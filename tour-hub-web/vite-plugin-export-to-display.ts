import fs from 'node:fs'
import path from 'node:path'
import type { Plugin, Connect } from 'vite'

const DATA_DIR = './public/spots'
const MEDIA_EXT = /\.(jpe?g|png|webp|gif)$/i

function resolveDataDir(root: string) {
  return path.resolve(root, DATA_DIR)
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
  [key: string]: unknown
}

function resolveCover(pkg: PublishedPkg): string {
  const ref = pkg.coverImage
  if (!ref) return ''
  if (ref.startsWith('data:') || /^https?:\/\//i.test(ref)) return ref
  if (pkg.assets?.[ref]) return pkg.assets[ref]
  return ref
}

function mergeCatalog(existing: Catalog | null, pkg: PublishedPkg): Catalog {
  const item = {
    id: pkg.id,
    name: pkg.name,
    description: pkg.description,
    coverImage: resolveCover(pkg),
    publishedAt: pkg.publishedAt,
  }
  const prev = Array.isArray(existing?.items) ? existing!.items : []
  return {
    schemaVersion: 1,
    updatedAt: Date.now(),
    items: [item, ...prev.filter((i) => i.id !== pkg.id)],
  }
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
