/**
 * tax-deduction —— 扣除额计算（纯函数）。
 * 输出“本人本纳税年度可享受的专项附加扣除额”（整数分）。
 */
import { LIMIT } from './rules-cn'
import { monthlyToAnnual, type DeductionItem } from './models'

/** 单条扣除记录的年度可扣金额（本人份额，整数分）。 */
export function itemAnnualDeduction(item: DeductionItem): number {
  switch (item.kind) {
    case 'childEducation':
      return monthlyToAnnual(LIMIT.childMonthlyCents, item.months, item.share)
    case 'infantCare':
      return monthlyToAnnual(LIMIT.infantMonthlyCents, item.months, item.share)
    case 'continuingEducation':
      if (item.ceType === 'cert') return LIMIT.ceCertYearCents // 取证当年定额
      return monthlyToAnnual(LIMIT.ceDegreeMonthlyCents, item.months, 1)
    case 'seriousIllness': {
      const paid = Math.max(0, item.selfPaidCents ?? 0)
      const deductible = Math.min(Math.max(paid - LIMIT.illnessFloorCents, 0), LIMIT.illnessCapCents)
      return deductible
    }
    case 'mortgageLoan':
      return monthlyToAnnual(LIMIT.mortgageMonthlyCents, item.months, item.share)
    case 'housingRent': {
      const tier = item.rentTier ?? 'tier1'
      // 租金按城市由一方全额扣除（同城一方、异地各自），不做 50/50
      return monthlyToAnnual(LIMIT.rentMonthlyCents[tier], item.months, 1)
    }
    case 'elderlySupport': {
      if (item.onlyChild) return monthlyToAnnual(LIMIT.elderlyTotalMonthlyCents, item.months, 1)
      const mine = Math.min(item.myShareMonthlyCents ?? 0, LIMIT.elderlyNonOnlyCapMonthlyCents)
      return monthlyToAnnual(mine, item.months, 1)
    }
    default:
      return 0
  }
}

export interface KindTotal {
  kind: DeductionItem['kind']
  cents: number
}

/** 按种类汇总本人年度扣除额。 */
export function totalsByKind(items: DeductionItem[]): KindTotal[] {
  const map = new Map<DeductionItem['kind'], number>()
  for (const it of items) map.set(it.kind, (map.get(it.kind) ?? 0) + itemAnnualDeduction(it))
  return [...map.entries()].map(([kind, cents]) => ({ kind, cents }))
}

/** 本人本纳税年度专项附加扣除合计（整数分）。 */
export function totalAnnualDeduction(items: DeductionItem[]): number {
  return items.reduce((sum, it) => sum + itemAnnualDeduction(it), 0)
}
