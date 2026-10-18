/**
 * card-billing —— 还款方式利息/费用演示（仅估算，以银行账单为准）。
 * 不接银行、不碰资金；日利率默认万分之五（0.05%），用户可在界面修改。
 */

export interface InterestInput {
  /** 账单应还总额（整数分） */
  billCents: number
  /** 计划在到期还款日偿还的金额（整数分） */
  paidCents: number
  /** 从账单日次日到实际还清的天数（起息基准简化，实际以银行记账为准） */
  days: number
  /** 日利率，默认 0.0005 */
  dailyRate: number
}

/**
 * 最低/未全额还款的循环利息演示：
 * 常见做法为对未还本金按日计息（具体计息基数各行不同），这里给保守线性估算。
 */
export function revolvingInterest(input: InterestInput): number {
  const unpaid = Math.max(0, input.billCents - input.paidCents)
  const raw = unpaid * input.dailyRate * input.days
  return Math.round(raw)
}

/** 分期总费用演示：每期手续费率 * 期数（整数分）。 */
export function installmentFee(principalCents: number, perPeriodRate: number, periods: number): number {
  return Math.round(principalCents * perPeriodRate * periods)
}

/** 违约金常见演示：最低还款额未还部分的 5%（各行不同，仅示意）。 */
export function latePenalty(minRepayUnpaidCents: number, rate = 0.05): number {
  return Math.round(minRepayUnpaidCents * rate)
}
