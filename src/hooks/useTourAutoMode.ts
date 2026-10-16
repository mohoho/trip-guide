import { useCallback, useEffect, useState } from 'react'
import { readAutoFromURL, syncAutoURL, type PlaybackMode } from '../lib/autoTour'

/**
 * 对齐 web-video-presentation 的 useAutoMode：
 * manual ↔ auto，URL `?auto=1`，Space 解除自动播放门闩。
 */
export function useTourAutoMode() {
  const [mode, setModeState] = useState<PlaybackMode>(() =>
    readAutoFromURL() ? 'auto' : 'manual',
  )
  const [autoStarted, setAutoStarted] = useState(false)

  const setMode = useCallback((m: PlaybackMode) => {
    setModeState(m)
    syncAutoURL(m)
    if (m !== 'auto') setAutoStarted(false)
  }, [])

  const toggleMode = useCallback(() => {
    setMode(mode === 'auto' ? 'manual' : 'auto')
  }, [mode, setMode])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault()
        toggleMode()
      } else if (e.key === ' ' && mode === 'auto' && !autoStarted) {
        e.preventDefault()
        setAutoStarted(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, autoStarted, toggleMode])

  return { mode, setMode, toggleMode, autoStarted, setAutoStarted }
}
