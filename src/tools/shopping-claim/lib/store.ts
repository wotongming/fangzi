/**
 * shopping-claim —— IndexedDB 数据层（案件 / 证据；证据含 Blob 同表存储）。
 */
import { toRaw } from 'vue'
import type { Evidence } from './models'

const DB_NAME = 'fangzi-shopping-claim'
const DB_VERSION = 1
type StoreName = 'cases' | 'evidence'

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前环境不支持 IndexedDB，请使用现代浏览器打开'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('cases')) db.createObjectStore('cases', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('evidence')) {
        const s = db.createObjectStore('evidence', { keyPath: 'id' })
        s.createIndex('caseId', 'caseId', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('打开本地数据库失败'))
  })
  return dbPromise
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('数据库操作失败'))
  })
}

function txn<T>(store: StoreName, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then((db) => request(run(db.transaction(store, mode).objectStore(store))))
}

/**
 * 深度解除 Vue 响应式代理后再交给 IndexedDB：
 * 结构化克隆无法克隆 reactive Proxy（含嵌套数组/对象），但必须原样保留 Blob / Date。
 */
function toPlain<T>(v: T): T {
  const u = toRaw(v as never) as unknown
  if (u === null || typeof u !== 'object') return u as T
  if (u instanceof Blob || u instanceof Date || u instanceof ArrayBuffer || ArrayBuffer.isView(u)) return u as T
  if (Array.isArray(u)) return u.map((x) => toPlain(x)) as unknown as T
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(u as Record<string, unknown>)) {
    out[key] = toPlain((u as Record<string, unknown>)[key])
  }
  return out as T
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDB()
  return request(db.transaction(store, 'readonly').objectStore(store).getAll() as IDBRequest<T[]>)
}

export function put<T>(store: StoreName, value: T): Promise<IDBValidKey> {
  return txn(store, 'readwrite', (s) => s.put(toPlain(value) as object) as IDBRequest<IDBValidKey>)
}

export function remove(store: StoreName, id: string): Promise<undefined> {
  return txn(store, 'readwrite', (s) => s.delete(id) as IDBRequest<undefined>)
}

/** 删除案件并连带删除其全部证据。 */
export async function deleteCaseCascade(caseId: string): Promise<void> {
  const evs = await getAll<Evidence>('evidence')
  for (const e of evs.filter((x) => x.caseId === caseId)) await remove('evidence', e.id)
  await remove('cases', caseId)
}

/** 某案件当前最大证据编号，用于连续编号。 */
export async function nextEvidenceSeq(caseId: string): Promise<number> {
  const evs = await getAll<Evidence>('evidence')
  return evs.filter((e) => e.caseId === caseId).reduce((m, e) => Math.max(m, e.seq), 0) + 1
}
