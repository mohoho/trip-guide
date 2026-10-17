import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { ModeTag } from '../components/ModeTag'
import { SiteFooter } from '../components/SiteFooter'
import { SiteHeader } from '../components/SiteHeader'
import type { CatalogItem, TourMode } from '../lib/tourPackage'
import { loadCatalog } from '../lib/catalog'

/** 首页页首的图例：色标 = 卡片上的标，后面跟一句这个标的意思 */
const MODE_LEGEND: Array<{ mode: TourMode; text: string }> = [
  { mode: 'checkin', text: '游遍景点，按顺序走完' },
  { mode: 'story', text: '分支探索，路口自己选下一步' },
]

/** 顶部 banner 自动轮播的间隔；鼠标停在上头时暂停 */
const BANNER_INTERVAL_MS = 7000

export function HomePage() {
  const [list, setList] = useState<CatalogItem[]>([])
  const [error, setError] = useState('')
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    loadCatalog()
      .then(setList)
      .catch((e) => setError(e instanceof Error ? e.message : '目录加载失败'))
  }, [])

  useEffect(() => {
    if (paused || list.length < 2) return
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % list.length), BANNER_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [paused, list.length])

  const active = list.length > 0 ? Math.min(index, list.length - 1) : 0

  return (
    <div className="flex min-h-screen flex-col bg-[#f7f8fa] text-[#111827]">
      <SiteHeader cta={{ label: '发布后台', to: '/publish' }} />

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 sm:px-8 py-6 sm:py-8 space-y-6">
        <div>
          <h2 className="text-lg font-medium tracking-tight">选择景点开始导览</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
            <p className="text-sm text-[#6b7280]">点击进入沉浸式地图导览，边走边听讲解</p>
            {/* 卡片右下角那两个标是什么意思：跟在副题同一行；没景点就不显示 */}
            {list.length > 0 && !error && (
              <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#6b7280]">
                {MODE_LEGEND.map((entry) => (
                  <li key={entry.mode} className="inline-flex items-center gap-1.5">
                    <ModeTag mode={entry.mode} />
                    <span>{entry.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {error ? (
          <div className="rounded-2xl border border-red-100 bg-white px-6 py-8 text-sm text-red-600">{error}</div>
        ) : list.length === 0 ? (
          <div className="rounded-2xl border border-black/[0.06] bg-white px-6 py-16 text-center text-sm text-[#6b7280]">
            暂无已发布景点
          </div>
        ) : (
          <>
            <div
              className="relative overflow-hidden rounded-2xl border border-black/[0.06] bg-[#111827]"
              onMouseEnter={() => setPaused(true)}
              onMouseLeave={() => setPaused(false)}
            >
              <div
                className="flex transition-transform duration-700 ease-out"
                style={{ transform: `translateX(-${active * 100}%)` }}
              >
                {list.map((item) => (
                  <Link
                    key={item.id}
                    to={`/tour/${item.id}`}
                    className="group relative block w-full shrink-0 min-h-[220px] sm:min-h-[300px]"
                  >
                    <img
                      src={item.coverImage}
                      alt=""
                      className="absolute inset-0 w-full h-full object-cover opacity-75 group-hover:scale-[1.02] transition-transform duration-500"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />
                    <div className="relative z-10 flex flex-col justify-end h-full min-h-[220px] sm:min-h-[300px] p-6 sm:p-8">
                      <h2 className="text-2xl sm:text-3xl font-medium text-white tracking-tight">
                        {item.name}
                      </h2>
                      <p className="mt-2 text-sm text-white/80 max-w-xl line-clamp-2">{item.description}</p>
                      <span className="mt-4 inline-flex items-center gap-1.5 self-start rounded-lg bg-white text-[#111827] px-3.5 py-2 text-sm font-medium">
                        开始导览
                        <ArrowRight size={14} />
                      </span>
                    </div>
                  </Link>
                ))}
              </div>

              {list.length > 1 && (
                <div className="absolute bottom-5 right-5 z-10 flex items-center gap-1.5">
                  {list.map((item, i) => (
                    <button
                      key={item.id}
                      type="button"
                      aria-label={`切换到 ${item.name}`}
                      onClick={() => setIndex(i)}
                      className={`h-1.5 cursor-pointer rounded-full transition-all ${
                        i === active ? 'w-5 bg-white' : 'w-1.5 bg-white/45 hover:bg-white/75'
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium text-[#6b7280]">全部景点</h3>
                <span className="text-xs text-[#9ca3af]">{list.length} 个</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {list.map((item) => (
                  <Link
                    key={item.id}
                    to={`/tour/${item.id}`}
                    className="group rounded-2xl border border-black/[0.06] bg-white overflow-hidden hover:shadow-md transition-shadow"
                  >
                    <div className="aspect-[16/10] bg-[#f3f4f6] overflow-hidden">
                      <img
                        src={item.coverImage}
                        alt=""
                        className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500"
                      />
                    </div>
                    <div className="p-3.5">
                      <div className="flex min-w-0 items-baseline gap-1.5">
                        <h4 className="truncate text-[15px] font-medium">{item.name}</h4>
                        {item.storyTitle ? (
                          <span className="shrink-0 text-xs text-[#9ca3af]">{item.storyTitle}</span>
                        ) : null}
                      </div>
                      <p className="mt-1.5 text-sm text-[#6b7280] line-clamp-2">{item.description}</p>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1 text-sm text-[#3b82f6]">
                          开始
                          <ArrowRight size={14} />
                        </span>
                        {/* 与导览页页头同款的小标：故事实心、打卡描边（只写模式名） */}
                        <ModeTag mode={item.mode} />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </>
        )}
      </main>

      <SiteFooter />
    </div>
  )
}
