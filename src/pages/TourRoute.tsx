import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { loadPublishedAttraction } from '../lib/catalog'
import type { PublishedAttraction } from '../lib/tourPackage'
import { StoryTourPage } from './StoryTourPage'
import { TourPage } from './TourPage'

type Loaded = { id: string; pkg: PublishedAttraction }
type Failed = { id: string; message: string }

/**
 * `/tour/:id` 的分发层：先把包读进来（避免两个页面各自 fetch 闪两次载入），
 * 再按 `mode` 选页面 —— 缺省是打卡页（行为与从前一字不差），`story` 才走故事页。
 */
export function TourRoute() {
  const { id = '' } = useParams()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState<Failed | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const item = await loadPublishedAttraction(id)
        if (!cancelled) setLoaded({ id, pkg: item })
      } catch (e) {
        if (!cancelled) setFailed({ id, message: e instanceof Error ? e.message : '景点加载失败' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  // 上一次的加载结果按 id 归属，换了 id 自动视作未完成，不用在 effect 里清状态
  const pkg = loaded?.id === id ? loaded.pkg : null
  const error = failed?.id === id ? failed.message : ''

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-[#f8f6ef] px-6 text-center">
        <p className="text-sm text-red-600">{error}</p>
        <Link to="/" className="text-sm text-[#315442] hover:underline">
          返回景点列表
        </Link>
      </div>
    )
  }

  if (!pkg) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f8f6ef] text-sm text-[#72766a]">
        正在载入…
      </div>
    )
  }

  if (pkg.mode === 'story') return <StoryTourPage key={pkg.id} pkg={pkg} />
  return <TourPage initialPackage={pkg} />
}
