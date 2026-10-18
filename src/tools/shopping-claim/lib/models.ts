/**
 * shopping-claim —— 类型与通用工具。金额一律整数「分」。
 */

export type Category = 'digital' | 'appliance' | 'computer' | 'furniture' | 'clothing' | 'general'

export type EvidenceKind = 'order' | 'chat' | 'logistics' | 'product' | 'payment' | 'other'

/** 维权进度状态机（顺序固定，可前进/回退） */
export type CaseStatus = 'evidence' | 'negotiate' | 'platform' | 'complain12315' | 'done'

export interface StatusLog {
  status: CaseStatus
  at: number
  note?: string
}

export interface ClaimCase {
  id: string
  product: string
  channel: string
  orderNo: string
  /** 成交金额，整数分 */
  amountCents?: number
  /** 签收日期 YYYY-MM-DD */
  receivedDate: string
  /** 发现问题日期（质量问题用），可空 */
  foundDate?: string
  category: Category
  /** 是否定作等不适用 7 天无理由的商品 */
  customMade: boolean
  /** 价保天数（平台规则，可改，0 表示不跟踪） */
  priceProtectDays: number
  status: CaseStatus
  outcomeNote?: string
  /** 实际挽回金额（退款/赔偿），整数分 */
  outcomeCents?: number
  logs: StatusLog[]
  createdAt: number
  updatedAt: number
}

export interface Evidence {
  id: string
  caseId: string
  /** 案件内连续编号，从 1 开始 */
  seq: number
  kind: EvidenceKind
  originalName: string
  note?: string
  mime: string
  width: number
  height: number
  bytes: number
  blob: Blob
  /** 录入时刻（证据固化时间） */
  capturedAt: number
  createdAt: number
}

// —— 通用 ——
export function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export function today(): string {
  return toDateStr(new Date())
}

export function toDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 当地零点，避免 UTC 偏移。 */
export function dayMs(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y!, (m ?? 1) - 1, d ?? 1).getTime()
}

export const ONE_DAY = 86400000

export function addDays(date: string, days: number): string {
  return toDateStr(new Date(dayMs(date) + days * ONE_DAY))
}

/** 加 n 个自然月，目标月天数不足时取该月最后一天。 */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const base = new Date(y!, (m ?? 1) - 1, 1)
  base.setMonth(base.getMonth() + months)
  const lastDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate()
  return toDateStr(new Date(base.getFullYear(), base.getMonth(), Math.min(d ?? 1, lastDay)))
}

/** 从 a 到 b 相差的整天数（b - a）。 */
export function diffDays(a: string, b: string): number {
  return Math.round((dayMs(b) - dayMs(a)) / ONE_DAY)
}

export function yuanToCents(text: string): number | undefined {
  if (text == null) return undefined
  const t = String(text).trim().replace(/[¥￥,，\s]/g, '')
  if (!t) return undefined
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return undefined
  return Math.round(Number(t) * 100)
}

export function fmtYuan(cents?: number): string {
  if (cents == null) return ''
  return `¥${(cents / 100).toFixed(2)}`
}

export function fmtDateTime(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
