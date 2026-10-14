/**
 * CSV / JSON 纯函数解析层（无 DOM 依赖，可在 Worker 与单测中直接使用）。
 *
 * - parseCsvLine：RFC4180 风格单行解析，支持双引号包裹、"" 转义、字段内逗号/换行（配合 scanCsv 处理）。
 * - scanCsv：增量字符扫描器，供流式 Worker 逐行产出字段，避免百万行字符串数组常驻内存。
 * - parseCsv：一次性解析（仅用于粘贴文本 / 小文件 / 单测）。
 */
import type { ColumnType } from './types'

const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/

/** 解析一行 CSV（字段内不含换行的场景）；保留引号语义 */
export function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

/** 去掉可能存在的 UTF-8 BOM */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

export interface CsvTable {
  headers: string[]
  rows: string[][]
}

/** 一次性解析 CSV（CRLF/LF 自适应，支持引号内换行） */
export function parseCsv(text: string): CsvTable {
  const src = stripBom(text)
  const records: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  const pushField = () => {
    row.push(field)
    field = ''
  }
  const pushRow = () => {
    pushField()
    records.push(row)
    row = []
  }
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      pushField()
    } else if (ch === '\n') {
      pushRow()
    } else if (ch === '\r') {
      if (src[i + 1] === '\n') i++
      pushRow()
    } else {
      field += ch
    }
  }
  // 末行无换行符
  if (field.length > 0 || row.length > 0) pushRow()

  if (records.length === 0) return { headers: [], rows: [] }
  const headers = records.shift()!.map((h, i) => h.trim() || `列${i + 1}`)
  return { headers, rows: records.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== '')) }
}

/**
 * 增量 CSV 扫描器：流式喂入文本块，逐行回调字段数组。
 * 正确处理跨行引号字段、CRLF；返回值可继续喂下一块。
 */
export function createCsvScanner(onRow: (fields: string[]) => void): (chunk: string) => void {
  let buf = ''
  let inQuotes = false
  return (chunk: string) => {
    buf += chunk
    let start = 0
    for (let i = 0; i < buf.length; i++) {
      const ch = buf[i]!
      if (ch === '"') {
        // 成对引号视为转义，不改变 inQuotes
        if (inQuotes && buf[i + 1] === '"') {
          i++
          continue
        }
        inQuotes = !inQuotes
      } else if (ch === '\n' && !inQuotes) {
        emit(buf.slice(start, i))
        start = i + 1
      } else if (ch === '\r' && !inQuotes) {
        emit(buf.slice(start, i))
        start = buf[i + 1] === '\n' ? i + 2 : i + 1
        if (start === i + 2) i++
      }
    }
    buf = buf.slice(start)
  }

  function emit(line: string) {
    // 空行跳过（不产生记录）
    if (line.length === 0) return
    onRow(parseCsvLine(line))
  }
}

/** 通知扫描器输入结束，刷出缓冲中的最后一行 */
export function flushCsvScanner(feed: (chunk: string) => void): void {
  feed('\n')
}

/** 推断列类型：采样值全部可解析为数字 → number；否则可解析为日期 → date；其余 string */
export function inferColumnType(sample: string[]): ColumnType {
  let numeric = 0
  let dateish = 0
  let total = 0
  for (const raw of sample) {
    const v = raw?.trim()
    if (!v) continue
    total++
    if (NUMBER_RE.test(v)) {
      numeric++
    } else if (!Number.isNaN(Date.parse(v))) {
      dateish++
    }
  }
  if (total === 0) return 'string'
  if (numeric / total >= 0.9) return 'number'
  if (dateish / total >= 0.9) return 'date'
  return 'string'
}

/** 把单元格文本按列类型转成数字；无法解析返回 NaN */
export function cellToNumber(value: string, type: ColumnType): number {
  const v = value?.trim() ?? ''
  if (!v) return NaN
  if (type === 'number') {
    if (!NUMBER_RE.test(v)) return NaN
    return Number(v)
  }
  if (type === 'date') return Date.parse(v)
  return NaN
}

/** 解析 JSON 数据：支持对象数组 [{..}] 或二维数组（首行表头） */
export function parseJsonData(text: string): CsvTable {
  const data = JSON.parse(stripBom(text)) as unknown
  if (Array.isArray(data)) {
    if (data.length === 0) return { headers: [], rows: [] }
    if (typeof data[0] === 'object' && data[0] !== null) {
      const headersSet: string[] = []
      for (const obj of data) {
        for (const k of Object.keys(obj as Record<string, unknown>)) {
          if (!headersSet.includes(k)) headersSet.push(k)
        }
      }
      const rows = (data as Record<string, unknown>[]).map((obj) =>
        headersSet.map((k) => {
          const v = obj[k]
          return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
        })
      )
      return { headers: headersSet, rows }
    }
    if (Array.isArray(data[0])) {
      const matrix = data as unknown[][]
      const headers = (matrix.shift() as unknown[]).map((h, i) => String(h ?? `列${i + 1}`))
      const rows = matrix
        .filter((r) => r.length > 0)
        .map((r) => r.map((c) => (c == null ? '' : typeof c === 'object' ? JSON.stringify(c) : String(c))))
      return { headers, rows }
    }
  }
  throw new Error('仅支持对象数组 [{"x":1,"y":2}] 或二维数组格式的 JSON')
}
