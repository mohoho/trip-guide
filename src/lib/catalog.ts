import {
  assertAttractionCatalog,
  assertPublishedAttraction,
  type AttractionCatalog,
  type CatalogItem,
  type PublishedAttraction,
} from './tourPackage'
import { siteUrl } from './sitePath'

const CATALOG_URL = siteUrl('/spots/catalog.json')

export async function loadCatalog(): Promise<CatalogItem[]> {
  const res = await fetch(CATALOG_URL, { cache: 'no-cache' })
  if (!res.ok) throw new Error(`目录加载失败: ${res.status}`)
  const catalog = assertAttractionCatalog(await res.json()) as AttractionCatalog
  return catalog.items.map((item) => ({ ...item, coverImage: siteUrl(item.coverImage) }))
}

export async function loadPublishedAttraction(id: string): Promise<PublishedAttraction> {
  const res = await fetch(siteUrl(`/spots/${encodeURIComponent(id)}.json`), { cache: 'no-cache' })
  if (!res.ok) throw new Error(`景点加载失败: ${res.status}`)
  return assertPublishedAttraction(await res.json())
}
