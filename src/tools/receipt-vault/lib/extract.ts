/**
 * extract.ts —— 小票/发票字段抽取（纯函数，可单测）。
 * 输入：OCR 得到的纯文本（可能多版式、有噪点）。
 * 输出：{ date, merchant, amount, tax, confidence }，抽不到留空字符串。
 */

export interface ParsedReceipt {
  date: string
  merchant: string
  amount: string
  tax: string
  /** 0..1，供 UI 提示"建议人工校对" */
  confidence: number
}

/** 归一金额字符串：去掉千分位逗号、货币符号，保留数字与小数点。 */
export function normalizeAmount(raw: string): string {
  return raw.replace(/[,，]/g, '').replace(/[¥￥$]/g, '').trim()
}

/** 抽取日期：2026-10-21 / 2026/10/21 / 2026年10月21日 / 10-21 20:00 等。 */
export function parseDate(text: string): string {
  const pats = [
    /(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/,
    /(\d{2})[-/](\d{1,2})[-/](\d{1,2})/
  ]
  for (const p of pats) {
    const m = text.match(p)
    if (m && m[1] && m[2] && m[3]) {
      const a = m[1]; const b = m[2]; const c = m[3]
      const y = a.length === 2 ? '20' + a : a
      return `${y}-${b.padStart(2, '0')}-${c.padStart(2, '0')}`
    }
  }
  return ''
}

/** 抽取金额：优先"合计/价税合计/小写/总金额/应付"附近的第一个数字；兜底最大数字。 */
export function parseAmount(text: string): string {
  const labels = ['价税合计', '合计金额', '合\\s*计', '小写', '总金额', '应付', '总计', '金额']
  for (const lab of labels) {
    const m = text.match(new RegExp(lab + '[^0-9¥￥$]{0,6}[¥￥$]?\\s*([0-9][0-9,]*\\.?\\d{1,2})'))
    if (m && m[1]) return normalizeAmount(m[1])
  }
  const nums = Array.from(text.matchAll(/([0-9][0-9,]*\.\d{2})/g)).map((m) => parseFloat(normalizeAmount(m[1]!)))
  if (nums.length) return String(Math.max(...nums))
  return ''
}

/** 抽取税额：优先"税额"标签后的数字；没有则空。 */
export function parseTax(text: string): string {
  const m = text.match(/税\s*额[^0-9¥￥$]{0,6}[¥￥$]?\s*([0-9][0-9,]*\.?\d{0,2})/)
  return m && m[1] ? normalizeAmount(m[1]) : ''
}

/** 抽取商家：优先"商户/销售方/抬头/名称："后一行；兜底第一行非数字短行。 */
export function parseMerchant(text: string): string {
  const m = text.match(/(?:商户|销售方|抬头|销售者|店名)[^:：]{0,4}[:：]?\s*([^\n]{2,30})/)
  if (m && m[1]) return m[1].trim()
  const lines = text.split(/\n/).map((s) => s.trim()).filter((s) => s.length >= 2 && !/^[\d¥￥$.,:：\-()（）]+$/.test(s))
  return lines[0] ?? ''
}

/** 综合置信度：关键字段命中越多越高；<0.5 提示人工校对。 */
export function confidenceOf(p: ParsedReceipt): number {
  let score = 0
  if (p.date) score += 0.25
  if (p.merchant) score += 0.2
  if (p.amount) score += 0.35
  if (p.tax) score += 0.2
  return score
}

export function parseReceipt(text: string): ParsedReceipt {
  const r: ParsedReceipt = {
    date: parseDate(text),
    merchant: parseMerchant(text),
    amount: parseAmount(text),
    tax: parseTax(text),
    confidence: 0
  }
  r.confidence = confidenceOf(r)
  return r
}

/** CSV 转义：含逗号/引号/换行时用双引号包裹并把 " 转义为 ""。 */
export function csvCell(v: string): string {
  if (/[",\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"'
  return v
}

export interface ReceiptRecord {
  id: string
  date: string
  merchant: string
  amount: string
  tax: string
  category: string
  note: string
  createdAt: number
}

export function toCsv(rows: ReceiptRecord[]): string {
  const head = ['日期', '商家', '金额', '税额', '项目分类', '备注']
  const body = rows.map((r) =>
    [r.date, r.merchant, r.amount, r.tax, r.category, r.note].map(csvCell).join(',')
  )
  return '﻿' + [head.join(','), ...body].join('\n')
}

/** 按项目分类汇总金额。 */
export function summarizeByCategory(rows: ReceiptRecord[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows) {
    const a = parseFloat(r.amount) || 0
    out[r.category] = (out[r.category] ?? 0) + a
  }
  return out
}
