import type { PublishedAttraction } from './tourPackage'

export type ServerExportResult = {
  ok: true
  absolutePath: string
  attractionPath: string
  catalogPath: string
}

/** 待落盘的图片：relPath 相对 public/spots，publicPath 为包内引用 */
export type MediaFile = {
  relPath: string
  publicPath: string
  blob: Blob
}

export type TrashSpotResult = {
  ok: true
  /** 移入的目录（绝对路径）；要恢复就把它搬回 public/spots */
  trashDir: string
  trashed: string[]
}

/** 删除已发布景点：包文件与图片目录移入 .trash（可恢复），并从 catalog 摘掉 */
export async function trashSpotViaServer(id: string): Promise<TrashSpotResult> {
  const res = await fetch(`/__trip_guide/spot?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
  const data = (await res.json()) as TrashSpotResult & { ok: boolean; error?: string }
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `删除失败: HTTP ${res.status}`)
  }
  return data as TrashSpotResult
}

/** .trash 里的一条记录（folder 是恢复时的定位符） */
export type TrashedSpot = {
  folder: string
  id: string
  name: string
  mode: 'checkin' | 'story'
  publishedAt: number
  trashedAt: number
}

/** 列出 .trash/spots 里的景点（开发服务不可用时返回空，列表就不显示这一块） */
export async function listTrashedSpots(): Promise<TrashedSpot[]> {
  try {
    const res = await fetch('/__trip_guide/trash', { cache: 'no-cache' })
    if (!res.ok) return []
    const data = (await res.json()) as { ok: boolean; items?: TrashedSpot[] }
    return data.ok && Array.isArray(data.items) ? data.items : []
  } catch {
    return []
  }
}

export type RestoreSpotResult = { ok: true; id: string; restored: string[] }

/** 恢复：包与图片搬回 public/spots，catalog 补回该条 */
export async function restoreSpotViaServer(folder: string): Promise<RestoreSpotResult> {
  const res = await fetch(`/__trip_guide/trash/restore?folder=${encodeURIComponent(folder)}`, {
    method: 'POST',
  })
  const data = (await res.json()) as RestoreSpotResult & { ok: boolean; error?: string }
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `恢复失败: HTTP ${res.status}`)
  }
  return data as RestoreSpotResult
}

/** 写入本应用 public/spots（与前台同一数据源） */
export async function exportPackageViaServer(
  pkg: PublishedAttraction,
  media: MediaFile[],
): Promise<ServerExportResult> {
  // 图片二进制逐个落盘，包 JSON 里只留路径
  for (const item of media) {
    const res = await fetch(`/__trip_guide/media?path=${encodeURIComponent(item.relPath)}`, {
      method: 'POST',
      headers: { 'Content-Type': item.blob.type || 'application/octet-stream' },
      body: item.blob,
    })
    const data = (await res.json()) as { ok: boolean; error?: string }
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `图片写入失败: ${item.relPath}`)
    }
  }

  const res = await fetch('/__trip_guide/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ package: pkg }),
  })
  const data = (await res.json()) as ServerExportResult & { ok: boolean; error?: string }
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `发布失败: HTTP ${res.status}`)
  }
  return data as ServerExportResult
}
