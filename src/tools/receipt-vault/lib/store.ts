/**
 * store.ts —— IndexedDB 数据层（复用 reusable-module/indexeddb-kv）。
 * 独立库 fz-receipt-vault-v1，store=receipts，绝不动任何既有键。
 */
import {
  getAllValues,
  putValue,
  removeValue,
  type IndexedDBConfig
} from '../../../../reusable-module/indexeddb-kv/indexeddb-kv'
import type { ReceiptRecord } from './extract'

const cfg: IndexedDBConfig = {
  dbName: 'fz-receipt-vault-v1',
  version: 1,
  stores: [{ storeName: 'receipts', keyPath: 'id', indexes: [['category', 'category'], ['date', 'date']] }]
}

export function allReceipts(): Promise<ReceiptRecord[]> {
  return getAllValues<ReceiptRecord>(cfg, 'receipts')
}
export function saveReceipt(r: ReceiptRecord): Promise<IDBValidKey> {
  return putValue(cfg, 'receipts', r)
}
export function deleteReceipt(id: string): Promise<unknown> {
  return removeValue(cfg, 'receipts', id)
}
