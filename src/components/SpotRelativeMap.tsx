import { useEffect, useMemo, useRef, useState } from 'react'
import type { CandidatePoi } from '../types/attraction'

type Point = { name: string; lng: number; lat: number; picked?: boolean }

interface SpotRelativeMapProps {
  /** 主景点（主景区 POI）；缺失时显示空态 */
  main?: { name: string; lng: number; lat: number }
  /** 候选地点；picked 的用实心点 + 深色名称 */
  points?: CandidatePoi[]
  /** 空态文案 */
  emptyHint?: string
  /** 点了某个候选点：切换它的 picked（不传则只读） */
  onToggle?: (name: string) => void
}

/** 画布高度；宽度取容器实测值，避免等比缩放把图挤成中间一条 */
const H = 260
const PAD = 20
/** 兜底：宽度还没量到时的占位值 */
const W_FALLBACK = 320
/** 所有点几乎重合时的兜底半径 */
const FALLBACK_R = 56
/** 点击热区半径（比圆点大一圈，便于点选） */
const HIT_R = 13
/** 画布底：米白 + 极淡方格（格线比底色只亮一点点，像一张坐标纸）；标签描边取底色，重叠处才不会积出灰边 */
const CANVAS_BG = '#fcf9f2'
const GRID_LINE = '#fdfcf8'
const GRID_SIZE = 15

function dot(picked: boolean, isMain: boolean) {
  if (isMain) {
    return { r: 7, fill: '#ef4444', stroke: '#fff', strokeWidth: 2 }
  }
  return picked
    ? { r: 5, fill: '#315442', stroke: '#fff', strokeWidth: 1.5 }
    : { r: 5, fill: '#fff', stroke: '#72766a', strokeWidth: 1.5 }
}

/**
 * 「相对位置」小画布：把主景点与候选点按经纬度差等比投影到纯色底上。
 * 不画底图、不请求瓦片，纯本地绘制；给了 onToggle 就能直接点圆点选点。
 */
export function SpotRelativeMap({ main, points = [], emptyHint, onToggle }: SpotRelativeMapProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    setWidth(Math.round(el.clientWidth))
    const ro = new ResizeObserver(() => setWidth(Math.round(el.clientWidth)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const W = width || W_FALLBACK

  const layout = useMemo(() => {
    const items: Point[] = [
      ...(main ? [{ name: main.name, lng: main.lng, lat: main.lat }] : []),
      ...points.map((p) => ({
        name: p.name,
        lng: p.location.lng,
        lat: p.location.lat,
        picked: p.picked,
      })),
    ]
    const lats = items.map((p) => p.lat)
    const minLat = Math.min(...lats)
    const maxLat = Math.max(...lats)

    // 经度按纬度收窄，横纵等比才不会把形状拉长
    const cosLat = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180)
    const xs = items.map((p) => p.lng * cosLat)
    const ys = items.map((p) => p.lat)
    const spanX = Math.max(...xs) - Math.min(...xs)
    const spanY = Math.max(...ys) - Math.min(...ys)
    const degenerate = spanX < 1e-9 && spanY < 1e-9

    if (degenerate) {
      return items.map((p, i) => {
        if (i === 0 && main) return { ...p, x: W / 2, y: H / 2, isMain: true }
        const k = main ? i : i + 1
        const angle = (k / Math.max(1, items.length - (main ? 1 : 0))) * Math.PI * 2
        return {
          ...p,
          x: W / 2 + Math.cos(angle) * FALLBACK_R,
          y: H / 2 + Math.sin(angle) * FALLBACK_R,
          isMain: false,
        }
      })
    }

    const scale = Math.min(
      (W - PAD * 2) / Math.max(spanX, 1e-12),
      (H - PAD * 2) / Math.max(spanY, 1e-12),
    )
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2

    return items.map((p, i) => ({
      ...p,
      x: W / 2 + (p.lng * cosLat - cx) * scale,
      y: H / 2 - (p.lat - cy) * scale,
      isMain: main ? i === 0 : false,
    }))
  }, [main, points, W])

  const hasData = !!main && layout.length > 0

  return (
    <div
      ref={wrapRef}
      style={{
        backgroundColor: CANVAS_BG,
        backgroundImage: `linear-gradient(to right, ${GRID_LINE} 1px, transparent 1px), linear-gradient(to bottom, ${GRID_LINE} 1px, transparent 1px)`,
        backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
      }}
      className="flex h-[260px] w-full items-center justify-center overflow-hidden rounded-xl"
    >
      {hasData ? (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full">
          {layout.map((p) => {
            const style = dot(!!p.picked, p.isMain)
            const clickable = !p.isMain && !!onToggle
            const gap = style.r + 6
            const flip = p.x + gap + p.name.length * 12 > W
            return (
              <g
                key={p.name}
                onClick={clickable ? () => onToggle?.(p.name) : undefined}
                className={clickable ? 'cursor-pointer' : undefined}
              >
                <title>
                  {clickable ? `${p.name}（点击${p.picked ? '取消选中' : '选中'}）` : p.name}
                </title>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={style.r}
                  fill={style.fill}
                  stroke={style.stroke}
                  strokeWidth={style.strokeWidth}
                />
                {clickable && (
                  <circle cx={p.x} cy={p.y} r={HIT_R} fill="#000" fillOpacity={0} />
                )}
                <text
                  x={flip ? p.x - gap : p.x + gap}
                  y={p.y + 4}
                  textAnchor={flip ? 'end' : 'start'}
                  fontSize={p.isMain ? 12 : 11}
                  fontWeight={p.isMain ? 600 : 400}
                  fill={p.isMain ? '#253c31' : p.picked ? '#253c31' : '#7f8375'}
                  stroke={CANVAS_BG}
                  strokeWidth={3}
                  paintOrder="stroke"
                  className="pointer-events-none select-none"
                >
                  {p.name}
                </text>
              </g>
            )
          })}
        </svg>
      ) : (
        <p className="px-6 text-center text-xs leading-relaxed text-[#7f8375]">
          {emptyHint || '检索景区后，这里显示主景点与候选点的相对位置'}
        </p>
      )}
    </div>
  )
}
