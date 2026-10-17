import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Compass, Footprints, RotateCcw, Square, Volume2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { AmapLiveMap, type MapApi, type WalkingSearch } from '../components/AmapLiveMap'
import { AskAiPanel } from '../components/AskAiPanel'
import {
  resolveMediaUrl,
  type LngLat,
  type PublishedAttraction,
  type PublishedSpot,
} from '../lib/tourPackage'
import { haversineMeters, speakOnce, walkAlongPath } from '../lib/tourLive'
import {
  storyChoiceLabel,
  storyEndingLabel,
  storyEntryId,
  storyNextChoices,
} from '../lib/storyTour'

/**
 * 故事模式前台。与打卡页是兄弟页面，骨架自成一派：
 * 地图打底 + 右上角当前情节 + 左下角去向选项；没有自动模式，推进全靠人点按钮。
 */
export function StoryTourPage({ pkg }: { pkg: PublishedAttraction }) {
  const entry = useMemo(() => storyEntryId(pkg), [pkg])
  const [currentId, setCurrentId] = useState<string | null>(entry)
  const [visited, setVisited] = useState<string[]>(() => (entry ? [entry] : []))
  /** 开始遮罩：进来先不播报，点「开始」才算这一程的第一下（也顺手解开浏览器的自动播放限制） */
  const [started, setStarted] = useState(false)
  const [mapReady, setMapReady] = useState(false)
  const [mapError, setMapError] = useState('')
  const [moving, setMoving] = useState(false)
  const [routePath, setRoutePath] = useState<LngLat[] | null>(null)
  const [freeRoam, setFreeRoam] = useState(false)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  /** 「重播」等于给同一个节点换个口令，逼播报 effect 重跑 */
  const [speakToken, setSpeakToken] = useState(0)

  const animRef = useRef<(() => void) | null>(null)
  const charRef = useRef<LngLat>(pkg.start)
  const mapApiRef = useRef<MapApi | null>(null)
  const walkingSearchRef = useRef<WalkingSearch | null>(null)
  const routeSeqRef = useRef(0)
  const synthRef = useRef(window.speechSynthesis)
  const narrateCancelRef = useRef<(() => void) | null>(null)
  const voicesRef = useRef<SpeechSynthesisVoice[]>([])

  useEffect(() => {
    voicesRef.current = voices
  }, [voices])

  useEffect(() => {
    const synth = synthRef.current
    const load = () => setVoices(synth.getVoices())
    load()
    synth.addEventListener('voiceschanged', load)
    return () => synth.removeEventListener('voiceschanged', load)
  }, [])

  const current = useMemo(
    () => pkg.spots.find((s) => s.id === currentId) || null,
    [pkg.spots, currentId],
  )

  const slide = current?.slides[0] || null

  /** 不回头：只列没去过的去向（§3.3 第 5 条） */
  const available = useMemo(() => {
    if (!currentId) return []
    return storyNextChoices(pkg, currentId).filter((c) => !visited.includes(c.to))
  }, [pkg, currentId, visited])

  /** 去向被过滤光也算结局（§3.3 边界） */
  const isEnding = !!current && available.length === 0

  /** 迷雾：只露"站在哪"和"下一步能去哪" */
  const visibleIds = useMemo(() => {
    const ids = new Set<string>()
    if (currentId) ids.add(currentId)
    for (const c of available) ids.add(c.to)
    return ids
  }, [currentId, available])

  const walkedTrace = useMemo(
    () =>
      visited
        .map((id) => pkg.spots.find((s) => s.id === id)?.name)
        .filter((n): n is string => !!n),
    [visited, pkg.spots],
  )

  const stopWalk = useCallback(() => {
    routeSeqRef.current += 1
    animRef.current?.()
    animRef.current = null
    setMoving(false)
    setRoutePath(null)
  }, [])

  /** 沿高德路网走到 to；到达后回调（复用共用底座的折线匀速动画） */
  const walkTo = useCallback((to: LngLat, onArrive: () => void) => {
    const from = { ...charRef.current }
    routeSeqRef.current += 1
    const seq = routeSeqRef.current
    setMoving(true)

    const run = (path: LngLat[]) => {
      if (seq !== routeSeqRef.current) return
      setRoutePath(path)
      animRef.current = walkAlongPath(path, {
        onFrame: (pos) => {
          charRef.current = pos
          mapApiRef.current?.moveVisitor(pos)
        },
        onArrive: (pos) => {
          if (seq !== routeSeqRef.current) return
          charRef.current = pos
          mapApiRef.current?.moveVisitor(pos)
          animRef.current = null
          setMoving(false)
          onArrive()
          window.setTimeout(() => {
            if (seq === routeSeqRef.current) setRoutePath(null)
          }, 600)
        },
      })
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
    void search(from, to).then((raw) => {
      if (seq !== routeSeqRef.current) return
      if (raw && raw.length >= 2) {
        const path = [...raw]
        if (haversineMeters(from, path[0]) > 3) path.unshift(from)
        if (haversineMeters(path[path.length - 1], to) > 3) path.push(to)
        run(path)
        return
      }
      run([from, to])
    })
  }, [])

  /** 点左下角选项：走过去，到了才算"来过" */
  const goTo = (targetId: string) => {
    if (moving) return
    const node = pkg.spots.find((s) => s.id === targetId)
    if (!node) return
    walkTo({ lng: node.lng, lat: node.lat }, () => {
      setVisited((prev) => (prev.includes(targetId) ? prev : [...prev, targetId]))
      setCurrentId(targetId)
      setFreeRoam(false)
    })
  }

  const restart = () => {
    stopWalk()
    if (!entry) return
    const node = pkg.spots.find((s) => s.id === entry)
    setFreeRoam(false)
    setVisited([entry])
    setCurrentId(entry)
    setSpeakToken((t) => t + 1)
    if (node) {
      const pos = { lng: node.lng, lat: node.lat }
      charRef.current = pos
      mapApiRef.current?.moveVisitor(pos)
    }
  }

  /** 点「开始」后进入一个节点就播报该节点情节；走动过程中不打断 */
  useEffect(() => {
    if (!started) return
    const node = pkg.spots.find((s) => s.id === currentId)
    narrateCancelRef.current?.()
    narrateCancelRef.current = speakOnce({
      synth: synthRef.current,
      voices: voicesRef.current,
      text: node?.slides[0]?.narration || '',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, currentId, speakToken, pkg])

  useEffect(
    () => () => {
      narrateCancelRef.current?.()
      routeSeqRef.current += 1
      animRef.current?.()
    },
    [],
  )

  const onMapClick = (pos: LngLat) => {
    if (!freeRoam || moving) return
    walkTo(pos, () => {})
  }

  const onSpotClick = (spot: PublishedSpot) => {
    if (spot.id === currentId) return
    if (available.some((c) => c.to === spot.id)) goTo(spot.id)
  }

  if (!current) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f7f8fa] text-sm text-[#6b7280]">
        这个故事还没有可走的节点
      </div>
    )
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#eef0f3] text-[#111827]">
      <div className="absolute inset-0">
        <AmapLiveMap
          key={pkg.id}
          start={pkg.start}
          zoom={pkg.zoom || 18.5}
          spots={pkg.spots}
          routePath={routePath}
          activeSpotId={currentId}
          markerLabel={(spot) => (visibleIds.has(spot.id) ? '' : null)}
          onReady={(api) => {
            mapApiRef.current = api
            walkingSearchRef.current = api.searchWalking
            api.moveVisitor(charRef.current)
            setMapReady(true)
          }}
          onMapClick={onMapClick}
          onSpotClick={onSpotClick}
          onError={setMapError}
        />
      </div>

      {!mapReady && !mapError && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 text-sm text-[#6b7280]">
          正在载入地图…
        </div>
      )}
      {mapError && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/90 px-6 text-center text-sm text-red-600">
          {mapError}
        </div>
      )}

      {/* 开始遮罩：点「开始」（或任意处）才进入入口节点，返回与问线索仍可用 */}
      {!started && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
          role="dialog"
          aria-label="开始故事导览"
          onClick={() => setStarted(true)}
        >
          <div
            className="mx-4 w-full max-w-sm rounded-2xl border border-black/5 bg-white px-6 py-7 text-center shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-xs text-[#9ca3af]">入口</p>
            <p className="mt-1.5 text-lg font-medium text-[#111827]">{current.name}</p>
            <button
              type="button"
              onClick={() => setStarted(true)}
              className="mt-5 inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#3b82f6] px-6 py-2.5 text-sm text-white hover:bg-[#2563eb]"
            >
              开始
            </button>
          </div>
        </div>
      )}

      <header className="pointer-events-none absolute inset-x-0 top-0 z-50 flex h-14 items-center justify-between gap-3 px-3">
        <div className="pointer-events-auto flex min-w-0 items-center gap-2 rounded-full border border-black/5 bg-white/95 py-1.5 pl-2.5 pr-3.5 shadow-sm backdrop-blur-md">
          <Link
            to="/"
            className="text-sm text-[#6b7280] hover:text-[#111827]"
            title="返回景点列表"
          >
            返回
          </Link>
          <span className="text-[#d1d5db]">/</span>
          <span className="min-w-0 truncate text-sm font-medium">{pkg.name}</span>
          <span className="shrink-0 rounded-md bg-[#111827] px-1.5 py-0.5 text-[10px] text-white">
            故事
          </span>
        </div>
        <div className="pointer-events-auto shrink-0">
          <AskAiPanel name={pkg.name} />
        </div>
      </header>

      {/* 右上角 · 当前情节 */}
      <section className="absolute right-3 top-16 z-20 max-h-[calc(100vh-11rem)] w-[min(94vw,420px)] overflow-y-auto rounded-2xl border border-black/5 bg-white/95 shadow-lg backdrop-blur-md">
        <div className="p-3.5">
          <div className="aspect-presentation relative overflow-hidden rounded-xl bg-[#f3f4f6]">
            <img
              src={resolveMediaUrl(pkg, current.image)}
              alt={current.name}
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent" />
            <div className="absolute inset-0 flex flex-col justify-end p-5">
              {current.poetic ? <p className="mb-1.5 text-xs text-white/70">{current.poetic}</p> : null}
              <h2 className="text-xl font-medium leading-snug text-white">
                {slide?.title || current.name}
              </h2>
              {slide && slide.bullets.length > 0 && (
                <ul className="mt-3 space-y-1.5 text-sm text-white/90">
                  {slide.bullets.map((b, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#93c5fd]" />
                      <span className="leading-relaxed">{b}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {slide?.narration ? (
            <p className="mt-3 text-[13px] leading-relaxed text-[#4b5563]">{slide.narration}</p>
          ) : (
            <p className="mt-3 text-[13px] text-[#9ca3af]">这个节点还没有口播文案。</p>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-black/5 px-3 py-2.5">
          <span className="text-[11px] text-[#9ca3af]">
            {moving ? '正在走过去…' : freeRoam ? '自由漫游中' : '当前情节'}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSpeakToken((t) => t + 1)}
              className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-[#f3f4f6] px-2.5 py-1.5 text-xs font-medium text-[#111827] hover:bg-[#e5e7eb]"
            >
              <Volume2 size={12} />
              重播
            </button>
            <button
              type="button"
              onClick={() => narrateCancelRef.current?.()}
              className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-[#f3f4f6] px-2.5 py-1.5 text-xs font-medium text-[#6b7280] hover:bg-[#e5e7eb]"
            >
              <Square size={12} />
              停止
            </button>
          </div>
        </div>
      </section>

      {/* 左下角 · 去向选项：故事页唯一的前进入口 */}
      <section className="absolute bottom-4 left-3 z-30 w-[min(calc(100vw-9rem),320px)] space-y-2">
        {isEnding ? (
          <div className="rounded-2xl border border-black/5 bg-white/95 p-3.5 shadow-lg backdrop-blur-md">
            <p className="text-[11px] text-[#9ca3af]">结局</p>
            <p className="mt-0.5 text-base font-medium">{storyEndingLabel(pkg, current.id)}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={restart}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-[#3b82f6] px-3 py-1.5 text-sm text-white hover:bg-[#2563eb]"
              >
                <RotateCcw size={14} />
                重新开始
              </button>
              {!freeRoam && (
                <button
                  type="button"
                  onClick={() => setFreeRoam(true)}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-black/10 bg-white px-3 py-1.5 text-sm hover:bg-[#f3f4f6]"
                >
                  <Compass size={14} />
                  自由漫游
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-black/5 bg-white/95 p-3.5 shadow-lg backdrop-blur-md">
            <p className="mb-2 px-0.5 text-sm font-medium">下一步去哪</p>
            <div className="space-y-1.5">
              {available.map((choice) => (
                <button
                  key={choice.to}
                  type="button"
                  onClick={() => goTo(choice.to)}
                  disabled={moving}
                  className="w-full cursor-pointer rounded-xl border border-black/8 bg-white px-3 py-2 text-left transition-colors hover:border-[#3b82f6]/40 hover:bg-[#eff6ff] disabled:opacity-50"
                >
                  <span className="block truncate text-sm">{storyChoiceLabel(pkg, choice)}</span>
                  {choice.note ? (
                    <span className="mt-0.5 block truncate text-[11px] text-[#9ca3af]">
                      {choice.note}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        )}

        {walkedTrace.length > 0 && (
          <p className="flex items-start gap-1.5 rounded-xl bg-white/90 px-3 py-1.5 text-[11px] leading-relaxed text-[#6b7280] shadow-sm backdrop-blur-md">
            <Footprints size={12} className="mt-0.5 shrink-0" />
            <span className="min-w-0">已走：{walkedTrace.join(' → ')}</span>
          </p>
        )}

        {freeRoam && (
          <p className="rounded-xl bg-white/90 px-3 py-1.5 text-[11px] text-[#6b7280] shadow-sm backdrop-blur-md">
            点击地图移动 · 自由漫游不受路线限制
          </p>
        )}
      </section>
    </div>
  )
}
