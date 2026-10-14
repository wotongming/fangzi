/**
 * 家庭财务管家 —— 报表与趋势（纯函数）
 *
 * 月报 / 年报聚合与环比计算，供 UI 图表（原生 SVG）直接消费。
 */
import type { LedgerEntry } from './ledger'
import { aggregateByCategory, aggregateByDay, inMonth, totalByType } from './ledger'

/** 月度报表 */
export interface MonthReport {
  month: string
  incomeCents: number
  expenseCents: number
  balanceCents: number
  /** 支出按分类占比（金额降序） */
  byCategory: { category: string; amountCents: number; ratio: number }[]
  /** 月内按日收支 */
  byDay: { date: string; expenseCents: number; incomeCents: number }[]
}

/** 某月报表（纯函数） */
export function monthlyReport(entries: LedgerEntry[], month: string): MonthReport {
  const inMonthEntries = entries.filter((e) => inMonth(e, month))
  const incomeCents = totalByType(inMonthEntries, 'income')
  const expenseCents = totalByType(inMonthEntries, 'expense')
  return {
    month,
    incomeCents,
    expenseCents,
    balanceCents: incomeCents - expenseCents,
    byCategory: aggregateByCategory(inMonthEntries, { type: 'expense' }).map((c) => ({
      category: c.category,
      amountCents: c.amountCents,
      ratio: c.ratio
    })),
    byDay: aggregateByDay(inMonthEntries, month)
  }
}

/** 趋势点 */
export interface TrendPoint {
  month: string
  incomeCents: number
  expenseCents: number
  balanceCents: number
}

/** 连续月份收支趋势（输入月份升序，输出同序） */
export function trendReport(entries: LedgerEntry[], months: string[]): TrendPoint[] {
  return months.map((month) => {
    const r = monthlyReport(entries, month)
    return { month, incomeCents: r.incomeCents, expenseCents: r.expenseCents, balanceCents: r.balanceCents }
  })
}

/**
 * 环比变化率：(current - previous) / previous。
 * 上期为 0 时：本期也为 0 → 返回 0；否则无法计算 → 返回 null。
 */
export function changeRatio(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  return (current - previous) / previous
}
