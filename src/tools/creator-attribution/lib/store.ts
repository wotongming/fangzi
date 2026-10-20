/**
 * store.ts —— IndexedDB 数据层（复用 reusable-module/indexeddb-kv）。
 * 独立库 fangzi-creator-attribution v1，四表：accounts / contents / metrics / deals。
 * 写库前由组件侧对入参做 JSON 深拷贝解 Vue 代理，这里只接受纯字面量对象。
 */
import {
  getAllValues,
  openIndexedDB,
  putValue,
  removeValue,
  type IndexedDBConfig
} from '../../../../reusable-module/indexeddb-kv/indexeddb-kv'
import type { Account, Content, Deal, MetricSnapshot } from './types'

export const DB_NAME = 'fangzi-creator-attribution'
export const DB_VERSION = 1

const cfg: IndexedDBConfig = {
  dbName: DB_NAME,
  version: DB_VERSION,
  stores: [
    { storeName: 'accounts', keyPath: 'id' },
    {
      storeName: 'contents',
      keyPath: 'id',
      indexes: [
        ['accountId', 'accountId'],
        ['publishedAt', 'publishedAt']
      ]
    },
    {
      storeName: 'metrics',
      keyPath: 'id',
      indexes: [
        ['contentId', 'contentId'],
        ['capturedAt', 'capturedAt']
      ]
    },
    {
      storeName: 'deals',
      keyPath: 'id',
      indexes: [
        ['date', 'date'],
        ['accountId', 'accountId']
      ]
    }
  ]
}

export function openDB(): Promise<IDBDatabase> {
  return openIndexedDB(cfg)
}

// —— 全表读取 ——
export async function getAllAccounts(): Promise<Account[]> {
  return getAllValues<Account>(cfg, 'accounts')
}
export async function getAllContents(): Promise<Content[]> {
  return getAllValues<Content>(cfg, 'contents')
}
export async function getAllMetrics(): Promise<MetricSnapshot[]> {
  return getAllValues<MetricSnapshot>(cfg, 'metrics')
}
export async function getAllDeals(): Promise<Deal[]> {
  return getAllValues<Deal>(cfg, 'deals')
}

// —— 写入（入参须为已拍平的纯字面量） ——
export function putAccount(v: Account): Promise<IDBValidKey> {
  return putValue(cfg, 'accounts', v)
}
export function putContent(v: Content): Promise<IDBValidKey> {
  return putValue(cfg, 'contents', v)
}
export function putMetric(v: MetricSnapshot): Promise<IDBValidKey> {
  return putValue(cfg, 'metrics', v)
}
export function putDeal(v: Deal): Promise<IDBValidKey> {
  return putValue(cfg, 'deals', v)
}

// —— 删除 ——
export function removeAccount(id: string): Promise<undefined> {
  return removeValue(cfg, 'accounts', id)
}
export function removeDeal(id: string): Promise<undefined> {
  return removeValue(cfg, 'deals', id)
}

/** 删除内容时级联删除其全部数据快照。 */
export async function removeContentCascade(id: string): Promise<void> {
  const ms = await getAllMetrics()
  for (const m of ms.filter((x) => x.contentId === id)) await removeValue(cfg, 'metrics', m.id)
  await removeValue(cfg, 'contents', id)
}

/** 删除账号时级联删除其内容、内容快照与商单。 */
export async function removeAccountCascade(id: string): Promise<void> {
  const [contents, metrics, deals] = await Promise.all([getAllContents(), getAllMetrics(), getAllDeals()])
  const cIds = new Set(contents.filter((c) => c.accountId === id).map((c) => c.id))
  for (const m of metrics.filter((m) => cIds.has(m.contentId))) await removeValue(cfg, 'metrics', m.id)
  for (const c of contents.filter((c) => c.accountId === id)) await removeValue(cfg, 'contents', c.id)
  for (const d of deals.filter((d) => d.accountId === id)) await removeValue(cfg, 'deals', d.id)
  await removeAccount(id)
}
