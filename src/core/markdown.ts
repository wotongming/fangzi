/**
 * 极简、安全的 Markdown 渲染器（用于工具用户指导 / 插件手册）。
 * 支持：#~#### 标题、有序/无序列表、围栏代码块、行内代码、加粗、链接、引用、分隔线、段落。
 * 安全策略：所有文本先 HTML 转义；链接仅允许 http/https/相对路径并强制 noopener。
 */
import { escapeHtml } from './search/highlight'

function inline(text: string): string {
  let s = escapeHtml(text)
  // 行内代码
  s = s.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`)
  // 加粗
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  // 链接 [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, url) => {
    if (/^(https?:\/\/|\/|\.\/|\.\.\/|#)/.test(url)) {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
    }
    return label
  })
  return s
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
      html.push(`<h${level}>${inline(heading[2]!)}</h${level}>`)
      i++
      continue
    }

    if (/^---+$/.test(line.trim())) {
      closeList()
      html.push('<hr />')
      i++
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
