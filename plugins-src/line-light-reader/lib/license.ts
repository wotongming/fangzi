/**
 * license.ts —— Pro 许可本地验签（ECDSA P-256 / ES256，WebCrypto 全平台稳定）。
 * 扩展只内置公钥，无授权服务器、无联网、无账号。beta 期默认全部功能可用，验签仅作预留开关。
 */

const PUBLIC_KEY_B64 = ''

export interface LicenseResult { ok: boolean; tier: string; reason?: string }

function b64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out.buffer
}

async function importKey(): Promise<CryptoKey | null> {
  if (!PUBLIC_KEY_B64) return null
  return crypto.subtle.importKey(
    'spki',
    b64ToBuf(PUBLIC_KEY_B64),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  )
}

export async function verifyLicense(code: string): Promise<LicenseResult> {
  const key = await importKey()
  if (!key) return { ok: false, tier: 'free', reason: 'beta' }
  if (!code) return { ok: false, tier: 'free' }
  const parts = code.replace(/\s/g, '').split('-')
  if (parts[0] !== 'LLR' || parts.length < 3) return { ok: false, tier: 'free', reason: 'format' }
  try {
    const payload = Uint8Array.from(atob(parts[1]), (c) => c.charCodeAt(0))
    const sig = Uint8Array.from(atob(parts[2]), (c) => c.charCodeAt(0))
    const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, payload)
    const tier = new TextDecoder().decode(payload)
    return valid ? { ok: true, tier } : { ok: false, tier: 'free', reason: 'bad-sig' }
  } catch {
    return { ok: false, tier: 'free', reason: 'decode' }
  }
}
