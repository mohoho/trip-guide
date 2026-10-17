import type { AmapPoi } from '../lib/amapLocate'
import type { LngLat, PublishedSpot, StoryGraph, TourMode } from '../lib/tourPackage'

export type { LngLat, Slide, StoryChoice, StoryGraph, TourMode } from '../lib/tourPackage'
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
  /** 游客头像（导览页地图上那枚标记）；缺省 = 内置吉祥物 */
  visitorAvatar?: string
  createdAt: number
  updatedAt: number
  /** 阶段一/二里上次停在哪一步，进入 /publish/:id 时恢复；草稿态字段，不进发布契约 */
  lastStage?: 1 | 2
  /** 导览模式；缺省 = 打卡 */
  mode?: TourMode
  /** 故事模式的分支关系；打卡模式下留着也不进发布契约 */
  story?: StoryGraph
  /** 故事模式的创作方向（主线 / 语气 / 意象），只喂给 AI；草稿态字段，不进发布契约 */
  storyDirection?: string
}
