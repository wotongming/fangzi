/**
 * 生成最小合法 PNG（用于本地验证与截图），无第三方依赖，zlib 用 Node 内置。
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return (~c) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

export function makePng(width, height, rgb) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type RGB
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  // raw: each row prefixed with filter byte 0
  const raw = Buffer.alloc(height * (1 + width * 3))
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3)
    raw[row] = 0
    for (let x = 0; x < width; x++) {
      const off = row + 1 + x * 3
      raw[off] = rgb[0]
      raw[off + 1] = rgb[1]
      raw[off + 2] = rgb[2]
    }
  }
  const idat = deflateSync(raw, { level: 6 })
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = join(dirname(fileURLToPath(import.meta.url)), '../tmp-test-img')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'sample-red-128.png'), makePng(128, 128, [220, 60, 60]))
  writeFileSync(join(outDir, 'sample-blue-64.png'), makePng(64, 64, [40, 90, 220]))
  writeFileSync(join(outDir, 'sample-green-32.png'), makePng(32, 32, [60, 180, 90]))
  console.log('wrote test images to', outDir)
}
