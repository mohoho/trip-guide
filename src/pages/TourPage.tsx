import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  MapPin,
  MessageCircle,
  Send,
  Volume2,
  X,
} from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { AmapLiveMap, type MapApi, type WalkingSearch } from '../components/AmapLiveMap'
import { TourAutoGate } from '../components/TourAutoGate'
import { TourProgressBar } from '../components/TourProgressBar'
import { useTourAutoMode } from '../hooks/useTourAutoMode'
import { AI_MODEL, aiEndpoint } from '../lib/aiConfig'
import { estimateSpeechMs, type TourPhase } from '../lib/autoTour'
import { loadPublishedAttraction } from '../lib/catalog'
import { resolveMediaUrl, type LngLat, type PublishedAttraction, type PublishedSpot } from '../lib/tourPackage'

type TourNode = PublishedSpot

const TRIGGER_METERS = 38
const SPEECH_TRAIL_MS = 200
/** 移动速度：3 倍速（基准 1.6 米/秒 × 3），单跳时长上下限同步压到 1/3 */
const WALK_METERS_PER_SEC = 4.8
const WALK_MIN_MS = 200
const WALK_MAX_MS = 2667
/** 景点加载前的占位；真实起点以发布包 start 为准 */
const PLACEHOLDER_POS: LngLat = { lng: 0, lat: 0 }

function buildSystemPrompt(name: string) {
  return `你是${name}的AI导游。只能回答与该景点历史、建筑、文化相关的问题。回答要简洁、口语化，控制在150字以内。如果问题无关，请礼貌拒绝。`
}

const MOCK_ANSWERS: Record<string, string> = {
  豫园: '豫园始建于明代嘉靖、万历年间，是上海著名的江南古典园林，至今已有四百余年历史。',
  门票: '豫园需购票入园，可在官方渠道或现场购买，建议提前查询当日开放时间。',
  建筑: '豫园以亭台楼阁、假山池沼见长，玉玲珑、大假山、九曲桥都是标志性景观。',
  历史: '豫园原为四川布政使潘允端为父亲安度晚年所建，后历经战火与修复，成为上海城市名片。',
}

function findChineseVoice(voices: SpeechSynthesisVoice[]) {
  return (
    voices.find((v) => v.lang.startsWith('zh') && v.localService) ||
    voices.find((v) => v.lang.startsWith('zh')) ||
    voices[0]
  )
}

function haversineMeters(a: LngLat, b: LngLat) {
  const toRad = (d: number) => (d * Math.PI) / 180
  const R = 6371000
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** 上层（TourRoute）已经把包读好时直接传进来，省掉一次重复 fetch */
interface TourPageProps {
  initialPackage?: PublishedAttraction
}

export function TourPage({ initialPackage }: TourPageProps = {}) {
  const { id = "" } = useParams()
  const [attraction, setAttraction] = useState<PublishedAttraction | null>(null)
  const { mode, setMode, toggleMode, autoStarted, setAutoStarted } = useTourAutoMode()
  const isAuto = mode === 'auto'

  const [nodes, setNodes] = useState<TourNode[]>([])
  const [spotsError, setSpotsError] = useState('')
  const [mapError, setMapError] = useState('')
  const [moving, setMoving] = useState(false)
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null)
  const [slideIndex, setSlideIndex] = useState(0)
  const [panelOpen, setPanelOpen] = useState(true)
  const [qaOpen, setQaOpen] = useState(false)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [asking, setAsking] = useState(false)
  const [mapReady, setMapReady] = useState(false)
  const [tourStart, setTourStart] = useState<LngLat>(PLACEHOLDER_POS)
  /** 作者在发布端框的视野中心；缺省 = 以游客起点开场 */
  const [tourView, setTourView] = useState<LngLat | null>(null)
  const [tourZoom, setTourZoom] = useState(18.5)
  const [routePath, setRoutePath] = useState<LngLat[] | null>(null)
  const [tourPhase, setTourPhase] = useState<TourPhase>('idle')
  const [autoChapter, setAutoChapter] = useState(0)

  const animRef = useRef<number | null>(null)
  const activeNodeIdRef = useRef<string | null>(null)
  const charRef = useRef<LngLat>(PLACEHOLDER_POS)
  const nodesRef = useRef<TourNode[]>([])
  const routeSeqRef = useRef(0)
  // 手动模式下显式点击选中的节点：行进途中路过其它节点不得抢占讲解
  const explicitTargetRef = useRef<string | null>(null)
  const onArriveRef = useRef<(() => void) | null>(null)
  const synthRef = useRef(window.speechSynthesis)
  const speechFallbackRef = useRef<number | null>(null)
  const advanceLockRef = useRef(false)
  const modeRef = useRef(mode)
  const tourPhaseRef = useRef(tourPhase)
  const autoChapterRef = useRef(autoChapter)
  const slideIndexRef = useRef(slideIndex)
  const mapApiRef = useRef<MapApi | null>(null)
  const walkingSearchRef = useRef<WalkingSearch | null>(null)

  const activeNode = useMemo(
    () => nodes.find((n) => n.id === activeNodeId) || null,
    [nodes, activeNodeId],
  )
  const activeSlide = activeNode ? activeNode.slides[slideIndex] : null

  const progressChapters = useMemo(
    () => nodes.map((n) => ({ id: n.id, title: n.name, stepCount: n.slides.length })),
    [nodes],
  )

  /** 开场取景：作者框过就用他框的，否则退回游客起点（旧包就是这条） */
  const mapCenter = tourView || tourStart

  useEffect(() => {
    activeNodeIdRef.current = activeNodeId
  }, [activeNodeId])
  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])
  useEffect(() => {
    modeRef.current = mode
  }, [mode])
  useEffect(() => {
    tourPhaseRef.current = tourPhase
  }, [tourPhase])
  useEffect(() => {
    autoChapterRef.current = autoChapter
  }, [autoChapter])
  useEffect(() => {
    slideIndexRef.current = slideIndex
  }, [slideIndex])

  useEffect(() => {
    const synth = synthRef.current
    const load = () => setVoices(synth.getVoices())
    load()
    synth.addEventListener('voiceschanged', load)
    return () => synth.removeEventListener('voiceschanged', load)
  }, [])

  const applyPackage = useCallback((item: PublishedAttraction) => {
    setAttraction(item)
    setNodes(item.spots)
    setTourStart(item.start)
    setTourView(item.view ?? null)
    setTourZoom(item.zoom || 18.5)
    charRef.current = item.start
  }, [])

  useEffect(() => {
    const cleanup = () => {
      if (animRef.current) cancelAnimationFrame(animRef.current)
      if (speechFallbackRef.current) window.clearTimeout(speechFallbackRef.current)
    }
    if (initialPackage) {
      applyPackage(initialPackage)
      return cleanup
    }
    let cancelled = false
    void (async () => {
      try {
        const item = await loadPublishedAttraction(id)
        if (cancelled) return
        applyPackage(item)
      } catch (e) {
        if (cancelled) return
        setSpotsError(e instanceof Error ? e.message : '景点加载失败')
      }
    })()
    return () => {
      cancelled = true
      cleanup()
    }
  }, [id, initialPackage, applyPackage])

  const clearSpeechTimers = () => {
    if (speechFallbackRef.current) {
      window.clearTimeout(speechFallbackRef.current)
      speechFallbackRef.current = null
    }
    synthRef.current.cancel()
  }

  const stopMovement = () => {
    if (animRef.current) {
      cancelAnimationFrame(animRef.current)
      animRef.current = null
    }
    onArriveRef.current = null
    explicitTargetRef.current = null
    setMoving(false)
    setRoutePath(null)
  }

  const exitAutoToManual = useCallback(() => {
    clearSpeechTimers()
    stopMovement()
    advanceLockRef.current = false
    setTourPhase('idle')
    setMode('manual')
  }, [setMode])

  const checkProximity = (pos: LngLat) => {
    if (modeRef.current === 'auto') return
    const target = explicitTargetRef.current
    const nearest = nodesRef.current.reduce<{ node: TourNode; dist: number } | null>((best, node) => {
      if (target && node.id !== target) return best
      const dist = haversineMeters(pos, { lng: node.lng, lat: node.lat })
      if (dist > TRIGGER_METERS) return best
      if (!best || dist < best.dist) return { node, dist }
      return best
    }, null)

    const current = activeNodeIdRef.current
    if (nearest && nearest.node.id !== current) {
      setActiveNodeId(nearest.node.id)
      setSlideIndex(0)
      setPanelOpen(true)
      speakNodeIntro(nearest.node)
    } else if (!nearest && current && !target) {
      setActiveNodeId(null)
      setSlideIndex(0)
      synthRef.current.cancel()
    }
  }

  const animateAlongPath = (points: LngLat[], onArrive?: () => void) => {
    if (animRef.current) cancelAnimationFrame(animRef.current)
    onArriveRef.current = onArrive ?? null

    const finish = (pos: LngLat) => {
      charRef.current = pos
      mapApiRef.current?.moveVisitor(pos)
      setMoving(false)
      animRef.current = null
      checkProximity(pos)
      explicitTargetRef.current = null
      const cb = onArriveRef.current
      onArriveRef.current = null
      cb?.()
      window.setTimeout(() => setRoutePath(null), 600)
    }

    if (points.length < 2) {
      finish(points[0] || charRef.current)
      return
    }

    setRoutePath(points)

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
      return
    }

    const duration = Math.min(
      WALK_MAX_MS,
      Math.max(WALK_MIN_MS, (total / WALK_METERS_PER_SEC) * 1000),
    )
    const startAt = performance.now()
    setMoving(true)
    let lastProximity = 0

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
      charRef.current = next
      mapApiRef.current?.moveVisitor(next)
      if (now - lastProximity > 200) {
        lastProximity = now
        checkProximity(next)
      }
      if (t < 1) {
        animRef.current = requestAnimationFrame(tick)
      } else {
        finish(next)
      }
    }
    animRef.current = requestAnimationFrame(tick)
  }

  const routeTo = (to: LngLat, onArrive?: () => void) => {
    const from = { ...charRef.current }
    routeSeqRef.current += 1
    const seq = routeSeqRef.current

    const run = (path: LngLat[]) => {
      if (seq !== routeSeqRef.current) return
      animateAlongPath(path, onArrive)
    }

    if (haversineMeters(from, to) < 12) {
      run([from, to])
      return
    }

    const search = walkingSearchRef.current
    if (!search) {
      run([from, to])
      return
    }

    setMoving(true)
    void search(from, to).then((raw) => {
      if (seq !== routeSeqRef.current) return
      if (raw && raw.length >= 2) {
        const path = [...raw]
        const first = path[0]
        if (haversineMeters(from, first) > 3) path.unshift(from)
        const last = path[path.length - 1]
        if (haversineMeters(last, to) > 3) path.push(to)
        run(path)
        return
      }
      run([from, to])
    })
  }

  const beginPresenting = useCallback((chapterIndex: number) => {
    const node = nodesRef.current[chapterIndex]
    if (!node) return
    advanceLockRef.current = false
    setAutoChapter(chapterIndex)
    setActiveNodeId(node.id)
    setSlideIndex(0)
    setPanelOpen(true)
    setTourPhase('presenting')
  }, [])

  const walkToChapter = useCallback(
    (chapterIndex: number) => {
      const node = nodesRef.current[chapterIndex]
      if (!node) {
        setTourPhase('done')
        return
      }
      clearSpeechTimers()
      advanceLockRef.current = false
      setAutoChapter(chapterIndex)
      setActiveNodeId(node.id)
      setSlideIndex(0)
      setPanelOpen(true)
      setTourPhase('walking')
      routeTo({ lng: node.lng, lat: node.lat }, () => {
        if (modeRef.current !== 'auto') return
        beginPresenting(chapterIndex)
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [beginPresenting],
  )

  const advanceAfterNarration = useCallback(() => {
    if (modeRef.current !== 'auto' || tourPhaseRef.current !== 'presenting') return
    if (advanceLockRef.current) return
    advanceLockRef.current = true

    window.setTimeout(() => {
      if (modeRef.current !== 'auto') return
      const chapter = autoChapterRef.current
      const node = nodesRef.current[chapter]
      if (!node) {
        setTourPhase('done')
        return
      }
      const nextSlide = slideIndexRef.current + 1
      if (nextSlide < node.slides.length) {
        advanceLockRef.current = false
        setSlideIndex(nextSlide)
        return
      }
      const nextChapter = chapter + 1
      if (nextChapter < nodesRef.current.length) {
        walkToChapter(nextChapter)
        return
      }
      setTourPhase('done')
      advanceLockRef.current = false
    }, SPEECH_TRAIL_MS)
  }, [walkToChapter])

  const speak = useCallback(
    (text: string, opts?: { onEnd?: () => void }) => {
      clearSpeechTimers()
      if (!text) {
        opts?.onEnd?.()
        return
      }
      const u = new SpeechSynthesisUtterance(text)
      u.lang = 'zh-CN'
      const voice = findChineseVoice(voices)
      if (voice) u.voice = voice
      u.rate = 1
      u.pitch = 1
      let ended = false
      const finish = () => {
        if (ended) return
        ended = true
        if (speechFallbackRef.current) {
          window.clearTimeout(speechFallbackRef.current)
          speechFallbackRef.current = null
        }
        opts?.onEnd?.()
      }
      u.onend = finish
      u.onerror = finish
      speechFallbackRef.current = window.setTimeout(finish, estimateSpeechMs(text) + 800)
      synthRef.current.speak(u)
    },
    [voices],
  )

  /** 手动模式下节点成为当前讲解点：自动读一遍该节点的口播（对齐自动漫游的"抵达即讲"） */
  const speakNodeIntro = (node: TourNode) => {
    if (!synthRef.current) return
    const text = node.slides[0]?.narration || ''
    if (text) speak(text)
  }

  // 自动漫游：Gate 解除后从第一章开始
  useEffect(() => {
    if (mode === 'auto' && autoStarted && tourPhase === 'idle') {
      walkToChapter(0)
    }
  }, [mode, autoStarted, tourPhase, walkToChapter])

  // 切回手动：停动画 / 停口播
  useEffect(() => {
    if (mode === 'manual') {
      clearSpeechTimers()
      if (tourPhaseRef.current !== 'idle') {
        stopMovement()
        setTourPhase('idle')
        advanceLockRef.current = false
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // presenting：口播结束推进（对齐 presentation audio.ended → next）
  useEffect(() => {
    if (mode !== 'auto' || tourPhase !== 'presenting' || !activeSlide) return
    if (!voices.length && typeof window !== 'undefined' && !window.speechSynthesis) {
      const t = window.setTimeout(advanceAfterNarration, estimateSpeechMs(activeSlide.narration))
      return () => window.clearTimeout(t)
    }
    advanceLockRef.current = false
    speak(activeSlide.narration, { onEnd: advanceAfterNarration })
    return () => {
      clearSpeechTimers()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, tourPhase, activeNodeId, slideIndex, voices.length])

  const goToNodeManual = (node: TourNode) => {
    if (isAuto) {
      const idx = nodesRef.current.findIndex((n) => n.id === node.id)
      if (idx >= 0) walkToChapter(idx)
      return
    }
    explicitTargetRef.current = node.id
    setActiveNodeId(node.id)
    setSlideIndex(0)
    setPanelOpen(true)
    routeTo({ lng: node.lng, lat: node.lat }, () => {
      if (modeRef.current !== 'manual') return
      speakNodeIntro(node)
    })
  }

  const onMapClick = (pos: LngLat) => {
    explicitTargetRef.current = null
    if (isAuto) {
      exitAutoToManual()
      routeTo(pos)
      return
    }
    routeTo(pos)
  }

  const goSlide = (i: number) => {
    if (!activeNode || isAuto) return
    const next = Math.max(0, Math.min(activeNode.slides.length - 1, i))
    setSlideIndex(next)
  }

  const askQuestion = async () => {
    if (!question.trim()) return
    setAsking(true)
    setAnswer('')

    try {
      const { url, headers } = aiEndpoint()
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: AI_MODEL,
          messages: [
            { role: 'system', content: buildSystemPrompt(attraction?.name || '景点') },
            { role: 'user', content: question.trim() },
          ],
          stream: false,
          max_tokens: 512,
        }),
      })
      if (!res.ok) throw new Error(`status ${res.status}`)
      const data = await res.json()
      const text = data.choices?.[0]?.message?.content?.trim()
      setAnswer(text || 'AI 没有返回内容')
    } catch {
      const q = question.trim()
      const hit = Object.keys(MOCK_ANSWERS).find((k) => q.includes(k))
      setAnswer(
        hit
          ? MOCK_ANSWERS[hit]
          : `当前未接入 API，我先用本地知识回答：${attraction?.name || '这里'}值得慢慢逛。`,
      )
    } finally {
      setAsking(false)
    }
  }

  const phaseHint =
    !isAuto
      ? mapReady
        ? '手动漫游 · 点击地图沿高德路网徐行'
        : '正在载入…'
      : !autoStarted
        ? '自动漫游待启 · 按 Space 开始'
        : tourPhase === 'walking'
          ? `前往 · ${nodes[autoChapter]?.name ?? ''}`
          : tourPhase === 'presenting'
            ? `讲解中 · ${nodes[autoChapter]?.name ?? ''}`
            : tourPhase === 'done'
              ? '自动漫游已结束'
              : '自动漫游'

  return (
    <div className="journal-tour flex flex-col h-screen w-screen overflow-hidden bg-[#f8f6ef] text-[#253c31]">
      <header className="journal-tour-toolbar relative z-30 flex items-center justify-between gap-3 px-4 sm:px-5 h-14 shrink-0 bg-white border-b border-black/5">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm text-[#72766a] hover:text-[#253c31] shrink-0"
            title="返回景点列表"
          >
            返回
          </Link>
          <span className="text-[#d1d5db]">/</span>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <h1 className="text-[15px] font-medium truncate">{attraction?.name || '漫游'}</h1>
              <span className="shrink-0 rounded-md bg-[#253c31] px-1.5 py-0.5 text-[10px] text-white">
                打卡
              </span>
            </div>
            <p className="text-xs text-[#7f8375] truncate">
              {activeNode && (tourPhase === 'presenting' || !isAuto)
                ? `${activeNode.name}${activeNode.poetic ? ` · ${activeNode.poetic}` : ''}`
                : phaseHint}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="flex rounded-lg overflow-hidden border border-black/10 text-xs bg-[#faf9f4]">
            <button
              type="button"
              onClick={() => setMode('manual')}
              className={`cursor-pointer px-2.5 py-1.5 transition-colors ${
                !isAuto ? 'bg-white text-[#253c31] shadow-sm' : 'text-[#72766a] hover:text-[#253c31]'
              }`}
              title="手动漫游（M）"
            >
              手动
            </button>
            <button
              type="button"
              onClick={() => {
                setTourPhase('idle')
                setMode('auto')
              }}
              className={`cursor-pointer px-2.5 py-1.5 transition-colors ${
                isAuto ? 'bg-white text-[#253c31] shadow-sm' : 'text-[#72766a] hover:text-[#253c31]'
              }`}
              title="自动漫游（M）"
            >
              自动
            </button>
          </div>
          <button
            onClick={() => setPanelOpen((v) => !v)}
            className="cursor-pointer hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-black/10 bg-white text-sm hover:bg-[#efeee5]"
          >
            {panelOpen ? <X size={15} /> : <MapPin size={15} />}
            {panelOpen ? '收起' : '讲解'}
          </button>
        </div>
      </header>

      <main className="relative flex-1 min-h-0 overflow-hidden bg-[#eef0f3]">
        <div className="absolute inset-0">
          {nodes.length > 0 && tourStart.lng !== 0 && (
            <AmapLiveMap
              key={`${id}-${tourZoom}-${mapCenter.lng.toFixed(5)}-${mapCenter.lat.toFixed(5)}`}
              start={tourStart}
              center={mapCenter}
              zoom={tourZoom}
              spots={nodes}
              routePath={routePath}
              activeSpotId={activeNodeId}
              onReady={(api) => {
                mapApiRef.current = api
                walkingSearchRef.current = api.searchWalking
                api.moveVisitor(charRef.current)
                setMapReady(true)
              }}
              onMapClick={onMapClick}
              onSpotClick={(spot) => {
                const node = nodes.find((n) => n.id === spot.id)
                if (node) goToNodeManual(node)
              }}
              onError={setMapError}
              visitorImage={
                attraction ? resolveMediaUrl(attraction, attraction.visitorAvatar) || undefined : undefined
              }
            />
          )}
        </div>

        {(!mapReady || !nodes.length) && !spotsError && !mapError && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 text-sm text-[#72766a]">
            正在载入地图…
          </div>
        )}
        {(spotsError || mapError) && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/90 text-sm text-red-600 px-6 text-center">
            {spotsError || mapError}
          </div>
        )}

        <TourAutoGate
          visible={isAuto && !autoStarted}
          onStart={() => setAutoStarted(true)}
        />

        {tourPhase === 'done' && isAuto && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 pointer-events-auto">
            <div className="rounded-2xl border border-black/5 bg-white px-7 py-6 text-center max-w-sm mx-4 shadow-xl">
              <p className="text-lg font-medium">漫游结束</p>
              <p className="mt-2 text-sm text-[#72766a]">路线已走完，可切回手动继续游园。</p>
              <button
                type="button"
                onClick={exitAutoToManual}
                className="cursor-pointer mt-4 px-4 py-2 rounded-xl bg-[#315442] text-white text-sm hover:bg-[#243f32]"
              >
                回到手动漫游
              </button>
            </div>
          </div>
        )}

        <div
          className={`absolute bottom-5 left-4 z-30 pointer-events-auto w-[min(92vw,260px)] hidden sm:block ${
            isAuto && autoStarted ? 'mb-14' : ''
          }`}
        >
          <div className="journal-tour-surface rounded-2xl border border-black/5 bg-white/95 backdrop-blur-md p-3 shadow-lg">
            <div className="flex items-center justify-between mb-2 px-1">
              <p className="text-sm font-medium">路线</p>
              <span className="text-[11px] text-[#7f8375]">{nodes.length} 站</span>
            </div>
            <div className="space-y-0.5 max-h-[42vh] overflow-y-auto">
              {nodes.map((node, i) => {
                const active = node.id === activeNodeId
                return (
                  <button
                    key={node.id}
                    onClick={() => goToNodeManual(node)}
                    className={`cursor-pointer w-full flex items-center gap-2.5 px-2 py-2 rounded-xl text-left transition-colors ${
                      active ? 'bg-[#f0f3e9] text-[#1d4ed8]' : 'hover:bg-[#efeee5] text-[#253c31]'
                    }`}
                  >
                    <span
                      className={`w-5 h-5 rounded-full text-[10px] flex items-center justify-center shrink-0 ${
                        active ? 'bg-[#315442] text-white' : 'bg-[#253c31] text-white'
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm truncate">{node.name}</span>
                      {node.poetic ? (
                        <span className={`block text-[11px] truncate ${active ? 'text-[#7d9c80]' : 'text-[#7f8375]'}`}>
                          {node.poetic}
                        </span>
                      ) : null}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {!activeNodeId && !moving && mapReady && !isAuto && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 px-3.5 py-1.5 rounded-full bg-white/95 border border-black/5 shadow-sm text-xs text-[#72766a] sm:left-[calc(50%+40px)]">
            点击地图移动 · 靠近节点展开讲解
          </div>
        )}

        <TourProgressBar
          chapters={progressChapters}
          cursor={{ chapter: autoChapter, step: slideIndex }}
          visible={isAuto && autoStarted && tourPhase !== 'done'}
          onJumpChapter={(i) => walkToChapter(i)}
        />

        {panelOpen && (
          <div className="absolute top-3 right-3 w-[min(94vw,440px)] sm:w-[min(48vw,560px)] lg:w-[min(46vw,620px)] flex flex-col gap-2 z-20 pointer-events-none">
            <div className="journal-tour-surface rounded-2xl border border-black/5 bg-white/95 backdrop-blur-md overflow-hidden shadow-lg pointer-events-auto">
              <div className="p-3.5">
                <div className="relative grid rounded-xl overflow-hidden bg-[#efeee5]">
                  {/* 撑高用：占位格给 16:9 的下限，文案更多时由同格那张卡把盒子顶高，不再被 overflow 剪掉 */}
                  <div className="aspect-presentation col-start-1 row-start-1" aria-hidden />
                  {activeSlide && activeNode ? (
                    <div
                      className="col-start-1 row-start-1 flex flex-col justify-end slide-enter"
                      key={`${activeNode.id}-${slideIndex}`}
                    >
                      <img
                        src={resolveMediaUrl(attraction, activeNode.image)}
                        alt={activeNode.name}
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent" />
                      <div className="relative p-5 sm:p-6 flex flex-col justify-end">
                        {activeNode.poetic ? (
                          <p className="text-xs text-white/70 mb-1.5">{activeNode.poetic}</p>
                        ) : null}
                        <h2 className="text-xl sm:text-2xl font-medium text-white leading-snug">
                          {activeSlide.title}
                        </h2>
                        <ul className="mt-3 space-y-1.5 text-sm sm:text-[15px] text-white/90">
                          {activeSlide.bullets.map((b, i) => (
                            <li key={i} className="flex gap-2">
                              <span className="mt-2 w-1.5 h-1.5 rounded-full bg-[#b6c8a6] shrink-0" />
                              <span className="leading-relaxed">{b}</span>
                            </li>
                          ))}
                        </ul>
                        <p className="mt-3 pt-2.5 border-t border-white/15 text-xs sm:text-[13px] text-white/70 leading-relaxed line-clamp-3">
                          {activeSlide.narration}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="col-start-1 row-start-1 flex flex-col justify-end p-6 bg-gradient-to-t from-[#253c31] via-[#455448] to-[#7f8375]">
                      <p className="text-xs text-white/60 mb-1">漫游</p>
                      <p className="text-2xl font-medium text-white">尚未入景</p>
                      <p className="mt-2 text-sm text-white/80 max-w-[320px] leading-relaxed">
                        {isAuto
                          ? '开启自动漫游后，将按路线走动并展开讲解'
                          : '点击地图或左侧路线，走近节点后展开讲解'}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between px-3 py-2.5 border-t border-black/5">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={toggleMode}
                    className={`cursor-pointer px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      isAuto ? 'bg-[#f0f3e9] text-[#1d4ed8]' : 'bg-[#efeee5] text-[#72766a]'
                    }`}
                    title="快捷键 M"
                  >
                    {isAuto ? '自动中' : '切自动'}
                  </button>
                  <button
                    onClick={() => activeSlide && speak(activeSlide.narration)}
                    disabled={!activeSlide || (isAuto && tourPhase === 'presenting')}
                    className="cursor-pointer flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[#efeee5] text-[#253c31] disabled:opacity-40"
                  >
                    <Volume2 size={12} />
                    重播
                  </button>
                </div>
                <div className="flex items-center gap-0.5">
                  <span className="mr-1 text-[11px] text-[#7f8375] tabular-nums">
                    {activeNode ? `${slideIndex + 1}/${activeNode.slides.length}` : '—'}
                  </span>
                  <button
                    onClick={() => goSlide(slideIndex - 1)}
                    disabled={isAuto || !activeNode || slideIndex === 0}
                    className="cursor-pointer p-1.5 rounded-lg hover:bg-[#efeee5] disabled:opacity-35"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    onClick={() => goSlide(slideIndex + 1)}
                    disabled={
                      isAuto || !activeNode || slideIndex === (activeNode?.slides.length || 1) - 1
                    }
                    className="cursor-pointer p-1.5 rounded-lg hover:bg-[#efeee5] disabled:opacity-35"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>
            </div>

            <button
              onClick={() => setQaOpen((v) => !v)}
              className="cursor-pointer self-end flex items-center gap-2 px-3.5 py-2 rounded-full bg-white border border-black/5 shadow-sm hover:bg-[#faf9f4] text-sm pointer-events-auto"
            >
              <MessageCircle size={15} className="text-[#315442]" />
              {qaOpen ? '收起问答' : '问 AI'}
            </button>

            {qaOpen && (
              <div className="rounded-2xl border border-black/5 bg-white/95 backdrop-blur-md p-4 shadow-lg pointer-events-auto">
                <div className="flex items-center gap-2 mb-3 text-[#253c31]">
                  <HelpCircle size={15} className="text-[#72766a]" />
                  <span className="text-sm font-medium">向导游提问</span>
                </div>
                <div className="flex gap-2">
                  <input
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && askQuestion()}
                    placeholder="例如：这里有什么看点？"
                    className="flex-1 px-3 py-2 rounded-xl bg-[#faf9f4] border border-black/8 text-sm outline-none focus:border-[#315442]/50 focus:bg-white"
                  />
                  <button
                    onClick={askQuestion}
                    disabled={asking || !question.trim()}
                    className="cursor-pointer px-3 py-2 rounded-xl bg-[#315442] text-white hover:bg-[#243f32] disabled:opacity-45"
                  >
                    {asking ? (
                      <span className="w-4 h-4 block border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <Send size={16} />
                    )}
                  </button>
                </div>
                {answer && (
                  <div className="mt-3 text-sm text-[#455448] bg-[#faf9f4] rounded-xl p-3 border border-black/5 leading-relaxed">
                    {answer}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
