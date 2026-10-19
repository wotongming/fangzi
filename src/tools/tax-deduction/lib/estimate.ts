/**
 * tax-deduction —— 综合所得年度应纳税额估算（纯函数，整数分）。
 *
 * 综合所得年度税率表（工资薪金等并入，减除费用 6 万、专项扣除、专项附加扣除等后的应纳税所得额）：
 *   ≤36000        3%   速算扣除 0
 *   36000~144000  10%  速算扣除 2520
 *   144000~300000 20%  速算扣除 16920
 *   300000~420000 25%  速算扣除 31920
 *   420000~660000 30%  速算扣除 52920
 *   660000~960000 35%  速算扣除 85920
 *   >960000       45%  速算扣除 181920
 * 仅用于让用户直观感受“多填扣除可能少缴多少”，非精确申报数，以个税 App/税务机关为准。
 */

export interface TaxBracket {
  upperCents: number | null // 区间上界（整数分），null 表示无上界
  rate: number
  quickCents: number // 速算扣除数（整数分）
}

export const BRACKETS: TaxBracket[] = [
  { upperCents: 3600000, rate: 0.03, quickCents: 0 },
  { upperCents: 14400000, rate: 0.1, quickCents: 252000 },
  { upperCents: 30000000, rate: 0.2, quickCents: 1692000 },
  { upperCents: 42000000, rate: 0.25, quickCents: 3192000 },
  { upperCents: 66000000, rate: 0.3, quickCents: 5292000 },
  { upperCents: 96000000, rate: 0.35, quickCents: 8592000 },
  { upperCents: null, rate: 0.45, quickCents: 18192000 }
]

/** 按超额累进表计算应纳税所得额对应年度税额（整数分，最小为 0）。 */
export function annualTax(taxableCents: number): number {
  const base = Math.max(0, Math.round(taxableCents))
  for (const b of BRACKETS) {
    if (b.upperCents === null || base <= b.upperCents) {
      return Math.max(0, Math.round(base * b.rate - b.quickCents))
    }
  }
  return 0
}

/** 找到应纳税所得额所在档的边际税率。 */
export function marginalRate(taxableCents: number): number {
  const base = Math.max(0, Math.round(taxableCents))
  for (const b of BRACKETS) {
    if (b.upperCents === null || base <= b.upperCents) return b.rate
  }
  return BRACKETS[BRACKETS.length - 1]!.rate
}

export interface SavingEstimate {
  taxBeforeCents: number
  taxAfterCents: number
  savedCents: number
  marginalRate: number
  /** 扣除后应纳税所得额是否已被压到 0（此时再多扣除也不产生退税） */
  saturated: boolean
}

/**
 * 给定“计入专项附加扣除之前”的估算应纳税所得额，以及本年专项附加扣除合计，
 * 估算因这些扣除少缴的税额。
 */
export function estimateSaving(taxableBeforeDeductionCents: number, deductionCents: number): SavingEstimate {
  const before = Math.max(0, Math.round(taxableBeforeDeductionCents))
  const after = Math.max(0, before - Math.max(0, Math.round(deductionCents)))
  const taxBefore = annualTax(before)
  const taxAfter = annualTax(after)
  return {
    taxBeforeCents: taxBefore,
    taxAfterCents: taxAfter,
    savedCents: taxBefore - taxAfter,
    marginalRate: marginalRate(before),
    saturated: after === 0
  }
}
