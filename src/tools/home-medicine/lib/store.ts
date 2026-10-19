/**
 * home-medicine —— IndexedDB 数据层（members / meds）。写库前深度 toRaw。
 */
import { toRaw } from 'vue'
import type { Med, Member } from './models'

const DB_NAME = 'fangzi-home-medicine'
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
      if (!db.objectStoreNames.contains('members')) {
        db.createObjectStore('members', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('meds')) {
        const s = db.createObjectStore('meds', { keyPath: 'id' })
        s.createIndex('memberId', 'memberId', { unique: false })
        s.createIndex('active', 'active', { unique: false })
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

export async function getAllMembers(): Promise<Member[]> {
  const db = await openDB()
  const list = await request(db.transaction('members', 'readonly').objectStore('members').getAll() as IDBRequest<Member[]>)
  return list.sort((a, b) => a.createdAt - b.createdAt)
}

export function putMember(value: Member): Promise<IDBValidKey> {
  return openDB().then((db) =>
    request(db.transaction('members', 'readwrite').objectStore('members').put(toPlain(value) as object) as IDBRequest<IDBValidKey>)
  )
}

export function removeMember(id: string): Promise<undefined> {
  return openDB().then((db) => request(db.transaction('members', 'readwrite').objectStore('members').delete(id) as IDBRequest<undefined>))
}

export async function getAllMeds(): Promise<Med[]> {
  const db = await openDB()
  const list = await request(db.transaction('meds', 'readonly').objectStore('meds').getAll() as IDBRequest<Med[]>)
  return list.sort((a, b) => b.createdAt - a.createdAt)
}

export function putMed(value: Med): Promise<IDBValidKey> {
  return openDB().then((db) =>
    request(db.transaction('meds', 'readwrite').objectStore('meds').put(toPlain(value) as object) as IDBRequest<IDBValidKey>)
  )
}

export function removeMed(id: string): Promise<undefined> {
  return openDB().then((db) => request(db.transaction('meds', 'readwrite').objectStore('meds').delete(id) as IDBRequest<undefined>))
}

/** 删除成员时级联删除其药品 */
export async function removeMemberCascade(id: string): Promise<void> {
  const db = await openDB()
  const meds = await request(
    db.transaction('meds', 'readonly').objectStore('meds').index('memberId').getAll(id) as IDBRequest<Med[]>
  )
  const tx = db.transaction(['members', 'meds'], 'readwrite')
  tx.objectStore('members').delete(id)
  const medStore = tx.objectStore('meds')
  for (const m of meds) medStore.delete(m.id)
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('删除成员失败'))
  })
}
