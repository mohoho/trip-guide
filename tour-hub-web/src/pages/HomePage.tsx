import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { SiteFooter } from '../components/SiteFooter'
import { SiteHeader } from '../components/SiteHeader'
import type { CatalogItem } from '../lib/tourPackage'
import { loadCatalog } from '../lib/catalog'

export function HomePage() {
  const [list, setList] = useState<CatalogItem[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    loadCatalog()
      .then(setList)
      .catch((e) => setError(e instanceof Error ? e.message : '目录加载失败'))
  }, [])

  const featured = list[0] || null

  return (
    <div className="flex min-h-screen flex-col bg-[#f7f8fa] text-[#111827]">
      <SiteHeader cta={{ label: '发布后台', to: '/publish' }} />

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 sm:px-8 py-6 sm:py-8 space-y-6">
        <div>
          <h2 className="text-lg font-medium tracking-tight">选择景点开始导览</h2>
          <p className="mt-1 text-sm text-[#6b7280]">点击进入沉浸式地图导览，边走边听讲解</p>
        </div>

        {error ? (
          <div className="rounded-2xl border border-red-100 bg-white px-6 py-8 text-sm text-red-600">{error}</div>
        ) : list.length === 0 ? (
          <div className="rounded-2xl border border-black/[0.06] bg-white px-6 py-16 text-center text-sm text-[#6b7280]">
            暂无已发布景点
          </div>
        ) : (
          <>
            {featured && (
              <Link
                to={`/tour/${featured.id}`}
                className="group relative block overflow-hidden rounded-2xl border border-black/[0.06] bg-[#111827] min-h-[220px] sm:min-h-[300px]"
              >
                <img
                  src={featured.coverImage}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover opacity-75 group-hover:scale-[1.02] transition-transform duration-500"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />
                <div className="relative z-10 flex flex-col justify-end h-full min-h-[220px] sm:min-h-[300px] p-6 sm:p-8">
                  <h2 className="text-2xl sm:text-3xl font-medium text-white tracking-tight">
                    {featured.name}
                  </h2>
                  <p className="mt-2 text-sm text-white/80 max-w-xl line-clamp-2">{featured.description}</p>
                  <span className="mt-4 inline-flex items-center gap-1.5 self-start rounded-lg bg-white text-[#111827] px-3.5 py-2 text-sm font-medium">
                    开始导览
                    <ArrowRight size={14} />
                  </span>
                </div>
              </Link>
            )}

            <div>
              <div className="flex items-center justify-between mb-3">
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
                      <h4 className="text-[15px] font-medium truncate">{item.name}</h4>
                      <p className="mt-1.5 text-sm text-[#6b7280] line-clamp-2">{item.description}</p>
                      <span className="mt-3 inline-flex items-center gap-1 text-sm text-[#3b82f6]">
                        开始
                        <ArrowRight size={14} />
                      </span>
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
