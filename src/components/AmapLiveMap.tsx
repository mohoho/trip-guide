import { useEffect, useRef } from 'react'
import AMapLoader from '@amap/amap-jsapi-loader'
import { extractWalkingPath } from '../lib/amapWalking'
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
}

function spotHtml(index: number, name: string, active: boolean) {
  const bg = active ? '#3b82f6' : '#111827'
  return `<div style="transform:translate(-50%,-100%);text-align:center;pointer-events:auto;cursor:pointer">
    <div style="width:26px;height:26px;margin:0 auto;border-radius:999px;background:${bg};color:#fff;font:600 12px/26px system-ui,sans-serif;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.25)">${index + 1}</div>
    <div style="margin-top:3px;padding:1px 6px;border-radius:4px;background:rgba(255,255,255,.95);font:500 11px/1.2 system-ui,sans-serif;color:#111;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.12)">${name}</div>
  </div>`
}

function visitorHtml() {
  return `<div style="transform:translate(-50%,-85%);text-align:center">
    <div style="width:28px;height:28px;margin:0 auto;border-radius:999px;background:#3b82f6;color:#fff;font:600 12px/28px system-ui,sans-serif;border:2px solid #fff;box-shadow:0 2px 8px rgba(59,130,246,.45)">游</div>
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

  onMapClickRef.current = onMapClick
  onSpotClickRef.current = onSpotClick
  onReadyRef.current = onReady
  onErrorRef.current = onError
  spotsRef.current = spots
  startRef.current = start
  zoomRef.current = zoom
  activeRef.current = activeSpotId

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

        spotsRef.current.forEach((node, index) => {
          const marker = new AMapLib.Marker({
            position: [node.lng, node.lat],
            content: spotHtml(index, node.name, node.id === activeRef.current),
            offset: new AMapLib.Pixel(0, 0),
            zIndex: 110,
          })
          marker.on('click', () => onSpotClickRef.current(node))
          map.add(marker)
          spotMarkersRef.current[node.id] = marker
        })

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
  }, [])

  useEffect(() => {
    spots.forEach((node, index) => {
      const marker = spotMarkersRef.current[node.id]
      if (marker) marker.setContent(spotHtml(index, node.name, node.id === activeSpotId))
    })
  }, [activeSpotId, spots])

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
