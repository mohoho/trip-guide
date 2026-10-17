import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronDown, ChevronRight, Flag, GitBranch, Sparkles, X } from 'lucide-react'
import { GenProgressToast } from '../../components/GenProgressToast'
import { SpotContentPanel } from '../../components/SpotContentPanel'
import { StoryGraphView } from '../../components/StoryGraphView'
import { VisitorAvatarPicker } from '../../components/VisitorAvatarPicker'
import { fillStoryIntro, fillStoryNode, fillStoryStructure } from '../../lib/aiDraft'
import type { StoryFields } from '../../lib/aiDraft'
import { isSpotPlaceholder } from '../../lib/draftStore'
import { attachSpotImage, attachVisitorAvatar } from '../../lib/imageUpload'
import {
  layoutStoryGraph,
  markStoryEnding,
  resetStoryChoices,
  setStoryChoices,
  setStoryEntry,
  toggleStoryChoice,
} from '../../lib/storyGraph'
import {
  storyEntryId,
  storyNextChoices,
  storyStoredChoices,
  validateStoryGraph,
} from '../../lib/storyTour'
import type { StoryChoice } from '../../lib/tourPackage'
import type { DraftAttraction, Spot } from '../../types/attraction'
import type { ContentPageProps } from './ContentCheckinPage'

/** AI 一次能写的部分：内容五项 + 结构一项 */
type GenPart = 'title' | 'description' | 'narration' | 'choices' | 'ending' | 'structure'
type GenParts = Record<GenPart, boolean>

const GEN_PART_ITEMS: Array<{ key: GenPart; label: string }> = [
  { key: 'title', label: '故事名' },
  { key: 'description', label: '前情提要' },
  { key: 'narration', label: '情节' },
  { key: 'choices', label: '选项文案' },
  { key: 'ending', label: '结局标题' },
  { key: 'structure', label: '修改故事结构' },
]

/** 内容五项默认全选；结构另算，默认不勾 */
const GEN_PART_DEFAULTS: GenParts = {
  title: true,
  description: true,
  narration: true,
  choices: true,
  ending: true,
  structure: false,
}

/**
 * 阶段三 · 内容创作（故事模式）：以「结构」为中心 ——
 * 上面是能点的结构图，下面是当前节点的文案与去向文案；关系也能在这页改。
 */
export function ContentStoryPage({ draft, persist, initialSpotId }: ContentPageProps) {
  const navigate = useNavigate()
  const [selectedId, setSelectedId] = useState<string | null>(initialSpotId)
  const [toast, setToast] = useState('')
  const [busy, setBusy] = useState(false)
  /** 生成是一段一段跑的，这里放「正在跑第几段」——进度条与 toast 都读它 */
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null)
  const [graphOpen, setGraphOpen] = useState(true)
  /** 创作方向的展开态：页头那格只有 240px，点开才铺开写 */
  const [dirOpen, setDirOpen] = useState(false)
  /** 「AI 生成内容」点了先弹一个小面板：这一趟要写哪几部分 */
  const [genOpen, setGenOpen] = useState(false)
  /** 内容五项默认全选；「修改故事结构」是改走向、比写文案重，默认不勾，得手动选 */
  const [genParts, setGenParts] = useState<GenParts>(() => ({ ...GEN_PART_DEFAULTS }))
  const dirRef = useRef<HTMLDivElement>(null)
  const genRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!dirOpen && !genOpen) return
    const onDown = (e: MouseEvent) => {
      if (!dirRef.current?.contains(e.target as Node)) setDirOpen(false)
      if (!genRef.current?.contains(e.target as Node)) setGenOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setDirOpen(false)
      setGenOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [dirOpen, genOpen])

  /** 每次打开都从默认起：内容全选、结构不勾（取消 / Esc 之后重开也一样） */
  const openGen = () => {
    setGenParts({ ...GEN_PART_DEFAULTS })
    setGenOpen(true)
  }

  const selected = useMemo(() => {
    return draft.spots.find((s) => s.id === selectedId) || draft.spots[0] || null
  }, [draft, selectedId])

  const layout = useMemo(() => layoutStoryGraph(draft), [draft])
  const nameOf = (id: string) => draft.spots.find((s) => s.id === id)?.name || id

  const updateSpot = (spotId: string, patch: Partial<Spot>) => {
    persist({
      ...draft,
      spots: draft.spots.map((s) => (s.id === spotId ? { ...s, ...patch } : s)),
    })
  }

  const updateDraft = (patch: Partial<DraftAttraction>) => {
    persist({ ...draft, ...patch })
  }

  const updateSlide = (field: 'title' | 'bullets' | 'narration', value: string) => {
    if (!selected) return
    const slides = [...selected.slides]
    const slide = { ...slides[0] }
    if (field === 'bullets') {
      slide.bullets = value
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
    } else {
      slide[field] = value
    }
    slides[0] = slide
    updateSpot(selected.id, { slides })
  }

  const onUploadImage = async (file: File) => {
    if (!selected) return
    try {
      persist(await attachSpotImage(draft, selected.id, file))
      setToast('图片已上传')
    } catch (e) {
      setToast(e instanceof Error ? e.message : '图片读取失败')
    }
  }

  const onUploadAvatar = async (file: File) => {
    try {
      persist(await attachVisitorAvatar(draft, file))
      setToast('头像已上传')
    } catch (e) {
      setToast(e instanceof Error ? e.message : '图片读取失败')
    }
  }

  /** 选项上的字：写进「生效中的去向」；本来靠数组顺序接的那条，一写字就落成显式连线 */
  const updateChoiceText = (toId: string, field: 'label' | 'note', value: string) => {
    if (!selected) return
    const choices = storyNextChoices(draft, selected.id).map((c) =>
      c.to === toId ? { ...c, [field]: value } : c,
    )
    persist(setStoryChoices(draft, selected.id, choices))
  }

  const updateEndingTitle = (spotId: string, value: string) => {
    persist({
      ...draft,
      story: {
        ...(draft.story || {}),
        endings: { ...(draft.story?.endings || {}), [spotId]: value },
      },
    })
  }

  /** 故事名：与景点名并列的副标题，跟着包走，导览页也显示它 */
  const updateStoryTitle = (value: string) => {
    persist({ ...draft, story: { ...(draft.story || {}), title: value } })
  }

  /** 三段请求共用的上下文：现在的入口、每个节点的去向与是否结局 */
  const storyFieldsOf = (d: DraftAttraction): StoryFields => {
    const nameIn = (id: string) => d.spots.find((s) => s.id === id)?.name || id
    return {
      name: d.name,
      description: d.description,
      city: d.city,
      amapContext: d.amapContext,
      direction: d.storyDirection,
      spots: d.spots.map((s) => ({ name: s.name })),
      entry: storyEntryId(d) ?? undefined,
      nodes: d.spots.map((s) => {
        const next = storyNextChoices(d, s.id)
        return { name: s.name, to: next.map((c) => nameIn(c.to)), ending: next.length === 0 }
      }),
    }
  }

  /**
   * 生成按段跑：结构 → 开场 → 逐个节点，一段一次请求、跑完立刻落盘。
   * 段数就是进度条的分母；某一段没成不影响后面的段，结束后在 toast 里说明哪几段沿用了原文案。
   */
  const onGenerateContent = async (parts: GenParts) => {
    if (busy) return
    const picked = GEN_PART_ITEMS.filter((i) => parts[i.key])
    if (picked.length === 0) return
    const contentLabels = picked.filter((i) => i.key !== 'structure').map((i) => i.label)

    let working = draft
    /** 一段跑完返回失败原因，null = 这段成了 */
    const steps: Array<{ label: string; run: () => Promise<string | null> }> = []
    let labelled = 0
    let restructured = false

    if (parts.structure) {
      steps.push({
        label: '重排故事结构',
        run: async () => {
          const r = await fillStoryStructure(storyFieldsOf(working))
          if (!r.structure) return r.reason || '没给出能对上节点的结构'
          const idByName = new Map(working.spots.map((s) => [s.name, s.id]))
          const choices: Record<string, StoryChoice[]> = {}
          for (const node of r.structure.nodes) {
            const from = idByName.get(node.name)
            if (!from) continue
            choices[from] = node.to
              .map((name) => idByName.get(name))
              .filter((to): to is string => Boolean(to))
              .map((to) => ({ to }))
          }
          const entry = r.structure.entry ? idByName.get(r.structure.entry) : undefined
          restructured = true
          // 这一段只换走向；选项文案留给节点段按新去向对齐
          working = persist({
            ...working,
            story: { ...(working.story || {}), choices, ...(entry ? { entry } : {}) },
          })
          return null
        },
      })
    }

    if (parts.title || parts.description) {
      const which = [parts.title ? '故事名' : '', parts.description ? '前情提要' : ''].filter(Boolean)
      steps.push({
        label: `写${which.join('与')}`,
        run: async () => {
          const r = await fillStoryIntro(storyFieldsOf(working))
          if (!r.storyTitle && !r.description) return r.reason || '没写出来'
          const story = { ...(working.story || {}) }
          if (parts.title && r.storyTitle) story.title = r.storyTitle
          working = persist({
            ...working,
            description: parts.description && r.description ? r.description : working.description,
            story,
          })
          return null
        },
      })
    }

    if (parts.narration || parts.choices || parts.ending) {
      draft.spots.forEach((spot, index) => {
        steps.push({
          label: `写「${spot.name}」`,
          run: async () => {
            // 上一站的讲述稿此时已定稿，喂给下一段才算真的「情节前后相接」
            const previous = working.spots[index - 1]?.slides[0]?.narration
            const r = await fillStoryNode(storyFieldsOf(working), index, previous)
            if (r.source === 'mock') return r.reason || '这一段没写出来'
            const content = r.content
            let next: DraftAttraction = working
            if (parts.narration) {
              next = {
                ...next,
                spots: next.spots.map((s) => {
                  if (s.id !== spot.id) return s
                  const slides = [...s.slides]
                  slides[0] = content.slides[0]
                  return { ...s, poetic: content.poetic, slides }
                }),
              }
            }
            const story = { ...(next.story || {}) }
            if (parts.ending && content.endingTitle) {
              story.endings = { ...(next.story?.endings || {}), [spot.id]: content.endingTitle }
            }
            if (parts.choices) {
              const targets = storyNextChoices(next, spot.id)
              const stored = storyStoredChoices(next, spot.id)
              // 只给「本来就连过线」或「真分叉」落显式去向；线性那条默认边保持不连、跟着数组顺序
              const worthWriting = targets.length > 0 && (stored.length > 0 || targets.length > 1)
              if (worthWriting && content.choices.length === targets.length) {
                story.choices = {
                  ...(next.story?.choices || {}),
                  [spot.id]: targets.map((c, j) => ({
                    ...c,
                    label: content.choices[j]?.label || c.label,
                    note: content.choices[j]?.note || c.note,
                  })),
                }
                labelled += 1
              }
            }
            working = persist({ ...next, story })
            return null
          },
        })
      })
    }

    const failures: string[] = []
    setBusy(true)
    setGenOpen(false)
    try {
      for (let i = 0; i < steps.length; i++) {
        setProgress({ label: steps[i].label, done: i + 1, total: steps.length })
        setToast(`AI 正在${steps[i].label}`)
        const reason = await steps[i].run()
        if (reason) failures.push(`${steps[i].label}：${reason}`)
      }
    } finally {
      setProgress(null)
      setBusy(false)
    }

    const branchCount = working.spots.filter((s) => storyNextChoices(working, s.id).length > 1).length
    const endingCount = working.spots.filter((s) => storyNextChoices(working, s.id).length === 0).length
    const written =
      parts.structure && restructured
        ? `已重排故事结构（${branchCount} 处分支 · ${endingCount} 个结局）${contentLabels.length > 0 ? ` · 已写入${contentLabels.join('、')}` : ''}`
        : `已写入 ${contentLabels.join('、')}${labelled > 0 ? ` · ${labelled} 处选项文案` : ''}`
    setToast(
      failures.length === 0
        ? written
        : failures.length === steps.length
          ? `AI 未接通（${failures[0]}），这一趟什么都没写，原内容没动`
          : `${written}（${failures.length} 段没写成、沿用了原文案：${failures[0]}）`,
    )
  }

  if (!selected) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f7f8fa] text-sm text-[#6b7280]">
        加载中…
      </div>
    )
  }

  const writtenCount = draft.spots.filter((s) => !isSpotPlaceholder(s)).length
  const branchCount = draft.spots.filter((s) => storyNextChoices(draft, s.id).length > 1).length
  const endingCount = draft.spots.filter((s) => storyNextChoices(draft, s.id).length === 0).length
  const storyBlockers = validateStoryGraph(draft).filter((i) => i.level === 'error')

  const spotStored = storyStoredChoices(draft, selected.id)
  const spotTargets = storyNextChoices(draft, selected.id)
  const isEnding = spotTargets.length === 0
  const isEntry = storyEntryId(draft) === selected.id
  const implicitNextName = (() => {
    const index = draft.spots.findIndex((s) => s.id === selected.id)
    return (index >= 0 ? draft.spots[index + 1] : undefined)?.name || ''
  })()

  return (
    <div className="h-screen flex flex-col bg-[#f7f8fa] text-[#111827]">
      <header className="shrink-0 flex items-center justify-between gap-3 px-4 sm:px-5 h-14 bg-white border-b border-black/5">
        <button
          type="button"
          onClick={() => navigate(`/publish/${draft.id}`)}
          className="inline-flex items-center gap-1 text-sm text-[#6b7280] hover:text-[#111827] shrink-0"
        >
          <ArrowLeft size={16} />
          调整地点
        </button>

        <div className="min-w-0 text-center leading-tight">
          <div className="flex items-center justify-center gap-1">
            <p className="truncate text-[15px] font-medium">{draft.name}</p>
            <input
              value={draft.story?.title || ''}
              onChange={(e) => updateStoryTitle(e.target.value)}
              placeholder="故事名"
              className="field-sizing-content min-w-[4.5em] max-w-[18em] rounded-md border border-transparent bg-transparent px-0.5 text-left text-[12px] text-[#6b7280] outline-none hover:border-black/8 hover:bg-[#f9fafb] focus:border-[#3b82f6]/50 focus:bg-white focus:text-[#111827]"
            />
          </div>
          <p className="text-[11px] text-[#9ca3af] tabular-nums">
            {draft.spots.length} 个节点 · 已写 {writtenCount} · {branchCount} 处分支 ·{' '}
            {endingCount} 个结局
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="relative shrink-0" ref={dirRef}>
            <input
              value={draft.storyDirection || ''}
              onChange={(e) => updateDraft({ storyDirection: e.target.value })}
              onFocus={() => setDirOpen(true)}
              onClick={() => setDirOpen(true)}
              placeholder="输入故事创作方向"
              className="w-[150px] lg:w-[240px] rounded-lg border border-black/8 bg-[#f9fafb] px-2.5 py-1.5 text-sm outline-none focus:border-[#3b82f6]/50 focus:bg-white"
            />
            {dirOpen && (
              <div className="absolute right-0 top-full z-50 mt-2 w-[min(90vw,460px)] rounded-xl border border-black/10 bg-white p-2 shadow-xl">
                <textarea
                  value={draft.storyDirection || ''}
                  onChange={(e) => updateDraft({ storyDirection: e.target.value })}
                  rows={5}
                  autoFocus
                  placeholder="输入故事创作方向"
                  className="max-h-[40vh] w-full resize-none rounded-lg border border-black/8 bg-[#f9fafb] px-2.5 py-2 text-sm leading-relaxed outline-none focus:border-[#3b82f6]/50 focus:bg-white"
                />
              </div>
            )}
          </div>
          <div className="relative shrink-0" ref={genRef}>
            <button
              type="button"
              onClick={() => (genOpen ? setGenOpen(false) : openGen())}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm hover:bg-[#f3f4f6] disabled:opacity-50"
            >
              <Sparkles size={14} />
              {busy ? '生成中…' : 'AI 生成内容'}
            </button>
            {genOpen && !busy && (
              <div className="absolute right-0 top-full z-50 mt-2 w-[248px] rounded-xl border border-black/10 bg-white p-3 shadow-xl">
                <p className="mb-2 text-[11px] text-[#9ca3af]">这一趟让 AI 写</p>
                <div className="space-y-1.5">
                  {GEN_PART_ITEMS.map((item) => (
                    <label
                      key={item.key}
                      className="flex cursor-pointer items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={genParts[item.key]}
                        onChange={(e) =>
                          setGenParts((prev) => ({ ...prev, [item.key]: e.target.checked }))
                        }
                      />
                      {item.label}
                    </label>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setGenOpen(false)}
                    className="cursor-pointer rounded-lg border border-black/10 px-2.5 py-1 text-xs hover:bg-[#f3f4f6]"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={GEN_PART_ITEMS.every((i) => !genParts[i.key])}
                    onClick={() => {
                      const parts = { ...genParts }
                      setGenOpen(false)
                      void onGenerateContent(parts)
                    }}
                    className="cursor-pointer rounded-lg bg-[#3b82f6] px-2.5 py-1 text-xs text-white hover:bg-[#2563eb] disabled:opacity-50"
                  >
                    开始生成
                  </button>
                </div>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => navigate(`/publish/${draft.id}/preview?from=content`)}
            className="rounded-lg bg-[#3b82f6] text-white px-3.5 py-1.5 text-sm hover:bg-[#2563eb]"
          >
            预览
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1200px] px-5 py-6 sm:px-8 grid gap-6 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)] lg:items-start">
          <aside className="space-y-1 rounded-2xl border border-black/[0.06] bg-white p-3 lg:sticky lg:top-6">
            <p className="px-1 pb-1 text-xs font-medium text-[#6b7280]">导览节点</p>
            {draft.spots.map((spot, index) => {
              const active = spot.id === selected.id
              return (
                <button
                  key={spot.id}
                  type="button"
                  onClick={() => setSelectedId(spot.id)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left ${
                    active ? 'bg-[#eff6ff]' : 'hover:bg-[#f9fafb]'
                  }`}
                >
                  <span className="w-5 h-5 rounded-full bg-[#111827] text-white text-[11px] flex items-center justify-center shrink-0">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{spot.name}</span>
                  <span
                    className={`shrink-0 text-[10px] ${
                      isSpotPlaceholder(spot) ? 'text-amber-600' : 'text-[#9ca3af]'
                    }`}
                  >
                    {isSpotPlaceholder(spot) ? '未写' : '已写'}
                  </span>
                </button>
              )
            })}
          </aside>

          <section className="mx-auto w-full max-w-3xl space-y-4">
            <div className="rounded-2xl border border-black/[0.06] bg-white p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-sm font-medium">故事结构</p>
                <button
                  type="button"
                  onClick={() => setGraphOpen((v) => !v)}
                  className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-[#6b7280] hover:text-[#111827]"
                >
                  {graphOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  {graphOpen ? '收起' : '展开'}
                </button>
              </div>
              {graphOpen && (
                <StoryGraphView layout={layout} selectedId={selected.id} onSelect={setSelectedId} />
              )}
            </div>

            <div className="rounded-2xl border border-black/[0.06] bg-white p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-sm font-medium">前情提要</p>
                <p className="text-[11px] text-[#9ca3af]">列表与封面用这段字</p>
              </div>
              <VisitorAvatarPicker
                label="角色头像"
                value={draft.visitorAvatar}
                onUpload={(file) => void onUploadAvatar(file)}
                onReset={() => updateDraft({ visitorAvatar: undefined })}
              />
              <textarea
                value={draft.description}
                onChange={(e) => updateDraft({ description: e.target.value })}
                rows={3}
                placeholder="点「AI 生成内容」会按创作方向写好开场，也可以自己改"
                className="w-full resize-none rounded-lg border border-black/8 bg-[#f9fafb] px-3 py-2 text-sm outline-none focus:border-[#3b82f6]/50 focus:bg-white"
              />
            </div>

            <div className="rounded-2xl border border-black/[0.06] bg-white p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-sm font-medium">节点内容</p>
                <p className="text-[11px] text-[#9ca3af] tabular-nums">
                  第 {draft.spots.findIndex((s) => s.id === selected.id) + 1} / {draft.spots.length} 站
                </p>
              </div>
              <SpotContentPanel
                spot={selected}
                onPatch={(patch) => updateSpot(selected.id, patch)}
                onSlide={updateSlide}
                onUpload={(file) => void onUploadImage(file)}
              />
            </div>

            <div className="rounded-2xl border border-black/[0.06] bg-white p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="inline-flex min-w-0 items-center gap-1.5 text-sm font-medium">
                  <GitBranch size={14} className="shrink-0 text-[#9ca3af]" />
                  <span className="truncate">这个节点的去向</span>
                </p>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => persist(setStoryEntry(draft, selected.id))}
                    disabled={isEntry}
                    className="cursor-pointer rounded border border-black/10 px-1.5 py-0.5 text-[10px] hover:bg-[#f3f4f6] disabled:opacity-45"
                  >
                    {isEntry ? '已是入口' : '设为入口'}
                  </button>
                  <button
                    type="button"
                    onClick={() => persist(markStoryEnding(draft, selected.id))}
                    disabled={isEnding}
                    className="cursor-pointer rounded border border-black/10 px-1.5 py-0.5 text-[10px] hover:bg-[#f3f4f6] disabled:opacity-45"
                  >
                    标为结局
                  </button>
                </div>
              </div>

              {spotStored.length === 0 && !isEnding && (
                <p className="mb-3 text-sm text-[#9ca3af]">
                  这个节点还没连去向，前台会按数组顺序接
                  {implicitNextName ? `「${implicitNextName}」` : '下一站'}。
                </p>
              )}

              <div className="space-y-3">
                {spotTargets.map((choice, i) => (
                  <div key={choice.to} className="rounded-xl border border-black/8 bg-[#f9fafb] p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-xs text-[#6b7280]">
                        去向 {i + 1} · <span className="text-[#111827]">{nameOf(choice.to)}</span>
                      </p>
                      <button
                        type="button"
                        onClick={() => persist(toggleStoryChoice(draft, selected.id, choice.to))}
                        title="删掉这条去向"
                        className="shrink-0 cursor-pointer rounded p-0.5 text-[#9ca3af] hover:text-red-600"
                      >
                        <X size={13} />
                      </button>
                    </div>
                    <label className="block">
                      <span className="text-[11px] text-[#9ca3af]">选项文案（留空则显示「下一步 · 目标名」）</span>
                      <input
                        value={choice.label || ''}
                        onChange={(e) => updateChoiceText(choice.to, 'label', e.target.value)}
                        placeholder={`下一步 · ${nameOf(choice.to)}`}
                        className="mt-1 w-full rounded-lg border border-black/8 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-[#3b82f6]/50"
                      />
                    </label>
                    <label className="mt-2 block">
                      <span className="text-[11px] text-[#9ca3af]">一行小字（选填，如「约 80 米 · 5 分钟」）</span>
                      <input
                        value={choice.note || ''}
                        onChange={(e) => updateChoiceText(choice.to, 'note', e.target.value)}
                        className="mt-1 w-full rounded-lg border border-black/8 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-[#3b82f6]/50"
                      />
                    </label>
                  </div>
                ))}

                {isEnding && (
                  <label className="block rounded-xl border border-black/8 bg-[#f9fafb] p-3">
                    <span className="text-[11px] text-[#9ca3af]">结局标题（留空则显示「故事结束」）</span>
                    <input
                      value={draft.story?.endings?.[selected.id] || ''}
                      onChange={(e) => updateEndingTitle(selected.id, e.target.value)}
                      placeholder="如：结局 · 登临揽胜"
                      className="mt-1 w-full rounded-lg border border-black/8 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-[#3b82f6]/50"
                    />
                  </label>
                )}
              </div>

              <div className="mt-3 flex items-center justify-between gap-2">
                <p className="text-[11px] text-[#9ca3af]">去向（可多选，不设上限；全不勾 = 结局）</p>
                <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-[#9ca3af]">
                  {isEnding ? (
                    <>
                      <Flag size={11} />
                      当前是结局
                    </>
                  ) : (
                    `去向 ${spotTargets.length} 个`
                  )}
                </span>
              </div>

              <div className="mt-1 max-h-40 space-y-0.5 overflow-y-auto rounded-xl border border-black/8 bg-[#f9fafb] p-1.5">
                {draft.spots
                  .filter((s) => s.id !== selected.id)
                  .map((s) => (
                    <label
                      key={s.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-white"
                    >
                      <input
                        type="checkbox"
                        checked={spotTargets.some((c) => c.to === s.id)}
                        onChange={() => persist(toggleStoryChoice(draft, selected.id, s.id))}
                      />
                      <span className="truncate">{s.name}</span>
                    </label>
                  ))}
              </div>

              <button
                type="button"
                onClick={() => persist(resetStoryChoices(draft, selected.id))}
                className="mt-2 cursor-pointer rounded border border-black/10 px-2 py-1 text-[11px] hover:bg-[#f3f4f6]"
              >
                按数组顺序（默认）
              </button>

              {storyBlockers.length > 0 && (
                <div className="mt-3 space-y-1 border-t border-black/5 pt-3">
                  <p className="text-xs font-medium text-[#6b7280]">分支检查</p>
                  {storyBlockers.map((issue, i) => (
                    <p key={i} className="text-[11px] leading-relaxed text-red-600">
                      · {issue.message}
                    </p>
                  ))}
                </div>
              )}
            </div>

            <p className="pb-6 text-center text-xs text-[#9ca3af]">
              坐标在「调整地点」里改；这一页只写文案
            </p>
          </section>
        </div>
      </div>

      <GenProgressToast text={toast} progress={progress} busy={busy} onClose={() => setToast('')} />
    </div>
  )
}
