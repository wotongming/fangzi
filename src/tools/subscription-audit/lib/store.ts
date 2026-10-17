/**
 * store.ts —— 订阅盘点本地持久化（IndexedDB，复用 reusable-module/indexeddb-kv）。
 * 只存：导入批次元信息（不存逐条账单明细，避免敏感数据长期落盘）、人工纠正 overrides。
 */
import {
  getAllValues,
  putValue,
  clearValues,
  type IndexedDBConfig
} from '../../../../reusable-module/indexeddb-kv/indexeddb-kv'
import type { SubOverrides } from './subscriptions'

const DB_CFG: IndexedDBConfig = {
  dbName: 'fz-subscription-audit-v1',
  version: 1,
  stores: [
    { storeName: 'overrides', keyPath: 'id' }, // 单行：{ id:'current', value: SubOverrides }
    { storeName: 'batches', keyPath: 'id', indexes: [['importedAt', 'importedAt']] }
  ]
}

interface OverridesRow {
  id: 'current'
  value: SubOverrides
  updatedAt: number
}

export interface BatchMeta {
  id: string
  name: string
  platform: string
  account: string
  rowCount: number
  importedAt: number
}

export async function loadOverrides(): Promise<SubOverrides> {
  const rows = await getAllValues<OverridesRow>(DB_CFG, 'overrides')
  return rows[0]?.value ?? {}
}

export async function saveOverrides(value: SubOverrides): Promise<void> {
  await putValue<OverridesRow>(DB_CFG, 'overrides', { id: 'current', value, updatedAt: Date.now() })
}

export async function listBatches(): Promise<BatchMeta[]> {
  const rows = await getAllValues<BatchMeta>(DB_CFG, 'batches')
  return rows.sort((a, b) => b.importedAt - a.importedAt)
}

export async function saveBatch(meta: BatchMeta): Promise<void> {
  await putValue<BatchMeta>(DB_CFG, 'batches', meta)
}

export async function clearAll(): Promise<void> {
  await clearValues(DB_CFG, 'batches')
  await clearValues(DB_CFG, 'overrides')
}
