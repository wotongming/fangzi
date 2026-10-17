import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readMetaFromBuffer } from '../src/tools/photo-privacy/lib/exif'
import { stripName, safeName, extForMime } from '../src/tools/photo-privacy/lib/naming'
import { rectToPixels, type Mask } from '../src/tools/photo-privacy/lib/redact'

// ---------- 构造带已知 EXIF/GPS 的最小 JPEG ----------
function putU16LE(b: Uint8Array, o: number, v: number): void {
  b[o] = v & 0xff
  b[o + 1] = (v >> 8) & 0xff
}
function putU32LE(b: Uint8Array, o: number, v: number): void {
  b[o] = v & 0xff
  b[o + 1] = (v >> 8) & 0xff
  b[o + 2] = (v >> 16) & 0xff
  b[o + 3] = (v >> 24) & 0xff
}
// IFD 条目（LE）
function entry(b: Uint8Array, o: number, tag: number, type: number, count: number, value: number | string): void {
  putU16LE(b, o, tag)
  putU16LE(b, o + 2, type)
  putU32LE(b, o + 4, count)
  if (typeof value === 'number') {
    putU32LE(b, o + 8, value)
  } else {
    putU32LE(b, o + 8, Number(value))
  }
}

function buildExifJpeg(): ArrayBuffer {
  // 预布局（相对 TIFF 起点）
  const IFD0 = 8
  const MAKE_OFF = 74
  const MODEL_OFF = 80
  const DATE_OFF = 87
  const LAT_RAT = 107
  const LNG_RAT = 131
  const EXIF_IFD = 156
  const GPS_IFD = 174
  const TOTAL = 228
  const tiff = new Uint8Array(TOTAL)
  // TIFF 头
  tiff[0] = 0x49
  tiff[1] = 0x49
  putU16LE(tiff, 2, 0x002a)
  putU32LE(tiff, 4, IFD0)
  // IFD0：5 条
  putU16LE(tiff, IFD0, 5)
  let e = IFD0 + 2
  entry(tiff, e, 0x010f, 2, 6, MAKE_OFF); e += 12 // Make
  entry(tiff, e, 0x0110, 2, 7, MODEL_OFF); e += 12 // Model
  entry(tiff, e, 0x0112, 3, 1, 6); e += 12 // Orientation = 6
  entry(tiff, e, 0x8769, 4, 1, EXIF_IFD); e += 12 // ExifIFD ptr
  entry(tiff, e, 0x8825, 4, 1, GPS_IFD); e += 12 // GPSIFD ptr
  putU32LE(tiff, e, 0) // next IFD = 0
  // 字符串
  const setStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) tiff[off + i] = s.charCodeAt(i)
    tiff[off + s.length] = 0
  }
  setStr(MAKE_OFF, 'Apple')
  setStr(MODEL_OFF, 'iPhone')
  setStr(DATE_OFF, '2026:10:17 12:00:00')
  // 有理数（num,den 各 u32）：lat 32,3,4.5(9/2)；lng 118,45,30
  const rat = (off: number, n: number, d: number) => {
    putU32LE(tiff, off, n)
    putU32LE(tiff, off + 4, d)
  }
  rat(LAT_RAT, 32, 1); rat(LAT_RAT + 8, 3, 1); rat(LAT_RAT + 16, 9, 2)
  rat(LNG_RAT, 118, 1); rat(LNG_RAT + 8, 45, 1); rat(LNG_RAT + 16, 30, 1)
  // Exif IFD
  putU16LE(tiff, EXIF_IFD, 1)
  entry(tiff, EXIF_IFD + 2, 0x9003, 2, 20, DATE_OFF)
  putU32LE(tiff, EXIF_IFD + 2 + 12, 0)
  // GPS IFD
  putU16LE(tiff, GPS_IFD, 4)
  let g = GPS_IFD + 2
  // tag1 LatRef ASCII "N" inline
  putU16LE(tiff, g, 1); putU16LE(tiff, g + 2, 2); putU32LE(tiff, g + 4, 2)
  tiff[g + 8] = 0x4e; tiff[g + 9] = 0
  g += 12
  entry(tiff, g, 2, 5, 3, LAT_RAT); g += 12
  putU16LE(tiff, g, 3); putU16LE(tiff, g + 2, 2); putU32LE(tiff, g + 4, 2)
  tiff[g + 8] = 0x45; tiff[g + 9] = 0
  g += 12
  entry(tiff, g, 4, 5, 3, LNG_RAT); g += 12
  putU32LE(tiff, g, 0)

  // 包成 JPEG APP1
  const payload = 6 + tiff.length
  const segLen = 2 + payload
  const out = new Uint8Array(2 + 2 + segLen)
  out[0] = 0xff; out[1] = 0xd8
  out[2] = 0xff; out[3] = 0xe1
  out[4] = (segLen >> 8) & 0xff
  out[5] = segLen & 0xff
  const sig = [0x45, 0x78, 0x69, 0x66, 0, 0]
  out.set(sig, 6)
  out.set(tiff, 12)
  return out.buffer
}

test('EXIF：正确解析 GPS/时间/设备/方向（小端）', () => {
  const info = readMetaFromBuffer(buildExifJpeg())
  assert.equal(info.kind, 'jpeg')
  assert.equal(info.hasMeta, true)
  assert.equal(info.make, 'Apple')
  assert.equal(info.model, 'iPhone')
  assert.equal(info.orientation, 6)
  assert.equal(info.dateTime, '2026:10:17 12:00:00')
  assert.ok(info.gps)
  assert.ok(Math.abs(info.gps!.lat - (32 + 3 / 60 + 4.5 / 3600)) < 1e-9)
  assert.ok(Math.abs(info.gps!.lng - (118 + 45 / 60 + 30 / 3600)) < 1e-9)
  assert.ok(info.risks.includes('精确 GPS 定位'))
  assert.ok(info.risks.includes('设备品牌型号'))
})

test('EXIF：无 APP1 / 空文件容错不抛', () => {
  const bare = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 0]).buffer
  const info = readMetaFromBuffer(bare)
  assert.equal(info.kind, 'jpeg')
  assert.equal(info.hasMeta, false)
  assert.deepEqual(info.risks, [])
  const empty = readMetaFromBuffer(new ArrayBuffer(0))
  assert.equal(empty.kind, 'unsupported')
})

test('PNG：识别尺寸与文本块元数据', () => {
  const chunks: number[] = []
  const push32 = (v: number) => chunks.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255)
  const pushStr = (s: string) => {
    for (const c of s) chunks.push(c.charCodeAt(0))
  }
  const chunk = (type: string, data: number[]) => {
    push32(data.length)
    pushStr(type)
    chunks.push(...data)
    chunks.push(0, 0, 0, 0) // CRC 不校验
  }
  const ihdr: number[] = []
  const wv = 1920
  const hv = 1080
  ihdr.push((wv >>> 24) & 255, (wv >>> 16) & 255, (wv >>> 8) & 255, wv & 255)
  ihdr.push((hv >>> 24) & 255, (hv >>> 16) & 255, (hv >>> 8) & 255, hv & 255)
  for (let i = 0; i < 9; i++) ihdr.push(8)
  chunk('IHDR', ihdr)
  const text: number[] = []
  pushStrInto(text, 'Software')
  text.push(0)
  pushStrInto(text, 'SomeEditor')
  chunk('tEXt', text)
  function pushStrInto(arr: number[], s: string) {
    for (const c of s) arr.push(c.charCodeAt(0))
  }
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  const buf = new Uint8Array([...sig, ...chunks]).buffer
  const info = readMetaFromBuffer(buf)
  assert.equal(info.kind, 'png')
  assert.equal(info.width, 1920)
  assert.equal(info.height, 1080)
  assert.equal(info.hasMeta, true)
})

test('文件名：清洗时间戳/品牌/序号，扩展名随输出格式', () => {
  assert.equal(extForMime('image/webp'), 'webp')
  const stem = stripName('IMG_20260101_120000_042.jpg')
  assert.ok(!/\d/.test(stem), `基名不应含数字，实际：${stem}`)
  assert.equal(stripName('DSC0042.png'), 'photo')
  const used = new Set<string>()
  const n1 = safeName('IMG_20260101_x.jpg', 'image/webp', { prefix: 'item', used })
  assert.ok(n1.startsWith('item-') && n1.endsWith('.webp'))
  const n2 = safeName('a.jpg', 'image/jpeg', { clean: false, random: false, used })
  assert.ok(n2.endsWith('.jpg'))
})

test('打码：归一化矩形正确换算到像素并裁剪', () => {
  const m: Mask = { id: '1', shape: 'rect', coords: [0.25, 0.5, 0.75, 1.5] }
  const r = rectToPixels(m, 100, 200)
  assert.deepEqual(r, { x: 25, y: 100, w: 50, h: 100 })
  const tiny: Mask = { id: '2', shape: 'rect', coords: [0.1, 0.1, 0.1001, 0.1001] }
  // 极小但为正
  assert.ok(rectToPixels(tiny, 10000, 10000)!.w >= 1)
})
