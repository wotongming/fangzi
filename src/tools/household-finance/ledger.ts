/**
 * 家庭财务管家 —— 账目领域模型与纯函数聚合
 *
 * 金额统一以「分」为单位存储与计算（与全局计费口径一致），展示层负责转元。
 * 本模块只包含纯函数，可在 Node 测试环境直接单测。
 */

/** 账目类型 */
export type LedgerType = 'expense' | 'income'

/** 支付 / 收入来源（多平台聚合维度） */
export type Platform = 'wechat' | 'alipay' | 'bank' | 'cash' | 'card' | 'other'

export const PLATFORM_LABELS: Record<Platform, string> = {
  wechat: '微信',
  alipay: '支付宝',
  bank: '银行卡',
  cash: '现金',
  card: '信用卡',
  other: '其他'
}

/** 一条账目记录 */
export interface LedgerEntry {
  id: string
  type: LedgerType
  /** 金额（分） */
  amountCents: number
  category: string
  note?: string
  tags: string[]
  /** 来源平台 */
  platform: Platform
  /** 记账日期 YYYY-MM-DD */
  date: string
  createdAt: number
}

/** 分类（内置分类不可删除） */
export interface Category {
  id: string
  name: string
  type: LedgerType
  builtin: boolean
}

/** 默认分类 */
export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'food', name: '餐饮', type: 'expense', builtin: true },
  { id: 'transport', name: '交通', type: 'expense', builtin: true },
  { id: 'shopping', name: '购物', type: 'expense', builtin: true },
  { id: 'entertainment', name: '娱乐', type: 'expense', builtin: true },
  { id: 'housing', name: '居住', type: 'expense', builtin: true },
  { id: 'medical', name: '医疗', type: 'expense', builtin: true },
  { id: 'education', name: '教育', type: 'expense', builtin: true },
  { id: 'salary', name: '工资', type: 'income', builtin: true },
  { id: 'bonus', name: '奖金', type: 'income', builtin: true },
  { id: 'invest', name: '理财', type: 'income', builtin: true }
]

/** 生成账目 / 分类 / 预算的本地唯一 id */
export function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** 判断账目是否属于某月（YYYY-MM） */
export function inMonth(entry: LedgerEntry, month: string): boolean {
  return entry.date.startsWith(month)
}

/** 汇总某类型金额（分） */
export function totalByType(entries: LedgerEntry[], type: LedgerType): number {
  return entries.filter((e) => e.type === type).reduce((s, e) => s + e.amountCents, 0)
}

/** 按分类聚合结果 */
export interface CategoryAggregate {
  category: string
  amountCents: number
  count: number
  /** 占该类型总额比例 0~1 */
  ratio: number
}

/** 按分类聚合（可限定类型与月份），按金额降序 */
export function aggregateByCategory(
  entries: LedgerEntry[],
  opts: { type?: LedgerType; month?: string } = {}
): CategoryAggregate[] {
  const filtered = entries.filter(
    (e) => (!opts.type || e.type === opts.type) && (!opts.month || inMonth(e, opts.month))
  )
  const total = filtered.reduce((s, e) => s + e.amountCents, 0)
  const map = new Map<string, { amountCents: number; count: number }>()
  for (const e of filtered) {
    const rec = map.get(e.category) ?? { amountCents: 0, count: 0 }
    rec.amountCents += e.amountCents
    rec.count += 1
    map.set(e.category, rec)
  }
  return [...map.entries()]
    .map(([category, rec]) => ({
      category,
      amountCents: rec.amountCents,
      count: rec.count,
      ratio: total > 0 ? rec.amountCents / total : 0
    }))
    .sort((a, b) => b.amountCents - a.amountCents)
}

/** 按日聚合（月内每日收支，用于日趋势） */
export interface DayAggregate {
  date: string
  expenseCents: number
  incomeCents: number
}

export function aggregateByDay(entries: LedgerEntry[], month: string): DayAggregate[] {
  const map = new Map<string, DayAggregate>()
  for (const e of entries) {
    if (!inMonth(e, month)) continue
    const rec = map.get(e.date) ?? { date: e.date, expenseCents: 0, incomeCents: 0 }
    if (e.type === 'expense') rec.expenseCents += e.amountCents
    else rec.incomeCents += e.amountCents
    map.set(e.date, rec)
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/** 按平台聚合（多平台支出聚合维度） */
export interface PlatformAggregate {
  platform: Platform
  amountCents: number
  count: number
}

export function aggregateByPlatform(
  entries: LedgerEntry[],
  opts: { type?: LedgerType; month?: string } = {}
): PlatformAggregate[] {
  const filtered = entries.filter(
    (e) => (!opts.type || e.type === opts.type) && (!opts.month || inMonth(e, opts.month))
  )
  const map = new Map<Platform, { amountCents: number; count: number }>()
  for (const e of filtered) {
    const rec = map.get(e.platform) ?? { amountCents: 0, count: 0 }
    rec.amountCents += e.amountCents
    rec.count += 1
    map.set(e.platform, rec)
  }
  return [...map.entries()]
    .map(([platform, rec]) => ({ platform, amountCents: rec.amountCents, count: rec.count }))
    .sort((a, b) => b.amountCents - a.amountCents)
}

/** 最近 n 个月（含当前月，降序） */
export function recentMonths(n: number, now = new Date()): string[] {
  const list: string[] = []
  const y = now.getFullYear()
  const m = now.getMonth()
  for (let i = 0; i < n; i++) {
    const d = new Date(y, m - i, 1)
    list.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return list
}

/** 当前月 YYYY-MM */
export function currentMonth(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

/** 今天 YYYY-MM-DD */
export function today(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** 分转元字符串（如 12345 → "123.45"） */
export function fmtYuan(cents: number): string {
  return (cents / 100).toFixed(2)
}
