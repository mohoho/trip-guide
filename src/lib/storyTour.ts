import type { StoryChoice, StoryGraph } from './tourPackage'

/** 只要求「有一批有 id/name 的节点 + 可选 story」，草稿与发布包都能套 */
export interface StoryCarrier {
  spots: { id: string; name: string }[]
  story?: StoryGraph
}

/** 入口：story.entry 有效就用它，否则（缺省 / 悬空）退回第一个节点 */
export function storyEntryId(pkg: StoryCarrier): string | null {
  const entry = pkg.story?.entry
  if (entry && pkg.spots.some((s) => s.id === entry)) return entry
  return pkg.spots[0]?.id ?? null
}

/** 作者在阶段二连的线（原样，含悬空项），编辑界面用 */
export function storyStoredChoices(pkg: StoryCarrier, spotId: string): StoryChoice[] {
  const stored = pkg.story?.choices?.[spotId]
  return Array.isArray(stored) ? stored : []
}

/** 该节点是否被显式标成结局（去向表里存了一个空数组） */
export function storyIsExplicitEnding(pkg: StoryCarrier, spotId: string): boolean {
  const stored = pkg.story?.choices?.[spotId]
  return Array.isArray(stored) && stored.length === 0
}

/**
 * 运行期唯一的"下一个是谁"：连过线就用线，没连过就按 spots 顺序接下一个（最后一站即结局）。
 * 悬空指向直接丢掉（发布端有硬校验，前台只求不崩）。
 */
export function storyNextChoices(pkg: StoryCarrier, spotId: string): StoryChoice[] {
  const stored = pkg.story?.choices?.[spotId]
  if (Array.isArray(stored)) {
    const ids = new Set(pkg.spots.map((s) => s.id))
    return stored.filter((c) => c && c.to && ids.has(c.to))
  }
  const index = pkg.spots.findIndex((s) => s.id === spotId)
  const next = index >= 0 ? pkg.spots[index + 1] : undefined
  return next ? [{ to: next.id }] : []
}

/** 选项按钮上的字：作者写了就用，没写兜底「下一步 · 目标名」 */
export function storyChoiceLabel(pkg: StoryCarrier, choice: StoryChoice): string {
  const custom = choice.label?.trim()
  if (custom) return custom
  const target = pkg.spots.find((s) => s.id === choice.to)
  return `下一步 · ${target?.name ?? '未知地点'}`
}

/** 结局标题：作者写了就用，没写就是「故事结束」 */
export function storyEndingLabel(pkg: StoryCarrier, spotId: string): string {
  return pkg.story?.endings?.[spotId]?.trim() || '故事结束'
}

/**
 * 概览用的分支摘要：一个分叉点一行（`猴山 → 新狼馆 / 本土物种保育区 / 细尾獴馆`），
 * 末行收结局。没有 story、或一处分叉都没有（全靠数组顺序接）时返回空数组，
 * 调用方回落到那条线性链条 —— 那本来就是线性故事的真实形态。
 */
export function storyBranchOutline(pkg: StoryCarrier): string[] {
  const entry = storyEntryId(pkg)
  if (!pkg.story || !entry) return []
  const nameOf = (id: string) => pkg.spots.find((s) => s.id === id)?.name || id

  const branches: string[] = []
  for (const spot of pkg.spots) {
    const choices = storyNextChoices(pkg, spot.id)
    if (choices.length < 2) continue
    const head = spot.id === entry ? `入口 ${spot.name}` : spot.name
    branches.push(`${head} → ${choices.map((c) => nameOf(c.to)).join(' / ')}`)
  }
  if (branches.length === 0) return []

  const endings = pkg.spots.filter((s) => storyNextChoices(pkg, s.id).length === 0)
  return endings.length > 0
    ? [...branches, `结局 ${endings.map((s) => s.name).join('、')}`]
    : branches
}

export interface StoryIssue {
  level: 'error' | 'warn'
  message: string
}

/** 从入口走不到的节点（发布门控与列表头共用；无入口时全部算孤立） */
export function storyUnreachable(pkg: StoryCarrier): StoryCarrier['spots'] {
  const entry = storyEntryId(pkg)
  if (!entry) return pkg.spots.slice()
  const reachable = new Set<string>()
  const stack: string[] = [entry]
  while (stack.length) {
    const cur = stack.pop() as string
    if (reachable.has(cur)) continue
    reachable.add(cur)
    for (const c of storyNextChoices(pkg, cur)) {
      if (!reachable.has(c.to)) stack.push(c.to)
    }
  }
  return pkg.spots.filter((s) => !reachable.has(s.id))
}

/**
 * 发布门控用（硬校验在发布端，前台不做）。只对 story 存在时生效：
 * 悬空 entry / 悬空去向 / 从入口走不到的孤立节点都是 error；自环与回边只提示。
 */
export function validateStoryGraph(pkg: StoryCarrier): StoryIssue[] {
  const story = pkg.story
  if (!story) return []
  const issues: StoryIssue[] = []
  const ids = new Set(pkg.spots.map((s) => s.id))
  const nameOf = (id: string) => pkg.spots.find((s) => s.id === id)?.name || id

  if (story.entry && !ids.has(story.entry)) {
    issues.push({ level: 'error', message: '入口指向了不存在的节点' })
  }

  for (const [from, list] of Object.entries(story.choices || {})) {
    if (!ids.has(from)) {
      issues.push({ level: 'error', message: '去向表里有一个节点已经不在列表里了' })
      continue
    }
    for (const c of list || []) {
      if (!c?.to || !ids.has(c.to)) {
        issues.push({ level: 'error', message: `「${nameOf(from)}」的去向指向了不存在的节点` })
        continue
      }
      if (c.to === from) {
        issues.push({ level: 'warn', message: `「${nameOf(from)}」的去向指向自己，运行期不会出现这个按钮` })
      }
    }
  }

  const entry = storyEntryId(pkg)
  if (entry) {
    const orphans = storyUnreachable(pkg)
    if (orphans.length > 0) {
      issues.push({
        level: 'error',
        message: `有 ${orphans.length} 个节点从入口走不到：${orphans.map((s) => s.name).join('、')}`,
      })
    }
  }

  return issues
}
