import type { TourMode } from '../lib/tourPackage'

/**
 * 前景/后台共用的导览模式小标：故事实心黑、打卡灰描边（只写模式名，缺省视作打卡）。
 * leading 写死：这个小标要落在不同 line-height 的行里（图例 text-xs、卡片 text-sm），
 * 不固定就会出现同样内容两个高度（19 / 21）。
 */
export function ModeTag({ mode }: { mode?: TourMode }) {
  const story = mode === 'story'
  return (
    <span
      className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] leading-[15px] ${
        story ? 'border-[#111827] bg-[#111827] text-white' : 'border-black/10 bg-[#f9fafb] text-[#6b7280]'
      }`}
    >
      {story ? '故事' : '打卡'}
    </span>
  )
}
