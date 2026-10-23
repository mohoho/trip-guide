import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { ApiError, createStore, createPublishingHandler, json, safeFile } from './publishing.mjs'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2', '.ico': 'image/x-icon' }

export function createApp({ staticDir = path.join(ROOT, 'dist'), dataDir = path.join(ROOT, 'data'),
  seedDir = path.join(staticDir, 'spots'), adminToken = '', requireAuth = false } = {}) {
  if (requireAuth && adminToken.length < 24) throw new Error('生产环境必须设置至少 24 位 PUBLISH_ADMIN_TOKEN')
  const store = createStore({ spotsDir: path.join(dataDir, 'spots'), trashDir: path.join(dataDir, 'trash'), seedDir })
  const publishing = createPublishingHandler({ store, adminToken })
  return createServer(async (req, res) => {
    try {
      if (await publishing(req, res)) return
      if (!['GET', 'HEAD'].includes(req.method)) { json(res, 405, { ok: false, error: '请求方法不支持' }); return }
      let pathname
      try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname) } catch { throw new ApiError(400, 'URL 不合法') }
      const isData = pathname.startsWith('/spots/')
      const relative = isData ? pathname.slice('/spots/'.length) : pathname === '/' ? 'index.html' : pathname.slice(1)
      if (pathname.includes('\\')) throw new ApiError(400, '路径不合法')
      const extension = path.extname(relative).toLowerCase()
      // Never fall back from /spots to bundled seed data after deletion.
      const allowed = isData ? ['.json', '.jpg', '.jpeg', '.png', '.webp', '.gif'] : Object.keys(MIME)
      if (!allowed.includes(extension)) throw new ApiError(404, '文件不存在')
      const file = safeFile(isData ? store.spotsDir : staticDir, relative)
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new ApiError(404, '文件不存在')
      res.writeHead(200, { 'Content-Type': MIME[extension], 'Content-Length': fs.statSync(file).size,
        'Cache-Control': !isData && relative.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' })
      if (req.method === 'HEAD') res.end()
      else {
        const stream = fs.createReadStream(file)
        stream.on('error', () => res.destroy())
        stream.pipe(res)
      }
    } catch (error) {
      if (!res.headersSent) json(res, error instanceof ApiError ? error.status : 500,
        { ok: false, error: error instanceof ApiError ? error.message : '服务器读取失败' })
    }
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST || '127.0.0.1'
  const port = Number(process.env.PORT || 3001)
  const server = createApp({ dataDir: process.env.DATA_DIR, staticDir: process.env.STATIC_DIR,
    adminToken: process.env.PUBLISH_ADMIN_TOKEN || '',
    requireAuth: process.env.NODE_ENV === 'production' || !['127.0.0.1', '::1', 'localhost'].includes(host) })
  server.requestTimeout = 60000
  server.headersTimeout = 15000
  server.listen(port, host, () => console.log(`时空漫游者已启动：http://${host}:${port}`))
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)))
}
