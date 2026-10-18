/**
 * card-billing —— IndexedDB 数据层（cards / payments）。
 * 写库前深度解除 Vue 响应式代理（结构化克隆无法克隆 Proxy），保留 Date/Blob。
 */
import { toRaw } from 'vue'

const DB_NAME = 'fangzi-card-billing'
const DB_VERSION = 1
type StoreName = 'cards' | 'payments'

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
      if (!db.objectStoreNames.contains('cards')) db.createObjectStore('cards', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('payments')) {
        const s = db.createObjectStore('payments', { keyPath: 'id' })
        s.createIndex('cardId', 'cardId', { unique: false })
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

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDB()
  return request(db.transaction(store, 'readonly').objectStore(store).getAll() as IDBRequest<T[]>)
}

export function put<T>(store: StoreName, value: T): Promise<IDBValidKey> {
  return openDB().then((db) => {
    const s = db.transaction(store, 'readwrite').objectStore(store)
    return request(s.put(toPlain(value) as object) as IDBRequest<IDBValidKey>)
  })
}

export function remove(store: StoreName, id: string): Promise<undefined> {
  return openDB().then((db) => request(db.transaction(store, 'readwrite').objectStore(store).delete(id) as IDBRequest<undefined>))
}

/** 删除卡片并清理其还款记录。 */
export async function deleteCardCascade(cardId: string): Promise<void> {
  const pays = await getAll<{ id: string; cardId: string }>('payments')
  for (const p of pays.filter((x) => x.cardId === cardId)) await remove('payments', p.id)
  await remove('cards', cardId)
}
