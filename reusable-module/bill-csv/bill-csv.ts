/**
 * bill-csv —— 通用账单/表格 CSV 读取纯函数（零依赖，浏览器与 Node 均可）。
 * 能力：ArrayBuffer 智能解码（UTF-8/BOM/GBK）、RFC4180 CSV 解析、元转分、多格式日期解析。
 * 由 subscription-audit（pipeline 009）沉淀；任何“导入官方导出的中文账单/表格 CSV”类工具可直接复用。
 */

/** 解码文本：优先 UTF-8（含 BOM），出现替换字符或无法解码时回退 GBK（微信/支付宝账单常见编码）。 */
export function decodeText(buf: ArrayBuffer): { text: string; encoding: 'utf-8' | 'gbk' } {
  // 显式 UTF-8（fatal:false），BOM 由 TextDecoder 自动剥离
  const utf8 = new TextDecoder('utf-8').decode(buf)
  // 含大量替换字符通常说明不是 UTF-8（中文 GBK 被按 utf-8 解会乱码/替换符）
  if (utf8.includes('\uFFFD')) {
    try {
      return { text: new TextDecoder('gbk').decode(buf), encoding: 'gbk' }
    } catch {
      // 极少数环境无 gbk 解码器，回退 utf-8 结果
      return { text: utf8, encoding: 'utf-8' }
    }
  }
  return { text: utf8, encoding: 'utf-8' }
}

/**
 * RFC4180 兼容 CSV 解析（状态机）：
 * 支持引号包裹、引号内逗号/换行、双引号转义（""）；自动兼容 \r\n / \n / \r。
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const pushField = (): void => {
    row.push(field)
    field = ''
  }
  const pushRow = (): void => {
    pushField()
    rows.push(row)
    row = []
  }

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        const next = text[i + 1]
        if (next === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
      continue
    }
    if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      pushField()
    } else if (c === '\n') {
      pushRow()
    } else if (c === '\r') {
      if (text[i + 1] === '\n') i++
      pushRow()
    } else {
      field += c
    }
  }
  // 末行/末字段
  if (field.length > 0 || row.length > 0) pushRow()
  // 过滤完全空白的行
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

/** 元（字符串，含 ¥ ￥ , 空格）→ 分（整数，四舍五入到分）；无法解析返回 null。 */
export function yuanToCents(raw: string): number | null {
  if (raw == null) return null
  const s = String(raw).replace(/[¥￥,\s]/g, '').trim()
  if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return null
  const yuan = Number(s)
  if (!Number.isFinite(yuan)) return null
  return Math.round(yuan * 100)
}

/**
 * 多格式日期解析 → epoch ms；无法解析返回 null。
 * 支持：2026-09-01 12:30:00、2026/9/1 12:30、2026.09.01、20260901 12:30:00、仅日期。
 */
export function parseFlexibleDate(raw: string): number | null {
  if (!raw) return null
  const s = String(raw).trim()
  let m = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/)
  if (m) {
    const [, y, mo, d, h, mi, se] = m
    return Date.UTC(+y!, +mo! - 1, +d!, h ? +h : 0, mi ? +mi : 0, se ? +se : 0)
  }
  m = s.match(/(\d{4})(\d{2})(\d{2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/)
  if (m) {
    const [, y, mo, d, h, mi, se] = m
    return Date.UTC(+y!, +mo! - 1, +d!, h ? +h : 0, mi ? +mi : 0, se ? +se : 0)
  }
  return null
}

/** 在表头行中按候选列名查找列索引（精确/包含/去括号变体），未找到返回 -1。 */
export function findColumn(header: string[], candidates: string[]): number {
  const norm = (x: string): string => x.replace(/[\s()（）%％:：]/g, '').toLowerCase()
  const heads = header.map(norm)
  for (const cand of candidates) {
    const c = norm(cand)
    const exact = heads.findIndex((h) => h === c)
    if (exact >= 0) return exact
  }
  for (const cand of candidates) {
    const c = norm(cand)
    const partial = heads.findIndex((h) => h.includes(c) || c.includes(h))
    if (partial >= 0) return partial
  }
  return -1
}
