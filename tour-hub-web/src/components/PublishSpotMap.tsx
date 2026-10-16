import { useEffect, useRef, useState } from 'react'
import AMapLoader from '@amap/amap-jsapi-loader'
import type { Spot } from '../types/attraction'
import { extractWalkingPath } from '../lib/amapWalking'
import type { LngLat } from '../lib/tourPackage'

export type PublishMapApi = {
  getCenter: () => LngLat | null
  setCenter: (pos: LngLat) => void
  setZoom: (zoom: number) => void
}

interface PublishSpotMapProps {
  center: LngLat
  zoom: number
  spots: Spot[]
  selectedId: string | null
  /** 游客初始位置；可拖动 */
  start: LngLat
  onSelect: (id: string) => void
  onMove: (id: string, pos: LngLat) => void
  onStartMove: (pos: LngLat) => void
  onZoomChange: (zoom: number) => void
  /** 是否按节点顺序在地图上连线（起点不是第一站时会一并接上） */
  showRoute?: boolean
  onReady?: (api: PublishMapApi) => void
  onError?: (message: string) => void
}

type AnyMarker = {
  on: (ev: string, fn: (e?: { lnglat?: { getLng: () => number; getLat: () => number } }) => void) => void
  setPosition: (c: number[]) => void
  setContent: (html: string) => void
  getPosition?: () => { getLng: () => number; getLat: () => number }
}

type AnyMap = {
  setCenter: (c: number[]) => void
  setZoom: (z: number) => void
  getZoom: () => number
  getCenter: () => { getLng: () => number; getLat: () => number }
  setMapStyle: (s: string) => void
  setFeatures: (f: string[]) => void
  add: (overlay: unknown) => void
  remove: (overlay: unknown | unknown[]) => void
  on: (ev: string, fn: (e?: { lnglat?: { getLng: () => number; getLat: () => number } }) => void) => void
  destroy: () => void
  resize?: () => void
}

type AnyWalking = {
  search: (from: number[], to: number[], cb: (status: string, result: unknown) => void) => void
}

type AMapNS = {
  Map: new (el: HTMLElement, opts: object) => AnyMap
  Marker: new (opts: object) => AnyMarker
  Polyline: new (opts: object) => unknown
  Walking: new (opts: object) => AnyWalking
  Pixel: new (x: number, y: number) => unknown
}

function markerHtml(index: number, name: string, active: boolean) {
  return `
    <div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);cursor:grab;">
      <div style="
        width:28px;height:28px;border-radius:999px;display:flex;align-items:center;justify-content:center;
        font:600 13px/1 system-ui,sans-serif;color:#fff;
        background:${active ? '#3b82f6' : '#111827'};
        box-shadow:0 4px 12px rgba(0,0,0,.2);border:2px solid #fff;
      ">${index + 1}</div>
      <div style="
        margin-top:4px;padding:2px 8px;border-radius:6px;font:500 12px/1.2 system-ui,sans-serif;
        background:rgba(255,255,255,.96);color:#111827;border:1px solid rgba(0,0,0,.06);
        white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.08);
      ">${name}</div>
    </div>
  `
}

function startMarkerHtml() {
  return `
    <div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);cursor:grab;">
      <div style="
        width:30px;height:30px;border-radius:999px;display:flex;align-items:center;justify-content:center;
        font:700 12px/1 system-ui,sans-serif;color:#fff;background:#10b981;
        box-shadow:0 4px 12px rgba(16,185,129,.35);border:2px solid #fff;
      ">起</div>
      <div style="
        margin-top:4px;padding:2px 8px;border-radius:6px;font:500 12px/1.2 system-ui,sans-serif;
        background:rgba(255,255,255,.96);color:#059669;border:1px solid rgba(16,185,129,.25);
        white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.08);
      ">游客起点</div>
    </div>
  `
}

export function PublishSpotMap({
  center,
  zoom,
  spots,
  selectedId,
  start,
  onSelect,
  onMove,
  onStartMove,
  onZoomChange,
  showRoute,
  onReady,
  onError,
}: PublishSpotMapProps) {
  const [routeHint, setRouteHint] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const AMapRef = useRef<AMapNS | null>(null)
  const mapRef = useRef<AnyMap | null>(null)
  const markersRef = useRef<Record<string, AnyMarker>>({})
  const startMarkerRef = useRef<AnyMarker | null>(null)
  const routeLinesRef = useRef<unknown[]>([])
  const showRouteRef = useRef(!!showRoute)
  const walkingRef = useRef<AnyWalking | null>(null)
  const routeSeqRef = useRef(0)
  const routeCacheRef = useRef(new Map<string, number[][]>())
  const onSelectRef = useRef(onSelect)
  const onMoveRef = useRef(onMove)
  const onStartMoveRef = useRef(onStartMove)
  const onZoomChangeRef = useRef(onZoomChange)
  const onReadyRef = useRef(onReady)
  const onErrorRef = useRef(onError)
  const spotsRef = useRef(spots)
  const selectedRef = useRef(selectedId)
  const startRef = useRef(start)
  const zoomRef = useRef(zoom)

  showRouteRef.current = !!showRoute

  onSelectRef.current = onSelect
  onMoveRef.current = onMove
  onStartMoveRef.current = onStartMove
  onZoomChangeRef.current = onZoomChange
  onReadyRef.current = onReady
  onErrorRef.current = onError
  spotsRef.current = spots
  selectedRef.current = selectedId
  startRef.current = start
  zoomRef.current = zoom

  const syncStartMarker = () => {
    const map = mapRef.current
    const AMapLib = AMapRef.current
    if (!map || !AMapLib) return
    const pos = startRef.current
    if (startMarkerRef.current) {
      startMarkerRef.current.setPosition([pos.lng, pos.lat])
      startMarkerRef.current.setContent(startMarkerHtml())
      return
    }
    const marker = new AMapLib.Marker({
      position: [pos.lng, pos.lat],
      content: startMarkerHtml(),
      offset: new AMapLib.Pixel(0, 0),
      draggable: true,
      cursor: 'grab',
      zIndex: 140,
    })
    marker.on('dragend', () => {
      const p = marker.getPosition?.()
      if (!p) return
      onStartMoveRef.current({ lng: p.getLng(), lat: p.getLat() })
    })
    map.add(marker)
    startMarkerRef.current = marker
  }

  const syncMarkers = () => {
    const map = mapRef.current
    const AMapLib = AMapRef.current
    if (!map || !AMapLib) return

    const nextIds = new Set(spotsRef.current.map((s) => s.id))
    Object.entries(markersRef.current).forEach(([id, marker]) => {
      if (!nextIds.has(id)) {
        map.remove(marker)
        delete markersRef.current[id]
      }
    })

    spotsRef.current.forEach((spot, index) => {
      const active = spot.id === selectedRef.current
      const existing = markersRef.current[spot.id]
      if (existing) {
        existing.setPosition([spot.lng, spot.lat])
        existing.setContent(markerHtml(index, spot.name, active))
        return
      }
      const marker = new AMapLib.Marker({
        position: [spot.lng, spot.lat],
        content: markerHtml(index, spot.name, active),
        offset: new AMapLib.Pixel(0, 0),
        draggable: true,
        cursor: 'grab',
        zIndex: active ? 130 : 110,
      })
      marker.on('click', () => onSelectRef.current(spot.id))
      marker.on('dragend', () => {
        const pos = marker.getPosition?.()
        if (!pos) return
        onMoveRef.current(spot.id, { lng: pos.getLng(), lat: pos.getLat() })
      })
      map.add(marker)
      markersRef.current[spot.id] = marker
    })

    syncStartMarker()
  }

  /** 首次真正需要步行规划时，才按需加载 AMap.Walking 插件 */
  const ensureWalking = async (): Promise<AnyWalking | null> => {
    if (walkingRef.current) return walkingRef.current
    const key = import.meta.env.VITE_AMAP_KEY
    if (!key) return null
    try {
      const AMapLib = (await AMapLoader.load({
        key,
        version: '2.0',
        plugins: ['AMap.Walking'],
      })) as AMapNS
      walkingRef.current = new AMapLib.Walking({ hideMarkers: true, autoFitView: false })
      return walkingRef.current
    } catch (e) {
      console.error(e)
      return null
    }
  }

  /** 取一段真实步行路径；插件缺失或查询失败时返回 null（调用方回退直线） */
  const walkingPath = async (from: LngLat, to: LngLat): Promise<LngLat[] | null> => {
    const walking = await ensureWalking()
    if (!walking) return null
    return new Promise((resolve) => {
      walking.search([from.lng, from.lat], [to.lng, to.lat], (status, result) => {
        if (status !== 'complete' || !result || typeof result === 'string') {
          resolve(null)
          return
        }
        const path = extractWalkingPath(result as Parameters<typeof extractWalkingPath>[0])
        resolve(path.length >= 2 ? path : null)
      })
    })
  }

  const segKey = (a: LngLat, b: LngLat) =>
    `${a.lng.toFixed(5)},${a.lat.toFixed(5)}>${b.lng.toFixed(5)},${b.lat.toFixed(5)}`

  /**
   * 按节点顺序取**真实步行路线**并连成一条线（起点与第一站不重合时先把起点接上）。
   * - 逐段走 AMap.Walking，段结果缓存在内存里：拖动节点只会重算相邻两段
   * - 某段查询失败就回退成直线，保证线是连续的
   */
  const syncRoute = async () => {
    const map = mapRef.current
    const AMapLib = AMapRef.current
    if (!map || !AMapLib) return

    routeSeqRef.current += 1
    const seq = routeSeqRef.current
    const stale = () => routeSeqRef.current !== seq || mapRef.current !== map

    routeLinesRef.current.forEach((l) => map.remove(l))
    routeLinesRef.current = []

    if (!showRouteRef.current) {
      setRouteHint('')
      return
    }

    const chain: LngLat[] = spotsRef.current.map((s) => ({ lng: s.lng, lat: s.lat }))
    const startPos = startRef.current
    const firstNode = chain[0]
    const startIsElsewhere =
      !!firstNode &&
      (Math.abs(firstNode.lng - startPos.lng) > 1e-5 ||
        Math.abs(firstNode.lat - startPos.lat) > 1e-5)
    if (startIsElsewhere) chain.unshift({ lng: startPos.lng, lat: startPos.lat })
    if (chain.length < 2) {
      setRouteHint('')
      return
    }

    const total = chain.length - 1
    let failed = 0
    setRouteHint(`正在计算步行路线… 0/${total}`)

    // 一段一条线：真路线实线，兜底直线虚线（一眼能看出哪段没算出来）
    for (let i = 1; i < chain.length; i++) {
      const from = chain[i - 1]
      const to = chain[i]
      const key = segKey(from, to)

      let seg = routeCacheRef.current.get(key)
      let real = !!seg

      if (!seg) {
        let path = await walkingPath(from, to)
        if (stale()) return
        if (!path) {
          // 失败多半是瞬时限流：等一下重试一次；仍失败才回退直线
          await new Promise((r) => setTimeout(r, 300))
          if (stale()) return
          path = await walkingPath(from, to)
          if (stale()) return
        }
        if (path) {
          seg = path.map((p) => [p.lng, p.lat])
          // 只缓存成功结果；失败不写缓存，下次还会重试
          routeCacheRef.current.set(key, seg)
          real = true
        } else {
          seg = [
            [from.lng, from.lat],
            [to.lng, to.lat],
          ]
          failed += 1
        }
        await new Promise((r) => setTimeout(r, 120))
        if (stale()) return
      }

      const line = new AMapLib.Polyline({
        path: seg,
        strokeColor: '#3b82f6',
        strokeWeight: 4,
        strokeOpacity: real ? 0.85 : 0.55,
        strokeStyle: real ? 'solid' : 'dashed',
        lineJoin: 'round',
        lineCap: 'round',
        zIndex: 60,
      })
      map.add(line)
      routeLinesRef.current.push(line)
      setRouteHint(`正在计算步行路线… ${i}/${total}`)
    }

    if (stale()) return
    setRouteHint(failed > 0 ? `${failed} 段未取到步行路线，已用虚线直连` : '')
  }

  useEffect(() => {
    const key = import.meta.env.VITE_AMAP_KEY
    if (!key) {
      onErrorRef.current?.('缺少 VITE_AMAP_KEY')
      return
    }

    let cancelled = false
    let onResize: (() => void) | null = null

    AMapLoader.load({ key, version: '2.0', plugins: [] })
      .then((AMapLib: AMapNS) => {
        if (cancelled || !containerRef.current) return
        AMapRef.current = AMapLib
        const map = new AMapLib.Map(containerRef.current, {
          viewMode: '2D',
          zoom: zoomRef.current,
          center: [center.lng, center.lat],
          mapStyle: 'amap://styles/whitesmoke',
          features: ['bg', 'road', 'building', 'point'],
          showLabel: true,
        })
        mapRef.current = map

        const resize = () => map.resize?.()
        requestAnimationFrame(resize)
        window.setTimeout(resize, 120)
        onResize = () => resize()
        window.addEventListener('resize', onResize)

        map.on('zoomend', () => {
          onZoomChangeRef.current(map.getZoom())
        })

        syncMarkers()
        void syncRoute()
        onReadyRef.current?.({
          getCenter: () => {
            const c = mapRef.current?.getCenter()
            if (!c) return null
            return { lng: c.getLng(), lat: c.getLat() }
          },
          setCenter: (pos) => {
            mapRef.current?.setCenter([pos.lng, pos.lat])
          },
          setZoom: (z) => {
            mapRef.current?.setZoom(z)
          },
        })
      })
      .catch((err: unknown) => {
        console.error(err)
        onErrorRef.current?.('高德地图加载失败')
      })

    return () => {
      cancelled = true
      if (onResize) window.removeEventListener('resize', onResize)
      markersRef.current = {}
      startMarkerRef.current = null
      routeSeqRef.current += 1
      routeLinesRef.current = []
      walkingRef.current = null
      mapRef.current?.destroy()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    spotsRef.current = spots
    selectedRef.current = selectedId
    syncMarkers()
  }, [spots, selectedId])

  useEffect(() => {
    startRef.current = start
    syncStartMarker()
  }, [start.lng, start.lat])

  useEffect(() => {
    void syncRoute()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spots, start.lng, start.lat, showRoute])

  useEffect(() => {
    mapRef.current?.setCenter([center.lng, center.lat])
  }, [center.lng, center.lat])

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full bg-[#f5f5f5]" />
      {routeHint && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full border border-black/5 bg-white/95 px-3 py-1 text-xs text-[#6b7280] shadow-sm">
          {routeHint}
        </div>
      )}
    </div>
  )
}
