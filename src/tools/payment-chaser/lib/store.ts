/**
 * payment-chaser —— IndexedDB 数据层（独立库 fz-payment-chaser-v1，不碰其它工具键）。
 */
import { toRaw } from 'vue'
import type { Invoice } from './models'

const DB_NAME = 'fz-payment-chaser-v1'
const DB_VERSION = 1
type StoreName = 'invoices'

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
      if (!db.objectStoreNames.contains('invoices')) {
        db.createObjectStore('invoices', { keyPath: 'id' })
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

export async function listInvoices(): Promise<Invoice[]> {
  const db = await openDB()
  const tx = db.transaction('invoices' as StoreName, 'readonly')
  const all = await request(tx.objectStore('invoices').getAll() as IDBRequest<Invoice[]>)
  return all.sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))
}

export async function putInvoice(inv: Invoice): Promise<IDBValidKey> {
  const db = await openDB()
  const tx = db.transaction('invoices' as StoreName, 'readwrite')
  return await request(tx.objectStore('invoices').put(toPlain(inv)) as IDBRequest<IDBValidKey>)
}

export async function deleteInvoice(id: string): Promise<void> {
  const db = await openDB()
  const tx = db.transaction('invoices' as StoreName, 'readwrite')
  await request(tx.objectStore('invoices').delete(id) as IDBRequest<undefined>)
}

export function newId(): string {
  return `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}
