/**
 * 命中片段高亮：把查询命中的 bigram / 完整短语用 <mark> 包裹。
 * 所有文本先做 HTML 转义，防止工具元数据中的特殊字符造成 XSS。
 */

import { normalize, queryTokens } from './bigram'

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 返回带 <mark> 的安全 HTML。
 * 合并相邻/重叠命中区间，避免标签交叉。
 */
export function highlightSnippet(snippet: string, query: string): string {
  if (!snippet) return ''
  const safe = escapeHtml(snippet)
  const qNorm = normalize(query)
  if (!qNorm) return safe

  const lower = normalize(snippet)
  const ranges: Array<[number, number]> = []

  const addRange = (start: number, len: number) => {
    if (len <= 0) return
    ranges.push([start, start + len])
  }

  // 完整短语优先（用字符索引，与 normalize 后等宽；bigram 均为 BMP 内 CJK）
  const phraseIdx = lower.indexOf(qNorm)
  if (phraseIdx >= 0) {
    addRange(phraseIdx, Array.from(qNorm).length)
  } else {
    // bigram / unigram 命中
    for (const tok of queryTokens(query)) {
      let from = 0
      const tokLen = Array.from(tok).length
      while (from <= lower.length) {
        const i = lower.indexOf(tok, from)
        if (i < 0) break
        addRange(i, tokLen)
        from = i + tok.length
      }
    }
  }

  if (ranges.length === 0) return safe

  // 单字 unigram 命中过多时噪声大：仅保留 bigram(长度>=2) 或短语区间
  const meaningful = ranges.filter(([a, b]) => b - a >= 2)
  const finalRanges = (phraseIdx >= 0 ? ranges : meaningful.length > 0 ? meaningful : ranges)
  finalRanges.sort((a, b) => a[0] - b[0] || a[1] - b[1])

  const merged: Array<[number, number]> = []
  for (const r of finalRanges) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1]) {
      last[1] = Math.max(last[1], r[1])
    } else {
      merged.push([...r])
    }
  }

  const chars = Array.from(safe)
  let out = ''
  let cursor = 0
  for (const [s, e] of merged) {
    out += chars.slice(cursor, s).join('')
    out += '<mark>' + chars.slice(s, e).join('') + '</mark>'
    cursor = e
  }
  out += chars.slice(cursor).join('')
  return out
}
