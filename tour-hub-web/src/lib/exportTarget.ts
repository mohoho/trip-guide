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
