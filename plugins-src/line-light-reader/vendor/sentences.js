/**
 * sentences.js —— 扩展运行时切句（与 lib/sentences.ts 同规则，供 content script 全局使用）。
 * 保护缩写 Mr./Dr./e.g./i.e. 与小数 3.14 不误切。
 */
'use strict'
;(function (global) {
  const ABBREV = new Set([
    'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'e.g', 'i.e',
    'u.s.a', 'u.k', 'ph.d', 'no', 'fig', 'cf', 'al', 'approx', 'min', 'max'
  ])
  const COMPOUND = /\b(e\.g|i\.e|u\.s\.a|u\.k|ph\.d|cf|al)\./i

  function protectedDot(text, p) {
    const win = text.slice(Math.max(0, p - 6), p + 4)
    if (COMPOUND.test(win)) return true
    const before = text.slice(0, p + 1).replace(/[^\w.']+$/, '')
    const m = before.match(/([a-z']+)\.$/i)
    if (m && ABBREV.has(m[1].toLowerCase())) return true
    const prev = text[p - 1]
    const next = text[p + 1]
    if (/[0-9]/.test(prev || '') && /[0-9]/.test(next || '')) return true
    return false
  }

  function splitSentences(text) {
    if (!text) return []
    const out = []
    let cur = ''
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      cur += ch
      if ('.!?。！？'.includes(ch)) {
        if (ch === '.' && protectedDot(text, i)) continue
        out.push(cur.trim())
        cur = ''
      } else if (ch === '\n' && cur.trim().length > 40) {
        out.push(cur.trim())
        cur = ''
      }
    }
    if (cur.trim()) out.push(cur.trim())
    return out.filter(Boolean)
  }

  global.LLR = global.LLR || {}
  global.LLR.splitSentences = splitSentences
})(globalThis)
