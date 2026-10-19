/**
 * tax-deduction —— IndexedDB 数据层（items）。
 * 写库前深度解除 Vue 响应式代理（结构化克隆无法克隆 Proxy）。
 */
import { toRaw } from 'vue'
import type { DeductionItem } from './models'

const DB_NAME = 'fangzi-tax-deduction'
const DB_VERSION = 1

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
      if (!db.objectStoreNames.contains('items')) {
        const s = db.createObjectStore('items', { keyPath: 'id' })
        s.createIndex('year', 'year', { unique: false })
        s.createIndex('kind', 'kind', { unique: false })
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

function toPlain<T>(v: T): T {
  const u = toRaw(v as never) as unknown
  if (u === null || typeof u !== 'object') return u as T
  if (u instanceof Blob || u instanceof Date || u instanceof ArrayBuffer || ArrayBuffer.isView(u)) return u as T
  if (Array.isArray(u)) return u.map((x) => toPlain(x)) as unknown as T
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(u as Record<string, unknown>)) out[key] = toPlain((u as Record<string, unknown>)[key])
  return out as T
}

export async function getAllItems(): Promise<DeductionItem[]> {
  const db = await openDB()
  return request(db.transaction('items', 'readonly').objectStore('items').getAll() as IDBRequest<DeductionItem[]>)
}

export async function getItemsByYear(year: number): Promise<DeductionItem[]> {
  const all = await getAllItems()
  return all.filter((x) => x.year === year)
}

export function putItem(value: DeductionItem): Promise<IDBValidKey> {
  return openDB().then((db) =>
    request(db.transaction('items', 'readwrite').objectStore('items').put(toPlain(value) as object) as IDBRequest<IDBValidKey>)
  )
}

export async function putItems(values: DeductionItem[]): Promise<void> {
  const db = await openDB()
  const tx = db.transaction('items', 'readwrite')
  const store = tx.objectStore('items')
  for (const v of values) store.put(toPlain(v) as object)
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('批量写入失败'))
  })
}

export function removeItem(id: string): Promise<undefined> {
  return openDB().then((db) => request(db.transaction('items', 'readwrite').objectStore('items').delete(id) as IDBRequest<undefined>))
}
