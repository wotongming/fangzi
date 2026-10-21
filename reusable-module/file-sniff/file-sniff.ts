/**
 * file-sniff —— 移动端文件选择健壮读取纯函数（零依赖，浏览器/Node 均可）。
 *
 * 背景：安卓各文件来源（系统"文件"/第三方"选择文件"/WeLink 容器）给的 File
 *   type 经常是 "" / application/octet-stream / 怪异 MIME，name 也可能无扩展名；
 *   不能只信 accept 或 file.type。本模块按「扩展名 + 魔数（文件头字节）」判定真实类型，
 *   识别 0 字节与 HTML 错误页，给三态错误文案，杜绝"选了完全没反应"。
 *
 * 由华为安卓真机兼容批次沉淀；pdf-redact / resume-jd-matcher / local-transcribe 共用。
 */

export type SniffKind =
  | 'pdf'
  | 'xlsx'
  | 'xls'
  | 'csv'
  | 'audio'
  | 'html'
  | 'empty'
  | 'unknown'

const enc = new TextDecoder('utf-8')

/** 读前 n 字节为 latin1/utf8 字符串，便于匹配魔数。 */
function headStr(buf: ArrayBuffer, n: number): string {
  return enc.decode(buf.slice(0, n))
}

/** 取文件头字节序列。 */
function headBytes(buf: ArrayBuffer): number[] {
  const v = new Uint8Array(buf.slice(0, 16))
  return [...v]
}

/**
 * 嗅探文件真实类型。优先魔数，扩展名作辅助；空文件单独标出。
 * audio 不做魔数穷举，按扩展名兜底（容器太多），由调用方再做解码试错。
 */
export function sniffFile(buf: ArrayBuffer, name = ''): { kind: SniffKind; size: number } {
  const size = buf.byteLength
  if (size === 0) return { kind: 'empty', size }
  const head = headBytes(buf)
  // %PDF-
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return { kind: 'pdf', size }
  // ZIP (xlsx/docx/pptx/jar...)
  if (head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07)) {
    const ext = extOf(name)
    if (ext === 'xlsx' || ext === 'xlsm') return { kind: 'xlsx', size }
    // zip 但无扩展名：默认按 xlsx 给上层试
    return { kind: ext === '' ? 'xlsx' : 'unknown', size }
  }
  // OLE2 (老 .xls/.doc)
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) return { kind: 'xls', size }
  const s = headStr(buf, 512).trimStart().toLowerCase()
  if (s.startsWith('<!doctype html') || s.startsWith('<html') || s.startsWith('<head') || s.startsWith('<html')) {
    return { kind: 'html', size }
  }
  const ext = extOf(name)
  if (ext === 'csv' || ext === 'txt') return { kind: 'csv', size }
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'webm', 'mp4', 'mpeg', '3gp'].includes(ext)) return { kind: 'audio', size }
  return { kind: 'unknown', size }
}

export function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

export class FileRejected extends Error {
  code: 'empty' | 'not-pdf' | 'not-supported' | 'html-error' | 'read-failed'
  constructor(code: FileRejected['code'], message: string) {
    super(message)
    this.code = code
  }
}

/** 读取并校验一个"应当是 PDF"的 File；不信 file.type，魔数不符明确报错。 */
export async function readPdfFile(f: File): Promise<ArrayBuffer> {
  let buf: ArrayBuffer
  try {
    buf = await f.arrayBuffer()
  } catch (e) {
    throw new FileRejected('read-failed', `读取失败：${f.name}（${(e as Error).message}）`)
  }
  if (buf.byteLength === 0) throw new FileRejected('empty', `文件是空的（0 字节）：${f.name}`)
  const { kind } = sniffFile(buf, f.name)
  if (kind === 'html') throw new FileRejected('html-error', '这不是 PDF，而是一个网页/错误页（可能是导出失败）')
  if (kind !== 'pdf') {
    throw new FileRejected(
      'not-pdf',
      `不是有效 PDF（实际类型=${f.type || '未知'}，大小=${(buf.byteLength / 1024).toFixed(1)}KB）：${f.name}`
    )
  }
  return buf
}
