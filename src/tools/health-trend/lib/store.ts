/**
 * store.ts —— IndexedDB 数据层（复用 reusable-module/indexeddb-kv）。
 * 独立库 fz-health-trend-v1，表 records，绝不动任何既有键。
 */
import {
  getAllValues,
  putValue,
  removeValue,
  type IndexedDBConfig
} from '../../../../reusable-module/indexeddb-kv/indexeddb-kv'
import type { MetricRecord } from './model'

const cfg: IndexedDBConfig = {
  dbName: 'fz-health-trend-v1',
  version: 1,
  stores: [{ storeName: 'records', keyPath: 'id', indexes: [['name', 'name'], ['year', 'year']] }]
}

export const allRecords = () => getAllValues<MetricRecord>(cfg, 'records')
export const saveRecord = (r: MetricRecord) => putValue(cfg, 'records', r)
export const deleteRecord = (id: string) => removeValue(cfg, 'records', id)
