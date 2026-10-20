/**
 * crypto.ts —— 备份包口令加密 / 解密（浏览器原生 Web Crypto，PBKDF2-SHA256 + AES-GCM-256）。
 * 密钥由用户口令在本机派生，不出设备、无服务器参与；信封格式沿用 home-medicine 成熟实现。
 * 迭代次数可注入（默认 100000），单测传小值避免拖慢。
 */

export interface Envelope {
  v: 1
  alg: 'PBKDF2-SHA256/AES-GCM-256'
  iters: number
  saltB64: string
  ivB64: string
  ctB64: string
}

export const DEFAULT_ITERS = 100_000

function enc(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('当前环境不支持 Web Crypto，无法加密导出')
  return subtle
}

// —— base64 / bytes / Blob 往返（Node 与浏览器均可跑） ——

export function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function blobToB64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  return bytesToB64(buf)
}

export function b64ToBlob(b64: string, mime: string): Blob {
  const bytes = b64ToBytes(b64)
  return new Blob([bytes as unknown as BlobPart], { type: mime || 'image/jpeg' })
}

// —— 密钥派生与加解密 ——

async function deriveKey(password: string, salt: Uint8Array, iters: number): Promise<CryptoKey> {
  const base = await enc().importKey(
    'raw',
    new TextEncoder().encode(password) as BufferSource,
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return enc().deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: iters, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

/** 加密任意可 JSON 序列化数据，返回信封 JSON 字符串。 */
export async function exportEncrypted(data: unknown, password: string, iters: number = DEFAULT_ITERS): Promise<string> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16))
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt, iters)
  const ct = new Uint8Array(
    await enc().encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      new TextEncoder().encode(JSON.stringify(data)) as BufferSource
    )
  )
  const env: Envelope = {
    v: 1,
    alg: 'PBKDF2-SHA256/AES-GCM-256',
    iters,
    saltB64: bytesToB64(salt),
    ivB64: bytesToB64(iv),
    ctB64: bytesToB64(ct)
  }
  return JSON.stringify(env)
}

/** 解密信封；口令错误或文件损坏抛可识别错误。 */
export async function importEncrypted<T>(payload: string, password: string): Promise<T> {
  let env: Envelope
  try {
    env = JSON.parse(payload) as Envelope
  } catch {
    throw new Error('无法识别的备份文件')
  }
  if (!env || env.v !== 1 || env.alg !== 'PBKDF2-SHA256/AES-GCM-256') {
    throw new Error('无法识别的备份文件')
  }
  try {
    const key = await deriveKey(password, b64ToBytes(env.saltB64), env.iters)
    const plain = await enc().decrypt(
      { name: 'AES-GCM', iv: b64ToBytes(env.ivB64) as BufferSource },
      key,
      b64ToBytes(env.ctB64) as BufferSource
    )
    return JSON.parse(new TextDecoder().decode(plain)) as T
  } catch {
    throw new Error('口令错误或备份文件已损坏')
  }
}

export function downloadText(text: string, filename: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
