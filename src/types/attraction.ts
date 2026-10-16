import type { AmapPoi } from '../lib/amapLocate'
import type { LngLat, PublishedSpot, Slide } from '../lib/tourPackage'

export type { LngLat, Slide }
export type Spot = PublishedSpot & {
  /** AI 给出的地图检索词；仅发布端草稿使用，导出契约前可忽略 */
  searchHint?: string
}

/** 高德候选地点（阶段一检索产物；picked 表示是否勾选） */
export type CandidatePoi = AmapPoi & { picked?: boolean }

/** 发布端草稿（不进入展示端契约） */
export interface DraftAttraction {
  id: string
  name: string
  description: string
  /** 城市/区域，辅助高德检索与 AI */
  city?: string
  /** 高德检索到的景区与周边地点摘要，供 AI 生成 */
  amapContext?: string
  /** 阶段一检索到的主景区 POI（用于按勾选重建 AI 输入） */
  areaPoi?: AmapPoi
  /** 阶段一检索出的附近候选地点 */
  candidates?: CandidatePoi[]
  status: 'draft' | 'published'
  start: LngLat
  zoom: number
  spots: Spot[]
  coverImage: string
  createdAt: number
  updatedAt: number
}
