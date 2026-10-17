/**
 * 导览发布包类型与校验
 * 外部 AI 生产内容请遵循项目 Skill：`.cursor/skills/trip-guide-content/SKILL.md`
 */

import { validateStoryGraph } from './storyTour'

export const PACKAGE_SCHEMA_VERSION = 1 as const

export interface LngLat {
  lng: number
  lat: number
}

export interface Slide {
  title: string
  bullets: string[]
  narration: string
}

/** 导览模式：缺省（含存量包）= 打卡 */
export type TourMode = 'checkin' | 'story'

/** 故事模式的一个去向；label 留空时前台显示「下一步 · 目标名」 */
export interface StoryChoice {
  /** 去向节点 id */
  to: string
  label?: string
  /** 一行小字，如「约 80 米 · 5 分钟」 */
  note?: string
}

/** 故事模式的分支关系；`choices` 里没有的节点按 spots 顺序接下一个，最后一个即结局 */
export interface StoryGraph {
  /** 故事名，与景点名并列的那行副标题；缺省 = 不起名字 */
  title?: string
  /** 入口节点 id；缺省 = spots[0] */
  entry?: string
  choices?: Record<string, StoryChoice[]>
  /** 结局标题，如「结局 · 虎啸山林」 */
  endings?: Record<string, string>
}

export interface PublishedSpot {
  id: string
  name: string
  poetic: string
  lng: number
  lat: number
  triggerRadiusMeters: number
  image: string
  imageCredit: string
  slides: Slide[]
}

export interface PublishedAttraction {
  schemaVersion: typeof PACKAGE_SCHEMA_VERSION
  id: string
  name: string
  description: string
  start: LngLat
  zoom: number
  spots: PublishedSpot[]
  coverImage: string
  publishedAt: number
  assets?: Record<string, string>
  /** 导览模式；缺省视作 `'checkin'`，前台据此选页面 */
  mode?: TourMode
  /** 故事模式的分支关系；打卡模式下不存在 */
  story?: StoryGraph
  /** 游客头像（导览页地图上那枚标记）；缺省 = 内置吉祥物 */
  visitorAvatar?: string
}

export interface CatalogItem {
  id: string
  name: string
  description: string
  coverImage: string
  publishedAt: number
  /** 导览模式；缺省视作 `'checkin'`（存量 catalog 没有这个字段） */
  mode?: TourMode
}

export interface AttractionCatalog {
  schemaVersion: typeof PACKAGE_SCHEMA_VERSION
  updatedAt: number
  items: CatalogItem[]
}

export function resolveMediaUrl(
  pkg: Pick<PublishedAttraction, 'assets'> | null | undefined,
  ref: string | undefined | null,
): string {
  if (!ref) return ''
  if (ref.startsWith('data:') || /^https?:\/\//i.test(ref)) return ref
  const fromAssets = pkg?.assets?.[ref]
  if (fromAssets) return fromAssets
  return ref
}

export function toCatalogItem(pkg: PublishedAttraction): CatalogItem {
  return {
    id: pkg.id,
    name: pkg.name,
    description: pkg.description,
    coverImage: resolveMediaUrl(pkg, pkg.coverImage),
    publishedAt: pkg.publishedAt,
    mode: pkg.mode === 'story' ? 'story' : 'checkin',
  }
}

export function assertPublishedAttraction(raw: unknown): PublishedAttraction {
  if (!raw || typeof raw !== 'object') throw new Error('发布包无效：非对象')
  const p = raw as Partial<PublishedAttraction>
  if (p.schemaVersion !== PACKAGE_SCHEMA_VERSION) {
    throw new Error(`发布包 schemaVersion 不支持：${String(p.schemaVersion)}`)
  }
  if (!p.id || !p.name) throw new Error('发布包缺少 id/name')
  if (!p.start || typeof p.start.lng !== 'number' || typeof p.start.lat !== 'number') {
    throw new Error('发布包缺少合法 start')
  }
  if (typeof p.zoom !== 'number' || p.zoom <= 0) throw new Error('发布包缺少合法 zoom')
  if (!Array.isArray(p.spots) || p.spots.length === 0) throw new Error('发布包 spots 为空')
  for (const spot of p.spots) {
    if (!spot?.image) throw new Error(`节点 ${spot?.id || '?'} 缺少 image`)
  }
  if (!p.coverImage) throw new Error('发布包缺少 coverImage')
  const pkg = p as PublishedAttraction
  // 故事模式的软校验：坏了只提醒，前台照旧降级成「按数组顺序走」，不白屏
  if (pkg.mode === 'story') {
    for (const issue of validateStoryGraph(pkg)) {
      if (issue.level === 'error') console.warn(`[story] ${issue.message}（已降级为按顺序走）`)
    }
  }
  return pkg
}

export function assertAttractionCatalog(raw: unknown): AttractionCatalog {
  if (!raw || typeof raw !== 'object') throw new Error('目录无效：非对象')
  const c = raw as Partial<AttractionCatalog>
  if (c.schemaVersion !== PACKAGE_SCHEMA_VERSION) {
    throw new Error(`目录 schemaVersion 不支持：${String(c.schemaVersion)}`)
  }
  if (!Array.isArray(c.items)) throw new Error('目录缺少 items')
  return c as AttractionCatalog
}

/** @deprecated 使用 PACKAGE_SCHEMA_VERSION */
export const CONTRACT_SCHEMA_VERSION = PACKAGE_SCHEMA_VERSION
