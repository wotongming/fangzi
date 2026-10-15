/**
 * 文档解析与智能分块。
 * V1 原生支持 txt / markdown / csv / html；pdf / docx 为 V1.1（动态导入 pdf.js / mammoth）。
 */
import type { DocFormat } from './types'

export interface ChunkResult {
  chunks: string[]
}

const SUPPORTED: Record<string, DocFormat> = {
  txt: 'txt',
  text: 'txt',
  md: 'markdown',
  markdown: 'markdown',
  csv: 'csv',
  html: 'html',
  htm: 'html'
}

export function detectFormat(fileName: string): DocFormat | null {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  return SUPPORTED[ext] ?? null
}

export const UNSUPPORTED_HINT =
  'V1 支持 txt / markdown / csv / html；PDF 与 Word（docx）解析将在下一版本提供，可先另存为 .txt 或 .md 导入。'

/** CSV → 以行为单位的可读文本（逗号转顿号，引号内换行用空格替代） */
function parseCsv(raw: string): string {
  const rows: string[][] = []
  let cur: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (inQuotes) {
      if (ch === '"' && raw[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      cur.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && raw[i + 1] === '\n') i++
      cur.push(field)
      rows.push(cur)
      cur = []
      field = ''
    } else {
      field += ch
    }
  }
  if (field.length || cur.length) {
    cur.push(field)
    rows.push(cur)
  }
  return rows
    .map((r) => r.map((c) => c.replace(/\s+/g, ' ').trim()).filter(Boolean).join('，'))
    .filter(Boolean)
    .join('\n')
}

function stripHtml(raw: string): string {
  if (typeof DOMParser === 'undefined') {
    // Node 单测环境的极简兜底
    return raw.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ')
  }
  const doc = new DOMParser().parseFromString(raw, 'text/html')
  doc.querySelectorAll('script,style,noscript').forEach((n) => n.remove())
  const blockTags = new Set(['P', 'DIV', 'BR', 'LI', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SECTION', 'ARTICLE'])
  let out = ''
  const walk = (node: Node) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        out += child.textContent
      } else if (child.nodeType === 1) {
        const el = child as Element
        if (blockTags.has(el.tagName)) out += '\n'
        walk(child)
        if (blockTags.has(el.tagName)) out += '\n'
      }
    })
  }
  walk(doc.body ?? doc)
  return out
}

export function parseDocument(raw: string, format: DocFormat): string {
  switch (format) {
    case 'csv':
      return parseCsv(raw)
    case 'html':
      return stripHtml(raw).replace(/[ \t]+\n/g, '\n')
    case 'markdown':
    case 'txt':
    default:
      return raw
  }
}

/**
 * 结构化分块：优先按 markdown/文本标题（#、##…）切段，段内再按字符窗口切分，
 * 相邻块保留 overlap 字符重叠，避免句子/证据被切断。
 */
export function chunkText(input: string, size = 600, overlap = 80): string[] {
  const text = input.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  if (!text) return []

  // 按标题切大段（保留标题行作为上下文开头）
  const sections: string[] = []
  const lines = text.split('\n')
  let buf: string[] = []
  const flush = () => {
    const s = buf.join('\n').trim()
    if (s) sections.push(s)
    buf = []
  }
  for (const line of lines) {
    if (/^#{1,6}\s+\S/.test(line.trim()) && buf.join('\n').length > size * 0.5) {
      flush()
    }
    buf.push(line)
  }
  flush()

  const chunks: string[] = []
  for (const section of sections.length ? sections : [text]) {
    if (section.length <= size) {
      chunks.push(section)
      continue
    }
    let start = 0
    while (start < section.length) {
      let end = Math.min(start + size, section.length)
      if (end < section.length) {
        // 尽量在句号/换行处收刀
        const window = section.slice(start + Math.floor(size * 0.6), end)
        const breakAt = Math.max(window.lastIndexOf('。'), window.lastIndexOf('\n'), window.lastIndexOf('；'), window.lastIndexOf('. '))
        if (breakAt > 0) end = start + Math.floor(size * 0.6) + breakAt + 1
      }
      const piece = section.slice(start, end).trim()
      if (piece) chunks.push(piece)
      if (end >= section.length) break
      start = Math.max(0, end - overlap)
    }
  }
  return chunks
}
