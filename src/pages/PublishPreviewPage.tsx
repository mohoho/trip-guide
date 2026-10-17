import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import {
  ensureEditableDraft,
  isSpotPlaceholder,
  publishDraft,
  toSelfContainedPackage,
} from '../lib/draftStore'
import { validateStoryGraph } from '../lib/storyTour'
import type { PublishedAttraction } from '../lib/tourPackage'
import type { DraftAttraction } from '../types/attraction'
import { StoryTourPage } from './StoryTourPage'
import { TourPage } from './TourPage'

/**
 * `/publish/:id/preview`：编辑端与前台之间的那一站 —— 按前台本尊的样子跑一遍草稿，发布也从这里出。
 * 草稿图片在内存里拼成自包含包（assets 里是 data URL）喂给前台页，所以预览**不写 public/spots**，
 * 也就能在任何时候进来（文案没写完也看得见），只有「发布」这一步按老规矩门控。
 */
export function PublishPreviewPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  /** 从哪个屏进来的（地图选点 / 内容创作），退出预览回哪儿 */
  const from = searchParams.get('from') === 'content' ? 'content' : 'map'

  const [draft, setDraft] = useState<DraftAttraction | null>(null)
  const [pkg, setPkg] = useState<PublishedAttraction | null>(null)
  const [failed, setFailed] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const [published, setPublished] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
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
      try {
        const built = await toSelfContainedPackage(item)
        if (!cancelled) setPkg(built)
      } catch (e) {
        if (!cancelled) setFailed(e instanceof Error ? e.message : '预览包构建失败')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id, navigate])

  /** 与编辑页同一套门控：节点文案写全 + 故事图没有硬错 */
  const blocked = useMemo(() => {
    if (!draft) return ''
    if (draft.spots.length === 0) return '请先生成或添加漫游节点'
    const written = draft.spots.filter((s) => !isSpotPlaceholder(s)).length
    if (written < draft.spots.length) {
      return `所有节点都写过文案后才能发布（${written}/${draft.spots.length}）`
    }
    if (draft.mode === 'story') {
      const blocker = validateStoryGraph(draft).find((i) => i.level === 'error')
      if (blocker) return blocker.message
    }
    return ''
  }, [draft])

  const exit = () => navigate(from === 'content' ? `/publish/${id}/content` : `/publish/${id}`)

  const onPublish = async () => {
    if (!draft) return
    setBusy(true)
    try {
      setToast('正在打包图片…')
      const result = await publishDraft(draft.id, { zoom: draft.zoom, start: draft.start })
      if (result) {
        setDraft(result.draft)
        const n = Object.keys(result.pkg.assets || {}).length
        setPublished(true)
        setToast(
          result.mode === 'config'
            ? `已发布（${n} 张图），前台可立即查看`
            : `写入 public/spots 失败，已改为下载文件（含 ${n} 张图）`,
        )
      }
    } catch (e) {
      setToast(e instanceof Error ? e.message : '导出失败')
    } finally {
      setBusy(false)
    }
  }

  if (failed) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-[#f7f8fa] px-6 text-center">
        <p className="text-sm text-red-600">{failed}</p>
        <button type="button" onClick={exit} className="text-sm text-[#3b82f6] hover:underline">
          返回编辑
        </button>
      </div>
    )
  }

  if (!pkg || !draft) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f7f8fa] text-sm text-[#6b7280]">
        正在准备预览…
      </div>
    )
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      {pkg.mode === 'story' ? (
        <StoryTourPage key={pkg.id} pkg={pkg} />
      ) : (
        <TourPage key={pkg.id} initialPackage={pkg} />
      )}

      {/* 预览工具条：浮在右下角，不占前台自己的版位 */}
      <div className="pointer-events-none absolute bottom-4 right-3 z-[60] flex max-w-[calc(100vw-1.5rem)] items-center">
        <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-black/5 bg-white/95 py-1.5 pl-3 pr-1.5 shadow-lg backdrop-blur-md">
          <span className="shrink-0 text-[11px] text-[#9ca3af]">预览中</span>
          <button
            type="button"
            onClick={exit}
            className="inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-1 text-xs text-[#6b7280] hover:bg-[#f3f4f6] hover:text-[#111827]"
          >
            <ArrowLeft size={12} />
            退出预览
          </button>
          {published && (
            <Link
              to={`/tour/${draft.id}`}
              className="inline-flex items-center gap-1 rounded-full border border-black/10 px-2.5 py-1 text-xs text-[#111827] hover:bg-[#f3f4f6]"
            >
              去前台看
              <ExternalLink size={12} />
            </Link>
          )}
          <button
            type="button"
            onClick={() => void onPublish()}
            disabled={busy || !!blocked}
            title={blocked || undefined}
            className="shrink-0 cursor-pointer rounded-full bg-[#3b82f6] px-3.5 py-1.5 text-xs text-white hover:bg-[#2563eb] disabled:cursor-default disabled:opacity-50"
          >
            {busy ? '发布中…' : '发布'}
          </button>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[70] flex max-w-[90vw] -translate-x-1/2 items-center gap-3 rounded-full bg-[#111827] px-4 py-2 text-sm text-white shadow-lg">
          <span className="truncate">{toast}</span>
          <button type="button" className="shrink-0 text-white/60" onClick={() => setToast('')}>
            关闭
          </button>
        </div>
      )}
    </div>
  )
}
