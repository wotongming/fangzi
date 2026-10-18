/**
 * backup.ts —— 家庭档案包：导出/导入（含照片），可选口令加密（AES-GCM + PBKDF2）。
 * 照片 JPEG 已压缩，base64 内联进单文件，便于换机与家人协作；不做云端账号。
 */
import { dumpAll, getAll, put } from './store'
import type { CarePlan, HealthEvent, Pet, PhotoRecord } from './models'

const KIND = 'fangzi-pet-health-backup'

interface PhotoPayload extends Omit<PhotoRecord, 'blob'> {
  dataB64: string
}
interface BackupJson {
  kind: typeof KIND
  version: 1
  exportedAt: string
  pets: Pet[]
  events: HealthEvent[]
  plans: CarePlan[]
  photos: PhotoPayload[]
}
interface Envelope {
  kind: 'fangzi-pet-health-backup-enc'
  version: 1
  saltB64: string
  ivB64: string
  dataB64: string
}

function blobToB64(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const s = String(reader.result)
      const i = s.indexOf(',')
      resolve(i >= 0 ? s.slice(i + 1) : s)
    }
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.readAsDataURL(blob)
  })
}

function b64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(bin)
}
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function deriveKey(pass: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations: 120_000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

export async function exportPackage(passphrase?: string): Promise<Blob> {
  const all = await dumpAll()
  const photos: PhotoPayload[] = []
  for (const p of all.photos) {
    photos.push({ id: p.id, petId: p.petId, mime: p.mime, width: p.width, height: p.height, bytes: p.bytes, createdAt: p.createdAt, dataB64: await blobToB64(p.blob) })
  }
  const json: BackupJson = { kind: KIND, version: 1, exportedAt: new Date().toISOString(), pets: all.pets, events: all.events, plans: all.plans, photos }
  const text = JSON.stringify(json)

  if (!passphrase) return new Blob([text], { type: 'application/json;charset=utf-8' })

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(passphrase, salt)
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, new TextEncoder().encode(text)))
  const env: Envelope = { kind: 'fangzi-pet-health-backup-enc', version: 1, saltB64: bytesToB64(salt), ivB64: bytesToB64(iv), dataB64: bytesToB64(cipher) }
  return new Blob([JSON.stringify(env)], { type: 'application/json;charset=utf-8' })
}

function isPlain(v: unknown): v is BackupJson {
  return typeof v === 'object' && v !== null && (v as BackupJson).kind === KIND && Array.isArray((v as BackupJson).pets) && Array.isArray((v as BackupJson).photos)
}
function isEnvelope(v: unknown): v is Envelope {
  return typeof v === 'object' && v !== null && (v as Envelope).kind === 'fangzi-pet-health-backup-enc' && !!(v as Envelope).dataB64
}

/** 导入档案包（需口令时传 passphrase）。返回导入计数。采用合并：按主键 put，不先清空，避免误删。 */
export async function importPackage(file: Blob, passphrase?: string): Promise<{ pets: number; events: number; plans: number; photos: number }> {
  const rawText = await file.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    throw new Error('档案包不是合法 JSON 文件')
  }

  let data: BackupJson
  if (isEnvelope(parsed)) {
    if (!passphrase) throw new Error('该档案包已加密，请输入口令')
    const key = await deriveKey(passphrase, b64ToBytes(parsed.saltB64))
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(parsed.ivB64) as BufferSource }, key, b64ToBytes(parsed.dataB64) as BufferSource)
      data = JSON.parse(new TextDecoder().decode(plain)) as BackupJson
    } catch {
      throw new Error('口令错误或档案包已损坏')
    }
  } else if (isPlain(parsed)) {
    data = parsed
  } else {
    throw new Error('不是有效的宠物健康档案包')
  }

  for (const p of data.pets) await put('pets', p)
  for (const pl of data.plans) await put('plans', pl)
  for (const e of data.events) await put('events', e)
  for (const ph of data.photos) {
    const { dataB64, ...meta } = ph
    const rec: PhotoRecord = { ...meta, blob: b64ToBlob(dataB64, ph.mime || 'image/jpeg') }
    await put('photos', rec)
  }
  return { pets: data.pets.length, plans: data.plans.length, events: data.events.length, photos: data.photos.length }
}

/** 触发浏览器下载档案包。 */
export async function downloadPackage(passphrase?: string, filename = 'fangzi-pet-health-backup.json'): Promise<void> {
  const blob = await exportPackage(passphrase)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function photoCount(): Promise<number> {
  return (await getAll<PhotoRecord>('photos')).length
}
