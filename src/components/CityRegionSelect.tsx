import { useEffect, useMemo, useState } from 'react'
import {
  citiesOfProvince,
  loadCityDistricts,
  matchProvinceCity,
  type DistrictNode,
} from '../lib/amapDistrict'

type Props = {
  value: string
  onChange: (city: string) => void
  disabled?: boolean
}

const selectClass =
  'w-full rounded-lg border border-black/8 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#315442]/50 disabled:opacity-50'

/** 省市级联下拉：数据来自高德 AMap.DistrictSearch */
export function CityRegionSelect({ value, onChange, disabled }: Props) {
  const [provinces, setProvinces] = useState<DistrictNode[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [provinceName, setProvinceName] = useState('')
  const [cityName, setCityName] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    loadCityDistricts()
      .then((list) => {
        if (cancelled) return
        setProvinces(list)
        setError('')
        const matched = matchProvinceCity(list, value)
        setProvinceName(matched.provinceName)
        setCityName(matched.cityName)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : '行政区加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // 仅挂载时拉一次；外部 value 变化由下方 effect 同步
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (provinces.length === 0) return
    const matched = matchProvinceCity(provinces, value)
    if (matched.provinceName && matched.provinceName !== provinceName) {
      setProvinceName(matched.provinceName)
    }
    if (matched.cityName && matched.cityName !== cityName) {
      setCityName(matched.cityName)
    }
  }, [value, provinces]) // eslint-disable-line react-hooks/exhaustive-deps

  const province = useMemo(
    () => provinces.find((p) => p.name === provinceName) || null,
    [provinces, provinceName],
  )

  const cities = useMemo(() => (province ? citiesOfProvince(province) : []), [province])

  const onPickProvince = (name: string) => {
    setProvinceName(name)
    const p = provinces.find((x) => x.name === name)
    const nextCities = p ? citiesOfProvince(p) : []
    const nextCity = nextCities[0]?.name || ''
    setCityName(nextCity)
    onChange(nextCity)
  }

  const onPickCity = (name: string) => {
    setCityName(name)
    onChange(name)
  }

  if (error) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-amber-700">{error}，可改为手动输入</p>
        <input
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder="如：上海、杭州市"
          className={selectClass}
        />
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="block min-w-0">
        <span className="sr-only">省 / 直辖市</span>
        <select
          value={provinceName}
          disabled={disabled || loading}
          onChange={(e) => onPickProvince(e.target.value)}
          className={selectClass}
        >
          <option value="">{loading ? '加载行政区…' : '选择省 / 直辖市'}</option>
          {provinces.map((p) => (
            <option key={p.adcode || p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block min-w-0">
        <span className="sr-only">城市</span>
        <select
          value={cityName}
          disabled={disabled || loading || !provinceName}
          onChange={(e) => onPickCity(e.target.value)}
          className={selectClass}
        >
          <option value="">{provinceName ? '选择城市' : '先选省份'}</option>
          {cities.map((c) => (
            <option key={c.adcode || c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
