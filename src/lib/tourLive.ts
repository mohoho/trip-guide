import { estimateSpeechMs } from './autoTour'
import type { LngLat } from './tourPackage'

/** 移动速度：3 倍速（基准 1.6 米/秒 × 3），单跳时长上下限同步压到 1/3 */
export const WALK_METERS_PER_SEC = 4.8
const WALK_MIN_MS = 200
const WALK_MAX_MS = 2667

export function haversineMeters(a: LngLat, b: LngLat) {
  const toRad = (d: number) => (d * Math.PI) / 180
  const R = 6371000
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function findChineseVoice(voices: SpeechSynthesisVoice[]) {
  return (
    voices.find((v) => v.lang.startsWith('zh') && v.localService) ||
    voices.find((v) => v.lang.startsWith('zh')) ||
    voices[0]
  )
}

type WalkOptions = {
  /** 每帧的位置（用来挪动访客标记） */
  onFrame: (pos: LngLat) => void
  /** 抵达终点 */
  onArrive: (pos: LngLat) => void
  /** 行进途中按节流回调（用来做"走近就展开"这类就近判断） */
  onPass?: (pos: LngLat) => void
}

/**
 * 沿高德给出的路网折线匀速走。返回取消函数（切页 / 走一半被打断时调用）。
 * 折线不足两点时立刻"抵达"。
 */
export function walkAlongPath(points: LngLat[], opts: WalkOptions): () => void {
  let raf: number | null = null
  let done = false

  const finish = (pos: LngLat) => {
    if (done) return
    done = true
    raf = null
    opts.onArrive(pos)
  }

  if (points.length === 0) return () => {}
  if (points.length === 1) {
    finish(points[0])
    return () => {}
  }

  type Seg = { from: LngLat; to: LngLat; dist: number; start: number }
  const segs: Seg[] = []
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const dist = haversineMeters(points[i - 1], points[i])
    if (dist < 0.2) continue
    segs.push({ from: points[i - 1], to: points[i], dist, start: total })
    total += dist
  }
  if (!segs.length || total < 0.5) {
    finish(points[points.length - 1])
    return () => {}
  }

  const duration = Math.min(WALK_MAX_MS, Math.max(WALK_MIN_MS, (total / WALK_METERS_PER_SEC) * 1000))
  const startAt = performance.now()
  let lastPass = 0

  const tick = (now: number) => {
    const t = Math.min(1, (now - startAt) / duration)
    const traveled = total * t
    let seg = segs[segs.length - 1]
    for (const s of segs) {
      if (traveled <= s.start + s.dist) {
        seg = s
        break
      }
    }
    const local = seg.dist < 1e-6 ? 1 : (traveled - seg.start) / seg.dist
    const next = {
      lng: seg.from.lng + (seg.to.lng - seg.from.lng) * local,
      lat: seg.from.lat + (seg.to.lat - seg.from.lat) * local,
    }
    opts.onFrame(next)
    if (opts.onPass && now - lastPass > 200) {
      lastPass = now
      opts.onPass(next)
    }
    if (t < 1) raf = requestAnimationFrame(tick)
    else finish(next)
  }
  raf = requestAnimationFrame(tick)

  return () => {
    if (raf !== null) cancelAnimationFrame(raf)
    raf = null
    done = true
  }
}

type SpeakOptions = {
  synth: SpeechSynthesis
  voices: SpeechSynthesisVoice[]
  text: string
  /** 念完（或念不出来）时回调；被打断则不回调 */
  onEnd?: () => void
}

/**
 * 念一段中文：优先用中文语音，并用估时兜底（某些环境 onend 不触发）。
 * 返回取消函数（切节点 / 离开页面时调用，取消则不触发 onEnd）。
 */
export function speakOnce({ synth, voices, text, onEnd }: SpeakOptions): () => void {
  if (!text) {
    onEnd?.()
    return () => {}
  }
  let fallback: number | null = null
  let ended = false
  const finish = () => {
    if (ended) return
    ended = true
    if (fallback !== null) {
      window.clearTimeout(fallback)
      fallback = null
    }
    onEnd?.()
  }
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'zh-CN'
  const voice = findChineseVoice(voices)
  if (voice) u.voice = voice
  u.rate = 1
  u.pitch = 1
  u.onend = finish
  u.onerror = finish
  fallback = window.setTimeout(finish, estimateSpeechMs(text) + 800)
  synth.speak(u)

  return () => {
    ended = true
    if (fallback !== null) {
      window.clearTimeout(fallback)
      fallback = null
    }
    synth.cancel()
  }
}
