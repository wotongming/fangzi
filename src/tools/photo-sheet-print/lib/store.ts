/**
 * photo-sheet-print —— IndexedDB 数据层（独立库 fz-photo-sheet-print-v1，不碰其它工具键）。
 * 复用 reusable-module/indexeddb-kv。
 */
import {
  clearValues,
  getAllValues,
  putValue,
  removeValue,
  type IndexedDBConfig
} from '../../../../reusable-module/indexeddb-kv/indexeddb-kv'
import type { PhotoItem } from './models'
import type { SheetConfig } from './layout'

const DB: IndexedDBConfig = {
  dbName: 'fz-photo-sheet-print-v1',
  version: 1,
  stores: [
    { storeName: 'photos', keyPath: 'id' },
    { storeName: 'meta', keyPath: 'key' }
  ]
}

export async function listPhotos(): Promise<PhotoItem[]> {
  const all = await getAllValues<PhotoItem>(DB, 'photos')
  return all.sort((a, b) => a.seq - b.seq)
}

export async function savePhoto(photo: PhotoItem): Promise<void> {
  await putValue(DB, 'photos', photo)
}

export async function removePhoto(id: string): Promise<void> {
  await removeValue(DB, 'photos', id)
}

export async function clearPhotos(): Promise<void> {
  await clearValues(DB, 'photos')
}

export async function saveConfig(cfg: SheetConfig): Promise<void> {
  await putValue(DB, 'meta', { key: 'config', value: cfg })
}

export async function loadConfig(): Promise<SheetConfig | null> {
  const all = await getAllValues<{ key: string; value: SheetConfig }>(DB, 'meta')
  return all.find((m) => m.key === 'config')?.value ?? null
}
