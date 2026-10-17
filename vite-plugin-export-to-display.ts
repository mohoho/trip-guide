import fs from 'node:fs'
import path from 'node:path'
import type { Plugin, Connect } from 'vite'

const DATA_DIR = './public/spots'
const TRASH_DIR = './.trash/spots'
const MEDIA_EXT = /\.(jpe?g|png|webp|gif)$/i
const SPOT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function resolveDataDir(root: string) {
  return path.resolve(root, DATA_DIR)
}

function resolveTrashDir(root: string) {
  return path.resolve(root, TRASH_DIR)
}

/** 景点 id 直接当文件名用，先挡掉目录分隔符与保留名 */
function resolveSpotId(id: string): string | null {
  if (!id || !SPOT_ID.test(id)) return null
  if (id === 'catalog' || id === TRASH_DIR) return null
  return id
}

/** 图片只能落在 public/spots 下；挡掉绝对路径与 .. 穿越 */
function resolveMediaFile(root: string, rel: string): string | null {
  if (!rel || !MEDIA_EXT.test(rel)) return null
  if (rel.startsWith('/') || rel.startsWith('\\') || rel.includes('\0')) return null
  const parts = rel.split(/[\\/]+/)
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return null
  const baseDir = resolveDataDir(root)
  const abs = path.resolve(baseDir, ...parts)
  if (!abs.startsWith(baseDir + path.sep)) return null
  return abs
}

function readJson<T>(file: string): T | null {
  try {
    if (!fs.existsSync(file)) return null
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}

function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

type Catalog = {
  schemaVersion: number
  updatedAt: number
  items: Array<{
    id: string
    name: string
    description: string
    coverImage: string
    publishedAt: number
    mode: string
  }>
}

type PublishedPkg = {
  schemaVersion: number
  id: string
  name: string
  description: string
  coverImage: string
  publishedAt: number
  assets?: Record<string, string>
  mode?: string
  [key: string]: unknown
}

function resolveCover(pkg: PublishedPkg): string {
  const ref = pkg.coverImage
  if (!ref) return ''
  if (ref.startsWith('data:') || /^https?:\/\//i.test(ref)) return ref
  if (pkg.assets?.[ref]) return pkg.assets[ref]
  return ref
}

function toCatalogEntry(pkg: PublishedPkg) {
  return {
    id: pkg.id,
    name: pkg.name,
    description: pkg.description,
    coverImage: resolveCover(pkg),
    publishedAt: pkg.publishedAt,
    mode: pkg.mode === 'story' ? 'story' : 'checkin',
  }
}

function mergeCatalog(existing: Catalog | null, pkg: PublishedPkg): Catalog {
  const item = toCatalogEntry(pkg)
  const prev = Array.isArray(existing?.items) ? existing!.items : []
  return {
    schemaVersion: 1,
    updatedAt: Date.now(),
    items: [item, ...prev.filter((i) => i.id !== pkg.id)],
  }
}

/** 恢复时按 publishedAt 插回原位置，免得"恢复一个旧景点"把它顶到最前面 */
function upsertCatalog(catalogFile: string, pkg: PublishedPkg) {
  const catalog = readJson<Catalog>(catalogFile)
  if (!catalog) return
  catalog.items = [...(Array.isArray(catalog.items) ? catalog.items : []).filter((i) => i.id !== pkg.id), toCatalogEntry(pkg)].sort(
    (a, b) => (b.publishedAt || 0) - (a.publishedAt || 0),
  )
  catalog.updatedAt = Date.now()
  writeJson(catalogFile, catalog)
}

type TrashEntry = {
  /** .trash/spots 下的目录名（重复删除会带时间戳后缀，恢复时按它定位） */
  folder: string
  id: string
  name: string
  mode: string
  publishedAt: number
  trashedAt: number
}

function resolveTrashFolder(root: string, folder: string): string | null {
  if (!folder || !SPOT_ID.test(folder)) return null
  const abs = path.join(resolveTrashDir(root), folder)
  if (!abs.startsWith(resolveTrashDir(root) + path.sep)) return null
  return fs.existsSync(abs) ? abs : null
}

function listTrashedSpots(root: string): TrashEntry[] {
  const dir = resolveTrashDir(root)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const folderPath = path.join(dir, e.name)
      const jsonName = fs.readdirSync(folderPath).find((f) => f.endsWith('.json'))
      const pkg = jsonName ? readJson<PublishedPkg>(path.join(folderPath, jsonName)) : null
      return {
        folder: e.name,
        id: (jsonName ? jsonName.replace(/\.json$/, '') : e.name) || e.name,
        name: pkg?.name || e.name,
        mode: pkg?.mode === 'story' ? 'story' : 'checkin',
        publishedAt: pkg?.publishedAt || 0,
        trashedAt: fs.statSync(folderPath).mtimeMs,
      }
    })
    .sort((a, b) => b.trashedAt - a.trashedAt)
}

/** 把 .trash 里的包与图片搬回 public/spots，并把 catalog 那条补回去 */
function restoreSpot(root: string, folder: string): { id: string; restored: string[] } {
  const src = resolveTrashFolder(root, folder)
  if (!src) throw new Error(`没有这条回收记录: ${folder}`)

  const jsonName = fs.readdirSync(src).find((f) => f.endsWith('.json'))
  if (!jsonName) throw new Error('回收目录里没有包 JSON，无法判断是哪个景点')
  const id = resolveSpotId(jsonName.replace(/\.json$/, ''))
  if (!id) throw new Error(`包 JSON 文件名不合法: ${jsonName}`)

  const dataDir = resolveDataDir(root)
  const pkgFile = path.join(dataDir, `${id}.json`)
  const mediaDir = path.join(dataDir, id)
  if (fs.existsSync(pkgFile) || fs.existsSync(mediaDir)) {
    throw new Error(`public/spots 里已经有 ${id} 了，先把它删掉或改名再恢复`)
  }

  const restored: string[] = []
  fs.renameSync(path.join(src, jsonName), pkgFile)
  restored.push(`${id}.json`)
  const mediaSrc = path.join(src, id)
  if (fs.existsSync(mediaSrc) && fs.statSync(mediaSrc).isDirectory()) {
    fs.renameSync(mediaSrc, mediaDir)
    restored.push(`${id}/`)
  }
  fs.rmSync(src, { recursive: true, force: true })

  const pkg = readJson<PublishedPkg>(pkgFile)
  if (pkg) upsertCatalog(path.join(dataDir, 'catalog.json'), pkg)

  return { id, restored }
}

/**
 * 已发布景点移入 .trash/spots（包 JSON + 图片目录都留着，可人工搬回 public/spots），
 * 并把它从 catalog 里摘掉。public/spots 因此始终等于"当前已发布"。
 */
function trashSpot(root: string, id: string): { trashDir: string; trashed: string[] } {
  const dataDir = resolveDataDir(root)
  const pkgFile = path.join(dataDir, `${id}.json`)
  const mediaDir = path.join(dataDir, id)
  const hasPkg = fs.existsSync(pkgFile)
  const hasMedia = fs.existsSync(mediaDir) && fs.statSync(mediaDir).isDirectory()
  if (!hasPkg && !hasMedia) throw new Error(`没有这个景点: ${id}`)

  const trashRoot = resolveTrashDir(root)
  let dest = path.join(trashRoot, id)
  if (fs.existsSync(dest)) dest = path.join(trashRoot, `${id}-${Date.now().toString(36)}`)
  fs.mkdirSync(dest, { recursive: true })

  const trashed: string[] = []
  if (hasPkg) {
    fs.renameSync(pkgFile, path.join(dest, `${id}.json`))
    trashed.push(`${id}.json`)
  }
  if (hasMedia) {
    fs.renameSync(mediaDir, path.join(dest, id))
    trashed.push(`${id}/`)
  }

  const catalogFile = path.join(dataDir, 'catalog.json')
  const catalog = readJson<Catalog>(catalogFile)
  if (catalog) {
    catalog.items = (Array.isArray(catalog.items) ? catalog.items : []).filter((i) => i.id !== id)
    catalog.updatedAt = Date.now()
    writeJson(catalogFile, catalog)
  }

  return { trashDir: dest, trashed }
}

function readBuffer(req: Connect.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function readBody(req: Connect.IncomingMessage): Promise<string> {
  return (await readBuffer(req)).toString('utf8')
}

/** 开发态：图片落成文件、包体写入本应用 public/spots */
export function exportToDisplayPlugin(): Plugin {
  let root = process.cwd()

  return {
    name: 'trip-guide-export',
    configResolved(config) {
      root = config.root
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0] || ''

        // 图片二进制落盘：包 JSON 里只留路径，不再内嵌 base64
        if (url === '/__trip_guide/media' && req.method === 'POST') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          try {
            const rel = new URL(req.url || '', 'http://localhost').searchParams.get('path') || ''
            const file = resolveMediaFile(root, rel)
            if (!file) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, error: `非法图片路径: ${rel}` }))
              return
            }
            const buf = await readBuffer(req)
            if (!buf.length) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, error: '图片内容为空' }))
              return
            }
            fs.mkdirSync(path.dirname(file), { recursive: true })
            fs.writeFileSync(file, buf)
            res.end(JSON.stringify({ ok: true, mediaPath: rel, bytes: buf.length }))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : '图片写入失败' }))
          }
          return
        }

        // 回收站：列出 .trash 里的景点
        if (url === '/__trip_guide/trash' && req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: true, items: listTrashedSpots(root) }))
          return
        }

        // 恢复：把 .trash 里的包与图片搬回 public/spots，catalog 补回该条
        if (url === '/__trip_guide/trash/restore' && req.method === 'POST') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          try {
            const folder = new URL(req.url || '', 'http://localhost').searchParams.get('folder') || ''
            const result = restoreSpot(root, folder)
            res.end(JSON.stringify({ ok: true, ...result }))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : '恢复失败' }))
          }
          return
        }

        // 删除已发布景点：移入 .trash（可恢复）+ 从 catalog 摘掉
        if (url === '/__trip_guide/spot' && req.method === 'DELETE') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          try {
            const raw = new URL(req.url || '', 'http://localhost').searchParams.get('id') || ''
            const id = resolveSpotId(raw)
            if (!id) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, error: `非法景点 id: ${raw}` }))
              return
            }
            const result = trashSpot(root, id)
            res.end(JSON.stringify({ ok: true, ...result }))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : '删除失败' }))
          }
          return
        }

        if (url !== '/__trip_guide/export' || req.method !== 'POST') {
          next()
          return
        }

        try {
          const absoluteDataDir = resolveDataDir(root)
          const body = await readBody(req)
          const parsed = JSON.parse(body) as { package?: PublishedPkg }
          const pkg = parsed.package
          if (!pkg?.id) {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, error: '缺少 package.id' }))
            return
          }

          writeJson(path.join(absoluteDataDir, `${pkg.id}.json`), pkg)

          const catalogFile = path.join(absoluteDataDir, 'catalog.json')
          const catalog = mergeCatalog(readJson<Catalog>(catalogFile), pkg)
          writeJson(catalogFile, catalog)

          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(
            JSON.stringify({
              ok: true,
              absolutePath: absoluteDataDir,
              attractionPath: `${pkg.id}.json`,
              catalogPath: 'catalog.json',
            }),
          )
        } catch (e) {
          res.statusCode = 500
          res.end(
            JSON.stringify({
              ok: false,
              error: e instanceof Error ? e.message : '发布写入失败',
            }),
          )
        }
      })
    },
  }
}
