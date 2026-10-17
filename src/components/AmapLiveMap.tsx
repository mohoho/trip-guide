import { useCallback, useEffect, useRef } from 'react'
import AMapLoader from '@amap/amap-jsapi-loader'
import { extractWalkingPath } from '../lib/amapWalking'
import visitorImage from '../assets/visitor.png'
import type { LngLat, PublishedSpot } from '../lib/tourPackage'

export type WalkingSearch = (from: LngLat, to: LngLat) => Promise<LngLat[] | null>

export type MapApi = {
  searchWalking: WalkingSearch
  moveVisitor: (pos: LngLat) => void
}

interface AmapLiveMapProps {
  start: LngLat
  zoom?: number
  spots: PublishedSpot[]
  activeSpotId: string | null
  routePath: LngLat[] | null
  onReady: (api: MapApi) => void
  onMapClick: (pos: LngLat) => void
  onSpotClick: (spot: PublishedSpot) => void
  onError: (message: string) => void
  /**
   * 圆牌上的字。不传 = 打卡页行为（数组下标 + 1）；给了则：字符串原样显示、
   * 空串画个小圆点（故事模式不要序号）、null 表示这个点不出现在地图上。
   */
  markerLabel?: (spot: PublishedSpot, index: number) => string | null
}

function spotHtml(label: string, name: string, active: boolean) {
  const bg = active ? '#3b82f6' : '#111827'
  const badge = label
    ? `<div style="width:26px;height:26px;margin:0 auto;border-radius:999px;background:${bg};color:#fff;font:600 12px/26px system-ui,sans-serif;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.25)">${label}</div>`
    : `<div style="width:14px;height:14px;margin:6px auto;border-radius:999px;background:${bg};border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.25)"></div>`
  return `<div style="transform:translate(-50%,-100%);text-align:center;pointer-events:auto;cursor:pointer">
    ${badge}
    <div style="margin-top:3px;padding:1px 6px;border-radius:4px;background:rgba(255,255,255,.95);font:500 11px/1.2 system-ui,sans-serif;color:#111;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.12)">${name}</div>
  </div>`
}

/** 游客吉祥物：方图裁成圆，白底当圆牌，锚在点上（游客脚下就是当前坐标） */
function visitorHtml() {
  return `<div style="transform:translate(-50%,-50%);text-align:center">
    <div style="width:36px;height:36px;margin:0 auto;border-radius:999px;overflow:hidden;background:#fff;border:2px solid #fff;box-shadow:0 2px 8px rgba(59,130,246,.45)">
      <img src="${visitorImage}" alt="" style="width:100%;height:100%;object-fit:cover;display:block">
    </div>
  </div>`
}

type AnyMarker = {
  on: (ev: string, fn: () => void) => void
  setPosition: (c: number[]) => void
  setContent: (html: string) => void
}

type AnyMap = {
  setCenter: (c: number[]) => void
  setMapStyle: (s: string) => void
  setFeatures: (f: string[]) => void
  add: (overlay: unknown) => void
  remove: (overlay: unknown) => void
  on: (ev: string, fn: (e: { lnglat: { getLng: () => number; getLat: () => number } }) => void) => void
  destroy: () => void
  resize?: () => void
}

type AMapNS = {
  Map: new (el: HTMLElement, opts: object) => AnyMap
  Marker: new (opts: object) => AnyMarker
  Polyline: new (opts: object) => unknown
  Pixel: new (x: number, y: number) => unknown
}

export function AmapLiveMap({
  start,
  zoom = 18.5,
  spots,
  activeSpotId,
  routePath,
  onReady,
  onMapClick,
  onSpotClick,
  onError,
  markerLabel,
}: AmapLiveMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const AMapRef = useRef<AMapNS | null>(null)
  const mapRef = useRef<AnyMap | null>(null)
  const visitorMarkerRef = useRef<AnyMarker | null>(null)
  const spotMarkersRef = useRef<Record<string, AnyMarker>>({})
  const routeLineRef = useRef<unknown>(null)
  const walkingRef = useRef<{
    search: (from: number[], to: number[], cb: (status: string, result: unknown) => void) => void
  } | null>(null)
  const onMapClickRef = useRef(onMapClick)
  const onSpotClickRef = useRef(onSpotClick)
  const onReadyRef = useRef(onReady)
  const onErrorRef = useRef(onError)
  const spotsRef = useRef(spots)
  const startRef = useRef(start)
  const zoomRef = useRef(zoom)
  const activeRef = useRef(activeSpotId)
  const labelRef = useRef(markerLabel)

  onMapClickRef.current = onMapClick
  onSpotClickRef.current = onSpotClick
  onReadyRef.current = onReady
  onErrorRef.current = onError
  spotsRef.current = spots
  startRef.current = start
  zoomRef.current = zoom
  activeRef.current = activeSpotId

  /**
   * 建 / 改 / 删都走这里：故事模式按可见集合增减 marker，
   * 打卡页每次都传同一批点，等价于只改内容。
   */
  const syncMarkers = useCallback(() => {
    const AMapLib = AMapRef.current
    const map = mapRef.current
    if (!AMapLib || !map) return

    const wanted = new Set<string>()
    spotsRef.current.forEach((node, index) => {
      const label = labelRef.current ? labelRef.current(node, index) : String(index + 1)
      if (label === null) return
      wanted.add(node.id)
      const html = spotHtml(label, node.name, node.id === activeRef.current)
      const existing = spotMarkersRef.current[node.id]
      if (existing) {
        existing.setContent(html)
        existing.setPosition([node.lng, node.lat])
        return
      }
      const marker = new AMapLib.Marker({
        position: [node.lng, node.lat],
        content: html,
        offset: new AMapLib.Pixel(0, 0),
        zIndex: 110,
      })
      marker.on('click', () => {
        const fresh = spotsRef.current.find((s) => s.id === node.id) || node
        onSpotClickRef.current(fresh)
      })
      map.add(marker)
      spotMarkersRef.current[node.id] = marker
    })

    for (const id of Object.keys(spotMarkersRef.current)) {
      if (wanted.has(id)) continue
      map.remove(spotMarkersRef.current[id])
      delete spotMarkersRef.current[id]
    }
  }, [])

  // 声明在初始化 effect 之前：挂载时先落值，syncMarkers 首次调用就能读到正确的圆牌规则
  useEffect(() => {
    labelRef.current = markerLabel
  }, [markerLabel])

  useEffect(() => {
    const key = import.meta.env.VITE_AMAP_KEY
    if (!key) {
      onErrorRef.current('缺少 VITE_AMAP_KEY')
      return
    }

    let cancelled = false
    let onResize: (() => void) | null = null

    AMapLoader.load({
      key,
      version: '2.0',
      plugins: ['AMap.Walking'],
    })
      .then((AMapLib: AMapNS) => {
        if (cancelled || !containerRef.current) return
        AMapRef.current = AMapLib

        const origin = startRef.current
        const map = new AMapLib.Map(containerRef.current, {
          viewMode: '2D',
          zoom: zoomRef.current,
          center: [origin.lng, origin.lat],
          mapStyle: 'amap://styles/whitesmoke',
          features: ['bg', 'road', 'building', 'point'],
          showLabel: true,
          animateEnable: false,
          jogEnable: false,
          pitchEnable: false,
          rotateEnable: false,
        })
        mapRef.current = map

        walkingRef.current = new (
          AMapLib as unknown as {
            Walking: new (opts: object) => NonNullable<typeof walkingRef.current>
          }
        ).Walking({
          hideMarkers: true,
          autoFitView: false,
        })

        const resizeMap = () => map.resize?.()
        requestAnimationFrame(resizeMap)
        window.setTimeout(resizeMap, 100)
        onResize = () => resizeMap()
        window.addEventListener('resize', onResize)

        syncMarkers()

        const visitorMarker = new AMapLib.Marker({
          position: [origin.lng, origin.lat],
          content: visitorHtml(),
          offset: new AMapLib.Pixel(0, 0),
          zIndex: 120,
        })
        map.add(visitorMarker)
        visitorMarkerRef.current = visitorMarker

        map.on('click', (e) => {
          onMapClickRef.current({ lng: e.lnglat.getLng(), lat: e.lnglat.getLat() })
        })

        const searchWalking: WalkingSearch = (from, to) =>
          new Promise((resolve) => {
            const walking = walkingRef.current
            if (!walking) {
              resolve(null)
              return
            }
            walking.search([from.lng, from.lat], [to.lng, to.lat], (status, result) => {
              if (status !== 'complete' || !result || typeof result === 'string') {
                resolve(null)
                return
              }
              const path = extractWalkingPath(
                result as {
                  routes?: Array<{
                    steps?: Array<{
                      path?: Array<{ lng?: number; lat?: number; getLng?: () => number; getLat?: () => number }>
                    }>
                  }>
                },
              )
              resolve(path.length >= 2 ? path : null)
            })
          })

        onReadyRef.current({
          searchWalking,
          moveVisitor: (pos) => {
            visitorMarkerRef.current?.setPosition([pos.lng, pos.lat])
          },
        })
      })
      .catch((err: unknown) => {
        console.error(err)
        onErrorRef.current('高德地图加载失败，请检查 Key / 安全密钥 / 网络')
      })

    return () => {
      cancelled = true
      if (onResize) window.removeEventListener('resize', onResize)
      walkingRef.current = null
      visitorMarkerRef.current = null
      spotMarkersRef.current = {}
      routeLineRef.current = null
      mapRef.current?.destroy()
      mapRef.current = null
    }
  }, [syncMarkers])

  useEffect(() => {
    syncMarkers()
  }, [activeSpotId, spots, markerLabel, syncMarkers])

  useEffect(() => {
    const map = mapRef.current
    const AMapLib = AMapRef.current
    if (map && routeLineRef.current) {
      map.remove(routeLineRef.current)
      routeLineRef.current = null
    }
    if (!map || !AMapLib || !routePath || routePath.length < 2) return
    const line = new AMapLib.Polyline({
      path: routePath.map((p) => [p.lng, p.lat]),
      strokeColor: '#3b82f6',
      strokeWeight: 4,
      strokeOpacity: 0.85,
      showDir: true,
      dirColor: '#bfdbfe',
      lineJoin: 'round',
      lineCap: 'round',
      zIndex: 80,
      bubble: true,
    })
    map.add(line)
    routeLineRef.current = line
  }, [routePath])

  return <div ref={containerRef} className="amap-stage h-full w-full" />
}
