import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

const fail = (message, status = 400) => { throw new ApiError(status, message) }
const hash = (value) => createHash('sha256').update(value).digest()
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value, max = 20000) => typeof value === 'string' && value.trim().length > 0 && value.length <= max
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/
const MEDIA = /\.(?:jpe?g|png|webp|gif)$/i

export function validId(id) {
  return typeof id === 'string' && ID.test(id) && !id.endsWith('.') &&
    !/^(catalog|constructor|prototype|con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(id)
}

/** Reject both path traversal and symlinks; callers provide an explicitly trusted root. */
export function safeFile(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes('\0')) fail('非法文件路径')
  const parts = relative.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..' || part.startsWith('.') || part.includes(':'))) fail('非法文件路径')
  const base = path.resolve(root)
  const file = path.resolve(base, ...parts)
  if (!file.startsWith(base + path.sep)) fail('非法文件路径')
  let current = base
  for (const part of parts) {
    current = path.join(current, part)
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) fail('不允许符号链接')
  }
  return file
}

function coordinate(value) {
  return object(value) && Number.isFinite(value.lng) && Math.abs(value.lng) <= 180 &&
    Number.isFinite(value.lat) && Math.abs(value.lat) <= 90
}

export function validatePackage(pkg) {
  if (!object(pkg) || pkg.schemaVersion !== 1 || !validId(pkg.id)) fail('发布包版本或景点 ID 不合法')
  if (!text(pkg.name, 200) || typeof pkg.description !== 'string' || pkg.description.length > 20000) fail('景点名称或简介不合法')
  if (!coordinate(pkg.start) || (pkg.view !== undefined && !coordinate(pkg.view))) fail('景点坐标不合法')
  if (!Number.isFinite(pkg.zoom) || pkg.zoom < 2 || pkg.zoom > 22) fail('地图缩放应在 2 到 22 之间')
  if (pkg.mode !== undefined && !['story', 'checkin'].includes(pkg.mode)) fail('未知漫游模式')
  if (!Array.isArray(pkg.spots) || !pkg.spots.length || pkg.spots.length > 300) fail('节点数量应为 1 到 300 个')
  if (pkg.assets !== undefined) fail('在线发布请上传图片文件，不接受内嵌资源包')
  const ids = new Set()
  for (const spot of pkg.spots) {
    if (!object(spot) || !validId(spot.id) || ids.has(spot.id) || !text(spot.name, 200)) fail('节点 ID 重复或名称不合法')
    ids.add(spot.id)
    if (!coordinate(spot) || !Number.isFinite(spot.triggerRadiusMeters) || spot.triggerRadiusMeters <= 0 || spot.triggerRadiusMeters > 10000) fail('节点坐标或触发距离不合法')
    if (!text(spot.image, 500) || typeof spot.poetic !== 'string' || typeof spot.imageCredit !== 'string') fail('节点缺少图片或说明')
    if (!Array.isArray(spot.slides) || !spot.slides.length || spot.slides.length > 50) fail('节点缺少讲解内容')
    for (const slide of spot.slides) {
      if (!object(slide) || !text(slide.title, 300) || !text(slide.narration) || !Array.isArray(slide.bullets) ||
        !slide.bullets.length || slide.bullets.length > 100 || !slide.bullets.every((b) => text(b, 4000))) fail('讲解标题、要点和口播不能为空')
    }
  }
  if (!text(pkg.coverImage, 500) || (pkg.visitorAvatar !== undefined && !text(pkg.visitorAvatar, 500))) fail('缺少封面或头像路径不合法')
  if (pkg.mode === 'story') {
    const story = pkg.story ?? {}
    if (!object(story) || (story.title !== undefined && typeof story.title !== 'string') ||
      (story.choices !== undefined && !object(story.choices)) || (story.endings !== undefined && !object(story.endings))) fail('故事结构不合法')
    const entry = story.entry ?? pkg.spots[0].id
    if (!ids.has(entry)) fail('故事入口不存在')
    for (const [from, choices] of Object.entries(story.choices ?? {})) {
      if (!ids.has(from) || !Array.isArray(choices) || choices.length > 300) fail('故事分支不合法')
      for (const choice of choices) {
        if (!object(choice) || !ids.has(choice.to) || (choice.label !== undefined && typeof choice.label !== 'string') ||
          (choice.note !== undefined && typeof choice.note !== 'string')) fail('故事分支指向不存在的节点或文案不合法')
      }
    }
    for (const [id, label] of Object.entries(story.endings ?? {})) {
      if (!ids.has(id) || typeof label !== 'string') fail('故事结局不合法')
    }
    const reachable = new Set()
    const stack = [entry]
    while (stack.length) {
      const id = stack.pop()
      if (reachable.has(id)) continue
      reachable.add(id)
      const i = pkg.spots.findIndex((s) => s.id === id)
      const next = story.choices?.[id] ?? (pkg.spots[i + 1] ? [{ to: pkg.spots[i + 1].id }] : [])
      stack.push(...next.map((choice) => choice.to))
    }
    if (reachable.size !== ids.size) fail('故事包含从入口无法到达的节点')
  }
  return { ...pkg, publishedAt: Date.now() }
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')) }
function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${randomUUID()}.tmp`
  try {
    const fd = fs.openSync(temp, 'wx')
    try { fs.writeFileSync(fd, content); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    fs.renameSync(temp, file)
  } finally { fs.rmSync(temp, { force: true }) }
}
const writeJson = (file, value) => atomicWrite(file, JSON.stringify(value, null, 2) + '\n')

function catalogEntry(pkg) {
  return { id: pkg.id, name: pkg.name, description: pkg.description, coverImage: pkg.coverImage,
    publishedAt: pkg.publishedAt, mode: pkg.mode === 'story' ? 'story' : 'checkin',
    ...(pkg.mode === 'story' && pkg.story?.title ? { storyTitle: pkg.story.title } : {}) }
}

/** One process owns a data directory. Synchronous transactions cannot interleave in this process. */
export function createStore({ spotsDir, trashDir, seedDir }) {
  spotsDir = path.resolve(spotsDir)
  trashDir = path.resolve(trashDir)
  fs.mkdirSync(spotsDir, { recursive: true })
  fs.mkdirSync(trashDir, { recursive: true })
  const catalogFile = path.join(spotsDir, 'catalog.json')
  if (!fs.existsSync(catalogFile)) {
    if (seedDir && fs.existsSync(seedDir)) fs.cpSync(seedDir, spotsDir, { recursive: true, force: false, errorOnExist: true })
    if (!fs.existsSync(catalogFile)) writeJson(catalogFile, { schemaVersion: 1, updatedAt: Date.now(), items: [] })
  }
  const catalog = () => {
    const value = readJson(catalogFile)
    if (value.schemaVersion !== 1 || !Array.isArray(value.items)) throw new Error('发布目录损坏，请从备份恢复')
    return value
  }
  catalog()
  const updateCatalog = (id, pkg) => {
    const previous = catalog()
    const items = previous.items.filter((item) => item.id !== id)
    if (pkg) items.push(catalogEntry(pkg))
    items.sort((a, b) => b.publishedAt - a.publishedAt)
    writeJson(catalogFile, { schemaVersion: 1, updatedAt: Date.now(), items })
  }
  return {
    spotsDir,
    upload(relative, buffer) {
      const parts = relative.split('/')
      if (parts.length !== 2 || !validId(parts[0]) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(parts[1]) || !MEDIA.test(parts[1])) fail('图片路径应为 景点ID/图片文件名')
      const file = safeFile(spotsDir, relative)
      const signatures = [buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255])),
        buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
        ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString()),
        buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP']
      const extension = path.extname(relative).toLowerCase()
      const expected = extension === '.png' ? 1 : extension === '.gif' ? 2 : extension === '.webp' ? 3 : 0
      if (!signatures[expected]) fail('图片内容与扩展名不匹配')
      if (fs.existsSync(file)) {
        if (!hash(fs.readFileSync(file)).equals(hash(buffer))) fail('同名图片内容不同，请重新打包发布', 409)
      } else atomicWrite(file, buffer)
      return { mediaPath: relative, bytes: buffer.length }
    },
    publish(raw) {
      const pkg = validatePackage(raw)
      for (const ref of [pkg.coverImage, pkg.visitorAvatar, ...pkg.spots.map((s) => s.image)].filter(Boolean)) {
        if (!ref.startsWith(`/spots/${pkg.id}/`) || !MEDIA.test(ref)) fail('发布图片必须属于当前景点')
        const file = safeFile(spotsDir, ref.slice('/spots/'.length))
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail('发布图片尚未上传')
      }
      const file = safeFile(spotsDir, `${pkg.id}.json`)
      const previous = fs.existsSync(file) ? fs.readFileSync(file) : null
      writeJson(file, pkg)
      try { updateCatalog(pkg.id, pkg) } catch (error) {
        if (previous) atomicWrite(file, previous)
        else fs.rmSync(file, { force: true })
        throw error
      }
      return { attractionPath: `${pkg.id}.json`, catalogPath: 'catalog.json', publishedAt: pkg.publishedAt,
        publicPath: `/spots/${pkg.id}.json` }
    },
    trash(id) {
      if (!validId(id)) fail('景点 ID 不合法')
      const file = safeFile(spotsDir, `${id}.json`)
      if (!fs.existsSync(file)) fail('景点不存在', 404)
      const folder = `${id}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
      const dest = safeFile(trashDir, folder)
      const media = safeFile(spotsDir, id)
      fs.mkdirSync(dest)
      try {
        fs.copyFileSync(file, path.join(dest, `${id}.json`))
        if (fs.existsSync(media)) fs.cpSync(media, path.join(dest, id), { recursive: true })
        writeJson(path.join(dest, 'manifest.json'), { id, trashedAt: Date.now() })
        updateCatalog(id)
      } catch (error) { fs.rmSync(dest, { recursive: true, force: true }); throw error }
      fs.rmSync(file, { force: true })
      fs.rmSync(media, { recursive: true, force: true })
      return { folder, trashed: [`${id}.json`, `${id}/`] }
    },
    listTrash() {
      return fs.readdirSync(trashDir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()).flatMap((entry) => {
        const folder = safeFile(trashDir, entry.name)
        // Read both the new manifest format and existing development recycle-bin folders.
        const name = fs.readdirSync(folder).find((name) => name.endsWith('.json') && name !== 'manifest.json')
        if (!name) return []
        const pkg = readJson(safeFile(folder, name))
        const manifest = path.join(folder, 'manifest.json')
        return [{ folder: entry.name, id: pkg.id, name: pkg.name, mode: pkg.mode === 'story' ? 'story' : 'checkin',
          publishedAt: pkg.publishedAt, trashedAt: fs.existsSync(manifest) ? readJson(manifest).trashedAt : fs.statSync(folder).mtimeMs }]
      }).sort((a, b) => b.trashedAt - a.trashedAt)
    },
    restore(folder) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(folder)) fail('回收记录不合法')
      const src = safeFile(trashDir, folder)
      if (!fs.existsSync(src)) fail('回收记录不存在', 404)
      const name = fs.readdirSync(src).find((name) => name.endsWith('.json') && name !== 'manifest.json')
      if (!name) fail('回收记录没有发布包')
      const pkg = readJson(safeFile(src, name))
      if (!validId(pkg.id)) fail('回收包 ID 不合法')
      const file = safeFile(spotsDir, `${pkg.id}.json`)
      if (fs.existsSync(file)) fail('已有同 ID 景点，请先处理后再恢复', 409)
      const mediaSrc = safeFile(src, pkg.id)
      const mediaDest = safeFile(spotsDir, pkg.id)
      // An interrupted upload may have left files; never replace them silently.
      if (fs.existsSync(mediaDest)) fail('存在同 ID 的图片目录，请先处理后再恢复', 409)
      try {
        if (fs.existsSync(mediaSrc)) fs.cpSync(mediaSrc, mediaDest, { recursive: true, dereference: false })
        writeJson(file, pkg)
        updateCatalog(pkg.id, pkg)
      } catch (error) {
        fs.rmSync(file, { force: true })
        fs.rmSync(mediaDest, { recursive: true, force: true })
        throw error
      }
      fs.rmSync(src, { recursive: true, force: true })
      return { id: pkg.id, restored: [`${pkg.id}.json`, `${pkg.id}/`] }
    },
  }
}

export function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(JSON.stringify(body))
}

async function readBody(req, maxBytes) {
  if (Number(req.headers['content-length']) > maxBytes) { req.resume(); fail('上传内容过大', 413) }
  return new Promise((resolve, reject) => {
    let length = 0
    let exceeded = false
    const chunks = []
    req.on('data', (chunk) => {
      length += chunk.length
      if (length > maxBytes) {
        if (!exceeded) { exceeded = true; chunks.length = 0; reject(new ApiError(413, '上传内容过大')) }
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => { if (!exceeded) resolve(Buffer.concat(chunks)) })
    req.on('error', reject)
    req.on('aborted', () => reject(new ApiError(400, '上传中断，请重新发布')))
  })
}

export function createPublishingHandler({ store, adminToken = '' }) {
  const authorized = (req) => !adminToken || timingSafeEqual(hash(req.headers.authorization ?? ''), hash(`Bearer ${adminToken}`))
  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (!url.pathname.startsWith('/__trip_guide/')) return false
    try {
      if (url.pathname === '/__trip_guide/health' && req.method === 'GET') {
        json(res, 200, { ok: true }); return true
      }
      if (url.pathname === '/__trip_guide/auth' && req.method === 'GET') {
        json(res, 200, { ok: true, authRequired: !!adminToken, authenticated: authorized(req) }); return true
      }
      if (req.headers['sec-fetch-site'] === 'cross-site') fail('不接受跨站点的发布请求', 403)
      if (!authorized(req)) fail('请先输入正确的发布口令', 401)
      let result
      if (url.pathname === '/__trip_guide/media' && req.method === 'POST') {
        result = store.upload(url.searchParams.get('path') ?? '', await readBody(req, 15 * 1024 * 1024))
      } else if (url.pathname === '/__trip_guide/export' && req.method === 'POST') {
        let body
        try { body = JSON.parse((await readBody(req, 4 * 1024 * 1024)).toString('utf8')) } catch (error) {
          if (error instanceof ApiError) throw error
          fail('请求不是合法 JSON')
        }
        result = store.publish(body?.package)
      } else if (url.pathname === '/__trip_guide/spot' && req.method === 'DELETE') {
        result = store.trash(url.searchParams.get('id') ?? '')
      } else if (url.pathname === '/__trip_guide/trash' && req.method === 'GET') {
        result = { items: store.listTrash() }
      } else if (url.pathname === '/__trip_guide/trash/restore' && req.method === 'POST') {
        result = store.restore(url.searchParams.get('folder') ?? '')
      } else fail('接口不存在或请求方法不支持', 404)
      json(res, 200, { ok: true, ...result })
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 500
      if (status === 500) console.error('[publishing]', error.message)
      if (!res.headersSent && !res.destroyed) json(res, status, { ok: false, error: status === 500 ? '服务器写入失败，请检查存储权限和磁盘空间' : error.message })
    }
    return true
  }
}
