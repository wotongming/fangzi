/**
 * card-billing —— 账单周期 / 还款日 / 免息期日期引擎（纯函数，可单测）。
 *
 * 约定（口径可在卡片上配置，最终以银行账单为准）：
 * - 账单日：每月出账日，31 号在小月自动落到当月最后一天。
 * - 还款日：fixed=固定每月某日（若该日早于/等于账单日则落到下月）；offset=账单日后第 N 天。
 * - 一笔消费计入“第一个不早于（默认严格晚于）消费日的账单日”所在账期；
 *   免息天数 = 该期还款日 - 消费日。
 */
import { addDays, clampDay, diffDays, parseISO } from './models'
import type { CreditCard } from './models'

function shiftMonth(year: number, month1: number, n: number): { year: number; month1: number } {
  const d = new Date(year, month1 - 1 + n, 1)
  return { year: d.getFullYear(), month1: d.getMonth() + 1 }
}

/** 指定年月的账单日（已做小月兜底）。 */
export function billingDateInMonth(card: CreditCard, year: number, month1: number): string {
  return clampDay(year, month1, card.billingDay)
}

/** 某账单日对应的还款日。 */
export function repaymentDate(card: CreditCard, billingDate: string): string {
  if (card.dueMode === 'offset') return addDays(billingDate, card.dueOffsetDays)
  const d = parseISO(billingDate)
  const sameMonth = clampDay(d.getFullYear(), d.getMonth() + 1, card.dueDay)
  if (diffDays(billingDate, sameMonth) >= 1) return sameMonth
  const nm = shiftMonth(d.getFullYear(), d.getMonth() + 1, 1)
  return clampDay(nm.year, nm.month1, card.dueDay)
}

export interface Cycle {
  /** 最近一个已出账的账单日（<= today） */
  lastBilling: string
  /** lastBilling 这期的还款日 */
  due: string
  /** 下一个账单日（> today） */
  nextBilling: string
  /** nextBilling 这期的还款日 */
  nextDue: string
}

/** 今天所处的账期：最近已出账单与其还款日，以及下一期。 */
export function billingCycle(card: CreditCard, todayStr: string): Cycle {
  const t = parseISO(todayStr)
  const thisMonth = billingDateInMonth(card, t.getFullYear(), t.getMonth() + 1)
  let by: number
  let bm: number
  if (diffDays(thisMonth, todayStr) >= 0 || thisMonth === todayStr) {
    // 本月账单日已过或就是今天 -> 最近账单即本月
    by = t.getFullYear()
    bm = t.getMonth() + 1
  } else {
    const p = shiftMonth(t.getFullYear(), t.getMonth() + 1, -1)
    by = p.year
    bm = p.month1
  }
  const lastBilling = billingDateInMonth(card, by, bm)
  const n = shiftMonth(by, bm, 1)
  const nextBilling = billingDateInMonth(card, n.year, n.month1)
  return {
    lastBilling,
    due: repaymentDate(card, lastBilling),
    nextBilling,
    nextDue: repaymentDate(card, nextBilling)
  }
}

/**
 * 覆盖某笔消费的账单日：
 * 第一个 >= 消费日（账单日消费计入当期）或严格 > 消费日（默认，计入下期）的账单日。
 */
export function statementBillingForSpend(card: CreditCard, spendStr: string): string {
  const s = parseISO(spendStr)
  let y = s.getFullYear()
  let m = s.getMonth() + 1
  for (let i = 0; i < 13; i++) {
    const cand = billingDateInMonth(card, y, m)
    const delta = diffDays(spendStr, cand)
    const ok = card.billingDayConsumptionIntoCurrent ? delta >= 0 : delta > 0
    if (ok) return cand
    const nm = shiftMonth(y, m, 1)
    y = nm.year
    m = nm.month1
  }
  /* c8 ignore next 1 */
  throw new Error('无法计算账期')
}

/** 某笔消费可享免息天数（消费日 -> 所在账期还款日）。 */
export function interestFreeDays(card: CreditCard, spendStr: string): number {
  const billing = statementBillingForSpend(card, spendStr)
  const due = repaymentDate(card, billing)
  return diffDays(spendStr, due)
}
