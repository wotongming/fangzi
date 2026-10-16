/**
 * 极简、安全的 Markdown 渲染器（用于工具用户指导 / 插件手册）。
 * 支持：#~#### 标题、有序/无序列表、GFM 表格、围栏代码块、行内代码、加粗、链接、引用、分隔线、段落。
 * 安全策略：所有文本先 HTML 转义；链接仅允许 http/https/相对路径并强制 noopener。
 */
import { escapeHtml } from './search/highlight'

/** 是否为 GFM 管道表格行（以 | 开头且非代码块） */
function isPipeRow(line: string): boolean {
  const t = line.trim()
  return t.startsWith('|') && t.indexOf('|', 1) !== -1
}

/** 表头与表体之间的分隔行，如 |---|:--:|--:| */
function isTableSep(line: string): boolean {
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  if (!t.includes('|') && !/^:?-{2,}:?$/.test(t)) return false
  return t.split('|').every((c) => /^\s*:?-{2,}:?\s*$/.test(c))
}

/** 拆分一行表格单元格，去掉首尾管道与空白 */
function splitCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

function renderTable(header: string[], body: string[][]): string {
  const th = header.map((h) => `<th>${inline(h)}</th>`).join('')
  const rows = body
    .map((r) => {
      const tds = header
        .map((_, c) => `<td>${inline(r[c] ?? '')}</td>`)
        .join('')
      return `<tr>${tds}</tr>`
    })
    .join('')
  return `<table><thead><tr>${th}</tr></thead>${rows ? `<tbody>${rows}</tbody>` : ''}</table>`
}

function inline(text: string): string {
  let s = escapeHtml(text)
  // 行内代码
  s = s.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`)
  // 加粗
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  // 链接 [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, url) => {
    // 页内锚点：不加 target=_blank，交由点击处理器滚动，避免在 hash 路由下跳走
    if (url.startsWith('#')) {
      return `<a href="${url}" class="md-anchor">${label}</a>`
    }
    if (/^(https?:\/\/|\/|\.\/|\.\.\/)/.test(url)) {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
    }
    return label
  })
  return s
}

/**
 * GitHub / GitCode 风格的标题锚点 slug：转小写、空白转连字符、去除标点
 * （保留字母数字（含中文）、下划线、连字符）。让仓库 Markdown 的目录
 * `[x](#锚点)` 与本渲染器生成的标题 id 一致，GitCode 网页与方子 PWA 内都能跳转。
 */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\-_\s]/gu, '')
    .replace(/\s+/g, '-')
}

/**
 * 页内锚点点击处理（hash 路由下必须拦截，否则会改 location.hash 被路由当新地址）。
 * 用法：`<article class="markdown-body" @click="handleMarkdownAnchorClick">`。
 */
export function handleMarkdownAnchorClick(e: MouseEvent): boolean {
  const anchor = (e.target as HTMLElement | null)?.closest?.('a')
  if (!anchor) return false
  const href = anchor.getAttribute('href') || ''
  if (!href.startsWith('#') || href.length <= 1) return false
  const id = decodeURIComponent(href.slice(1))
  const container = anchor.closest('.markdown-body')
  const el =
    (container?.querySelector(`[id="${CSS.escape(id)}"]`) as HTMLElement | null) ??
    document.getElementById(id)
  if (!el) return false
  e.preventDefault()
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  return true
}

export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const html: string[] = []
  let i = 0
  let inCode = false
  let codeBuf: string[] = []
  let listType: 'ul' | 'ol' | null = null

  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`)
      listType = null
    }
  }

  while (i < lines.length) {
    const line = lines[i]!

    if (/^```/.test(line.trimStart())) {
      if (!inCode) {
        closeList()
        inCode = true
        codeBuf = []
      } else {
        html.push(`<pre><code>${codeBuf.map(escapeHtml).join('\n')}</code></pre>`)
        inCode = false
      }
      i++
      continue
    }
    if (inCode) {
      codeBuf.push(line)
      i++
      continue
    }

    if (!line.trim()) {
      closeList()
      i++
      continue
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      closeList()
      const level = heading[1]!.length
      const raw = heading[2]!
        .replace(/`/g, '')
        .replace(/\*\*/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      const id = slugifyHeading(raw)
      html.push(`<h${level}${id ? ` id="${id}"` : ''}>${inline(heading[2]!)}</h${level}>`)
      i++
      continue
    }

    if (/^---+$/.test(line.trim())) {
      closeList()
      html.push('<hr />')
      i++
      continue
    }

    // GFM 表格：当前行为管道行、下一行为分隔行
    if (isPipeRow(line) && lines[i + 1] && isTableSep(lines[i + 1]!)) {
      closeList()
      const header = splitCells(line)
      i += 2
      const body: string[][] = []
      while (i < lines.length && isPipeRow(lines[i]!)) {
        body.push(splitCells(lines[i]!))
        i++
      }
      html.push(renderTable(header, body))
      continue
    }

    if (/^>\s?/.test(line)) {
      closeList()
      html.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`)
      i++
      continue
    }

    const ul = /^\s*[-*]\s+(.*)$/.exec(line)
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (ul || ol) {
      const want: 'ul' | 'ol' = ul ? 'ul' : 'ol'
      if (listType !== want) {
        closeList()
        listType = want
        html.push(`<${want}>`)
      }
      html.push(`<li>${inline((ul ?? ol)![1]!)}</li>`)
      i++
      continue
    }

    closeList()
    html.push(`<p>${inline(line)}</p>`)
    i++
  }

  closeList()
  if (inCode) html.push(`<pre><code>${codeBuf.map(escapeHtml).join('\n')}</code></pre>`)
  return html.join('\n')
}
