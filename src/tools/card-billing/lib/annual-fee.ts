/**
 * card-billing —— 年费刷免达标判定（纯函数）。
 */
import { diffDays } from './models'
import type { CreditCard } from './models'

export interface FeeStatus {
  active: boolean
  yearEnd: string
  daysLeft: number
  needCount: number
  haveCount: number
  needAmountCents: number
  haveAmountCents: number
  countMet: boolean
  amountMet: boolean
  met: boolean
}

export function feeStatus(card: CreditCard, todayStr: string): FeeStatus | null {
  const g = card.feeGoal
  if (!g) return null
  const daysLeft = diffDays(todayStr, g.yearEnd)
  const countMet = g.targetCount <= 0 || g.progressCount >= g.targetCount
  const amountMet = g.targetAmountCents <= 0 || g.progressAmountCents >= g.targetAmountCents
  return {
    active: true,
    yearEnd: g.yearEnd,
    daysLeft,
    needCount: Math.max(0, g.targetCount - g.progressCount),
    haveCount: g.progressCount,
    needAmountCents: Math.max(0, g.targetAmountCents - g.progressAmountCents),
    haveAmountCents: g.progressAmountCents,
    countMet,
    amountMet,
    met: countMet && amountMet
  }
}
