/**
 * sentences.ts —— 中英文句子切分（纯逻辑，Node 单测覆盖）。
 * 保护缩写（Mr./e.g.）与小数（3.14）不被误切。
 */

const ABBREV = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'e.g', 'i.e',
  'u.s.a', 'u.k', 'ph.d', 'no', 'fig', 'cf', 'al', 'approx', 'min', 'max'
])

const COMPOUND = /\b(e\.g|i\.e|u\.s\.a|u\.k|ph\.d|cf|al)\./i

function isProtected(text: string, p: number): boolean {
  const window = text.slice(Math.max(0, p - 6), p + 4)
  if (COMPOUND.test(window)) return true
  const before = text.slice(0, p + 1).replace(/[^\w.']+$/, '')
  const m = before.match(/([a-z']+)\.$/i)
  if (m && ABBREV.has(m[1].toLowerCase())) return true
  const prev = text[p - 1]
  const next = text[p + 1]
  if (/[0-9]/.test(prev ?? '') && /[0-9]/.test(next ?? '')) return true
  return false
}

export function splitSentences(text: string): string[] {
  if (!text) return []
  const out: string[] = []
  let cur = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    cur += ch
    if ('.!?。！？'.includes(ch)) {
      if (ch === '.' && isProtected(text, i)) continue
      out.push(cur.trim())
      cur = ''
    } else if (ch === '\n' && cur.trim().length > 40) {
      out.push(cur.trim())
      cur = ''
    }
  }
  if (cur.trim()) out.push(cur.trim())
  return out.filter((s) => s.length > 0)
}
