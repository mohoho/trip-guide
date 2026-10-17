import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Flag,
  GitBranch,
  MapPin,
  Plus,
  Route,
  Trash2,
} from 'lucide-react'
import { PublishSpotMap, type PublishMapApi } from '../components/PublishSpotMap'
import { CityRegionSelect } from '../components/CityRegionSelect'
import { SpotRelativeMap } from '../components/SpotRelativeMap'
import { buildMainPoiText, resolveAttractionScope } from '../lib/amapLocate'
import {
  newSpotAt,
  newSpotFromCandidate,
  saveDraft,
  ensureEditableDraft,
  isSpotPlaceholder,
} from '../lib/draftStore'
import {
  storyEntryId,
  storyIsExplicitEnding,
  storyNextChoices,
  storyStoredChoices,
  storyUnreachable,
  validateStoryGraph,
} from '../lib/storyTour'
import {
  resetStoryChoices as resetStoryChoicesIn,
  setStoryEntry as setStoryEntryIn,
  toggleStoryChoice as toggleStoryChoiceIn,
} from '../lib/storyGraph'
import type { CandidatePoi, DraftAttraction, Spot } from '../types/attraction'
import type { LngLat, StoryChoice } from '../lib/tourPackage'

type EditorStage = 1 | 2

/** 「手动加点」的落点比视图中心高一点：标记以气泡尖端为锚、向上生长，正好落在中心就会跟绿「起」叠在一起（约一个标记高） */
const NEW_SPOT_LIFT_PX = 56

/** 把视图中心按屏幕像素向北挪（按当前 zoom 折算成纬度） */
function liftNorth(pos: LngLat, px: number, zoom: number): LngLat {
  const metersPerPx = (156543.03392 * Math.cos((pos.lat * Math.PI) / 180)) / 2 ** zoom
  return { lng: pos.lng, lat: pos.lat + (metersPerPx * px) / 111320 }
}

type CandidateListProps = {
  candidates: CandidatePoi[]
  pickedCount: number
  emptyHint: string
  /** 阶段二是否已经有节点：有则按钮变成「更新节点」，按当前勾选同步 */
  hasSpots: boolean
  onToggle: (name: string) => void
  onSetAll: (picked: boolean) => void
  onGenerate: () => void
}

/** 高德候选地点列表：勾选后可直接生成导览节点（阶段一/阶段二共用） */
function CandidateList({
  candidates,
  pickedCount,
  emptyHint,
  hasSpots,
  onToggle,
  onSetAll,
  onGenerate,
}: CandidateListProps) {
  return (
    <div className="space-y-2 border-t border-black/5 pt-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-[#6b7280]">
          地点信息
          <span className="ml-1 text-[#9ca3af] tabular-nums">
            {pickedCount}/{candidates.length}
          </span>
        </p>
        <div className="flex gap-2 text-[11px] shrink-0">
          <button type="button" className="cursor-pointer text-[#3b82f6]" onClick={() => onSetAll(true)}>
            全选
          </button>
          <button type="button" className="cursor-pointer text-[#9ca3af]" onClick={() => onSetAll(false)}>
            清空
          </button>
        </div>
      </div>

      {candidates.length === 0 ? (
        <p className="text-[11px] text-[#9ca3af]">{emptyHint}</p>
      ) : (
        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          {candidates.map((c) => (
            <label
              key={c.name}
              className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 hover:bg-[#f9fafb]"
            >
              <input
                type="checkbox"
                checked={!!c.picked}
                onChange={() => onToggle(c.name)}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block truncate text-xs text-[#111827]">{c.name}</span>
                <span className="block truncate text-[10px] text-[#6b7280]">
                  {[
                    c.address,
                    c.type?.split(';').pop(),
                    typeof c.distance === 'number' && Number.isFinite(c.distance)
                      ? `${Math.round(c.distance)}m`
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={onGenerate}
        disabled={pickedCount === 0}
        className="w-full cursor-pointer rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs hover:bg-[#f3f4f6] disabled:opacity-45"
      >
        {hasSpots ? '更新节点' : '用勾选的候选生成节点'}
      </button>
    </div>
  )
}

export function PublishEditorPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [draft, setDraft] = useState<DraftAttraction | null>(null)
  const [stage, setStage] = useState<EditorStage>(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mapError, setMapError] = useState('')
  const [toast, setToast] = useState('')
  const [mapCenter, setMapCenter] = useState<LngLat | null>(null)
  const [showRoute, setShowRoute] = useState(false)
  const [resolving, setResolving] = useState(false)
  const mapApiRef = useRef<PublishMapApi | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const item = await ensureEditableDraft(id)
      if (cancelled) return
      if (!item) {
        navigate('/publish', { replace: true })
        return
      }
      setDraft(item)
      setSelectedId(item.spots[0]?.id ?? null)
      setMapCenter(item.view ?? item.start)
      setStage(item.lastStage ?? (item.spots.length > 0 || item.status === 'published' ? 2 : 1))
    })()
    return () => {
      cancelled = true
    }
  }, [id, navigate])

  const persist = (next: DraftAttraction) => {
    const saved = saveDraft(next)
    setDraft(saved)
    return saved
  }

  const updateDraft = (patch: Partial<DraftAttraction>) => {
    if (!draft) return
    persist({ ...draft, ...patch })
  }

  const updateSpot = (spotId: string, patch: Partial<Spot>) => {
    if (!draft) return
    persist({
      ...draft,
      spots: draft.spots.map((s) => (s.id === spotId ? { ...s, ...patch } : s)),
    })
  }

  const moveSpot = (index: number, dir: -1 | 1) => {
    if (!draft) return
    const nextIndex = index + dir
    if (nextIndex < 0 || nextIndex >= draft.spots.length) return
    const spots = [...draft.spots]
    const tmp = spots[index]
    spots[index] = spots[nextIndex]
    spots[nextIndex] = tmp
    persist({ ...draft, spots })
  }

  /** 阶段一：高德确定旅游范围 */
  const onResolveScope = async () => {
    if (!draft || resolving) return
    if (!draft.name.trim()) {
      setToast('请先填写景点名称')
      return
    }
    setResolving(true)
    setToast('正在用高德检索景区范围…')
    try {
      const scope = await resolveAttractionScope(draft)
      const saved = persist({
        ...draft,
        start: scope.start,
        zoom: scope.zoom,
        city: scope.city || draft.city,
        amapContext: scope.amapContext,
        areaPoi: scope.areaPoi,
        candidates: scope.nearbyPois.map((p) => ({ ...p, picked: true })),
      })
      setMapCenter(scope.start)
      setToast(
        `已定位「${scope.areaPoi.name}」${
          scope.nearbyPois.length > 0 ? `，并发现 ${scope.nearbyPois.length} 个相关地点` : ''
        }`,
      )
      return saved
    } catch (e) {
      setToast(e instanceof Error ? e.message : '范围检索失败')
      return null
    } finally {
      setResolving(false)
    }
  }

  /** 切阶段并记住落点；同一 handler 里刚 persist 过时要把新 draft 传进来（否则会被旧闭包覆盖） */
  const gotoStage = (next: EditorStage, base?: DraftAttraction) => {
    const current = base ?? draft
    if (!current) return
    persist({ ...current, lastStage: next })
    setStage(next)
  }

  const goStage2 = async () => {
    if (!draft || resolving) return
    if (!draft.name.trim()) {
      setToast('请先填写景点名称')
      return
    }
    // 尚未检索范围时自动检索一次
    let working = draft
    if (!working.amapContext?.trim()) {
      const saved = await onResolveScope()
      if (!saved) return
      working = saved
    }
    // 阶段二还没有节点：直接把勾选的候选带过去，省一次「用勾选的候选生成节点」
    if (working.spots.length === 0) {
      const result = syncSpotsFromCandidates(working)
      if (result) {
        working = result.draft
        setToast(`已用勾选的 ${result.added} 个候选生成节点；可改名或拖标记校准`)
      }
    }
    persist({ ...working, lastStage: 2 })
    setStage(2)
    window.setTimeout(() => {
      // 回到作者上次框的那一眼；没框过才退回游客起点
      mapApiRef.current?.setCenter(working.view ?? working.start)
      mapApiRef.current?.setZoom(working.zoom)
    }, 200)
  }

  const onGoContent = (spotId?: string) => {
    if (!draft || draft.spots.length === 0) return
    navigate(`/publish/${draft.id}/content${spotId ? `?spot=${spotId}` : ''}`)
  }

  /** 新节点落在当前地图中心偏上一点，避开绿「起」标记 */
  const onAddSpot = () => {
    if (!draft) return
    const base = mapApiRef.current?.getCenter() ?? draft.start
    const spot = newSpotAt(liftNorth(base, NEW_SPOT_LIFT_PX, draft.zoom), draft.spots.length)
    const spots = [...draft.spots, spot]
    persist({ ...draft, spots })
    setSelectedId(spot.id)
  }

  /** 勾选 / 取消单个候选 */
  const toggleCandidate = (name: string) => {
    if (!draft) return
    const candidates = (draft.candidates || []).map((c) =>
      c.name === name ? { ...c, picked: !c.picked } : c,
    )
    persist({ ...draft, candidates })
  }

  const setAllCandidates = (picked: boolean) => {
    if (!draft) return
    persist({ ...draft, candidates: (draft.candidates || []).map((c) => ({ ...c, picked })) })
  }

  /**
   * 以草稿 `base` 的当前勾选同步阶段二节点：取消勾选的候选节点删掉、新勾选的追加，
   * 已存在节点保留原有的名字/坐标/文案；手加的节点不受影响（它不对应任何候选）。
   * 没有可做的改动（含一个候选都没勾）时返回 null。
   */
  const syncSpotsFromCandidates = (base: DraftAttraction) => {
    const picked = (base.candidates || []).filter((c) => c.picked)
    if (picked.length === 0) return null

    /** 节点 ⇄ 候选的对应键：优先用生成时留下的 searchHint，改名后也能认出来 */
    const spotKey = (s: Spot) => s.searchHint || s.name
    const pickedNames = new Set(picked.map((c) => c.name))
    const candidateNames = new Set((base.candidates || []).map((c) => c.name))

    const kept: Spot[] = []
    let removed = 0
    for (const s of base.spots) {
      const key = spotKey(s)
      // 只有「来自候选、且该候选已被取消勾选」的节点才删；手加节点与认不出来的节点都留着
      if (candidateNames.has(key) && !pickedNames.has(key)) {
        removed += 1
        continue
      }
      kept.push(s)
    }

    const seen = new Set(kept.map(spotKey))
    const added: Spot[] = []
    for (const c of picked) {
      if (seen.has(c.name)) continue
      seen.add(c.name)
      added.push(newSpotFromCandidate(c, kept.length + added.length))
      if (added.length >= 12) break
    }

    if (added.length === 0 && removed === 0) return null

    const saved = persist({ ...base, spots: [...kept, ...added] })
    const focus = added[0] || kept[0]
    if (focus) {
      setSelectedId(focus.id)
      setMapCenter({ lng: focus.lng, lat: focus.lat })
    }
    return { draft: saved, added: added.length, removed }
  }

  /** 用勾选的候选直接生成节点（坐标已就位，不再请求高德）；返回落盘后的草稿 */
  const createSpotsFromCandidates = (): DraftAttraction | null => {
    if (!draft) return null
    if ((draft.candidates || []).every((c) => !c.picked)) {
      setToast('请先勾选候选地点')
      return null
    }
    const result = syncSpotsFromCandidates(draft)
    if (!result) {
      setToast('阶段二节点已与勾选一致，无需更新')
      return null
    }
    const changes = [
      result.added > 0 ? `新增 ${result.added} 个` : '',
      result.removed > 0 ? `移除 ${result.removed} 个` : '',
    ].filter(Boolean)
    setToast(`已按勾选更新节点：${changes.join('、')}；可改名或拖标记校准`)
    return result.draft
  }

  /** 删掉这个节点的连线，回落到「按数组顺序接下一个」 */
  const resetStoryChoices = (spotId: string) => {
    if (!draft) return
    persist(resetStoryChoicesIn(draft, spotId))
  }

  /** 勾选态直接以"生效中的去向"为准，所以没连过的节点也显示它默认接的那个 */
  const toggleStoryChoice = (spotId: string, toId: string) => {
    if (!draft) return
    persist(toggleStoryChoiceIn(draft, spotId, toId))
  }

  const setStoryEntry = (spotId: string) => {
    if (!draft) return
    persist(setStoryEntryIn(draft, spotId))
  }

  /** 删节点时把分支表里的引用一并清掉，免得留下一堆悬空指向 */
  const removeSpot = (spotId: string) => {
    if (!draft) return
    const spots = draft.spots.filter((s) => s.id !== spotId)
    let story = draft.story
    if (story) {
      const choices: Record<string, StoryChoice[]> = {}
      for (const [from, list] of Object.entries(story.choices || {})) {
        if (from === spotId) continue
        choices[from] = (list || []).filter((c) => c?.to && c.to !== spotId)
      }
      const endings = { ...(story.endings || {}) }
      delete endings[spotId]
      story = { ...story, choices, endings, entry: story.entry === spotId ? undefined : story.entry }
    }
    persist({ ...draft, spots, story })
    if (selectedId === spotId) setSelectedId(spots[0]?.id ?? null)
  }

  if (!draft) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f7f8fa] text-sm text-[#6b7280]">
        加载中…
      </div>
    )
  }

  const busy = resolving
  const candidates = draft.candidates || []
  const pickedCount = candidates.filter((c) => c.picked).length
  const writtenCount = draft.spots.filter((s) => !isSpotPlaceholder(s)).length

  const isStory = draft.mode === 'story'
  const selectedSpot = draft.spots.find((s) => s.id === selectedId) || null
  const storyIssues = isStory ? validateStoryGraph(draft) : []
  const storyBlockers = storyIssues.filter((i) => i.level === 'error')
  const storyWarnings = storyIssues.filter((i) => i.level === 'warn')
  const storyOrphans = isStory ? storyUnreachable(draft) : []
  const storyEntryName = isStory
    ? draft.spots.find((s) => s.id === storyEntryId(draft))?.name || '—'
    : '—'
  const storyEndingCount = isStory
    ? draft.spots.filter((s) => storyNextChoices(draft, s.id).length === 0).length
    : 0
  /** 每行下面那行小字：去向 / 结局 / 按顺序接谁 */
  const storyRowHint = (spot: Spot) => {
    if (!isStory) return ''
    const nameOf = (id: string) => draft.spots.find((s) => s.id === id)?.name || id
    if (storyIsExplicitEnding(draft, spot.id)) return '结局 · 无去向'
    const stored = storyStoredChoices(draft, spot.id)
    const effective = storyNextChoices(draft, spot.id)
    if (effective.length === 0) return '结局'
    if (stored.length === 0) return `按顺序 → ${effective.map((c) => nameOf(c.to)).join('、')}`
    return `去向：${effective.map((c) => nameOf(c.to)).join('、')}`
  }

  return (
    <div className="h-screen flex flex-col bg-[#f7f8fa] text-[#111827]">
      <header className="shrink-0 flex items-center justify-between gap-3 px-4 sm:px-5 h-14 bg-white border-b border-black/5">
        <div className="flex items-center gap-3 min-w-0">
          <Link to="/publish" className="inline-flex items-center gap-1 text-sm text-[#6b7280] hover:text-[#111827]">
            <ArrowLeft size={16} />
            返回
          </Link>
          <input
            value={draft.name}
            onChange={(e) => updateDraft({ name: e.target.value, amapContext: '' })}
            placeholder="景点名称"
            className="min-w-0 flex-1 max-w-xs bg-transparent text-[15px] font-medium outline-none placeholder:text-[#c4c4c4]"
          />
          <span
            className={`hidden sm:inline text-[11px] px-1.5 py-0.5 rounded-md ${
              draft.status === 'published' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
            }`}
          >
            {draft.status === 'published' ? '已发布' : '草稿'}
          </span>
        </div>

        <div className="hidden md:flex items-center gap-1 rounded-lg bg-[#f3f4f6] p-0.5">
          <button
            type="button"
            onClick={() => gotoStage(1)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              stage === 1 ? 'bg-white text-[#111827] shadow-sm' : 'text-[#6b7280] hover:text-[#111827]'
            }`}
          >
            1. 确定范围
          </button>
          <button
            type="button"
            onClick={() => void goStage2()}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              stage === 2 ? 'bg-white text-[#111827] shadow-sm' : 'text-[#6b7280] hover:text-[#111827]'
            }`}
          >
            2. 地点与内容
          </button>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {stage === 1 ? (
            <>
              <button
                type="button"
                onClick={() => void onResolveScope()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm hover:bg-[#f3f4f6] disabled:opacity-50"
              >
                <MapPin size={14} />
                {resolving ? '检索中…' : '检索范围'}
              </button>
              <button
                type="button"
                onClick={() => void goStage2()}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-lg bg-[#3b82f6] text-white px-3.5 py-1.5 text-sm hover:bg-[#2563eb] disabled:opacity-50"
              >
                下一步
                <ArrowRight size={14} />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => gotoStage(1)}
                className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm hover:bg-[#f3f4f6]"
              >
                上一步
              </button>
              <button
                type="button"
                onClick={() => navigate(`/publish/${draft.id}/preview?from=map`)}
                className="rounded-lg bg-[#3b82f6] text-white px-3.5 py-1.5 text-sm hover:bg-[#2563eb]"
              >
                预览
              </button>
            </>
          )}
        </div>
      </header>

      {stage === 1 ? (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1400px] px-5 py-5 sm:px-8 sm:py-7">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:items-start">
              {/* 左：基础信息 */}
              <section className="space-y-4 rounded-2xl border border-black/[0.06] bg-white p-5">
                <div>
                  <h2 className="text-lg font-medium tracking-tight">确定旅游范围</h2>
                  <p className="mt-1 text-sm leading-relaxed text-[#6b7280]">
                    先写清景点与城市，再用高德确认景区位置与周边地点；下一步把这些地点交给 AI 生成导览。
                  </p>
                </div>

                <label className="block">
                  <span className="text-xs text-[#9ca3af]">景点名称</span>
                  <input
                    value={draft.name}
                    onChange={(e) => updateDraft({ name: e.target.value, amapContext: '' })}
                    placeholder="如：豫园、长白山北坡"
                    className="mt-1 w-full rounded-lg border border-black/8 bg-[#f9fafb] px-3 py-2.5 text-sm outline-none focus:border-[#3b82f6]/50 focus:bg-white"
                  />
                </label>

                <label className="block">
                  <span className="text-xs text-[#9ca3af]">城市 / 区域</span>
                  <div className="mt-1">
                    <CityRegionSelect
                      value={draft.city || ''}
                      onChange={(city) => updateDraft({ city, amapContext: '' })}
                      disabled={busy}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-[#9ca3af]">数据来自高德行政区查询（DistrictSearch）</p>
                </label>

                <div className="border-t border-black/5 pt-4">
                  <span className="text-xs text-[#9ca3af]">导览模式</span>
                  <div className="mt-1 flex w-fit items-center gap-1 rounded-lg bg-[#f3f4f6] p-0.5">
                    {(
                      [
                        { key: 'checkin', label: '打卡' },
                        { key: 'story', label: '故事' },
                      ] as const
                    ).map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => updateDraft({ mode: item.key })}
                        className={`cursor-pointer rounded-md px-3 py-1.5 text-sm transition-colors ${
                          (draft.mode || 'checkin') === item.key
                            ? 'bg-white text-[#111827] shadow-sm'
                            : 'text-[#6b7280] hover:text-[#111827]'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-[11px] text-[#9ca3af]">
                    {draft.mode === 'story'
                      ? '故事模式：节点之间自己连去向，前台由游客选路'
                      : '打卡模式：按列表顺序线性走完'}
                  </p>
                </div>

                <div className="space-y-2 border-t border-black/5 pt-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-[#111827]">主景区</p>
                      <p className="mt-0.5 text-[11px] text-[#9ca3af]">
                        {draft.amapContext
                          ? `坐标 ${draft.start.lng.toFixed(5)}, ${draft.start.lat.toFixed(5)}`
                          : '尚未检索'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void onResolveScope()}
                      disabled={busy}
                      className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-[#111827] px-3 py-1.5 text-sm text-white hover:bg-black disabled:opacity-50"
                    >
                      <MapPin size={14} />
                      {resolving ? '检索中…' : draft.amapContext ? '重新检索' : '检索景区'}
                    </button>
                  </div>
                  {draft.amapContext ? (
                    <pre className="max-h-64 overflow-y-auto rounded-lg bg-[#f9fafb] px-3 py-2 text-[11px] leading-relaxed text-[#4b5563] whitespace-pre-wrap font-sans">
                      {draft.areaPoi ? buildMainPoiText(draft.areaPoi) : draft.amapContext}
                    </pre>
                  ) : (
                    <p className="text-sm text-[#9ca3af]">填写名称后点「检索景区」，确认主景区再进入下一步。</p>
                  )}
                </div>
              </section>

              {/* 右：候选地点（方位画布 + 明细同栏） */}
              <section className="space-y-4 rounded-2xl border border-black/[0.06] bg-white p-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">候选地点</p>
                  <p className="text-[11px] text-[#9ca3af]">
                    主景点与已选地点的方位示意，不按比例尺 · 点圆点取消选中
                  </p>
                </div>
                <SpotRelativeMap
                  main={
                    draft.areaPoi
                      ? {
                          name: draft.areaPoi.name,
                          lng: draft.areaPoi.location.lng,
                          lat: draft.areaPoi.location.lat,
                        }
                      : undefined
                  }
                  points={candidates.filter((c) => c.picked)}
                  onToggle={toggleCandidate}
                />

                <CandidateList
                  candidates={candidates}
                  pickedCount={pickedCount}
                  emptyHint="尚无候选：点左侧「检索景区」，会自动扫描景区周边地点"
                  hasSpots={draft.spots.length > 0}
                  onToggle={toggleCandidate}
                  onSetAll={setAllCandidates}
                  onGenerate={() => {
                    const saved = createSpotsFromCandidates()
                    if (saved) gotoStage(2, saved)
                  }}
                />
              </section>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex">
          <aside className="w-[min(100%,380px)] shrink-0 border-r border-black/5 bg-white flex flex-col min-h-0">
            <div className="p-4 space-y-3 border-b border-black/5 shrink-0 max-h-[52vh] overflow-y-auto">
              <p className="text-xs text-[#9ca3af]">阶段二 · 地图选点</p>
              <p className="text-sm text-[#6b7280] leading-relaxed">
                勾选候选、拖标记校准坐标；文案留到「内容创作」再写。
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setShowRoute((v) => !v)}
                  disabled={draft.spots.length < 2}
                  className={`inline-flex cursor-pointer items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs disabled:opacity-45 ${
                    showRoute
                      ? 'border-[#3b82f6]/40 bg-[#eff6ff] text-[#1d4ed8]'
                      : 'border-black/10 hover:bg-[#f9fafb]'
                  }`}
                >
                  <Route size={12} />
                  {showRoute ? '隐藏路线' : '显示路线'}
                </button>
                <button
                  type="button"
                  onClick={onAddSpot}
                  className="inline-flex items-center gap-1 rounded-lg border border-black/10 px-2.5 py-1.5 text-xs hover:bg-[#f9fafb]"
                >
                  <Plus size={12} />
                  手动加点
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
              {draft.spots.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-[#9ca3af]">
                  回「1. 确定范围」勾选候选生成节点，或点上方「手动加点」
                </p>
              ) : (
                <div className="px-3 py-2 space-y-1">
                  <div className="flex items-center justify-between gap-2 px-1">
                    <p className="text-xs font-medium text-[#6b7280]">导览节点</p>
                    <p className="text-[11px] text-[#9ca3af] tabular-nums">
                      已编辑 {writtenCount}/{draft.spots.length}
                    </p>
                  </div>
                  {isStory && (
                    <p className="px-1 pb-1 text-[11px] text-[#9ca3af]">
                      入口：{storyEntryName} · 结局 {storyEndingCount} 个
                      {storyOrphans.length > 0 && (
                        <span className="text-amber-600"> · 孤立 {storyOrphans.length} 个</span>
                      )}
                    </p>
                  )}
                  {draft.spots.map((spot, index) => {
                    const active = spot.id === selectedId
                    const unwritten = isSpotPlaceholder(spot)
                    return (
                      <div
                        key={spot.id}
                        className={`flex items-center gap-1 rounded-lg px-2 py-2 ${
                          active ? 'bg-[#eff6ff]' : 'hover:bg-[#f9fafb]'
                        }`}
                      >
                        <div
                          role="button"
                          tabIndex={0}
                          className="flex-1 flex items-center gap-2 text-left min-w-0 cursor-pointer"
                          onClick={() => {
                            setSelectedId(spot.id)
                            setMapCenter({ lng: spot.lng, lat: spot.lat })
                          }}
                          onKeyDown={(e) => {
                            if (e.target !== e.currentTarget) return
                            if (e.key !== 'Enter' && e.key !== ' ') return
                            e.preventDefault()
                            setSelectedId(spot.id)
                            setMapCenter({ lng: spot.lng, lat: spot.lat })
                          }}
                        >
                          <span className="w-5 h-5 rounded-full bg-[#111827] text-white text-[11px] flex items-center justify-center shrink-0">
                            {index + 1}
                          </span>
                          <span className="block min-w-0">
                            <span className="flex items-center gap-1.5 min-w-0">
                              <span className="truncate text-sm">{spot.name}</span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onGoContent(spot.id)
                                }}
                                title={unwritten ? '去内容创作写这段讲解' : '去内容创作改这段讲解'}
                                className={`shrink-0 cursor-pointer rounded border px-1.5 py-0.5 text-[10px] ${
                                  unwritten
                                    ? 'border-amber-300 text-amber-600 hover:bg-amber-50'
                                    : 'border-black/10 text-[#6b7280] hover:bg-[#f3f4f6]'
                                }`}
                              >
                                {unwritten ? '未编辑' : '已编辑'}
                              </button>
                            </span>
                            <span className="block text-[11px] text-[#9ca3af] tabular-nums">
                              {spot.lng.toFixed(4)}, {spot.lat.toFixed(4)}
                            </span>
                            {isStory && (
                              <span
                                className={`block truncate text-[11px] ${
                                  storyIsExplicitEnding(draft, spot.id) ? 'text-[#6b7280]' : 'text-[#9ca3af]'
                                }`}
                              >
                                {storyRowHint(spot)}
                              </span>
                            )}
                          </span>
                        </div>
                        <button
                          type="button"
                          disabled={index === 0}
                          className="p-1 rounded text-[#9ca3af] hover:text-[#111827] disabled:opacity-25"
                          onClick={() => moveSpot(index, -1)}
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          type="button"
                          disabled={index === draft.spots.length - 1}
                          className="p-1 rounded text-[#9ca3af] hover:text-[#111827] disabled:opacity-25"
                          onClick={() => moveSpot(index, 1)}
                        >
                          <ArrowDown size={14} />
                        </button>
                        <button
                          type="button"
                          className="p-1 rounded text-[#9ca3af] hover:text-red-600"
                          onClick={() => removeSpot(spot.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}

              {isStory && selectedSpot && (
                <div className="space-y-3 border-t border-black/5 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium text-[#6b7280]">
                      <GitBranch size={12} className="shrink-0" />
                      <span className="truncate">分支 · {selectedSpot.name}</span>
                    </p>
                    <button
                      type="button"
                      onClick={() => setStoryEntry(selectedSpot.id)}
                      disabled={storyEntryId(draft) === selectedSpot.id}
                      className="shrink-0 cursor-pointer rounded border border-black/10 px-1.5 py-0.5 text-[10px] hover:bg-[#f3f4f6] disabled:opacity-45"
                    >
                      {storyEntryId(draft) === selectedSpot.id ? '已是入口' : '设为入口'}
                    </button>
                  </div>

                  <div>
                    <p className="text-[11px] text-[#9ca3af]">去向（可多选，不设上限；全不勾 = 结局）</p>
                    <div className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
                      {draft.spots
                        .filter((s) => s.id !== selectedSpot.id)
                        .map((s) => (
                          <label
                            key={s.id}
                            className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-[#f9fafb]"
                          >
                            <input
                              type="checkbox"
                              checked={storyNextChoices(draft, selectedSpot.id).some((c) => c.to === s.id)}
                              onChange={() => toggleStoryChoice(selectedSpot.id, s.id)}
                            />
                            <span className="truncate">{s.name}</span>
                          </label>
                        ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => resetStoryChoices(selectedSpot.id)}
                      className="cursor-pointer rounded border border-black/10 px-2 py-1 text-[11px] hover:bg-[#f3f4f6]"
                    >
                      按数组顺序（默认）
                    </button>
                    <span className="inline-flex items-center gap-1 text-[11px] text-[#9ca3af]">
                      {storyNextChoices(draft, selectedSpot.id).length === 0 ? (
                        <>
                          <Flag size={11} />
                          当前是结局
                        </>
                      ) : (
                        `去向 ${storyNextChoices(draft, selectedSpot.id).length} 个`
                      )}
                    </span>
                  </div>
                </div>
              )}

              {isStory && (storyBlockers.length > 0 || storyWarnings.length > 0) && (
                <div className="space-y-1 border-t border-black/5 p-4">
                  <p className="text-xs font-medium text-[#6b7280]">分支检查</p>
                  {storyBlockers.map((issue, i) => (
                    <p key={`e${i}`} className="text-[11px] leading-relaxed text-red-600">
                      · {issue.message}
                    </p>
                  ))}
                  {storyWarnings.map((issue, i) => (
                    <p key={`w${i}`} className="text-[11px] leading-relaxed text-amber-600">
                      · {issue.message}
                    </p>
                  ))}
                </div>
              )}

              <div className="border-t border-black/5 p-4 space-y-2">
                <p className="text-xs font-medium text-[#6b7280]">游客起点</p>
                <p className="text-[11px] text-[#9ca3af] tabular-nums">
                  {draft.start.lng.toFixed(5)}, {draft.start.lat.toFixed(5)}
                </p>
                <p className="text-[10px] text-[#9ca3af]">
                  直接拖地图上的绿色「起」标记即可挪动
                </p>
              </div>

              <div className="border-t border-black/5 p-4 space-y-2">
                <button
                  type="button"
                  onClick={() => onGoContent()}
                  disabled={busy || draft.spots.length === 0}
                  className="w-full inline-flex items-center justify-center gap-1 rounded-lg bg-[#111827] text-white px-3 py-2 text-sm hover:bg-black disabled:opacity-50"
                >
                  内容创作
                  <ArrowRight size={14} />
                </button>
                <p className="text-[10px] text-[#9ca3af]">
                  逐站写文案；全部写完（{writtenCount}/{draft.spots.length}）才能发布
                </p>
              </div>
            </div>
          </aside>

          <section className="relative flex-1 min-w-0">
            <PublishSpotMap
              center={mapCenter || draft.start}
              zoom={draft.zoom}
              spots={draft.spots}
              selectedId={selectedId}
              start={draft.start}
              showRoute={showRoute}
              onSelect={setSelectedId}
              onMove={(spotId, pos) => updateSpot(spotId, pos)}
              onStartMove={(pos) => updateDraft({ start: pos })}
              onZoomChange={(z) => updateDraft({ zoom: Number(z.toFixed(2)) })}
              onCenterChange={(pos) => updateDraft({ view: pos })}
              onReady={(api) => {
                mapApiRef.current = api
              }}
              onError={setMapError}
            />
            {mapError && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/80 text-sm text-red-600">
                {mapError}
              </div>
            )}
            <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-[#6b7280] bg-white/90 px-3 py-1.5 rounded-full border border-black/5 shadow-sm">
              拖标记校准位置 · 拖绿标定游客起点 · 列表顺序即游览顺序
            </p>
          </section>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-full bg-[#111827] text-white text-sm px-4 py-2 shadow-lg max-w-[90vw]">
          {toast}
          <button type="button" className="ml-3 text-white/60" onClick={() => setToast('')}>
            关闭
          </button>
        </div>
      )}
    </div>
  )
}
