import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { once } from 'node:events'
import { createApp } from './index.mjs'
import { createStore } from './publishing.mjs'

const TOKEN = 'test-publish-authorization-0123456789'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jc1sAAAAASUVORK5CYII=', 'base64')
const api = '/__trip_guide'
function pkg(id = 'test-tour') {
  return { schemaVersion: 1, id, name: '发布测试景点', description: '用于验证在线发布', start: { lng: 121.49, lat: 31.22 }, zoom: 18,
    coverImage: `/spots/${id}/photo.png`, publishedAt: 1,
    spots: [{ id: 'first', name: '第一站', poetic: '测试节点', lng: 121.49, lat: 31.22, triggerRadiusMeters: 20,
      image: `/spots/${id}/photo.png`, imageCredit: 'test', slides: [{ title: '讲解', bullets: ['一个要点'], narration: '测试讲解内容' }] }] }
}

async function fixture(t, { seeded = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tour-hub-server-test-'))
  const staticDir = path.join(root, 'dist')
  const dataDir = path.join(root, 'data')
  fs.mkdirSync(staticDir)
  fs.writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>test app</title>')
  if (seeded) {
    fs.mkdirSync(path.join(staticDir, 'spots', 'seed-tour'), { recursive: true })
    fs.writeFileSync(path.join(staticDir, 'spots', 'seed-tour', 'photo.png'), PNG)
    fs.writeFileSync(path.join(staticDir, 'spots', 'seed-tour.json'), JSON.stringify(pkg('seed-tour')))
    fs.writeFileSync(path.join(staticDir, 'spots', 'catalog.json'), JSON.stringify({ schemaVersion: 1, updatedAt: 1, items: [pkg('seed-tour')] }))
  }
  let server
  let base
  const start = async () => {
    server = createApp({ staticDir, dataDir, adminToken: TOKEN, requireAuth: true })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    base = `http://127.0.0.1:${server.address().port}`
  }
  const close = () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections() })
  await start()
  t.after(async () => {
    await close()
    // Only remove this test's verified temporary workspace.
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + 'tour-hub-server-test-')) throw new Error('unexpected test directory')
    fs.rmSync(root, { recursive: true, force: true })
  })
  return {
    root, dataDir,
    request: (url, options = {}, authorized = true) => fetch(base + url, { ...options, headers: {
      ...(authorized ? { Authorization: `Bearer ${TOKEN}` } : {}), ...options.headers } }),
    restart: async () => { await close(); await start() },
  }
}
const publish = (f, data) => f.request(api + '/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ package: data }) })
const upload = (f, id, name = 'photo.png', body = PNG) => f.request(`${api}/media?path=${encodeURIComponent(`${id}/${name}`)}`, { method: 'POST', body })

test('public reading works; publishing, recycle bin and upload require authorization', async (t) => {
  const f = await fixture(t)
  assert.equal((await f.request('/', {}, false)).status, 200)
  assert.equal((await f.request('/spots/catalog.json', {}, false)).status, 200)
  assert.equal((await f.request(api + '/health', {}, false)).status, 200)
  assert.deepEqual(await (await f.request(api + '/auth', {}, false)).json(), { ok: true, authRequired: true, authenticated: false })
  assert.equal((await (await f.request(api + '/auth')).json()).authenticated, true)
  for (const [url, method] of [[api + '/trash', 'GET'], [api + '/export', 'POST'], [api + '/media?path=x/a.png', 'POST'], [api + '/spot?id=x', 'DELETE'], [api + '/trash/restore?folder=x', 'POST']]) {
    assert.equal((await f.request(url, { method }, false)).status, 401)
  }
  assert.equal((await f.request(api + '/trash', { headers: { Authorization: 'Bearer wrong-token' } })).status, 401)
  assert.equal((await f.request(api + '/export', { method: 'POST', headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403)
})

test('real image upload → publish → immediate public catalog/package/image reading', async (t) => {
  const f = await fixture(t)
  assert.equal((await upload(f, 'test-tour')).status, 200)
  const result = await publish(f, pkg())
  assert.equal(result.status, 200)
  assert.equal((await result.json()).publicPath, '/spots/test-tour.json')
  const catalog = await f.request('/spots/catalog.json', {}, false)
  assert.equal(catalog.headers.get('cache-control'), 'no-cache')
  assert.equal((await catalog.json()).items[0].id, 'test-tour')
  const published = await (await f.request('/spots/test-tour.json', {}, false)).json()
  assert.ok(published.publishedAt > 1)
  const image = await f.request(published.coverImage, {}, false)
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), PNG)
  assert.equal(image.headers.get('content-type'), 'image/png')
})

test('invalid IDs, traversal, missing media and malformed packages do not mutate catalog', async (t) => {
  const f = await fixture(t)
  for (const id of ['../escape', 'catalog', 'CON', 'constructor', 'x/y', 'x\\y', 'x.']) {
    assert.equal((await publish(f, { ...pkg(), id })).status, 400)
  }
  assert.equal((await publish(f, pkg())).status, 400)
  await upload(f, 'test-tour')
  for (const data of [null, { ...pkg(), start: { lng: null, lat: 31 } }, { ...pkg(), schemaVersion: 9 }, { ...pkg(), spots: [] }, { ...pkg(), coverImage: '/spots/other/photo.png' }]) {
    assert.equal((await publish(f, data)).status, 400)
  }
  assert.equal((await f.request(`${api}/media?path=${encodeURIComponent('../escape.png')}`, { method: 'POST', body: PNG })).status, 400)
  assert.equal((await f.request(`${api}/media?path=${encodeURIComponent('test-tour/a.svg')}`, { method: 'POST', body: '<svg />' })).status, 400)
  assert.equal((await upload(f, 'test-tour', 'fake.png', Buffer.from('not an image'))).status, 400)
  assert.equal((await f.request(api + '/export', { method: 'POST', body: '{' })).status, 400)
  assert.deepEqual((await (await f.request('/spots/catalog.json')).json()).items, [])
  assert.equal(fs.existsSync(path.join(f.root, 'escape.json')), false)
})

test('immutable media prevents a failed republish from overwriting live pictures', async (t) => {
  const f = await fixture(t)
  await upload(f, 'test-tour')
  await publish(f, pkg())
  assert.equal((await upload(f, 'test-tour')).status, 200)
  assert.equal((await upload(f, 'test-tour', 'photo.png', Buffer.concat([PNG, Buffer.from('different')]))).status, 409)
  assert.deepEqual(Buffer.from(await (await f.request('/spots/test-tour/photo.png')).arrayBuffer()), PNG)
  assert.equal((await publish(f, { ...pkg(), zoom: 0 })).status, 400)
  assert.equal((await (await f.request('/spots/test-tour.json')).json()).zoom, 18)
})

test('concurrent publication preserves every catalog entry; edits replace only their own entry', async (t) => {
  const f = await fixture(t)
  const ids = ['tour-one', 'tour-two', 'tour-three']
  await Promise.all(ids.map((id) => upload(f, id)))
  const results = await Promise.all(ids.map((id) => publish(f, pkg(id))))
  assert.ok(results.every((response) => response.status === 200))
  assert.equal((await publish(f, { ...pkg('tour-two'), name: '更新后的景点' })).status, 200)
  const items = (await (await f.request('/spots/catalog.json')).json()).items
  assert.equal(items.length, 3)
  assert.equal(items.find((item) => item.id === 'tour-two').name, '更新后的景点')
})

test('delete hides package and media; restore recovers both; restart never overwrites persistent content', async (t) => {
  const f = await fixture(t, { seeded: true })
  await upload(f, 'test-tour')
  await publish(f, pkg())
  const deletion = await f.request(api + '/spot?id=seed-tour', { method: 'DELETE' })
  assert.equal(deletion.status, 200)
  const { folder } = await deletion.json()
  assert.equal((await f.request('/spots/seed-tour.json')).status, 404)
  assert.equal((await f.request('/spots/seed-tour/photo.png')).status, 404)
  await f.restart()
  assert.equal((await f.request('/spots/seed-tour.json')).status, 404)
  assert.equal((await f.request('/spots/test-tour.json')).status, 200)
  const trash = (await (await f.request(api + '/trash')).json()).items
  assert.equal(trash.length, 1)
  assert.equal(trash[0].folder, folder)
  assert.equal((await f.request(`${api}/trash/restore?folder=${folder}`, { method: 'POST' })).status, 200)
  assert.equal((await f.request('/spots/seed-tour.json')).status, 200)
  assert.deepEqual(Buffer.from(await (await f.request('/spots/seed-tour/photo.png')).arrayBuffer()), PNG)
  assert.equal((await (await f.request(api + '/trash')).json()).items.length, 0)
})

test('restore refuses to overwrite a republished attraction and keeps its backup', async (t) => {
  const f = await fixture(t)
  await upload(f, 'test-tour'); await publish(f, pkg())
  const { folder } = await (await f.request(api + '/spot?id=test-tour', { method: 'DELETE' })).json()
  await upload(f, 'test-tour'); await publish(f, { ...pkg(), name: '新版本' })
  assert.equal((await f.request(`${api}/trash/restore?folder=${folder}`, { method: 'POST' })).status, 409)
  assert.equal((await (await f.request('/spots/test-tour.json')).json()).name, '新版本')
  assert.equal((await (await f.request(api + '/trash')).json()).items.length, 1)
})

test('story publication validates dangling branches and unreachable nodes', async (t) => {
  const f = await fixture(t)
  await upload(f, 'test-tour')
  const story = { ...pkg(), mode: 'story', story: { entry: 'first', choices: { first: [] }, endings: { first: '结局' } } }
  assert.equal((await publish(f, story)).status, 200)
  assert.equal((await publish(f, { ...story, story: { entry: 'missing' } })).status, 400)
  assert.equal((await publish(f, { ...story, story: { choices: { first: [{ to: 'missing' }] } } })).status, 400)
  assert.equal((await publish(f, { ...story, spots: [...story.spots, { ...story.spots[0], id: 'orphan' }] })).status, 400)
})

test('oversized requests, unknown APIs and private filesystem paths are rejected', async (t) => {
  const f = await fixture(t)
  assert.equal((await f.request(api + '/export', { method: 'POST', body: ' '.repeat(4 * 1024 * 1024 + 1) })).status, 413)
  for (const url of ['/server/index.mjs', '/.env', '/data/trash/a.json', api + '/unknown', '/spots/missing.json']) {
    assert.equal((await f.request(url)).status, 404)
  }
})

test('catalog write failure rolls back package update; production refuses missing authorization', async (t) => {
  const f = await fixture(t)
  const store = createStore({ spotsDir: path.join(f.dataDir, 'spots'), trashDir: path.join(f.dataDir, 'trash') })
  store.upload('test-tour/photo.png', PNG)
  store.publish(pkg())
  const catalogPath = path.join(f.dataDir, 'spots', 'catalog.json')
  fs.writeFileSync(catalogPath, 'broken catalog')
  assert.throws(() => store.publish({ ...pkg(), name: '不应写入' }))
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.dataDir, 'spots', 'test-tour.json'), 'utf8')).name, '发布测试景点')
  assert.throws(() => createApp({ requireAuth: true }), /PUBLISH_ADMIN_TOKEN/)
})
