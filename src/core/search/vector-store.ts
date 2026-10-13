/**
 * 向量持久化缓存：浏览器用 IndexedDB，Node / 隐私模式等不可用环境自动降级内存。
 * 缓存按 model 命名空间隔离，文本内容变更（hash 变化）会自动重新嵌入。
 */

import { fnv1a } from './embedding'

const DB_NAME = 'fangzi-vectors'
const STORE = 'vectors'
const DB_VERSION = 1

type VectorRow = { key: string; vector: number[] }

interface KVStore {
  get(key: string): Promise<number[] | undefined>
  set(key: string, vector: number[]): Promise<void>
  setMany(rows: VectorRow[]): Promise<void>
}

function keyOf(model: string, text: string): string {
  return `${model}::${fnv1a(text)}::${text.length}`
}

class MemoryStore implements KVStore {
  private map = new Map<string, number[]>()
  async get(key: string) {
    return this.map.get(key)
  }
  async set(key: string, vector: number[]) {
    this.map.set(key, vector)
  }
  async setMany(rows: VectorRow[]) {
    for (const r of rows) this.map.set(r.key, r.vector)
  }
}

class IDBStore implements KVStore {
  private dbPromise: Promise<IDBDatabase>
  constructor() {
    this.dbPromise = this.open()
  }
  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'key' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  async get(key: string): Promise<number[] | undefined> {
    const db = await this.dbPromise
    return new Promise<number[] | undefined>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      req.onsuccess = () => resolve((req.result as VectorRow | undefined)?.vector)
      req.onerror = () => reject(req.error)
    })
  }
  async set(key: string, vector: number[]) {
    const db = await this.dbPromise
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(STORE, 'readwrite')
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error)
      t.objectStore(STORE).put({ key, vector })
    })
  }
  async setMany(rows: VectorRow[]) {
    const db = await this.dbPromise
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(STORE, 'readwrite')
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error)
      const store = t.objectStore(STORE)
      for (const row of rows) store.put(row)
    })
  }
}

function createStore(): KVStore {
  if (typeof indexedDB !== 'undefined') {
    try {
      return new IDBStore()
    } catch {
      return new MemoryStore()
    }
  }
  return new MemoryStore()
}

export class VectorCache {
  private store: KVStore = createStore()
  /** 进程内热缓存，避免重复异步读取 */
  private hot = new Map<string, number[]>()

  async get(model: string, text: string): Promise<number[] | undefined> {
    const key = keyOf(model, text)
    const hotHit = this.hot.get(key)
    if (hotHit) return hotHit
    const v = await this.store.get(key)
    if (v) this.hot.set(key, v)
    return v
  }

  async set(model: string, text: string, vector: number[]) {
    const key = keyOf(model, text)
    this.hot.set(key, vector)
    await this.store.set(key, vector)
  }

  async setMany(model: string, items: Array<{ text: string; vector: number[] }>) {
    const rows: VectorRow[] = items.map(({ text, vector }) => {
      const key = keyOf(model, text)
      this.hot.set(key, vector)
      return { key, vector }
    })
    await this.store.setMany(rows)
  }
}
