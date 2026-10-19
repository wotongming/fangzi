/**
 * home-medicine —— 备份包的口令加密 / 解密（浏览器原生 Web Crypto，AES-GCM + PBKDF2）。
 * 仅用于用户主动导出的本地家庭档案；数据不离开设备，无任何服务器参与。
 */

interface Envelope {
  v: 1
  alg: 'PBKDF2-SHA256/AES-GCM-256'
  iters: number
  saltB64: string
  ivB64: string
  ctB64: string
}

function enc(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('当前浏览器不支持 Web Crypto，无法加密导出')
  return subtle
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

async function deriveKey(password: string, salt: Uint8Array, iters: number): Promise<CryptoKey> {
  const base = await enc().importKey('raw', new TextEncoder().encode(password) as BufferSource, 'PBKDF2', false, ['deriveKey'])
  return enc().deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: iters, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function exportEncrypted(data: unknown, password: string): Promise<string> {
  const iters = 100000
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

export async function importEncrypted<T>(payload: string, password: string): Promise<T> {
  const env = JSON.parse(payload) as Envelope
  if (!env || env.v !== 1 || env.alg !== 'PBKDF2-SHA256/AES-GCM-256') throw new Error('无法识别的备份文件')
  const key = await deriveKey(password, b64ToBytes(env.saltB64), env.iters)
  const plain = await enc().decrypt(
    { name: 'AES-GCM', iv: b64ToBytes(env.ivB64) as BufferSource },
    key,
    b64ToBytes(env.ctB64) as BufferSource
  )
  return JSON.parse(new TextDecoder().decode(plain)) as T
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
