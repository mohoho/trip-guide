import AMapLoader from '@amap/amap-jsapi-loader'

export type DistrictNode = {
  name: string
  adcode?: string
  level?: string
  children: DistrictNode[]
}

type DistrictRaw = {
  name?: string
  adcode?: string
  level?: string
  districtList?: DistrictRaw[]
}

type DistrictSearchResult = {
  districtList?: DistrictRaw[]
}

type DistrictSearch = {
  search: (
    keyword: string,
    cb: (status: string, result: DistrictSearchResult | string) => void,
  ) => void
}

type AMapNS = {
  DistrictSearch: new (opts: object) => DistrictSearch
}

const CACHE_KEY = 'trip-guide:amap-districts:v1'

function mapNode(raw: DistrictRaw): DistrictNode {
  return {
    name: (raw.name || '').trim(),
    adcode: raw.adcode,
    level: raw.level,
    children: (raw.districtList || []).map(mapNode).filter((n) => n.name),
  }
}

function readCache(): DistrictNode[] | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DistrictNode[]
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null
  } catch {
    return null
  }
}

function writeCache(list: DistrictNode[]) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(list))
  } catch {
    /* quota */
  }
}

let districtsPromise: Promise<DistrictNode[]> | null = null

/**
 * 用高德 DistrictSearch 拉全国省→市树（与 PlaceSearch 同一套 JSAPI）
 */
export function loadCityDistricts(): Promise<DistrictNode[]> {
  const cached = readCache()
  if (cached) return Promise.resolve(cached)
  if (districtsPromise) return districtsPromise

  const key = import.meta.env.VITE_AMAP_KEY
  if (!key) {
    return Promise.reject(new Error('缺少 VITE_AMAP_KEY'))
  }

  districtsPromise = AMapLoader.load({
    key,
    version: '2.0',
    plugins: ['AMap.DistrictSearch'],
  })
    .then(
      (AMapLib: AMapNS) =>
        new Promise<DistrictNode[]>((resolve, reject) => {
          const ds = new AMapLib.DistrictSearch({
            level: 'country',
            subdistrict: 2,
            extensions: 'base',
          })
          ds.search('中国', (status, result) => {
            if (status !== 'complete' || typeof result === 'string') {
              reject(new Error('行政区数据加载失败'))
              return
            }
            const country = result.districtList?.[0]
            const provinces = (country?.districtList || [])
              .map(mapNode)
              .filter((p) => p.name)
            if (provinces.length === 0) {
              reject(new Error('未获取到省级行政区'))
              return
            }
            writeCache(provinces)
            resolve(provinces)
          })
        }),
    )
    .catch((e) => {
      districtsPromise = null
      throw e
    })

  return districtsPromise
}

/** 直辖市 / 特别行政区：省下可能无「市」级，或市名与省名相同 */
const DIRECT_CITY_NAMES = new Set([
  '北京市',
  '天津市',
  '上海市',
  '重庆市',
  '香港特别行政区',
  '澳门特别行政区',
])

export function citiesOfProvince(province: DistrictNode): DistrictNode[] {
  if (DIRECT_CITY_NAMES.has(province.name)) {
    return [{ name: province.name, adcode: province.adcode, level: 'city', children: [] }]
  }
  const cities = province.children.filter(
    (c) => c.level === 'city' || c.name.endsWith('市') || c.name.endsWith('盟') || c.name.endsWith('州') || c.name.endsWith('地区'),
  )
  if (cities.length > 0) return cities
  // 无下级时用省名本身（如部分特别行政区）
  return [{ name: province.name, adcode: province.adcode, level: 'city', children: [] }]
}

/** 从已有 city 字符串反推省、市选中项 */
export function matchProvinceCity(
  provinces: DistrictNode[],
  cityValue: string,
): { provinceName: string; cityName: string } {
  const v = cityValue.trim()
  if (!v) return { provinceName: '', cityName: '' }

  for (const p of provinces) {
    if (p.name === v || p.name.replace(/省|市|壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区/g, '') === v) {
      return { provinceName: p.name, cityName: citiesOfProvince(p)[0]?.name || p.name }
    }
    for (const c of citiesOfProvince(p)) {
      if (
        c.name === v ||
        c.name.replace(/市$/g, '') === v ||
        v.includes(c.name) ||
        c.name.includes(v)
      ) {
        return { provinceName: p.name, cityName: c.name }
      }
    }
  }
  return { provinceName: '', cityName: v }
}
