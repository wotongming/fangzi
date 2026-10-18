/**
 * card-billing —— 多卡还款日时间线（纯函数）。
 */
import { diffDays } from './models'
import type { CreditCard, PaymentRecord } from './models'
import { billingCycle } from './cycle'

export interface DueEvent {
  cardId: string
  name: string
  last4: string
  /** 该事件对应的账单日 */
  billing: string
  /** 应还款日 */
  due: string
  /** 距今天数（负=已逾期） */
  daysLeft: number
  urgent: 'overdue' | 'today' | 'soon' | 'normal'
  paid: boolean
}

/**
 * 每张卡给出“当前账期”的还款日：
 * 始终展示本期（最近已出账单）还款日；本期已还则 paid=true（显示“已还/撤销”），
 * 不跳到下一期，避免用户刚标记还款就看不到本期状态、也无法撤销。
 */
export function upcomingDues(cards: CreditCard[], todayStr: string, payments: PaymentRecord[]): DueEvent[] {
  const paidSet = new Set(payments.map((p) => `${p.cardId}|${p.periodBilling}`))
  const evs: DueEvent[] = cards.map((c) => {
    const cy = billingCycle(c, todayStr)
    const billing = cy.lastBilling
    const due = cy.due
    const paid = paidSet.has(`${c.id}|${billing}`)
    const daysLeft = diffDays(todayStr, due)
    const urgent: DueEvent['urgent'] =
      daysLeft < 0 ? 'overdue' : daysLeft === 0 ? 'today' : daysLeft <= 3 ? 'soon' : 'normal'
    return { cardId: c.id, name: c.name, last4: c.last4, billing, due, daysLeft, urgent, paid }
  })
  return evs.sort((a, b) => a.daysLeft - b.daysLeft)
}
