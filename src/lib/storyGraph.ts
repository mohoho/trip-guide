import type { DraftAttraction } from '../types/attraction'
import type { StoryChoice } from './tourPackage'
import { storyNextChoices, storyStoredChoices } from './storyTour'

/** 布局用一个最小节点集：草稿与发布包都能套 */
interface GraphNode {
  id: string
  name: string
}

interface GraphSource {
  spots: GraphNode[]
  story?: { entry?: string; choices?: Record<string, StoryChoice[]> }
}

export interface StoryGraphNode {
  id: string
  name: string
  /** 从入口走几步（同层一列） */
  layer: number
  /** 同层里的第几行 */
  row: number
  isEntry: boolean
  isEnding: boolean
  /** 中心点坐标，SVG 直接用 */
  x: number
  y: number
  width: number
}

export interface StoryGraphEdge {
  from: string
  to: string
  /** 作者没连过、靠「按数组顺序接下一个」生效的那条边 */
  implicit: boolean
}

export interface StoryGraphLayout {
  nodes: StoryGraphNode[]
  edges: StoryGraphEdge[]
  layerCount: number
  width: number
  height: number
  nodeHeight: number
}

const NODE_HEIGHT = 34
const ROW_GAP = 16
const COL_GAP = 56
const PAD_X = 16
const PAD_Y = 16

function nodeWidth(name: string): number {
  const chars = Array.from(name)
  // 中文按一个全角宽算，粗略但够用；上下各留 14 内边距
  const textWidth = chars.reduce((sum, ch) => sum + (/[\u4e00-\u9fff]/.test(ch) ? 13 : 7.5), 0)
  return Math.max(72, Math.min(184, Math.round(textWidth) + 28))
}

/**
 * 生效图 → 分层布局数据（纯函数，无 DOM）。
 * 分层取「从入口出发的最长路径」：否则一条长链会把中段节点挤到同一列、看不出来它其实在前面。
 * 未连过的节点按数组顺序补出的那条边也照实画，只是标成 implicit 供调用方画虚线。
 */
export function layoutStoryGraph(pkg: GraphSource): StoryGraphLayout {
  const ids = new Set(pkg.spots.map((s) => s.id))
  const order = new Map(pkg.spots.map((s, i) => [s.id, i]))
  const entry = (() => {
    const e = pkg.story?.entry
    if (e && ids.has(e)) return e
    return pkg.spots[0]?.id ?? null
  })()

  const edges: StoryGraphEdge[] = []
  const outgoing = new Map<string, StoryGraphEdge[]>()
  for (const spot of pkg.spots) {
    const stored = new Set(storyStoredChoices(pkg, spot.id).map((c) => c.to))
    for (const choice of storyNextChoices(pkg, spot.id)) {
      // 自环画不出来也没意义，直接不画
      if (choice.to === spot.id) continue
      const edge: StoryGraphEdge = { from: spot.id, to: choice.to, implicit: !stored.has(choice.to) }
      edges.push(edge)
      const list = outgoing.get(spot.id)
      if (list) list.push(edge)
      else outgoing.set(spot.id, [edge])
    }
  }

  // 最长路径：松弛 |V| 轮足够，图上万一有环也不会死循环
  const layerOf = new Map<string, number>(pkg.spots.map((s) => [s.id, 0]))
  for (let round = 0; round < pkg.spots.length; round++) {
    let changed = false
    for (const edge of edges) {
      const from = layerOf.get(edge.from) ?? 0
      const to = layerOf.get(edge.to) ?? 0
      if (to < from + 1) {
        layerOf.set(edge.to, from + 1)
        changed = true
      }
    }
    if (!changed) break
  }
  if (entry) layerOf.set(entry, 0)

  const byLayer = new Map<number, GraphNode[]>()
  for (const spot of pkg.spots) {
    const layer = layerOf.get(spot.id) ?? 0
    const list = byLayer.get(layer)
    if (list) list.push(spot)
    else byLayer.set(layer, [spot])
  }

  const layerCount = Math.max(1, ...[...byLayer.keys()].map((k) => k + 1))
  const columnWidth = Math.max(
    72,
    ...pkg.spots.map((s) => nodeWidth(s.name)),
  )

  const nodes: StoryGraphNode[] = []
  for (const [layer, list] of byLayer) {
    list.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    list.forEach((spot, row) => {
      const width = nodeWidth(spot.name)
      // 同一列左对齐，长名字向右溢出一点，也比居中对不齐好看
      nodes.push({
        id: spot.id,
        name: spot.name,
        layer,
        row,
        isEntry: spot.id === entry,
        isEnding: storyNextChoices(pkg, spot.id).length === 0,
        x: PAD_X + layer * (columnWidth + COL_GAP) + width / 2,
        y: PAD_Y + row * (NODE_HEIGHT + ROW_GAP) + NODE_HEIGHT / 2,
        width,
      })
    })
  }

  const rows = Math.max(1, ...[...byLayer.values()].map((l) => l.length))
  return {
    nodes,
    edges,
    layerCount,
    width: PAD_X * 2 + layerCount * columnWidth + (layerCount - 1) * COL_GAP,
    height: PAD_Y * 2 + rows * NODE_HEIGHT + (rows - 1) * ROW_GAP,
    nodeHeight: NODE_HEIGHT,
  }
}

function withChoices(draft: DraftAttraction, spotId: string, choices: StoryChoice[]): DraftAttraction {
  return {
    ...draft,
    story: {
      ...(draft.story || {}),
      choices: { ...(draft.story?.choices || {}), [spotId]: choices },
    },
  }
}

/** 改某个节点的去向表（空数组 = 显式结局）；阶段二与内容页共用 */
export function setStoryChoices(
  draft: DraftAttraction,
  spotId: string,
  choices: StoryChoice[],
): DraftAttraction {
  return withChoices(draft, spotId, choices)
}

/** 删掉这个节点的连线，回落到「按数组顺序接下一个」 */
export function resetStoryChoices(draft: DraftAttraction, spotId: string): DraftAttraction {
  const choices = { ...(draft.story?.choices || {}) }
  delete choices[spotId]
  return { ...draft, story: { ...(draft.story || {}), choices } }
}

/** 勾选态以「生效中的去向」为准，所以没连过的节点也显示它默认接的那个 */
export function toggleStoryChoice(
  draft: DraftAttraction,
  spotId: string,
  toId: string,
): DraftAttraction {
  const current = storyNextChoices(draft, spotId)
  const exists = current.some((c) => c.to === toId)
  return setStoryChoices(
    draft,
    spotId,
    exists ? current.filter((c) => c.to !== toId) : [...current, { to: toId }],
  )
}

export function setStoryEntry(draft: DraftAttraction, spotId: string): DraftAttraction {
  return { ...draft, story: { ...(draft.story || {}), entry: spotId } }
}

/** 标为结局：显式写一个空数组，前台就没有去向按钮了 */
export function markStoryEnding(draft: DraftAttraction, spotId: string): DraftAttraction {
  return setStoryChoices(draft, spotId, [])
}
