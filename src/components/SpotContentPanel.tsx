import { useRef } from 'react'
import { ImagePlus } from 'lucide-react'
import type { Spot } from '../types/attraction'

type SlideField = 'title' | 'bullets' | 'narration'

interface SpotContentPanelProps {
  spot: Spot
  /** 名称 / 诗意副标题等直接落在节点上的字段 */
  onPatch: (patch: Partial<Spot>) => void
  /** 讲解标题 / 要点（每行一条）/ 口播文案 */
  onSlide: (field: SlideField, value: string) => void
  onUpload: (file: File) => void
}

/** 单个节点的内容表单（只存在于内容创作页，不回写坐标） */
export function SpotContentPanel({ spot, onPatch, onSlide, onUpload }: SpotContentPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-xs text-[#7f8375]">名称</span>
        <input
          value={spot.name}
          onChange={(e) => onPatch({ name: e.target.value })}
          className="mt-1 w-full rounded-lg border border-black/8 bg-[#faf9f4] px-2.5 py-1.5 text-sm outline-none focus:bg-white focus:border-[#315442]/50"
        />
      </label>
      <label className="block">
        <span className="text-xs text-[#7f8375]">诗意副标题</span>
        <input
          value={spot.poetic}
          onChange={(e) => onPatch({ poetic: e.target.value })}
          className="mt-1 w-full rounded-lg border border-black/8 bg-[#faf9f4] px-2.5 py-1.5 text-sm outline-none focus:bg-white focus:border-[#315442]/50"
        />
      </label>
      <div>
        <span className="text-xs text-[#7f8375]">实景图</span>
        <div className="mt-1 rounded-lg border border-black/8 overflow-hidden bg-[#efeee5]">
          <div className="aspect-[16/10]">
            {spot.image ? (
              <img src={spot.image} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-xs text-[#7f8375]">
                未上传
              </div>
            )}
          </div>
          <div className="flex justify-end px-2 py-2 border-t border-black/5 bg-white">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1 text-xs text-[#315442]"
            >
              <ImagePlus size={13} />
              上传
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) onUpload(file)
                e.target.value = ''
              }}
            />
          </div>
        </div>
      </div>
      <label className="block">
        <span className="text-xs text-[#7f8375]">讲解标题</span>
        <input
          value={spot.slides[0]?.title || ''}
          onChange={(e) => onSlide('title', e.target.value)}
          className="mt-1 w-full rounded-lg border border-black/8 bg-[#faf9f4] px-2.5 py-1.5 text-sm outline-none focus:bg-white focus:border-[#315442]/50"
        />
      </label>
      <label className="block">
        <span className="text-xs text-[#7f8375]">要点（每行一条）</span>
        <textarea
          value={(spot.slides[0]?.bullets || []).join('\n')}
          onChange={(e) => onSlide('bullets', e.target.value)}
          rows={3}
          className="mt-1 w-full resize-none rounded-lg border border-black/8 bg-[#faf9f4] px-2.5 py-1.5 text-sm outline-none focus:bg-white focus:border-[#315442]/50"
        />
      </label>
      <label className="block">
        <span className="text-xs text-[#7f8375]">口播文案</span>
        <textarea
          value={spot.slides[0]?.narration || ''}
          onChange={(e) => onSlide('narration', e.target.value)}
          rows={6}
          className="mt-1 w-full resize-none rounded-lg border border-black/8 bg-[#faf9f4] px-2.5 py-1.5 text-sm outline-none focus:bg-white focus:border-[#315442]/50"
        />
      </label>
    </div>
  )
}
