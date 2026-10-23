import type { PublishedAttraction } from './tourPackage'
import { publishRequest } from './publishApi'

export type ServerExportResult = {
  ok: true
  attractionPath: string
  catalogPath: string
  publicPath: string
  publishedAt: number
}

export type MediaFile = { relPath: string; publicPath: string; blob: Blob }
export type TrashSpotResult = { ok: true; folder: string; trashed: string[] }
export type TrashedSpot = {
  folder: string
  id: string
  name: string
  mode: 'checkin' | 'story'
  publishedAt: number
  trashedAt: number
}
export type RestoreSpotResult = { ok: true; id: string; restored: string[] }

export function trashSpotViaServer(id: string): Promise<TrashSpotResult> {
  return publishRequest(`/__trip_guide/spot?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function listTrashedSpots(): Promise<TrashedSpot[]> {
  try {
    const data = await publishRequest<{ ok: true; items: TrashedSpot[] }>('/__trip_guide/trash', { cache: 'no-store' })
    return data.items
  } catch { return [] }
}

export function restoreSpotViaServer(folder: string): Promise<RestoreSpotResult> {
  return publishRequest(`/__trip_guide/trash/restore?folder=${encodeURIComponent(folder)}`, { method: 'POST' })
}

/** Media is immutable and content-addressed; failed publication never replaces a live image. */
export async function exportPackageViaServer(pkg: PublishedAttraction, media: MediaFile[]): Promise<ServerExportResult> {
  for (const item of media) {
    await publishRequest(`/__trip_guide/media?path=${encodeURIComponent(item.relPath)}`, {
      method: 'POST',
      headers: { 'Content-Type': item.blob.type || 'application/octet-stream' },
      body: item.blob,
    })
  }
  return publishRequest('/__trip_guide/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ package: pkg }),
  })
}
