import type { TourMode } from '../lib/tourPackage'

/**
 * 前景/后台共用的漫游模式小标：故事陶土色、打卡深绿色（缺省视作打卡）。
 * leading 写死：这个小标要落在不同 line-height 的行里（图例 text-xs、卡片 text-sm），
 * 不固定就会出现同样内容两个高度（19 / 21）。
 */
export function ModeTag({ mode }: { mode?: TourMode }) {
  const story = mode === 'story'
  return (
    <span
      className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] leading-[15px] ${
        story ? 'border-[#ad5e43] bg-[#ad5e43] text-white' : 'border-[#315442]/20 bg-[#f3f5ed] text-[#315442]'
      }`}
    >
      {story ? '故事' : '打卡'}
    </span>
  )
}
