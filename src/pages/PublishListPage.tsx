import { Link, useNavigate } from 'react-router-dom'
import { RotateCcw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { ModeTag } from '../components/ModeTag'
import { SiteFooter } from '../components/SiteFooter'
import { SiteHeader } from '../components/SiteHeader'
import { loadCatalog, loadPublishedAttraction } from '../lib/catalog'
import { createDraft, deleteDraft, isSpotPlaceholder, listLocalDrafts } from '../lib/draftStore'
import { listTrashedSpots, restoreSpotViaServer, trashSpotViaServer, type TrashedSpot } from '../lib/exportTarget'
import { storyBranchOutline } from '../lib/storyTour'
import type { CatalogItem, StoryGraph, TourMode } from '../lib/tourPackage'
import type { DraftAttraction, Spot } from '../types/attraction'

type ListRow = {
  id: string
  name: string
  description: string
  coverImage: string
  status: 'draft' | 'published'
  localOnly: boolean
  mode?: TourMode
  /** 当前节点（本地草稿优先，其次读发布包；读不到就是空数组） */
  spots: Spot[]
  /** 故事分支表，同样是草稿优先；打卡包没有 */
  story?: StoryGraph
}

function base(
  id: string,
  name: string,
  description: string,
  coverImage: string,
): Omit<ListRow, 'status' | 'localOnly' | 'mode' | 'spots' | 'story'> {
  return {
    id,
    name: name || '未命名景点',
    description: description || '暂无简介',
    coverImage: coverImage || '/spots/map-intro.jpg',
  }
}

/** 节点统计：与编辑器同一口径（空要点 / 待完善 / 只剩地址行 = 未编辑） */
function nodeSummary(spots: Spot[]): { total: number; edited: number; names: string } {
  const edited = spots.filter((s) => !isSpotPlaceholder(s)).length
  return {
    total: spots.length,
    edited,
    names: spots.map((s) => s.name || '未命名节点').join(' → '),
  }
}

/** 发布包里是否有这个景点；有就顺带把节点与分支表读出来给列表用 */
async function loadPackageNodes(id: string): Promise<{ spots: Spot[]; story?: StoryGraph }> {
  try {
    const pkg = await loadPublishedAttraction(id)
    return { spots: pkg.spots, story: pkg.story }
  } catch {
    return { spots: [] }
  }
}

/** 与前台同一数据源 public/spots；本地未发布草稿附加在后 */
async function buildRows(catalog: CatalogItem[], drafts: DraftAttraction[]): Promise<ListRow[]> {
  const draftById = new Map(drafts.map((d) => [d.id, d]))
  const publishedIds = new Set(catalog.map((c) => c.id))

  const published = await Promise.all(
    catalog.map(async (c): Promise<ListRow> => {
      const local = draftById.get(c.id)
      const nodes = local ? { spots: local.spots, story: local.story } : await loadPackageNodes(c.id)
      return {
        ...base(c.id, c.name, c.description, c.coverImage),
        status: 'published',
        localOnly: false,
        mode: c.mode,
        spots: nodes.spots,
        story: nodes.story,
      }
    }),
  )

  const localOnly = drafts
    .filter((d) => !publishedIds.has(d.id))
    .map(
      (d): ListRow => ({
        ...base(d.id, d.name, d.description, d.coverImage || d.spots[0]?.image || ''),
        status: d.status,
        localOnly: true,
        mode: d.mode,
        spots: d.spots,
        story: d.story,
      }),
    )

  return [...published, ...localOnly]
}

export function PublishListPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<ListRow[]>([])
  const [trashed, setTrashed] = useState<TrashedSpot[]>([])
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [pendingDelete, setPendingDelete] = useState('')
  const [busy, setBusy] = useState('')
  const [tick, setTick] = useState(0)

  const reload = useCallback(() => {
    const drafts = listLocalDrafts()
    void listTrashedSpots().then(setTrashed)
    loadCatalog()
      .then((catalog) => {
        setError('')
        return buildRows(catalog, drafts)
      })
      .catch(() => {
        // catalog 缺失时仍展示本地草稿
        setError('目录加载失败，只列出本地草稿')
        return buildRows([], drafts)
      })
      .then(setRows)
  }, [])

  useEffect(() => {
    reload()
  }, [reload, tick])

  const onCreate = () => {
    const item = createDraft({
      name: '',
      description: '',
    })
    navigate(`/publish/${item.id}`)
  }

  const onDelete = async (row: ListRow) => {
    setPendingDelete('')
    if (row.localOnly) {
      deleteDraft(row.id)
      setToast('已删除本地草稿')
      setTick((t) => t + 1)
      return
    }
    setBusy(row.id)
    try {
      const result = await trashSpotViaServer(row.id)
      deleteDraft(row.id)
      setToast(`已移入 .trash\\spots（${result.trashed.join('、')}），可在页面底部恢复`)
      setTick((t) => t + 1)
    } catch (e) {
      setToast(e instanceof Error ? e.message : '删除失败')
    } finally {
      setBusy('')
    }
  }

  const onRestore = async (entry: TrashedSpot) => {
    setBusy(entry.folder)
    try {
      await restoreSpotViaServer(entry.folder)
      setToast(`已恢复「${entry.name}」，前台与列表都回来了`)
      setTick((t) => t + 1)
    } catch (e) {
      setToast(e instanceof Error ? e.message : '恢复失败')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#f7f8fa] text-[#111827]">
      <SiteHeader back={{ label: '返回前台', to: '/' }} cta={{ label: '新建景点', onClick: onCreate }} />

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 sm:px-8 py-6 sm:py-8 space-y-6">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-medium tracking-tight">景点管理</h2>
          <span className="rounded-md bg-[#eef2ff] px-1.5 py-0.5 text-[11px] text-[#4f46e5]">发布后台</span>
        </div>

        {error ? (
          <div className="rounded-2xl border border-red-100 bg-white px-6 py-5 text-sm text-red-600">{error}</div>
        ) : null}

        {rows.length === 0 ? (
          <button
            type="button"
            onClick={onCreate}
            className="w-full rounded-2xl border border-dashed border-black/15 bg-white px-6 py-16 text-center hover:border-[#3b82f6]/40 hover:bg-[#f8fbff]"
          >
            <p className="text-base font-medium">创建第一个景点</p>
            <p className="mt-1 text-sm text-[#9ca3af]">定范围 · AI+高德生成 · 发布</p>
          </button>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-[#6b7280]">全部景点</h3>
              <span className="text-xs text-[#9ca3af]">{rows.length} 个</span>
            </div>

            {rows.map((row) => {
              const summary = nodeSummary(row.spots)
              // 故事包优先列分叉；没有分叉（或没有分支表）就还是那条线性链条
              const branches = row.mode === 'story' ? storyBranchOutline(row) : []
              return (
                <div
                  key={row.id}
                  className="flex items-center gap-4 rounded-2xl border border-black/[0.06] bg-white p-3 transition-shadow hover:shadow-md"
                >
                  <Link to={`/publish/${row.id}`} className="flex min-w-0 flex-1 items-center gap-4">
                    <img
                      src={row.coverImage}
                      alt=""
                      className="h-[68px] w-[102px] shrink-0 rounded-xl bg-[#f3f4f6] object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <h4 className="truncate text-[15px] font-medium">{row.name}</h4>
                        <ModeTag mode={row.mode} />
                        <span
                          className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] ${
                            row.status === 'published'
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-amber-50 text-amber-700'
                          }`}
                        >
                          {row.status === 'published' ? '已发布' : '草稿'}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-sm text-[#6b7280]">{row.description}</p>
                      {summary.total === 0 ? (
                        <p className="mt-1.5 text-[11px] text-[#9ca3af]">暂无节点</p>
                      ) : (
                        <p className="mt-1.5 line-clamp-3 text-[11px] text-[#9ca3af]">
                          {summary.total} 个节点 · 已编辑 {summary.edited} / 未编辑{' '}
                          {summary.total - summary.edited} ·{' '}
                          {branches.length > 0 ? branches.join(' · ') : summary.names}
                        </p>
                      )}
                    </div>
                  </Link>

                  <div className="flex shrink-0 items-center gap-1 pr-1">
                    {pendingDelete === row.id ? (
                      <>
                        <button
                          type="button"
                          className="rounded-lg px-2 py-1.5 text-xs text-[#6b7280] hover:bg-black/[0.04]"
                          onClick={() => setPendingDelete('')}
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          className="rounded-lg bg-red-600 px-2.5 py-1.5 text-xs text-white hover:bg-red-700"
                          onClick={() => onDelete(row)}
                        >
                          确认删除
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="rounded-lg p-2 text-[#9ca3af] hover:bg-black/[0.04] hover:text-red-600 disabled:opacity-40"
                        title={row.localOnly ? '删除本地草稿' : '移入 .trash\\spots（可恢复）'}
                        disabled={busy === row.id}
                        onClick={() => setPendingDelete(row.id)}
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {trashed.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-[#6b7280]">已删除</h3>
              <span className="text-xs text-[#9ca3af]">文件还在 .trash\spots，恢复就是搬回来</span>
            </div>
            {trashed.map((entry) => (
              <div
                key={entry.folder}
                className="flex items-center gap-4 rounded-2xl border border-dashed border-black/15 bg-white px-3.5 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <h4 className="truncate text-sm font-medium text-[#6b7280]">{entry.name}</h4>
                    <ModeTag mode={entry.mode} />
                    <span className="truncate text-[11px] text-[#9ca3af]">{entry.id}</span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-[#9ca3af]">
                    删除于 {new Date(entry.trashedAt).toLocaleString('zh-CN', { hour12: false })}
                  </p>
                </div>
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-black/10 px-2.5 py-1.5 text-xs text-[#374151] hover:bg-[#f9fafb] disabled:opacity-40"
                  disabled={busy === entry.folder}
                  onClick={() => onRestore(entry)}
                >
                  <RotateCcw size={13} />
                  恢复
                </button>
              </div>
            ))}
          </div>
        )}
      </main>

      <SiteFooter />

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-xl bg-[#111827] px-4 py-2.5 text-sm text-white shadow-lg">
          {toast}
          <button type="button" className="ml-3 text-white/60" onClick={() => setToast('')}>
            关闭
          </button>
        </div>
      )}
    </div>
  )
}
