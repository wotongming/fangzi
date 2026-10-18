/**
 * card-billing —— 类型与日期/金额工具。
 * 金融最小化：只存卡名/尾号/账单规则，不存完整卡号、密码、CVV，不碰资金。
 */

export type DueMode = 'fixed' | 'offset'

export interface FeeGoal {
  /** 年费年度截止日 YYYY-MM-DD（年度内需达标，否则可能被扣年费） */
  yearEnd: string
  /** 需刷满笔数（0 表示不按笔数考核） */
  targetCount: number
  /** 需刷满金额（整数分，0 表示不按金额考核） */
  targetAmountCents: number
  /** 已刷笔数（手动记录，本工具不自动读取账单） */
  progressCount: number
  /** 已刷金额（整数分） */
  progressAmountCents: number
}

export interface CreditCard {
  id: string
  /** 卡名称，如「招行经典白」 */
  name: string
  /** 卡尾号后 4 位（可选，仅用于辨识） */
  last4: string
  /** 账单日（每月几号，1-31，小月自动落到月末） */
  billingDay: number
  /** 还款日规则：fixed=固定每月几号；offset=账单日后第 N 天 */
  dueMode: DueMode
  /** dueMode=fixed 时的固定还款日（1-31） */
  dueDay: number
  /** dueMode=offset 时账单日后的天数 */
  dueOffsetDays: number
  /** 信用额度（整数分，可选） */
  limitCents: number
  /** 账单日当天消费归属：true=计入当期，false=计入下期（默认 false，多数银行口径） */
  billingDayConsumptionIntoCurrent: boolean
  /** 年费刷免目标（可选） */
  feeGoal: FeeGoal | null
  createdAt: number
  updatedAt: number
}

/** 某期还款标记 */
export interface PaymentRecord {
  id: string
  cardId: string
  /** 对应账单日 YYYY-MM-DD（哪一期账单） */
  periodBilling: string
  paidAt: number
  amountCents: number
}

// —————————————————— 日期工具（本地日历日，UTC 午夜算差，规避时区/夏令时） ——————————————————

export function today(): string {
  return toISO(new Date())
}

export function toISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseISO(s: string): Date {
  const parts = s.split('-').map(Number)
  const y = parts[0] ?? 1970
  const m = parts[1] ?? 1
  const d = parts[2] ?? 1
  return new Date(y, m - 1, d)
}

function utcMidnight(y: number, m0: number, d: number): number {
  return Date.UTC(y, m0, d)
}

/** b - a 的整数天数（a、b 为 YYYY-MM-DD）。 */
export function diffDays(a: string, b: string): number {
  const da = parseISO(a)
  const db = parseISO(b)
  return Math.round(
    (utcMidnight(db.getFullYear(), db.getMonth(), db.getDate()) -
      utcMidnight(da.getFullYear(), da.getMonth(), da.getDate())) /
      86400000
  )
}

export function addDays(s: string, n: number): string {
  const d = parseISO(s)
  d.setDate(d.getDate() + n)
  return toISO(d)
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate()
}

/** 把“某月第 day 号”落到该月真实存在的日期（如 31 号在 2 月落到月末）。 */
export function clampDay(year: number, month1: number, day: number): string {
  const last = daysInMonth(year, month1)
  const real = Math.min(Math.max(day, 1), last)
  return `${year}-${String(month1).padStart(2, '0')}-${String(real).padStart(2, '0')}`
}

// —————————————————— 金额工具（整数分） ——————————————————

/** 把用户输入的元解析为整数分；非法返回 null。 */
export function yuanToCents(text: string): number | null {
  const t = String(text ?? '').trim()
  if (!t) return null
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  const [yuan, frac = ''] = t.split('.')
  const cents = Number(yuan) * 100 + Number((frac + '00').slice(0, 2))
  return Number.isFinite(cents) ? cents : null
}

export function yuan(cents: number): string {
  return (cents / 100).toFixed(2)
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}
