/**
 * AI 生成时的底部 toast：`progress` 非空就先显示「进度条 + 3/4」，
 * 跑完只剩一句话与关闭；忙时不给关闭，免得把进度从眼前关掉。
 */
export function GenProgressToast({
  text,
  progress,
  busy,
  onClose,
}: {
  text: string
  progress: { done: number; total: number } | null
  busy: boolean
  onClose: () => void
}) {
  if (!text) return null
  return (
    <div className="fixed bottom-6 left-1/2 z-50 flex max-w-[90vw] -translate-x-1/2 items-center gap-3 rounded-full bg-[#111827] px-4 py-2 text-sm text-white shadow-lg">
      {progress && (
        <>
          {/* 实心＝已跑完的段，浅色＝正在跑的这段（所以最后一段跑完时进度条才是满的） */}
          <span className="flex h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-white/25 lg:w-28">
            <span
              className="h-full bg-white transition-[width] duration-300"
              style={{ width: `${((progress.done - 1) / progress.total) * 100}%` }}
            />
            <span
              className="h-full bg-white/45 transition-[width] duration-300"
              style={{ width: `${(1 / progress.total) * 100}%` }}
            />
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-white/60">
            {progress.done}/{progress.total}
          </span>
        </>
      )}
      <span className="truncate">{text}</span>
      {!busy && (
        <button type="button" className="shrink-0 text-white/60" onClick={onClose}>
          关闭
        </button>
      )}
    </div>
  )
}
