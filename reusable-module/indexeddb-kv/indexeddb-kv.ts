/**
 * indexeddb-kv —— 通用 IndexedDB KV 封装（零依赖，TypeScript）
 *
 * 提供：单例连接、request/transaction 包装、按主键增删改查、全表读取、
 * 清空、按索引范围查询。适合 PWA / 纯前端本地存储类工具复用。
 * 参考实现：方子家庭财务管家 store.ts（ledgers/categories/budgets 三表）。
 */

export interface IndexedDBStoreSpec {
  /** 对象仓库名 */
  storeName: string
  /** 主键路径，如 'id' */
  keyPath: string
  /** 可选索引：[索引名, 索引键路径][] */
  indexes?: Array<[string, string]>
}

export interface IndexedDBConfig {
  dbName: string
  version: number
  stores: IndexedDBStoreSpec[]
}

let dbPromise: Promise<IDBDatabase> | null = null

/** 打开（或复用）数据库连接；onupgradeneeded 按 spec 建表建索引 */
export function openIndexedDB(cfg: IndexedDBConfig): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前环境不支持 IndexedDB，请使用现代浏览器'))
      return
    }
    const req = indexedDB.open(cfg.dbName, cfg.version)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const spec of cfg.stores) {
        if (!db.objectStoreNames.contains(spec.storeName)) {
          const store = db.createObjectStore(spec.storeName, { keyPath: spec.keyPath })
          for (const [name, keyPath] of spec.indexes ?? []) {
            store.createIndex(name, keyPath, { unique: false })
          }
        }
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('打开本地数据库失败'))
  })
  return dbPromise
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('数据库操作失败'))
  })
}

/** 单仓读写事务包装 */
export function tx<T>(
  cfg: IndexedDBConfig,
  storeName: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openIndexedDB(cfg).then((db) => {
    const t = db.transaction(storeName, mode)
    return request(run(t.objectStore(storeName)))
  })
}

/** 写入（按主键新增或覆盖） */
export function putValue<V>(cfg: IndexedDBConfig, storeName: string, value: V): Promise<IDBValidKey> {
  return tx(cfg, storeName, 'readwrite', (s) => s.put(value))
}

/** 按主键读取单条 */
export function getValue<V>(cfg: IndexedDBConfig, storeName: string, id: IDBValidKey): Promise<V | undefined> {
  return tx(cfg, storeName, 'readonly', (s) => s.get(id))
}

/** 读取全表 */
export function getAllValues<V>(cfg: IndexedDBConfig, storeName: string): Promise<V[]> {
  return tx(cfg, storeName, 'readonly', (s) => s.getAll())
}

/** 按主键删除单条 */
export function removeValue(cfg: IndexedDBConfig, storeName: string, id: IDBValidKey): Promise<undefined> {
  return tx(cfg, storeName, 'readwrite', (s) => s.delete(id))
}

/** 清空表 */
export function clearValues(cfg: IndexedDBConfig, storeName: string): Promise<undefined> {
  return tx(cfg, storeName, 'readwrite', (s) => s.clear())
}

/** 按索引范围查询（start/end 含边界；省略则不限） */
export function listByIndex<V>(
  cfg: IndexedDBConfig,
  storeName: string,
  indexName: string,
  start?: IDBValidKey,
  end?: IDBValidKey
): Promise<V[]> {
  return openIndexedDB(cfg).then((db) => {
    const t = db.transaction(storeName, 'readonly')
    const idx = t.objectStore(storeName).index(indexName)
    const range = start || end ? IDBKeyRange.bound(start ?? '', end ?? '\uffff', !start, !end) : undefined
    return request(range ? idx.getAll(range) : idx.getAll())
  })
}

/** 示例：家庭账本风格三表配置 */
export const EXAMPLE_CFG: IndexedDBConfig = {
  dbName: 'example-kv',
  version: 1,
  stores: [
    {
      storeName: 'items',
      keyPath: 'id',
      indexes: [
        ['date', 'date'],
        ['category', 'category']
      ]
    }
  ]
}
