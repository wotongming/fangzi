/**
 * 家庭财务管家 —— IndexedDB 数据层
 *
 * 账目 / 分类 / 预算 CRUD；导出 / 导入备份（支持可选 AES-GCM 加密，订阅高级功能）。
 * 首次打开时自动写入内置分类种子。所有读写均为异步，失败抛出可读错误。
 */
import type { LedgerEntry, Category } from './ledger'
import { DEFAULT_CATEGORIES } from './ledger'
import type { Budget } from './budget'

const DB_NAME = 'fangzi-household-finance'
const DB_VERSION = 1

interface Stores {
  ledgers: LedgerEntry
  categories: Category
  budgets: Budget
}

type StoreName = keyof Stores

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
      if (!db.objectStoreNames.contains('ledgers')) {
        const store = db.createObjectStore('ledgers', { keyPath: 'id' })
        store.createIndex('date', 'date', { unique: false })
        store.createIndex('category', 'category', { unique: false })
      }
      if (!db.objectStoreNames.contains('categories')) {
        db.createObjectStore('categories', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('budgets')) {
        db.createObjectStore('budgets', { keyPath: 'id' })
      }
    }
    req.onsuccess = () => {
      const db = req.result
      seedCategories(db).catch(() => undefined)
      resolve(db)
    }
    req.onerror = () => reject(req.error ?? new Error('打开本地数据库失败'))
  })
  return dbPromise
}

/** 首次使用：写入内置分类（仅当分类表为空） */
async function seedCategories(db: IDBDatabase): Promise<void> {
  const tx = db.transaction('categories', 'readwrite')
  const store = tx.objectStore('categories')
  const countReq = store.count()
  countReq.onsuccess = () => {
    if (countReq.result === 0) {
      for (const c of DEFAULT_CATEGORIES) store.add(c)
    }
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('初始化分类失败'))
  })
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('数据库操作失败'))
  })
}

function transaction<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDB().then((db) => {
    const tx = db.transaction(store, mode)
    return request(run(tx.objectStore(store)))
  })
}

/** 读取全部记录（按主键） */
export function getAll<T extends keyof Stores>(store: T): Promise<Stores[T][]> {
  return openDB().then((db) => {
    const tx = db.transaction(store, 'readonly')
    return request(tx.objectStore(store).getAll())
  })
}

/** 读取单条 */
export function getOne<T extends keyof Stores>(store: T, id: string): Promise<Stores[T] | undefined> {
  return transaction(store, 'readonly', (s) => s.get(id))
}

/** 写入（新增或覆盖） */
export function put<T extends keyof Stores>(store: T, value: Stores[T]): Promise<IDBValidKey> {
  return transaction(store, 'readwrite', (s) => s.put(value))
}

/** 删除单条 */
export function remove<T extends keyof Stores>(store: T, id: string): Promise<undefined> {
  return transaction(store, 'readwrite', (s) => s.delete(id))
}

/** 清空某表 */
export function clearStore<T extends keyof Stores>(store: T): Promise<undefined> {
  return transaction(store, 'readwrite', (s) => s.clear())
}

/** 按日期范围读取账目（start/end 为 YYYY-MM-DD，含边界；省略则不限） */
export function listLedgersByDate(start?: string, end?: string): Promise<LedgerEntry[]> {
  return openDB().then((db) => {
    const tx = db.transaction('ledgers', 'readonly')
    const store = tx.objectStore('ledgers')
    const idx = store.index('date')
    const range = start || end ? IDBKeyRange.bound(start ?? '', end ?? '\uffff', !start, !end) : undefined
    return request(range ? idx.getAll(range) : idx.getAll())
  })
}

// —— 备份：明文导出 / 导入 ——

export interface BackupPayload {
  kind: 'fangzi-household-finance-backup'
  version: 1
  exportedAt: string
  ledgers: LedgerEntry[]
  categories: Category[]
  budgets: Budget[]
}

export function isBackupPayload(v: unknown): v is BackupPayload {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as BackupPayload).kind === 'fangzi-household-finance-backup' &&
    (v as BackupPayload).version === 1 &&
    Array.isArray((v as BackupPayload).ledgers) &&
    Array.isArray((v as BackupPayload).categories) &&
    Array.isArray((v as BackupPayload).budgets)
  )
}

/** 导出全部数据为 JSON 字符串（明文） */
export async function exportBackup(): Promise<string> {
  const [ledgers, categories, budgets] = await Promise.all([
    getAll('ledgers'),
    getAll('categories'),
    getAll('budgets')
  ])
  const payload: BackupPayload = {
    kind: 'fangzi-household-finance-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    ledgers,
    categories,
    budgets
  }
  return JSON.stringify(payload)
}

/** 导入备份（先清空再写入），返回各表写入条数 */
export async function importBackup(json: string): Promise<{ ledgers: number; categories: number; budgets: number }> {
  let payload: unknown
  try {
    payload = JSON.parse(json)
  } catch {
    throw new Error('备份文件不是合法 JSON')
  }
  if (!isBackupPayload(payload)) throw new Error('不是有效的家庭财务管家备份文件')
  await clearStore('ledgers')
  await clearStore('categories')
  await clearStore('budgets')
  for (const c of payload.categories) await put('categories', c)
  for (const b of payload.budgets) await put('budgets', b)
  for (const e of payload.ledgers) await put('ledgers', e)
  return { ledgers: payload.ledgers.length, categories: payload.categories.length, budgets: payload.budgets.length }
}

// —— 可选加密备份（订阅高级功能：AES-GCM + PBKDF2）——

const ENC_SALT_BYTES = 16
const ENC_IV_BYTES = 12

/** 用口令加密备份文本；输出 base64（结构：salt|iv|cipher） */
export async function encryptBackup(json: string, passphrase: string): Promise<string> {
  const enc = new TextEncoder()
  const salt = crypto.getRandomValues(new Uint8Array(ENC_SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(ENC_IV_BYTES))
  const key = await deriveKey(passphrase, salt)
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(json))
  const buf = new Uint8Array(salt.length + iv.length + cipher.byteLength)
  buf.set(salt, 0)
  buf.set(iv, salt.length)
  buf.set(new Uint8Array(cipher), salt.length + iv.length)
  return base64FromBytes(buf)
}

/** 解密加密备份文本为 JSON 字符串；口令错误抛错 */
export async function decryptBackup(b64: string, passphrase: string): Promise<string> {
  const buf = bytesFromBase64(b64)
  if (buf.length < ENC_SALT_BYTES + ENC_IV_BYTES + 16) throw new Error('备份数据不完整或已损坏')
  const salt = buf.slice(0, ENC_SALT_BYTES)
  const iv = buf.slice(ENC_SALT_BYTES, ENC_SALT_BYTES + ENC_IV_BYTES)
  const cipher = buf.slice(ENC_SALT_BYTES + ENC_IV_BYTES)
  const key = await deriveKey(passphrase, salt)
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher)
    return new TextDecoder().decode(plain)
  } catch {
    throw new Error('口令错误或备份已损坏，无法解密')
  }
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 120_000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

function base64FromBytes(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

function bytesFromBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}
