/**
 * pet-health —— IndexedDB 数据层（多宠隔离；图片 Blob 单独分表）。
 */
import type { CarePlan, HealthEvent, Pet, PhotoRecord } from './models'
import { PLAN_TEMPLATES, createId, today } from './models'

const DB_NAME = 'fangzi-pet-health'
const DB_VERSION = 1

type StoreName = 'pets' | 'events' | 'photos' | 'plans'

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
      if (!db.objectStoreNames.contains('pets')) db.createObjectStore('pets', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('events')) {
        const s = db.createObjectStore('events', { keyPath: 'id' })
        s.createIndex('petId', 'petId', { unique: false })
        s.createIndex('date', 'date', { unique: false })
      }
      if (!db.objectStoreNames.contains('photos')) {
        const s = db.createObjectStore('photos', { keyPath: 'id' })
        s.createIndex('petId', 'petId', { unique: false })
      }
      if (!db.objectStoreNames.contains('plans')) {
        const s = db.createObjectStore('plans', { keyPath: 'id' })
        s.createIndex('petId', 'petId', { unique: false })
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

function transaction<T>(store: StoreName, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then((db) => request(run(db.transaction(store, mode).objectStore(store))))
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDB()
  return request(db.transaction(store, 'readonly').objectStore(store).getAll() as IDBRequest<T[]>)
}

export function put<T>(store: StoreName, value: T): Promise<IDBValidKey> {
  return transaction(store, 'readwrite', (s) => s.put(value as unknown as object) as IDBRequest<IDBValidKey>)
}

export function remove(store: StoreName, id: string): Promise<undefined> {
  return transaction(store, 'readwrite', (s) => s.delete(id) as IDBRequest<undefined>)
}

export function getOne<T>(store: StoreName, id: string): Promise<T | undefined> {
  return transaction(store, 'readonly', (s) => s.get(id) as IDBRequest<T | undefined>)
}

/** 新建宠物时，同时为其写入默认照护计划（每月驱虫、年度疫苗，可随后停用/改期）。 */
export async function createPetWithPlans(input: Omit<Pet, 'id' | 'createdAt'>): Promise<Pet> {
  const pet: Pet = { ...input, id: createId('pet'), createdAt: Date.now() }
  await put('pets', pet)
  const start = pet.birthday || today()
  for (const tpl of PLAN_TEMPLATES) {
    const plan: CarePlan = {
      id: createId('plan'),
      petId: pet.id,
      planKey: tpl.key,
      enabled: true,
      intervalDays: tpl.intervalDays,
      startDate: start
    }
    await put('plans', plan)
  }
  return pet
}

/** 删除宠物：连带删除其事件、计划与照片（释放本地存储）。 */
export async function deletePetCascade(petId: string): Promise<void> {
  const events = await getAll<HealthEvent>('events')
  const photos = await getAll<PhotoRecord>('photos')
  const plans = await getAll<CarePlan>('plans')
  for (const e of events.filter((x) => x.petId === petId)) await remove('events', e.id)
  for (const p of photos.filter((x) => x.petId === petId)) await remove('photos', p.id)
  for (const p of plans.filter((x) => x.petId === petId)) await remove('plans', p.id)
  await remove('pets', petId)
}

/** 全库导出用：一次读出四类记录（photos 单独转 base64，见 backup.ts）。 */
export async function dumpAll(): Promise<{
  pets: Pet[]
  events: HealthEvent[]
  plans: CarePlan[]
  photos: PhotoRecord[]
}> {
  const [pets, events, plans, photos] = await Promise.all([
    getAll<Pet>('pets'),
    getAll<HealthEvent>('events'),
    getAll<CarePlan>('plans'),
    getAll<PhotoRecord>('photos')
  ])
  return { pets, events, plans, photos }
}
