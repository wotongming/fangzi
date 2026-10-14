/**
 * 家庭财务管家 —— 预算与超支预警（纯函数）
 *
 * 预算按月设置：`month === '*'` 表示每月通用；`category === '__all__'` 表示总预算。
 */
import type { LedgerEntry } from './ledger'
import { inMonth } from './ledger'

/** 预算 */
export interface Budget {
  id: string
  /** 分类 id；'__all__' 表示总预算 */
  category: string
  /** 月份 YYYY-MM；'*' 表示每月通用 */
  month: string
  /** 预算金额（分） */
  amountCents: number
}

/** 预算执行状态 */
export interface BudgetStatus {
  budget: Budget
  spentCents: number
  /** 使用比例（0~n，n 表示超支倍数） */
  usedRatio: number
  /** 是否超支 */
  over: boolean
  /** 剩余额度（分；超支为负） */
  remainCents: number
}

/** 单条预算执行状态（纯函数） */
export function budgetStatus(
  spentCents: number,
  amountCents: number
): Pick<BudgetStatus, 'usedRatio' | 'over' | 'remainCents'> {
  const usedRatio = amountCents > 0 ? spentCents / amountCents : spentCents > 0 ? Infinity : 0
  return { usedRatio, over: spentCents > amountCents, remainCents: amountCents - spentCents }
}

/** 计算某月全部预算执行情况（含总预算与分类预算），按使用比例降序 */
export function monthlyBudgetStatus(
  entries: LedgerEntry[],
  budgets: Budget[],
  month: string
): BudgetStatus[] {
  const expense = entries.filter((e) => e.type === 'expense' && inMonth(e, month))
  const totalSpent = expense.reduce((s, e) => s + e.amountCents, 0)
  const results: BudgetStatus[] = []
  for (const budget of budgets) {
    if (budget.month !== '*' && budget.month !== month) continue
    const spentCents =
      budget.category === '__all__'
        ? totalSpent
        : expense.filter((e) => e.category === budget.category).reduce((s, e) => s + e.amountCents, 0)
    results.push({ budget, spentCents, ...budgetStatus(spentCents, budget.amountCents) })
  }
  return results.sort((a, b) => b.usedRatio - a.usedRatio)
}
