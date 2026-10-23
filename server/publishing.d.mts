import type { IncomingMessage, ServerResponse } from 'node:http'

export class ApiError extends Error { status: number; constructor(status: number, message: string) }
export function validId(id: unknown): boolean
export function safeFile(root: string, relative: string): string
export function validatePackage(pkg: unknown): Record<string, unknown>
export interface PublishingStore {
  spotsDir: string
  upload(relative: string, buffer: Buffer): Record<string, unknown>
  publish(pkg: unknown): Record<string, unknown>
  trash(id: string): Record<string, unknown>
  listTrash(): Array<Record<string, unknown>>
  restore(folder: string): Record<string, unknown>
}
export function createStore(options: { spotsDir: string; trashDir: string; seedDir?: string }): PublishingStore
export function json(res: ServerResponse, status: number, body: unknown): void
export function createPublishingHandler(options: { store: PublishingStore; adminToken?: string }):
  (req: IncomingMessage, res: ServerResponse) => Promise<boolean>
