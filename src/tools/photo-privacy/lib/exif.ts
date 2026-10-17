/**
 * exif.ts —— 纯前端、零依赖的图片元数据（EXIF / PNG 文本块）读取。
 *
 * 只“读”用于风险展示，不做修改；真正的剥离由 Canvas 重绘完成（见 process.ts）。
 * 设计为纯函数、对输入容错：任何越界 / 缺标签 / 截断都安全返回已读到的部分，绝不抛断主流程。
 *
 * 授权：MIT（fangzi 内部模块）
 */

export interface GpsInfo {
  lat: number
  lng: number
}

export interface MetaInfo {
  /** 文件实际类别；不支持解码的格式（如 HEIC/RAW）标 unsupported */
  kind: 'jpeg' | 'png' | 'webp' | 'unsupported'
  /** 是否检测到可泄露的元数据（EXIF / XMP / IPTC / PNG 文本块） */
  hasMeta: boolean
  gps?: GpsInfo
  dateTime?: string
  make?: string
  model?: string
  software?: string
  serial?: string
  orientation?: number
  width?: number
  height?: number
  /** 命中的可读风险标签，用于 UI 直接展示 */
  risks: string[]
}

const EMPTY_RISKS: string[] = []

function detectKind(buf: ArrayBuffer): MetaInfo['kind'] {
  const b = new Uint8Array(buf, 0, Math.min(12, buf.byteLength))
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpeg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  // RIFF ???? WEBP
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'webp'
  return 'unsupported'
}

// ---------- JPEG / TIFF ----------

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }

interface TiffCtx {
  view: DataView
  little: boolean
  tiffStart: number
}

function safeAscii(raw: string): string {
  return raw.replace(/\0+$/, '').trim()
}

/** 读取一个 IFD 条目的值（已处理内联 / 偏移、数组），返回原始数字数组或字符串 */
function readEntryValue(ctx: TiffCtx, type: number, count: number, field: number): number[] | string | null {
  const { view, little, tiffStart } = ctx
  const size = (TYPE_SIZE[type] ?? 0) * count
  let valueOffset: number
  if (size <= 4) {
    valueOffset = field // 内联在 4 字节值域内（相对 TIFF 头）
  } else {
    valueOffset = tiffStart + view.getUint32(field, little)
  }
  if (valueOffset < 0 || valueOffset + size > view.buffer.byteLength) return null
  try {
    if (type === 2) {
      let s = ''
      for (let i = 0; i < count; i++) s += String.fromCharCode(view.getUint8(valueOffset + i))
      return safeAscii(s)
    }
    const nums: number[] = []
    for (let i = 0; i < count; i++) {
      const at = valueOffset + i * (TYPE_SIZE[type] ?? 1)
      if (type === 3) nums.push(view.getUint16(at, little))
      else if (type === 4) nums.push(view.getUint32(at, little))
      else if (type === 5 || type === 10) {
        const num = view.getUint32(at, little)
        const den = view.getUint32(at + 4, little)
        nums.push(den === 0 ? 0 : num / den)
      } else if (type === 1 || type === 7) nums.push(view.getUint8(at))
      else if (type === 9) nums.push(view.getInt32(at, little))
    }
    return nums
  } catch {
    return null
  }
}

interface IfdEntries {
  map: Map<number, number[] | string>
  exifPtr?: number
  gpsPtr?: number
}

function readIfd(ctx: TiffCtx, ifdOffset: number): IfdEntries | null {
  const { view, little, tiffStart } = ctx
  const start = tiffStart + ifdOffset
  if (start + 2 > view.buffer.byteLength) return null
  const count = view.getUint16(start, little)
  const map = new Map<number, number[] | string>()
  let exifPtr: number | undefined
  let gpsPtr: number | undefined
  for (let i = 0; i < count; i++) {
    const e = start + 2 + i * 12
    if (e + 12 > view.buffer.byteLength) break
    const tag = view.getUint16(e, little)
    const type = view.getUint16(e + 2, little)
    const cnt = view.getUint32(e + 4, little)
    const val = readEntryValue(ctx, type, cnt, e + 8)
    if (val === null) continue
    if (tag === 0x8769 && Array.isArray(val)) exifPtr = val[0]
    else if (tag === 0x8825 && Array.isArray(val)) gpsPtr = val[0]
    else map.set(tag, val)
  }
  return { map, exifPtr, gpsPtr }
}

function dmsToDecimal(dms: number[], ref: string | undefined): number | undefined {
  if (dms.length < 3) return undefined
  const dec = dms[0]! + dms[1]! / 60 + dms[2]! / 3600
  return ref === 'S' || ref === 'W' ? -dec : dec
}

function parseJpegExif(buf: ArrayBuffer, info: MetaInfo): void {
  const view = new DataView(buf)
  if (buf.byteLength < 4) return
  let offset = 2 // 跳过 SOI
  while (offset + 4 <= buf.byteLength) {
    if (view.getUint8(offset) !== 0xff) break
    const marker = view.getUint16(offset, false)
    if (marker === 0xffda) break // SOS：图像数据开始，停止
    const segLen = view.getUint16(offset + 2, false)
    if (segLen < 2 || offset + 2 + segLen > buf.byteLength) break
    // APP1 = 0xFFE1，且以 "Exif\0\0" 开头
    if (marker === 0xffe1) {
      const p = offset + 4
      const sig = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]
      if (sig.every((v, i) => view.getUint8(p + i) === v)) {
        parseTiff(buf, p + 6, info)
        return
      }
    }
    offset += 2 + segLen
  }
}

function parseTiff(buf: ArrayBuffer, tiffStart: number, info: MetaInfo): void {
  try {
    const view = new DataView(buf)
    if (tiffStart + 8 > buf.byteLength) return
    const bo = view.getUint16(tiffStart, false)
    const little = bo === 0x4949
    if (view.getUint16(tiffStart + 2, little) !== 0x002a) return
    const ifd0Off = view.getUint32(tiffStart + 4, little)
    const ctx: TiffCtx = { view, little, tiffStart }
    const ifd0 = readIfd(ctx, ifd0Off)
    if (!ifd0) return
    info.hasMeta = true

    const str = (m: Map<number, number[] | string>, tag: number): string | undefined => {
      const v = m.get(tag)
      return typeof v === 'string' && v ? v : undefined
    }
    const num = (m: Map<number, number[] | string>, tag: number): number | undefined => {
      const v = m.get(tag)
      return Array.isArray(v) ? v[0] : undefined
    }

    info.make = str(ifd0.map, 0x010f)
    info.model = str(ifd0.map, 0x0110)
    info.software = str(ifd0.map, 0x0131)
    info.dateTime = str(ifd0.map, 0x0132)
    info.orientation = num(ifd0.map, 0x0112)
    info.width = num(ifd0.map, 0x0100)
    info.height = num(ifd0.map, 0x0101)

    // Exif 子 IFD
    if (ifd0.exifPtr !== undefined) {
      const exif = readIfd(ctx, ifd0.exifPtr)
      if (exif) {
        info.dateTime = info.dateTime ?? str(exif.map, 0x9003)
        info.serial = str(exif.map, 0xa431) ?? str(exif.map, 0xa432)
      }
    }
    // GPS 子 IFD
    if (ifd0.gpsPtr !== undefined) {
      const gps = readIfd(ctx, ifd0.gpsPtr)
      if (gps) {
        const lat = dmsToDecimal((gps.map.get(2) as number[]) ?? [], str(gps.map, 1))
        const lng = dmsToDecimal((gps.map.get(4) as number[]) ?? [], str(gps.map, 3))
        if (lat !== undefined && lng !== undefined && Number.isFinite(lat) && Number.isFinite(lng)) {
          info.gps = { lat, lng }
        }
      }
    }
  } catch {
    /* 容错：保留已读到的字段 */
  }
}

// ---------- PNG ----------

function parsePng(buf: ArrayBuffer, info: MetaInfo): void {
  try {
    const view = new DataView(buf)
    let off = 8
    const texts: string[] = []
    while (off + 8 <= buf.byteLength) {
      const len = view.getUint32(off, false)
      const type = String.fromCharCode(...new Uint8Array(buf, off + 4, 4))
      const dataStart = off + 8
      if (dataStart + len > buf.byteLength) break
      if (type === 'IHDR' && len >= 8) {
        info.width = view.getUint32(dataStart, false)
        info.height = view.getUint32(dataStart + 4, false)
      } else if (type === 'tEXt' || type === 'iTXt') {
        const bytes = new Uint8Array(buf, dataStart, Math.min(len, 4096))
        const text = String.fromCharCode(...bytes).replace(/\0+.*$/s, (m) => (m.startsWith('\0') ? '' : m))
        const nul = bytes.indexOf(0)
        const keyword = String.fromCharCode(...bytes.subarray(0, nul > -1 ? nul : Math.min(40, len)))
        texts.push(keyword)
        if (/software|comment|date|camera|gps|exif/i.test(keyword)) info.hasMeta = true
        if (/software/i.test(keyword)) info.software = text
      } else if (type === 'eXIf') {
        info.hasMeta = true
      }
      if (type === 'IEND') break
      off = dataStart + len + 4 // skip CRC
    }
    if (texts.length) info.hasMeta = true
  } catch {
    /* 容错 */
  }
}

function buildRisks(info: MetaInfo): string[] {
  const r: string[] = []
  if (info.gps) r.push('精确 GPS 定位')
  if (info.dateTime) r.push('拍摄时间')
  if (info.make || info.model) r.push('设备品牌型号')
  if (info.serial) r.push('设备序列号')
  if (info.software) r.push('处理软件信息')
  return r
}

export async function readMeta(file: Blob): Promise<MetaInfo> {
  // 只读前 256KB，EXIF 一定在文件头部，避免把大图整块读入内存
  const slice = file.slice(0, 256 * 1024)
  const buf = await slice.arrayBuffer()
  const kind = detectKind(buf)
  const info: MetaInfo = { kind, hasMeta: false, risks: EMPTY_RISKS }
  if (kind === 'jpeg') parseJpegExif(buf, info)
  else if (kind === 'png') parsePng(buf, info)
  info.risks = buildRisks(info)
  return info
}

/** 便于单元测试：直接喂 ArrayBuffer（可构造带已知 EXIF 的 buffer） */
export function readMetaFromBuffer(buf: ArrayBuffer): MetaInfo {
  const kind = detectKind(buf)
  const info: MetaInfo = { kind, hasMeta: false, risks: EMPTY_RISKS }
  if (kind === 'jpeg') parseJpegExif(buf, info)
  else if (kind === 'png') parsePng(buf, info)
  info.risks = buildRisks(info)
  return info
}
