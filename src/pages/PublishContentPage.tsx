import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Sparkles } from 'lucide-react'
import { SpotContentPanel } from '../components/SpotContentPanel'
import { fillSpotContent } from '../lib/aiDraft'
import { ensureEditableDraft, isSpotPlaceholder, publishDraft, saveDraft } from '../lib/draftStore'
import { storyNextChoices, storyStoredChoices, validateStoryGraph } from '../lib/storyTour'
import type { DraftAttraction, Spot } from '../types/attraction'

function readImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.readAsDataURL(file)
  })
}

/**
 * 阶段三 · 内容创作：独立页面，不挂地图，只写文案
 */
export function PublishContentPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  /** 从阶段二点某个节点的「已编辑 / 未编辑」跳进来时，直接定位到那个节点 */
  const wantedSpotId = searchParams.get('spot')
  const [draft, setDraft] = useState<DraftAttraction | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const item = await ensureEditableDraft(id)
      if (cancelled) return
      if (!item) {
        navigate('/publish', { replace: true })
        return
      }
      if (item.spots.length === 0) {
        navigate(`/publish/${item.id}`, { replace: true })
        return
      }
      setDraft(item)
      const wanted = item.spots.find((s) => s.id === wantedSpotId)
      setSelectedId(wanted ? wanted.id : item.spots[0].id)
    })()
    return () => {
      cancelled = true
    }
  }, [id, navigate, wantedSpotId])

  const selected = useMemo(() => {
    if (!draft) return null
    return draft.spots.find((s) => s.id === selectedId) || draft.spots[0] || null
  }, [draft, selectedId])

  const persist = (next: DraftAttraction) => {
    const saved = saveDraft(next)
    setDraft(saved)
    return saved
  }

  const updateSpot = (spotId: string, patch: Partial<Spot>) => {
    if (!draft) return
    persist({
      ...draft,
      spots: draft.spots.map((s) => (s.id === spotId ? { ...s, ...patch } : s)),
    })
  }

  const updateDraft = (patch: Partial<DraftAttraction>) => {
    if (!draft) return
    persist({ ...draft, ...patch })
  }

  const updateSlide = (field: 'title' | 'bullets' | 'narration', value: string) => {
    if (!draft || !selected) return
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

  /** AI 只写文案：按 index 一一对应回填 poetic / slides，不碰坐标与名称；简介一并写好 */
  const onGenerateContent = async () => {
    if (!draft || busy) return
    setBusy(true)
    setToast('AI 正在为各节点写讲解…')
    try {
      const result = await fillSpotContent({
        name: draft.name,
        description: draft.description,
        city: draft.city,
        amapContext: draft.amapContext,
        spots: draft.spots.map((s) => ({ name: s.name })),
      })
      const spots = draft.spots.map((s, i) => {
        const content = result.contents[i]
        if (!content) return s
        const slides = [...s.slides]
        slides[0] = content.slides[0]
        return { ...s, poetic: content.poetic, slides }
      })
      const saved = persist({
        ...draft,
        description: result.description || draft.description,
        spots,
      })
      setSelectedId((prev) => prev ?? saved.spots[0]?.id ?? null)
      const note = result.reason ? `（${result.reason}）` : ''
      setToast(
        result.source === 'ai'
          ? `已为 ${saved.spots.length} 个节点写入讲解${note}`
          : `AI 未接通${note}，已用模板内容；简介需自己补，逐条可改`,
      )
    } catch (e) {
      setToast(e instanceof Error ? e.message : '生成失败')
    } finally {
      setBusy(false)
    }
  }

  const onUploadImage = async (file: File) => {
    if (!draft || !selected) return
    if (!file.type.startsWith('image/')) {
      setToast('请选择图片文件')
      return
    }
    try {
      const dataUrl = await readImageFile(file)
      const nextSpots = draft.spots.map((s) =>
        s.id === selected.id ? { ...s, image: dataUrl, imageCredit: file.name } : s,
      )
      persist({
        ...draft,
        spots: nextSpots,
        coverImage:
          draft.coverImage === selected.image || !draft.coverImage ? dataUrl : draft.coverImage,
      })
      setToast('图片已上传')
    } catch {
      setToast('图片读取失败')
    }
  }

  /** 故事模式：只改选项上的字（去向的目标在「调整地点」里连） */
  const updateChoiceText = (spotId: string, toId: string, field: 'label' | 'note', value: string) => {
    if (!draft) return
    const choices = storyStoredChoices(draft, spotId).map((c) =>
      c.to === toId ? { ...c, [field]: value } : c,
    )
    persist({
      ...draft,
      story: {
        ...(draft.story || {}),
        choices: { ...(draft.story?.choices || {}), [spotId]: choices },
      },
    })
  }

  const updateEndingTitle = (spotId: string, value: string) => {
    if (!draft) return
    persist({
      ...draft,
      story: {
        ...(draft.story || {}),
        endings: { ...(draft.story?.endings || {}), [spotId]: value },
      },
    })
  }

  const onPublish = async () => {
    if (!draft) return
    if (!draft.name.trim()) {
      setToast('请先填写景点名称')
      return
    }
    try {
      setToast('正在打包图片…')
      const result = await publishDraft(draft.id, { zoom: draft.zoom, start: draft.start })
      if (result) {
        setDraft(result.draft)
        const n = Object.keys(result.pkg.assets || {}).length
        if (result.mode === 'config') {
          setToast(`已发布（${n} 张图），前台可立即查看`)
        } else {
          setToast(`写入 public/spots 失败，已改为下载文件（含 ${n} 张图）`)
        }
      }
    } catch (e) {
      setToast(e instanceof Error ? e.message : '导出失败')
    }
  }

  if (!draft || !selected) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f7f8fa] text-sm text-[#6b7280]">
        加载中…
      </div>
    )
  }

  const writtenCount = draft.spots.filter((s) => !isSpotPlaceholder(s)).length

  const isStory = draft.mode === 'story'
  const storyBlockers = isStory ? validateStoryGraph(draft).filter((i) => i.level === 'error') : []
  const spotChoices = isStory ? storyStoredChoices(draft, selected.id) : []
  const isEnding = isStory && storyNextChoices(draft, selected.id).length === 0
  const nameOf = (id: string) => draft.spots.find((s) => s.id === id)?.name || id
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

        <div className="min-w-0 text-center">
          <p className="truncate text-[15px] font-medium">{draft.name}</p>
          <p className="text-[11px] text-[#9ca3af] tabular-nums">
            {draft.spots.length} 个节点 · 已写 {writtenCount}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void onGenerateContent()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm hover:bg-[#f3f4f6] disabled:opacity-50"
          >
            <Sparkles size={14} />
            {busy ? '生成中…' : 'AI 生成讲解'}
          </button>
          <button
            type="button"
            onClick={() => void onPublish()}
            disabled={busy || storyBlockers.length > 0}
            title={storyBlockers[0]?.message}
            className="rounded-lg bg-[#3b82f6] text-white px-3.5 py-1.5 text-sm hover:bg-[#2563eb] disabled:opacity-50"
          >
            发布
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
                <p className="text-sm font-medium">景点简介</p>
                <p className="text-[11px] text-[#9ca3af]">列表与封面用这段字</p>
              </div>
              <textarea
                value={draft.description}
                onChange={(e) => updateDraft({ description: e.target.value })}
                rows={3}
                placeholder="点「AI 生成讲解」会一并写好，也可以自己改"
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
            {isStory && (
              <div className="rounded-2xl border border-black/[0.06] bg-white p-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">分支文案</p>
                  <p className="text-[11px] text-[#9ca3af]">去向的目标在「调整地点」里连，这里只写字</p>
                </div>

                {spotChoices.length === 0 && !isEnding && (
                  <p className="text-sm text-[#9ca3af]">
                    这个节点还没连去向，前台会按数组顺序接
                    {implicitNextName ? `「${implicitNextName}」` : '下一站'}。
                  </p>
                )}

                <div className="space-y-3">
                  {spotChoices.map((choice, i) => (
                    <div key={choice.to} className="rounded-xl border border-black/8 bg-[#f9fafb] p-3">
                      <p className="mb-2 text-xs text-[#6b7280]">
                        去向 {i + 1} · <span className="text-[#111827]">{nameOf(choice.to)}</span>
                      </p>
                      <label className="block">
                        <span className="text-[11px] text-[#9ca3af]">选项文案（留空则显示「下一步 · 目标名」）</span>
                        <input
                          value={choice.label || ''}
                          onChange={(e) => updateChoiceText(selected.id, choice.to, 'label', e.target.value)}
                          placeholder={`下一步 · ${nameOf(choice.to)}`}
                          className="mt-1 w-full rounded-lg border border-black/8 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-[#3b82f6]/50"
                        />
                      </label>
                      <label className="mt-2 block">
                        <span className="text-[11px] text-[#9ca3af]">一行小字（选填，如「约 80 米 · 5 分钟」）</span>
                        <input
                          value={choice.note || ''}
                          onChange={(e) => updateChoiceText(selected.id, choice.to, 'note', e.target.value)}
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
            )}

            <p className="pb-6 text-center text-xs text-[#9ca3af]">
              坐标在「调整地点」里改；这一页只写文案
            </p>
          </section>
        </div>
      </div>

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
