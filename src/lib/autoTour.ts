export type PlaybackMode = 'manual' | 'auto'

/** presentation 对齐：口播估时 ≈ 4 字/秒，作 speech 失败时的 Auto 兜底 */
export function estimateSpeechMs(text: string) {
  if (!text) return 1500
  return Math.max(1500, text.length * 250)
}

export type TourPhase = 'idle' | 'walking' | 'presenting' | 'done'

export function readAutoFromURL(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('auto') === '1'
}

export function syncAutoURL(mode: PlaybackMode) {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (mode === 'auto') url.searchParams.set('auto', '1')
  else url.searchParams.delete('auto')
  try {
    window.history.replaceState(null, '', url.toString())
  } catch {
    /* 托管沙箱里 History API 不可用：auto 状态走内存，地址栏不体现而已 */
  }
}
