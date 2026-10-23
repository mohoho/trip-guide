import {
  CONTRACT_SCHEMA_VERSION,
  resolveMediaUrl,
  toCatalogItem,
  type AttractionCatalog,
  type LngLat,
  type PublishedAttraction,
} from './tourPackage'
import { exportPackageViaServer, type MediaFile } from './exportTarget'
import { loadPublishedAttraction } from './catalog'
import type { DraftAttraction, Spot } from '../types/attraction'

const STORAGE_KEY = 'trip-guide:drafts:v1'
export const DEFAULT_MAP_ZOOM = 18.5

function startFromFirstSpot(spots: Spot[], fallback?: LngLat): LngLat {
  const first = spots[0]
  if (first) return { lng: first.lng, lat: first.lat }
  return fallback || { lng: 121.49195, lat: 31.2272 }
}

/** 坐标字段统一过一道：坏值当没写（视野中心只影响开场取景，缺省回落成 start） */
function validPos(pos: LngLat | undefined | null): LngLat | undefined {
  if (!pos || typeof pos.lng !== 'number' || typeof pos.lat !== 'number') return undefined
  return pos
}

function normalizeDraft(raw: DraftAttraction): DraftAttraction {
  const spots = Array.isArray(raw.spots) ? raw.spots : []
  const hasStart =
    raw.start &&
    typeof raw.start.lng === 'number' &&
    typeof raw.start.lat === 'number' &&
    (raw.start.lng !== 0 || raw.start.lat !== 0)
  return {
    ...raw,
    spots,
    city: typeof raw.city === 'string' ? raw.city : '',
    amapContext: typeof raw.amapContext === 'string' ? raw.amapContext : '',
    candidates: Array.isArray(raw.candidates) ? raw.candidates : [],
    zoom: typeof raw.zoom === 'number' && raw.zoom > 0 ? raw.zoom : DEFAULT_MAP_ZOOM,
    start: hasStart ? raw.start : startFromFirstSpot(spots, raw.start),
    view: validPos(raw.view),
  }
}

function readAll(): DraftAttraction[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as DraftAttraction[]
    return Array.isArray(parsed) ? parsed.map(normalizeDraft) : []
  } catch {
    return []
  }
}

function writeAll(list: DraftAttraction[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    /* 浏览器禁用存储（沙箱、隐私模式）时草稿只留内存，不阻断当前会话 */
  }
}

/** 仅本地未发布/编辑中的草稿（与 public/spots 分离） */
export function listLocalDrafts(): DraftAttraction[] {
  return readAll().sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getDraft(id: string): DraftAttraction | null {
  return readAll().find((a) => a.id === id) || null
}

export function publishedToDraft(pkg: PublishedAttraction): DraftAttraction {
  const now = Date.now()
  return {
    id: pkg.id,
    name: pkg.name,
    description: pkg.description,
    status: 'published',
    start: pkg.start,
    view: validPos(pkg.view),
    zoom: pkg.zoom || DEFAULT_MAP_ZOOM,
    spots: pkg.spots.map((s) => ({
      ...s,
      image: resolveMediaUrl(pkg, s.image),
    })),
    coverImage: resolveMediaUrl(pkg, pkg.coverImage),
    visitorAvatar: pkg.visitorAvatar ? resolveMediaUrl(pkg, pkg.visitorAvatar) : undefined,
    createdAt: pkg.publishedAt || now,
    updatedAt: now,
    mode: pkg.mode === 'story' ? 'story' : undefined,
    story: pkg.story ? { ...pkg.story } : undefined,
  }
}

/** 编辑器用：本地草稿优先，否则从 public/spots 发布包载入 */
export async function ensureEditableDraft(id: string): Promise<DraftAttraction | null> {
  const local = getDraft(id)
  if (local) return local
  try {
    const pkg = await loadPublishedAttraction(id)
    return saveDraft(publishedToDraft(pkg))
  } catch {
    return null
  }
}

export function createDraft(input: {
  name: string
  description: string
  start?: LngLat
}): DraftAttraction {
  const now = Date.now()
  const start = input.start || { lng: 121.49195, lat: 31.2272 }
  const item: DraftAttraction = {
    id: `attr-${now.toString(36)}`,
    name: input.name.trim() || '未命名景点',
    description: input.description.trim(),
    status: 'draft',
    start,
    zoom: DEFAULT_MAP_ZOOM,
    spots: [],
    coverImage: '/spots/map-intro.jpg',
    createdAt: now,
    updatedAt: now,
  }
  const list = listLocalDrafts()
  list.unshift(item)
  writeAll(list)
  return item
}

export function saveDraft(next: DraftAttraction): DraftAttraction {
  const list = listLocalDrafts()
  const idx = list.findIndex((a) => a.id === next.id)
  const saved = { ...next, updatedAt: Date.now() }
  if (idx >= 0) list[idx] = saved
  else list.unshift(saved)
  writeAll(list)
  return saved
}

export function deleteDraft(id: string): boolean {
  writeAll(listLocalDrafts().filter((a) => a.id !== id))
  return true
}

/**
 * 节点文案是否还是新建时的占位内容 —— 「已编辑 / 未编辑」的唯一判定口径。
 * 三种占位：带显式标记、没有任何要点、要点只剩高德自动写入的「地址：」行。
 */
export function isSpotPlaceholder(spot: Spot): boolean {
  const bullets = (spot.slides[0]?.bullets || []).map((b) => b.trim()).filter(Boolean)
  if (bullets.length === 0) return true
  if (bullets.some((b) => b.includes('待完善讲解要点'))) return true
  return bullets.every((b) => b.startsWith('地址：'))
}

export function newSpotAt(pos: LngLat, index: number): Spot {
  const n = index + 1
  return {
    id: `spot-${Date.now().toString(36)}-${n}`,
    name: `节点 ${n}`,
    poetic: '',
    lng: pos.lng,
    lat: pos.lat,
    triggerRadiusMeters: 38,
    image: '/spots/map-intro.jpg',
    imageCredit: '',
    slides: [
      {
        title: `节点 ${n}`,
        bullets: ['待完善讲解要点'],
        narration: `这里是第 ${n} 站。`,
      },
    ],
  }
}

/** 从高德候选地点生成漫游节点（坐标已确定，讲解文案待补） */
export function newSpotFromCandidate(
  poi: { name: string; location: LngLat; address?: string },
  index: number,
): Spot {
  const n = index + 1
  return {
    id: `spot-${Date.now().toString(36)}-${n}`,
    name: poi.name,
    poetic: '',
    lng: poi.location.lng,
    lat: poi.location.lat,
    triggerRadiusMeters: 38,
    image: '/spots/map-intro.jpg',
    imageCredit: '',
    searchHint: poi.name,
    slides: [
      {
        title: poi.name,
        bullets: [poi.address ? `地址：${poi.address}` : '待完善讲解要点'],
        narration: `这里是${poi.name}。`,
      },
    ],
  }
}

function extFromMimeOrRef(ref: string, mime?: string): string {
  if (mime?.includes('png')) return '.png'
  if (mime?.includes('webp')) return '.webp'
  if (mime?.includes('gif')) return '.gif'
  if (mime?.includes('jpeg') || mime?.includes('jpg')) return '.jpg'
  const m = /\.(png|jpe?g|webp|gif)(?:\?|$)/i.exec(ref)
  if (m) return `.${m[1].toLowerCase().replace('jpeg', 'jpg')}`
  if (ref.startsWith('data:image/png')) return '.png'
  if (ref.startsWith('data:image/webp')) return '.webp'
  if (ref.startsWith('data:image/gif')) return '.gif'
  return '.jpg'
}

/** 图片引用 → Blob（支持 data: / http(s) / 站点相对路径） */
async function toBlob(ref: string): Promise<Blob> {
  if (!ref) throw new Error('空图片引用')
  if (ref.startsWith('data:')) {
    const decoded = await fetch(ref)
    if (!decoded.ok) throw new Error('图片解码失败')
    return decoded.blob()
  }
  const url = /^https?:\/\//i.test(ref) ? ref : new URL(ref, window.location.origin).href
  const res = await fetch(url)
  if (!res.ok) throw new Error(`图片读取失败: ${ref} (${res.status})`)
  return res.blob()
}

function sameBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false
  const va = new Uint8Array(a)
  const vb = new Uint8Array(b)
  for (let i = 0; i < va.length; i++) {
    if (va[i] !== vb[i]) return false
  }
  return true
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('图片编码失败'))
    reader.readAsDataURL(blob)
  })
}

/**
 * 草稿图片 → /spots/<id>/<节点>-<内容哈希>.<ext>，避免发布失败时覆盖线上图片
 * 同一张图（按字节比较）只留一份引用，避免包内重复
 */
export async function prepareMedia(draft: DraftAttraction): Promise<{
  spots: Spot[]
  coverImage: string
  visitorAvatar?: string
  media: MediaFile[]
}> {
  const media: MediaFile[] = []
  const seen: { sig: string; buffer: ArrayBuffer; publicPath: string }[] = []

  const put = async (logicalName: string, ref: string): Promise<string> => {
    const blob = await toBlob(ref)
    const buffer = await blob.arrayBuffer()
    const sig = `${blob.type}:${buffer.byteLength}`

    const dup = seen.find((c) => c.sig === sig && sameBytes(c.buffer, buffer))
    if (dup) return dup.publicPath

    // WebCrypto digest requires HTTPS. Plain HTTP installations use a random immutable filename.
    const digest = crypto.subtle ? new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)) : crypto.getRandomValues(new Uint8Array(16))
    const fingerprint = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 20)
    const relPath = `${draft.id}/${logicalName}-${fingerprint}${extFromMimeOrRef(ref, blob.type)}`
    const publicPath = `/spots/${relPath}`
    seen.push({ sig, buffer, publicPath })
    media.push({ relPath, publicPath, blob })
    return publicPath
  }

  const spots: Spot[] = []
  for (const spot of draft.spots) {
    const image = await put(spot.id, spot.image || '/spots/map-intro.jpg')
    spots.push({ ...spot, image })
  }

  const coverRef = draft.coverImage || spots[0]?.image || '/spots/map-intro.jpg'
  // 封面若与某个节点同图，复用同一路径
  const coverImage = spots.some((s) => s.image === coverRef) ? coverRef : await put('cover', coverRef)

  // 游客头像：没传就整份不出现，前台照旧用内置吉祥物
  const visitorAvatar = draft.visitorAvatar ? await put('visitor', draft.visitorAvatar) : undefined

  return { spots, coverImage, visitorAvatar, media }
}

/** 故事模式才把 mode/story 写进发布包；打卡包这两个字段一律不出现 */
function storyFields(draft: DraftAttraction): Pick<PublishedAttraction, 'mode' | 'story'> {
  if (draft.mode !== 'story') return {}
  return { mode: 'story', story: draft.story ?? {} }
}

/** 上传过游客头像才把 visitorAvatar 写进发布包 */
function avatarField(visitorAvatar: string | undefined): Pick<PublishedAttraction, 'visitorAvatar'> {
  return visitorAvatar ? { visitorAvatar } : {}
}

/** 作者框过视野中心才写进包；不写 = 前台照旧以游客起点为中心 */
function viewField(view: LngLat | undefined): Pick<PublishedAttraction, 'view'> {
  return view ? { view } : {}
}

/** 草稿 → 展示端契约发布包（图片为 /spots/... 路径引用，二进制由 media 落盘） */
export async function toPublishedPackage(draft: DraftAttraction): Promise<{
  pkg: PublishedAttraction
  media: MediaFile[]
}> {
  const first = draft.spots[0]
  if (!first) throw new Error('没有节点，无法发布')
  const prepared = await prepareMedia(draft)
  return {
    pkg: {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      id: draft.id,
      name: draft.name,
      description: draft.description,
      start: draft.start,
      zoom: draft.zoom || DEFAULT_MAP_ZOOM,
      spots: prepared.spots.map(({ searchHint: _hint, ...rest }) => rest),
      coverImage: prepared.coverImage,
      publishedAt: Date.now(),
      ...viewField(draft.view),
      ...storyFields(draft),
      ...avatarField(prepared.visitorAvatar),
    },
    media: prepared.media,
  }
}

/** 开发服务不可用时的兜底：把同一批图片内嵌为 data URL，产出单文件包 */
export async function toSelfContainedPackage(draft: DraftAttraction): Promise<PublishedAttraction> {
  const prepared = await prepareMedia(draft)
  const assets: Record<string, string> = {}
  for (const item of prepared.media) {
    assets[item.publicPath] = await blobToDataUrl(item.blob)
  }
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    id: draft.id,
    name: draft.name,
    description: draft.description,
    start: draft.start,
    zoom: draft.zoom || DEFAULT_MAP_ZOOM,
    spots: prepared.spots.map(({ searchHint: _hint, ...rest }) => rest),
    coverImage: prepared.coverImage,
    publishedAt: Date.now(),
    assets,
    ...viewField(draft.view),
    ...storyFields(draft),
    ...avatarField(prepared.visitorAvatar),
  }
}

export function buildCatalog(packages: PublishedAttraction[]): AttractionCatalog {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    updatedAt: Date.now(),
    items: packages.map(toCatalogItem),
  }
}

/**
 * 发布：先上传不可变图片、提交发布包；后端确认成功后才保存 published 状态。
 * 失败直接报告错误，草稿保留，不把下载文件误当作在线发布。
 */
export async function publishDraft(
  id: string,
  opts?: { zoom?: number; start?: LngLat },
): Promise<{
  draft: DraftAttraction
  pkg: PublishedAttraction
  mode: 'config'
  targetLabel?: string
} | null> {
  const item = getDraft(id)
  if (!item || item.spots.length === 0) return null
  const draft: DraftAttraction = {
    ...item,
    start: opts?.start || item.start,
    zoom: typeof opts?.zoom === 'number' && opts.zoom > 0 ? opts.zoom : item.zoom || DEFAULT_MAP_ZOOM,
    coverImage: item.coverImage || item.spots[0].image,
  }
  const { pkg, media } = await toPublishedPackage(draft)

  const written = await exportPackageViaServer(pkg, media)
  return {
    draft: saveDraft({ ...draft, status: 'published' }),
    pkg: { ...pkg, publishedAt: written.publishedAt },
    mode: 'config',
    targetLabel: written.publicPath,
  }
}
