/**
 * store.ts —— IndexedDB 数据层（复用 reusable-module/indexeddb-kv）。
 * 独立库 fz-rent-evidence-v1，三张表 photos/tickets/ledger，绝不动任何既有键。
 */
import {
  getAllValues,
  putValue,
  removeValue,
  type IndexedDBConfig
} from '../../../../reusable-module/indexeddb-kv/indexeddb-kv'
import type { LedgerEntry, PhotoRecord, RepairTicket } from './model'

const cfg: IndexedDBConfig = {
  dbName: 'fz-rent-evidence-v1',
  version: 1,
  stores: [
    { storeName: 'photos', keyPath: 'id', indexes: [['kind', 'kind'], ['at', 'at']] },
    { storeName: 'tickets', keyPath: 'id', indexes: [['at', 'at']] },
    { storeName: 'ledger', keyPath: 'id', indexes: [['at', 'at']] }
  ]
}

export const allPhotos = () => getAllValues<PhotoRecord>(cfg, 'photos')
export const savePhoto = (r: PhotoRecord) => putValue(cfg, 'photos', r)
export const deletePhoto = (id: string) => removeValue(cfg, 'photos', id)

export const allTickets = () => getAllValues<RepairTicket>(cfg, 'tickets')
export const saveTicket = (r: RepairTicket) => putValue(cfg, 'tickets', r)
export const deleteTicket = (id: string) => removeValue(cfg, 'tickets', id)

export const allLedger = () => getAllValues<LedgerEntry>(cfg, 'ledger')
export const saveLedger = (r: LedgerEntry) => putValue(cfg, 'ledger', r)
export const deleteLedger = (id: string) => removeValue(cfg, 'ledger', id)
