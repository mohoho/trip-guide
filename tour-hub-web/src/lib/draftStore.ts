import {
  CONTRACT_SCHEMA_VERSION,
  resolveMediaUrl,
  toCatalogItem,
  type AttractionCatalog,
  type LngLat,
  type PublishedAttraction,
} from './tourPackage'
import { exportPackageViaServer } from './exportTarget'
import { loadPublishedAttraction } from './catalog'
import type { DraftAttraction, Spot } from '../types/attraction'

const STORAGE_KEY = 'trip-guide:drafts:v1'
export const DEFAULT_MAP_ZOOM = 18.5

function startFromFirstSpot(spots: Spot[], fallback?: LngLat): LngLat {
  const first = spots[0]
  if (first) return { lng: first.lng, lat: first.lat }
  return fallback || { lng: 121.49195, lat: 31.2272 }
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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
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
    zoom: pkg.zoom || DEFAULT_MAP_ZOOM,
    spots: pkg.spots.map((s) => ({
      ...s,
      image: resolveMediaUrl(pkg, s.image),
    })),
    coverImage: resolveMediaUrl(pkg, pkg.coverImage),
    createdAt: pkg.publishedAt || now,
    updatedAt: now,
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

/** 从高德候选地点生成导览节点（坐标已确定，讲解文案待补） */
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

/** 把草稿中的图片引用变成 data URL（支持 data: / http(s) / 站点相对路径） */
async function toDataUrl(ref: string): Promise<{ dataUrl: string; ext: string }> {
  if (!ref) throw new Error('空图片引用')
  if (ref.startsWith('data:')) {
    return { dataUrl: ref, ext: extFromMimeOrRef(ref) }
  }

  const url = /^https?:\/\//i.test(ref) ? ref : new URL(ref, window.location.origin).href
  const res = await fetch(url)
  if (!res.ok) throw new Error(`图片读取失败: ${ref} (${res.status})`)
  const blob = await res.blob()
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error(`图片编码失败: ${ref}`))
    reader.readAsDataURL(blob)
  })
  return { dataUrl, ext: extFromMimeOrRef(ref, blob.type) }
}

/**
 * 将草稿图片收拢进 assets，并把 image/coverImage 改写成 assets/... 键
 * 这样发布包自带图片，不依赖展示端事先有 /spots 文件
 */
export async function materializeMedia(draft: DraftAttraction): Promise<{
  spots: Spot[]
  coverImage: string
  assets: Record<string, string>
}> {
  const assets: Record<string, string> = {}
  const dataUrlToKey = new Map<string, string>()

  const put = async (logicalName: string, ref: string): Promise<string> => {
    const { dataUrl, ext } = await toDataUrl(ref)
    const existing = dataUrlToKey.get(dataUrl)
    if (existing) return existing
    const key = `assets/${draft.id}/${logicalName}${ext}`
    assets[key] = dataUrl
    dataUrlToKey.set(dataUrl, key)
    return key
  }

  const spots: Spot[] = []
  for (const spot of draft.spots) {
    const image = await put(spot.id, spot.image || '/spots/map-intro.jpg')
    spots.push({ ...spot, image })
  }

  const coverRef = draft.coverImage || spots[0]?.image || '/spots/map-intro.jpg'
  // coverRef 若已是 assets 键，直接复用；否则按原引用读取
  const coverImage = coverRef.startsWith('assets/')
    ? coverRef
    : await put('cover', coverRef)

  return { spots, coverImage, assets }
}

/** 草稿 → 展示端契约发布包（含 assets 图片） */
export async function toPublishedPackage(draft: DraftAttraction): Promise<PublishedAttraction> {
  const first = draft.spots[0]
  if (!first) throw new Error('没有节点，无法发布')
  const media = await materializeMedia(draft)
  const spots = media.spots.map(({ searchHint: _hint, ...rest }) => rest)
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    id: draft.id,
    name: draft.name,
    description: draft.description,
    start: draft.start,
    zoom: draft.zoom || DEFAULT_MAP_ZOOM,
    spots,
    coverImage: media.coverImage,
    publishedAt: Date.now(),
    assets: media.assets,
  }
}

export function buildCatalog(packages: PublishedAttraction[]): AttractionCatalog {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    updatedAt: Date.now(),
    items: packages.map(toCatalogItem),
  }
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * 发布：打包图片后写入本应用 public/spots（与前台同一数据源）
 * 开发服务不可用时回落为浏览器下载
 */
export async function publishDraft(
  id: string,
  opts?: { zoom?: number; start?: LngLat },
): Promise<{
  draft: DraftAttraction
  pkg: PublishedAttraction
  mode: 'config' | 'download'
  targetLabel?: string
} | null> {
  const item = getDraft(id)
  if (!item || item.spots.length === 0) return null
  const draft = saveDraft({
    ...item,
    status: 'published',
    start: opts?.start || item.start,
    zoom: typeof opts?.zoom === 'number' && opts.zoom > 0 ? opts.zoom : item.zoom || DEFAULT_MAP_ZOOM,
    coverImage: item.coverImage || item.spots[0].image,
  })
  const pkg = await toPublishedPackage(draft)

  try {
    const written = await exportPackageViaServer(pkg)
    return {
      draft,
      pkg,
      mode: 'config',
      targetLabel: `${written.absolutePath}\\${written.attractionPath}`,
    }
  } catch {
    downloadJson(`${pkg.id}.json`, pkg)
    await new Promise((r) => setTimeout(r, 120))
    downloadJson('catalog.json', buildCatalog([pkg]))
    return { draft, pkg, mode: 'download' }
  }
}
