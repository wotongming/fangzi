/**
 * store.ts —— IndexedDB 数据层（复用 reusable-module/indexeddb-kv）。
 * 独立库 fangzi-home-vault v1，四表：assets / docs / boxes / boxItems。
 * 手动登记的到期项体积小、结构简单，存 LocalStorage（刷新持久）。
 * 写库前由组件侧把响应式对象拍平为纯对象（Blob 直接放纯对象字段即可被结构化克隆）。
 */
import {
  clearValues,
  getAllValues,
  openIndexedDB,
  putValue,
  removeValue,
  type IndexedDBConfig
} from '../../../../reusable-module/indexeddb-kv/indexeddb-kv'
import type { Asset, Box, BoxItem, Doc, ExpiryItem } from './models'

export const DB_NAME = 'fangzi-home-vault'
export const DB_VERSION = 1
const EXPIRY_LS_KEY = 'fangzi-home-vault:expiry-items:v1'

const cfg: IndexedDBConfig = {
  dbName: DB_NAME,
  version: DB_VERSION,
  stores: [
    {
      storeName: 'assets',
      keyPath: 'id',
      indexes: [
        ['category', 'category'],
        ['location', 'location']
      ]
    },
    { storeName: 'docs', keyPath: 'id', indexes: [['assetId', 'assetId']] },
    { storeName: 'boxes', keyPath: 'id' },
    {
      storeName: 'boxItems',
      keyPath: 'id',
      indexes: [
        ['boxId', 'boxId'],
        ['assetId', 'assetId']
      ]
    }
  ]
}

export function openDB(): Promise<IDBDatabase> {
  return openIndexedDB(cfg)
}

// —— assets ——
export function getAllAssets(): Promise<Asset[]> {
  return getAllValues<Asset>(cfg, 'assets')
}
export function putAsset(v: Asset): Promise<IDBValidKey> {
  return putValue(cfg, 'assets', v)
}
export function removeAsset(id: string): Promise<undefined> {
  return removeValue(cfg, 'assets', id)
}

// —— docs ——
export function getAllDocs(): Promise<Doc[]> {
  return getAllValues<Doc>(cfg, 'docs')
}
export function putDoc(v: Doc): Promise<IDBValidKey> {
  return putValue(cfg, 'docs', v)
}
export function removeDoc(id: string): Promise<undefined> {
  return removeValue(cfg, 'docs', id)
}

// —— boxes ——
export function getAllBoxes(): Promise<Box[]> {
  return getAllValues<Box>(cfg, 'boxes')
}
export function putBox(v: Box): Promise<IDBValidKey> {
  return putValue(cfg, 'boxes', v)
}
export function removeBox(id: string): Promise<undefined> {
  return removeValue(cfg, 'boxes', id)
}

// —— boxItems ——
export function getAllBoxItems(): Promise<BoxItem[]> {
  return getAllValues<BoxItem>(cfg, 'boxItems')
}
export function putBoxItem(v: BoxItem): Promise<IDBValidKey> {
  return putValue(cfg, 'boxItems', v)
}
export function removeBoxItem(id: string): Promise<undefined> {
  return removeValue(cfg, 'boxItems', id)
}

// —— 全库导出 / 清空（备份与二次确认清空用） ——

export interface VaultDump {
  assets: Asset[]
  docs: Doc[]
  boxes: Box[]
  boxItems: BoxItem[]
  expiryItems: ExpiryItem[]
}

export async function dumpAll(): Promise<VaultDump> {
  const [assets, docs, boxes, boxItems] = await Promise.all([
    getAllAssets(),
    getAllDocs(),
    getAllBoxes(),
    getAllBoxItems()
  ])
  return { assets, docs, boxes, boxItems, expiryItems: readManualExpiry() }
}

export async function clearAll(): Promise<void> {
  await Promise.all([
    clearValues(cfg, 'assets'),
    clearValues(cfg, 'docs'),
    clearValues(cfg, 'boxes'),
    clearValues(cfg, 'boxItems')
  ])
  try {
    localStorage.removeItem(EXPIRY_LS_KEY)
  } catch {
    /* 隐私模式下忽略 */
  }
}

// —— 手动到期项（LocalStorage，刷新持久） ——

export function readManualExpiry(): ExpiryItem[] {
  try {
    const raw = localStorage.getItem(EXPIRY_LS_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as ExpiryItem[]
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

export function writeManualExpiry(items: ExpiryItem[]): void {
  try {
    localStorage.setItem(EXPIRY_LS_KEY, JSON.stringify(items))
  } catch {
    /* 隐私模式下忽略 */
  }
}
