interface TourAutoGateProps {
  visible: boolean
  onStart: () => void
}

/** 对齐 presentation AutoStartGate：解除浏览器自动播放限制 */
export function TourAutoGate({ visible, onStart }: TourAutoGateProps) {
  if (!visible) return null

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
      onClick={onStart}
      role="dialog"
      aria-label="开始自动漫游"
    >
      <div
        className="mx-4 max-w-sm w-full rounded-2xl bg-white px-6 py-7 text-center shadow-xl border border-black/5"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-xs text-[#9ca3af]">自动漫游</p>
        <p className="mt-2 text-lg font-medium text-[#111827]">准备开始</p>
        <p className="mt-2 text-sm text-[#6b7280] leading-relaxed">
          将按路线依次走动，抵达后口播讲解；口播结束自动前往下一站。
        </p>
        <button
          type="button"
          onClick={onStart}
          className="cursor-pointer mt-5 inline-flex items-center justify-center gap-2 rounded-xl bg-[#3b82f6] px-5 py-2.5 text-sm text-white hover:bg-[#2563eb]"
        >
          按 Space 或点击开始
        </button>
      </div>
    </div>
  )
}
