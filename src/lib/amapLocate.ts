import AMapLoader from '@amap/amap-jsapi-loader'
import type { LngLat } from './tourPackage'
import type { DraftAttraction, Spot } from '../types/attraction'

export type AmapPoi = {
  name: string
  location: LngLat
  /** 仅周边搜索（searchNearBy）会返回，单位：米 */
  distance?: number
  address?: string
  type?: string
  tel?: string
  pname?: string
  cityname?: string
  adname?: string
}

type PlaceSearchResult = {
  poiList?: {
    pois?: Array<{
      name?: string
      type?: string
      address?: string
      tel?: string
      pname?: string
      cityname?: string
      adname?: string
      distance?: number
      location?: { lng: number; lat: number } | string
    }>
  }
}

type PlaceSearch = {
  search: (
    keyword: string,
    cb: (status: string, result: PlaceSearchResult | string) => void,
  ) => void
  /** 周边搜索：关键词 + 中心点 + 半径（0-50000 米） */
  searchNearBy?: (
    keyword: string,
    center: [number, number],
    radius: number,
    cb: (status: string, result: PlaceSearchResult | string) => void,
  ) => void
  setCity?: (city: string) => void
}

type AMapNS = {
  PlaceSearch: new (opts: object) => PlaceSearch
}

function parseLocation(loc: { lng: number; lat: number } | string | undefined): LngLat | null {
  if (!loc) return null
  if (typeof loc === 'string') {
    const [lng, lat] = loc.split(',').map(Number)
    if (Number.isFinite(lng) && Number.isFinite(lat)) return { lng, lat }
    return null
  }
  if (typeof loc.lng === 'number' && typeof loc.lat === 'number') {
    return { lng: loc.lng, lat: loc.lat }
  }
  return null
}

function toPoi(
  raw: NonNullable<NonNullable<PlaceSearchResult['poiList']>['pois']>[number],
): AmapPoi | null {
  const location = parseLocation(raw.location)
  if (!location || !raw.name) return null
  return {
    name: raw.name,
    location,
    address: raw.address || undefined,
    type: raw.type || undefined,
    tel: raw.tel || undefined,
    pname: raw.pname || undefined,
    cityname: raw.cityname || undefined,
    adname: raw.adname || undefined,
    distance: typeof raw.distance === 'number' ? raw.distance : undefined,
  }
}

let placeSearchPromise: Promise<PlaceSearch> | null = null

function getPlaceSearch(): Promise<PlaceSearch> {
  if (placeSearchPromise) return placeSearchPromise
  const key = import.meta.env.VITE_AMAP_KEY
  if (!key) return Promise.reject(new Error('缺少 VITE_AMAP_KEY'))

  placeSearchPromise = AMapLoader.load({
    key,
    version: '2.0',
    plugins: ['AMap.PlaceSearch'],
  }).then((AMapLib: AMapNS) => {
    return new AMapLib.PlaceSearch({
      pageSize: 8,
      pageIndex: 1,
      citylimit: false,
      extensions: 'all',
    })
  })
  return placeSearchPromise
}

function searchList(ps: PlaceSearch, keyword: string, city?: string): Promise<AmapPoi[]> {
  return new Promise((resolve) => {
    if (city && ps.setCity) ps.setCity(city)
    ps.search(keyword, (status, result) => {
      if (status !== 'complete' || typeof result === 'string') {
        resolve([])
        return
      }
      const pois = (result.poiList?.pois || [])
        .map(toPoi)
        .filter((p): p is AmapPoi => !!p)
      resolve(pois)
    })
  })
}

/** 周边扫描半径（米，高德取值范围 0-50000）与候选总数上限 */
const NEARBY_RADIUS_M = 800
const NEARBY_LIMIT = 12
/** 周边搜索关键词 */
const NEARBY_KEYWORD = '景点'
/**
 * 高德 POI 分类形如 `风景名胜;公园广场;公园`、`交通设施;收费站;收费站`。
 * 只保留首段命中下面这些「游览大类」的 POI。
 */
const SCENIC_TYPE_HEADS = ['风景名胜', '公园广场', '体育休闲服务', '科教文化服务']
/** 即使在游览大类里也要排除的配套设施子类 */
const NOISE_TYPE_KEYWORDS = [
  '收费站', '停车', '售票', '检票', '高速', '服务区', '出入口', '出口', '入口',
  '轮渡', '索道站', '厕所', '加油', '充电', '公交', '地铁', '车站',
  '监控', '管理处', '派出所', '医务', '餐饮', '购物', '住宿', '住宅', '小区',
]
/** 名称里出现这些词的一律不要（收费站 / 停车点 / 售票处…） */
const NOISE_NAME_KEYWORDS = [
  '收费站', '停车场', '停车点', '售票', '检票', '服务区', '加油站', '充电站', '公共厕所', '卫生间',
]

/**
 * 是否像「可游览的点」。
 * 先按名称排配套，再要求分类首段命中游览大类，最后按分类串排配套子类；
 * 分类缺失的一律丢弃 —— 宁少几个候选，也别把收费站塞进导览。
 */
function isScenicLikePoi(p: AmapPoi): boolean {
  if (NOISE_NAME_KEYWORDS.some((k) => p.name.includes(k))) return false
  const t = (p.type || '').trim()
  if (!t) return false
  const head = t.split(';')[0]
  if (!SCENIC_TYPE_HEADS.some((k) => head.includes(k))) return false
  return !NOISE_TYPE_KEYWORDS.some((k) => t.includes(k))
}

/** 周边搜索：以 center 为圆心、radius 米内按关键词找 POI */
function searchNearByList(
  ps: PlaceSearch,
  keyword: string,
  center: LngLat,
  radius: number,
): Promise<AmapPoi[]> {
  return new Promise((resolve) => {
    const searchNearBy = ps.searchNearBy
    if (!searchNearBy) {
      resolve([])
      return
    }
    searchNearBy.call(ps, keyword, [center.lng, center.lat], radius, (status, result) => {
      if (status !== 'complete' || typeof result === 'string') {
        resolve([])
        return
      }
      resolve((result.poiList?.pois || []).map(toPoi).filter((p): p is AmapPoi => !!p))
    })
  })
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function formatPoiLine(p: AmapPoi, i: number): string {
  const parts = [
    `${i + 1}. ${p.name}`,
    p.type ? `类型:${p.type}` : '',
    typeof p.distance === 'number' && Number.isFinite(p.distance) ? `距离:${Math.round(p.distance)}m` : '',
    p.address ? `地址:${p.address}` : '',
    `${p.location.lng.toFixed(5)},${p.location.lat.toFixed(5)}`,
  ].filter(Boolean)
  return parts.join(' · ')
}

/** 把高德 POI 整理成可喂给 AI 的文本 */
export function buildAmapContextText(area: AmapPoi, nearby: AmapPoi[]): string {
  const region = [area.pname, area.cityname, area.adname].filter(Boolean).join('')
  const lines = [
    `主景区：${area.name}`,
    region ? `行政区：${region}` : '',
    area.type ? `类型：${area.type}` : '',
    area.address ? `地址：${area.address}` : '',
    `坐标：${area.location.lng.toFixed(5)}, ${area.location.lat.toFixed(5)}`,
  ]
  if (nearby.length > 0) {
    lines.push(`周边/相关地点（${NEARBY_RADIUS_M}m 内优先，来自高德检索，可作导览节点参考）：`)
    nearby.forEach((p, i) => lines.push(formatPoiLine(p, i)))
  }
  return lines.filter(Boolean).join('\n')
}

export type ScopeResolveResult = {
  start: LngLat
  zoom: number
  city: string
  areaPoi: AmapPoi
  nearbyPois: AmapPoi[]
  amapContext: string
}

/**
 * 阶段一：按景点名 + 城市检索高德，确定旅游范围与周边地点
 */
export async function resolveAttractionScope(
  draft: Pick<DraftAttraction, 'name' | 'city' | 'start'>,
): Promise<ScopeResolveResult> {
  const ps = await getPlaceSearch()
  const city = (draft.city || '').trim()
  const name = draft.name.trim()
  if (!name) throw new Error('请先填写景点名称')

  let areaList = await searchList(ps, name, city || undefined)
  if (areaList.length === 0) {
    await sleep(120)
    areaList = await searchList(ps, `${name} 景区`, city || undefined)
  }
  if (areaList.length === 0) {
    throw new Error(`高德未找到「${name}」，请调整名称或城市后再试`)
  }

  const areaPoi = areaList[0]
  const resolvedCity = city || areaPoi.cityname || areaPoi.pname || ''

  const seen = new Set<string>([areaPoi.name])
  const nearbyPois: AmapPoi[] = []
  const pushPoi = (p: AmapPoi) => {
    if (nearbyPois.length >= NEARBY_LIMIT || seen.has(p.name)) return
    seen.add(p.name)
    nearbyPois.push(p)
  }

  // 1) 地理周边：以主景区坐标为圆心、按半径找真实地点（按距离由近到远）
  await sleep(150)
  const nearBy = await searchNearByList(ps, NEARBY_KEYWORD, areaPoi.location, NEARBY_RADIUS_M)
  nearBy
    .filter(isScenicLikePoi)
    .sort((a, b) => (a.distance ?? 1e9) - (b.distance ?? 1e9))
    .forEach(pushPoi)

  // 2) 关键字相关：同名景区下的子景点（这里同样要过滤，否则「乐山大佛收费站」这类会被搜出来）
  await sleep(150)
  const related = (await searchList(ps, name, resolvedCity || undefined)).filter(isScenicLikePoi)
  related.forEach(pushPoi)

  // 3) 兜底：候选很少时再按「景点名 + 景点」补一轮
  if (nearbyPois.length < 3) {
    await sleep(120)
    const extra = (await searchList(ps, `${name} 景点`, resolvedCity || undefined)).filter(isScenicLikePoi)
    extra.forEach(pushPoi)
  }

  return {
    start: areaPoi.location,
    zoom: 17,
    city: resolvedCity,
    areaPoi,
    nearbyPois,
    amapContext: buildAmapContextText(areaPoi, nearbyPois),
  }
}

export type LocateResult = {
  start: LngLat
  zoom: number
  spots: Spot[]
  locatedCount: number
}

/**
 * 按节点 searchHint/名称，用高德定位各导览点
 */
export async function locateAttractionOnMap(draft: DraftAttraction): Promise<LocateResult> {
  const ps = await getPlaceSearch()
  const city = (draft.city || '').trim() || undefined
  const areaKeyword = draft.name.trim() || '景点'

  let areaPos: LngLat | null = null
  const areaHits = await searchList(ps, areaKeyword, city)
  if (areaHits[0]) areaPos = areaHits[0].location
  if (!areaPos) {
    await sleep(100)
    const again = await searchList(ps, `${areaKeyword} 景区`, city)
    areaPos = again[0]?.location || draft.start
  }

  await sleep(120)

  const spots: Spot[] = []
  let locatedCount = 0
  for (let i = 0; i < draft.spots.length; i++) {
    const spot = draft.spots[i]
    const hint = (spot.searchHint || `${draft.name} ${spot.name}`).trim()
    let hits = await searchList(ps, hint, city)
    let pos = hits[0]?.location || null
    if (!pos && spot.name) {
      await sleep(80)
      hits = await searchList(ps, `${draft.name} ${spot.name}`, city)
      pos = hits[0]?.location || null
    }
    if (pos) locatedCount += 1
    else {
      const angle = (i / Math.max(1, draft.spots.length)) * Math.PI * 2
      pos = {
        lng: areaPos.lng + Math.cos(angle) * 0.00035,
        lat: areaPos.lat + Math.sin(angle) * 0.00035,
      }
    }
    spots.push({ ...spot, lng: pos.lng, lat: pos.lat })
    await sleep(100)
  }

  const first = spots[0]
  const start = first ? { lng: first.lng, lat: first.lat } : areaPos

  return {
    start,
    zoom: 17.5,
    spots,
    locatedCount,
  }
}
