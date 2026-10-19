/**
 * tax-deduction —— 夫妻分摊方案比较（只比较扣除额在夫妻间的分配，不替用户算收入个税）。
 * 可分摊项：子女教育、3 岁以下婴幼儿照护、首套住房贷款利息（一方 100% 或双方各 50%）。
 * 家庭合计扣除额不随分摊改变；应让边际税率更高的一方多承担扣除。
 */
import { LIMIT, ruleOf } from './rules-cn'
import { monthlyToAnnual, type DeductionItem, type DeductionKind } from './models'

const SPLITTABLE: DeductionKind[] = ['childEducation', 'infantCare', 'mortgageLoan']

function monthlyOf(kind: DeductionKind): number {
  if (kind === 'mortgageLoan') return LIMIT.mortgageMonthlyCents
  if (kind === 'childEducation') return LIMIT.childMonthlyCents
  return LIMIT.infantMonthlyCents
}

export interface SplitPlan {
  key: 'allSelf' | 'half' | 'allSpouse'
  label: string
  /** 本人年度可分摊项扣除额（整数分） */
  selfSplittableCents: number
  /** 配偶年度可分摊项扣除额（整数分） */
  spouseSplittableCents: number
}

export interface SplitResult {
  /** 不可分摊、固定归本人的年度扣除额（整数分） */
  fixedSelfCents: number
  /** 可分摊项家庭年度合计（整数分，三种方案一致） */
  splittableTotalCents: number
  plans: SplitPlan[]
  /** 参与分摊的种类名 */
  splittableKinds: string[]
  tip: string
}

export function buildSplitPlans(items: DeductionItem[], year: number): SplitResult | null {
  const yearItems = items.filter((x) => x.year === year)
  const splittable = yearItems.filter((x) => SPLITTABLE.includes(x.kind))
  if (splittable.length === 0) return null

  let splittableTotal = 0
  for (const it of splittable) splittableTotal += monthlyToAnnual(monthlyOf(it.kind), it.months, 1)
  const fixedSelf = yearItems
    .filter((x) => !SPLITTABLE.includes(x.kind))
    .reduce((sum, it) => sum + fixedAnnual(it), 0)

  const make = (selfShare: 1 | 0.5 | 0): SplitPlan => {
    const self = splittable
      .map((it) => {
        const full = monthlyToAnnual(monthlyOf(it.kind), it.months, 1)
        return selfShare === 0 ? 0 : selfShare === 0.5 ? Math.floor(full / 2) : full
      })
      .reduce((a, b) => a + b, 0)
    return {
      key: selfShare === 1 ? 'allSelf' : selfShare === 0.5 ? 'half' : 'allSpouse',
      label: selfShare === 1 ? '全部由本人扣除' : selfShare === 0.5 ? '夫妻各扣 50%' : '全部由配偶扣除',
      selfSplittableCents: self,
      spouseSplittableCents: splittableTotal - self
    }
  }

  return {
    fixedSelfCents: fixedSelf,
    splittableTotalCents: splittableTotal,
    plans: [make(1), make(0.5), make(0)],
    splittableKinds: [...new Set(splittable.map((x) => ruleOf(x.kind).short))],
    tip: '三种分法的家庭合计扣除额相同；真正省税的关键是让适用税率（边际税率）更高的一方多扣除。请结合双方工资的预扣/汇算税率选择，具体以个税 App 测算为准。'
  }
}

/** 不可分摊项的本人年度扣除额（与 deduction 中对应分支保持一致的简化版，仅用于方案对比）。 */
function fixedAnnual(it: DeductionItem): number {
  switch (it.kind) {
    case 'continuingEducation':
      return it.ceType === 'cert' ? LIMIT.ceCertYearCents : monthlyToAnnual(LIMIT.ceDegreeMonthlyCents, it.months, 1)
    case 'seriousIllness': {
      const paid = Math.max(0, it.selfPaidCents ?? 0)
      return Math.min(Math.max(paid - LIMIT.illnessFloorCents, 0), LIMIT.illnessCapCents)
    }
    case 'housingRent':
      return monthlyToAnnual(LIMIT.rentMonthlyCents[it.rentTier ?? 'tier1'], it.months, 1)
    case 'elderlySupport':
      if (it.onlyChild) return monthlyToAnnual(LIMIT.elderlyTotalMonthlyCents, it.months, 1)
      return monthlyToAnnual(Math.min(it.myShareMonthlyCents ?? 0, LIMIT.elderlyNonOnlyCapMonthlyCents), it.months, 1)
    default:
      return 0
  }
}
