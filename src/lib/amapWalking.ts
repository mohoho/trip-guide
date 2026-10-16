import type { LngLat } from './tourPackage'

type PathPt = {
  getLng?: () => number
  getLat?: () => number
  lng?: number
  lat?: number
}

function asLngLat(p: PathPt | undefined): LngLat | null {
  if (!p) return null
  if (typeof p.getLng === 'function' && typeof p.getLat === 'function') {
    return { lng: p.getLng(), lat: p.getLat() }
  }
  if (typeof p.lng === 'number' && typeof p.lat === 'number') {
    return { lng: p.lng, lat: p.lat }
  }
  return null
}

export function extractWalkingPath(result: {
  routes?: Array<{ steps?: Array<{ path?: PathPt[] }> }>
}): LngLat[] {
  const route = result.routes?.[0]
  if (!route?.steps?.length) return []
  const points: LngLat[] = []
  const push = (pt: LngLat) => {
    const last = points[points.length - 1]
    if (last && Math.abs(last.lng - pt.lng) < 1e-7 && Math.abs(last.lat - pt.lat) < 1e-7) return
    points.push(pt)
  }
  for (const step of route.steps) {
    for (const raw of step.path || []) {
      const pt = asLngLat(raw)
      if (pt) push(pt)
    }
  }
  return points
}
