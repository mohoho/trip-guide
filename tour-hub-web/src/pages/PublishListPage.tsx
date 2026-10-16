import { Link, useNavigate } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { loadCatalog } from '../lib/catalog'
import { createDraft, deleteDraft, listLocalDrafts } from '../lib/draftStore'
import type { CatalogItem } from '../lib/tourPackage'
import type { DraftAttraction } from '../types/attraction'

type ListRow = {
  id: string
  name: string
  description: string
  coverImage: string
  status: 'draft' | 'published'
  spotHint: string
  localOnly: boolean
}

function draftToRow(d: DraftAttraction): ListRow {
  return {
    id: d.id,
    name: d.name || '未命名景点',
    description: d.description || '暂无简介',
    coverImage: d.coverImage || d.spots[0]?.image || '/spots/map-intro.jpg',
    status: d.status,
    spotHint: `${d.spots.length} 个导览节点`,
    localOnly: true,
  }
}

function catalogToRow(c: CatalogItem): ListRow {
  return {
    id: c.id,
    name: c.name,
    description: c.description || '暂无简介',
    coverImage: c.coverImage || '/spots/map-intro.jpg',
    status: 'published',
    spotHint: '已发布',
    localOnly: false,
  }
}

/** 与前台同一数据源 public/spots；本地未发布草稿附加在后 */
function mergeRows(catalog: CatalogItem[], drafts: DraftAttraction[]): ListRow[] {
  const publishedIds = new Set(catalog.map((c) => c.id))
  const rows = catalog.map(catalogToRow)
  for (const d of drafts) {
    if (publishedIds.has(d.id)) continue
    rows.push(draftToRow(d))
  }
  return rows
}

export function PublishListPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<ListRow[]>([])
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)

  const reload = useCallback(() => {
    loadCatalog()
      .then((catalog) => {
        setRows(mergeRows(catalog, listLocalDrafts()))
        setError('')
      })
      .catch((e) => {
        // catalog 缺失时仍展示本地草稿
        setRows(mergeRows([], listLocalDrafts()))
        setError(e instanceof Error ? e.message : '目录加载失败')
      })
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

  const featured = rows[0] || null

  return (
    <div className="min-h-screen bg-[#f7f8fa] text-[#111827]">
      <header className="sticky top-0 z-20 flex items-center justify-between gap-4 px-5 sm:px-8 h-14 bg-white/90 backdrop-blur border-b border-black/5">
        <div className="flex items-center gap-3 min-w-0">
          <Link to="/" className="text-sm text-[#6b7280] hover:text-[#111827] shrink-0">
            前台
          </Link>
          <span className="text-[#d1d5db]">/</span>
          <div className="min-w-0">
            <h1 className="text-[15px] font-medium truncate">发布后台</h1>
            <p className="text-xs text-[#9ca3af]">与前台共用 public/spots</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#3b82f6] text-white px-3.5 py-1.5 text-sm hover:bg-[#2563eb]"
        >
          <Plus size={15} />
          新建景点
        </button>
      </header>

      <main className="mx-auto max-w-5xl px-5 sm:px-8 py-6 sm:py-8 space-y-6">
        {error && rows.length === 0 ? (
          <div className="rounded-2xl border border-red-100 bg-white px-6 py-8 text-sm text-red-600">{error}</div>
        ) : null}

        {featured ? (
          <Link
            to={`/publish/${featured.id}`}
            className="group relative block overflow-hidden rounded-2xl border border-black/[0.06] bg-[#111827] min-h-[220px] sm:min-h-[280px]"
          >
            <img
              src={featured.coverImage}
              alt=""
              className="absolute inset-0 w-full h-full object-cover opacity-75 group-hover:scale-[1.02] transition-transform duration-500"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />
            <div className="relative z-10 flex flex-col justify-end h-full min-h-[220px] sm:min-h-[280px] p-6 sm:p-8">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`text-[11px] px-1.5 py-0.5 rounded-md ${
                    featured.status === 'published'
                      ? 'bg-emerald-500/90 text-white'
                      : 'bg-amber-400/90 text-[#111827]'
                  }`}
                >
                  {featured.status === 'published' ? '已发布' : '草稿'}
                </span>
                <span className="text-[11px] text-white/70">{featured.spotHint}</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-medium text-white tracking-tight">{featured.name}</h2>
              <p className="mt-2 text-sm text-white/80 max-w-xl line-clamp-2">{featured.description}</p>
            </div>
          </Link>
        ) : (
          <button
            type="button"
            onClick={onCreate}
            className="w-full rounded-2xl border border-dashed border-black/15 bg-white px-6 py-16 text-center hover:border-[#3b82f6]/40 hover:bg-[#f8fbff]"
          >
            <p className="text-base font-medium">创建              创建第一个景点</p>
            <p className="mt-1 text-sm text-[#9ca3af]">定范围 · AI+高德生成 · 发布</p>
          </button>
        )}

        {rows.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-[#6b7280]">全部景点</h3>
              <span className="text-xs text-[#9ca3af]">{rows.length} 个</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {rows.map((item) => (
                <div
                  key={item.id}
                  className="group relative rounded-2xl border border-black/[0.06] bg-white overflow-hidden hover:shadow-md transition-shadow"
                >
                  <Link to={`/publish/${item.id}`} className="block">
                    <div className="aspect-[16/10] bg-[#f3f4f6] overflow-hidden">
                      <img
                        src={item.coverImage}
                        alt=""
                        className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500"
                      />
                    </div>
                    <div className="p-3.5">
                      <div className="flex items-center gap-2">
                        <h4 className="text-[15px] font-medium truncate flex-1">{item.name}</h4>
                        <span
                          className={`shrink-0 text-[11px] px-1.5 py-0.5 rounded-md ${
                            item.status === 'published'
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-amber-50 text-amber-700'
                          }`}
                        >
                          {item.status === 'published' ? '已发布' : '草稿'}
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm text-[#6b7280] line-clamp-2">{item.description}</p>
                      <p className="mt-2 text-[11px] text-[#9ca3af]">{item.spotHint}</p>
                    </div>
                  </Link>
                  {item.localOnly && (
                    <button
                      type="button"
                      className="absolute top-2.5 right-2.5 p-1.5 rounded-lg bg-white/90 text-[#9ca3af] hover:text-red-600 shadow-sm"
                      title="删除本地草稿"
                      onClick={() => {
                        if (deleteDraft(item.id)) setTick((t) => t + 1)
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
