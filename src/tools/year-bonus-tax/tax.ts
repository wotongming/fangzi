/**
 * 年终奖个税计算（中国大陆，2021 年后政策延续“单独计税”口径）。
 * 仅做估算参考，以税务机关汇算结果为准。
 */

/** 月度税率表（全年一次性奖金 商数=奖金/12 适用） */
const MONTHLY_BRACKETS: Array<{ upper: number; rate: number; deduction: number }> = [
  { upper: 3000, rate: 0.03, deduction: 0 },
  { upper: 12000, rate: 0.1, deduction: 210 },
  { upper: 25000, rate: 0.2, deduction: 1410 },
  { upper: 35000, rate: 0.25, deduction: 2660 },
  { upper: 55000, rate: 0.3, deduction: 4410 },
  { upper: 80000, rate: 0.35, deduction: 7160 },
  { upper: Infinity, rate: 0.45, deduction: 15160 }
]

/** 年度综合所得税率表 */
const YEARLY_BRACKETS: Array<{ upper: number; rate: number; deduction: number }> = [
  { upper: 36000, rate: 0.03, deduction: 0 },
  { upper: 144000, rate: 0.1, deduction: 2520 },
  { upper: 300000, rate: 0.2, deduction: 16920 },
  { upper: 420000, rate: 0.25, deduction: 31920 },
  { upper: 660000, rate: 0.3, deduction: 52920 },
  { upper: 960000, rate: 0.35, deduction: 85920 },
  { upper: Infinity, rate: 0.45, deduction: 181920 }
]

function taxOf(amount: number, brackets: typeof YEARLY_BRACKETS): { tax: number; rate: number; deduction: number } {
  const taxable = Math.max(0, amount)
  for (const b of brackets) {
    if (taxable <= b.upper) {
      return { tax: Math.max(0, taxable * b.rate - b.deduction), rate: b.rate, deduction: b.deduction }
    }
  }
  const last = brackets[brackets.length - 1]!
  return { tax: Math.max(0, taxable * last.rate - last.deduction), rate: last.rate, deduction: last.deduction }
}

export interface BonusComparison {
  bonus: number
  /** 工资薪金部分的年度应纳税所得额（已扣除 6 万起征点、五险一金、专项附加等） */
  salaryTaxable: number
  separate: {
    tax: number
    takeHome: number
    rate: number
    quickDeduction: number
    bracketBase: number
  }
  combined: {
    taxOnSalaryOnly: number
    taxOnTotal: number
    taxAttributableToBonus: number
    takeHome: number
    rate: number
    quickDeduction: number
  }
  better: 'separate' | 'combined'
  saving: number
}

export function compareBonusTax(bonus: number, salaryTaxable: number): BonusComparison {
  const safeBonus = Math.max(0, bonus)
  const safeSalary = Math.max(0, salaryTaxable)

  // 方式一：单独计税。以 奖金/12 的商数确定适用税率与速算扣除数，
  // 应纳税额 = 奖金 × 适用税率 - 速算扣除数
  const bracketBase = safeBonus / 12
  const sep = taxOf(bracketBase, MONTHLY_BRACKETS)
  const separateTaxReal = Math.max(0, safeBonus * sep.rate - sep.deduction)

  // 方式二：并入综合所得
  const salaryOnly = taxOf(safeSalary, YEARLY_BRACKETS)
  const total = taxOf(safeSalary + safeBonus, YEARLY_BRACKETS)
  const combinedBonusTax = Math.max(0, total.tax - salaryOnly.tax)

  const better = separateTaxReal <= combinedBonusTax ? 'separate' : 'combined'
  const saving = Math.abs(separateTaxReal - combinedBonusTax)

  return {
    bonus: safeBonus,
    salaryTaxable: safeSalary,
    separate: {
      tax: separateTaxReal,
      takeHome: safeBonus - separateTaxReal,
      rate: sep.rate,
      quickDeduction: sep.deduction,
      bracketBase
    },
    combined: {
      taxOnSalaryOnly: salaryOnly.tax,
      taxOnTotal: total.tax,
      taxAttributableToBonus: combinedBonusTax,
      takeHome: safeBonus - combinedBonusTax,
      rate: total.rate,
      quickDeduction: total.deduction
    },
    better,
    saving
  }
}
