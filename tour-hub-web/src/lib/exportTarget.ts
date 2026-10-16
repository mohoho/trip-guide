import type { PublishedAttraction } from './tourPackage'

export type ServerExportResult = {
  ok: true
  absolutePath: string
  attractionPath: string
  catalogPath: string
}

/** 写入本应用 public/spots（与前台同一数据源） */
export async function exportPackageViaServer(
  pkg: PublishedAttraction,
): Promise<ServerExportResult> {
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
