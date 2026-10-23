import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ensureEditableDraft, saveDraft } from '../../lib/draftStore'
import type { DraftAttraction } from '../../types/attraction'
import { ContentCheckinPage } from './ContentCheckinPage'
import { ContentStoryPage } from './ContentStoryPage'

/**
 * `/publish/:id/content` 的分发层：先把草稿读进来（避免两个页面各自闪一次载入），
 * 再按 mode 选页面 —— 缺省是打卡页（与从前一字不差），`story` 才走以结构为中心的故事页。
 */
export function PublishContentPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  /** 从阶段二点某个节点的「已编辑 / 未编辑」跳进来时，直接定位到那个节点 */
  const wantedSpotId = searchParams.get('spot')
  const [draft, setDraft] = useState<DraftAttraction | null>(null)

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
    })()
    return () => {
      cancelled = true
    }
  }, [id, navigate])

  if (!draft) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f6ef] text-sm text-[#72766a]">
        加载中…
      </div>
    )
  }

  const persist = (next: DraftAttraction) => {
    const saved = saveDraft(next)
    setDraft(saved)
    return saved
  }
  const initialSpotId =
    draft.spots.find((s) => s.id === wantedSpotId)?.id ?? draft.spots[0]?.id ?? null
  const page = { draft, persist, initialSpotId }

  if (draft.mode === 'story') return <ContentStoryPage key={draft.id} {...page} />
  return <ContentCheckinPage key={draft.id} {...page} />
}
