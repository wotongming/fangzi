/**
 * 程序化生成行光阅读器图标 16/48/128（无外部素材、无版权字体）。
 * 蓝→橙 行光渐变 + 三行横条寓意阅读行。纯 Node zlib 编码 PNG。
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'plugins-src/line-light-reader/icons')
mkdirSync(OUT, { recursive: true })

function crc32(buf) {
  let table = crc32.table
  if (!table) {
    table = crc32.table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c
    }
  }
  let c = 0xffffffff
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function render(size) {
  const px = size
  const raw = Buffer.alloc(px * (1 + px * 4))
  for (let y = 0; y < px; y++) {
    raw[y * (1 + px * 4)] = 0 // filter none
    for (let x = 0; x < px; x++) {
      const i = y * (1 + px * 4) + 1 + x * 4
      const dx = x - px / 2, dy = y - px / 2
      const d = Math.sqrt(dx * dx + dy * dy) / (px / 2)
      let a = 0
      if (d <= 1) a = 255
      // 三行横条
      const rows = [0.3, 0.5, 0.7]
      const onRow = rows.some((r) => Math.abs(y / px - r) < 0.06 && x / px > 0.22 && x / px < 0.78)
      const t = x / px // 蓝→橙
      const hue = 210 - 182 * t
      let R, G, B
      if (onRow) {
        // HSL-ish 简化：hue 210 蓝 → 28 橙
        if (hue > 120) { R = 90; G = 170; B = 255 } else { R = 255; G = 170; B = 90 }
      } else { R = 22; G = 33; B = 62 }
      raw[i] = R; raw[i + 1] = G; raw[i + 2] = B; raw[i + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(px, 0); ihdr.writeUInt32BE(px, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
  writeFileSync(join(OUT, `icon${size}.png`), png)
}

;[16, 48, 128].forEach(render)
console.log('icons written to', OUT)
