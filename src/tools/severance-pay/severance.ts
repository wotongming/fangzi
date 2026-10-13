/**
 * 解除/终止劳动合同的经济补偿计算（《劳动合同法》第 40 / 47 / 87 条）。
 * 结果为依法估算，具体以当地裁审口径与实际证据为准。
 */

export type SeveranceScenario =
  | 'negotiate' // 第36条 协商一致（用人单位提出）
  | 'layoff' // 第41条 经济性裁员 / 第40条无过失辞退且已提前30日通知
  | 'no-notice' // 第40条 应给代通知金（未提前30日通知）
  | 'illegal' // 第87条 违法解除/终止

export interface SeveranceInput {
  /** 解除前 12 个月平均应得工资（含奖金津贴） */
  monthlyWage: number
  /** 当地上年度职工月平均工资（用于三倍封顶） */
  localAvgWage: number
  /** 本单位工作年限：整年 */
  years: number
  /** 本单位工作年限：剩余整月（0-11） */
  months: number
  scenario: SeveranceScenario
}

export interface SeveranceResult {
  /** 经济补偿月数系数 N（可能为 0.5 的倍数） */
  nFactor: number
  /** 计算基数（是否三倍封顶） */
  baseWage: number
  capped: boolean
  /** N：经济补偿 */
  economicComp: number
  /** 代通知金（+1 个月） */
  noticePay: number
  /** 违法解除赔偿金（2N） */
  illegalComp: number
  /** 当前情形应得合计 */
  total: number
  formula: string
  scenarioLabel: string
  note: string
}

export function calcSeverance(input: SeveranceInput): SeveranceResult {
  const wage = Math.max(0, input.monthlyWage)
  const avg = Math.max(0, input.localAvgWage)
  const totalMonths = Math.max(0, Math.round(input.years * 12 + input.months))
  const fullYears = Math.floor(totalMonths / 12)
  const rem = totalMonths % 12
  let nFactor = fullYears
  if (rem >= 6) nFactor += 1
  else if (rem > 0) nFactor += 0.5

  let baseWage = wage
  let capped = false
  const cap = avg * 3
  if (avg > 0 && wage > cap) {
    baseWage = cap
    capped = true
    nFactor = Math.min(nFactor, 12) // 高薪员工补偿年限封顶 12 年
  }

  const economicComp = round2(nFactor * baseWage)
  const noticePay = input.scenario === 'no-notice' ? round2(baseWage) : 0
  const illegalComp = round2(2 * nFactor * baseWage)

  const meta = SCENARIO_META[input.scenario]
  let total = economicComp
  if (input.scenario === 'no-notice') total = round2(economicComp + noticePay)
  if (input.scenario === 'illegal') total = illegalComp

  const formula =
    input.scenario === 'illegal'
      ? `2N = 2 × ${nFactor} × ${formatNum(baseWage)}`
      : input.scenario === 'no-notice'
        ? `N + 1 = ${nFactor} × ${formatNum(baseWage)} + ${formatNum(baseWage)}`
        : `N = ${nFactor} × ${formatNum(baseWage)}`

  return {
    nFactor,
    baseWage: round2(baseWage),
    capped,
    economicComp,
    noticePay,
    illegalComp,
    total: round2(total),
    formula,
    scenarioLabel: meta.label,
    note: meta.note
  }
}

export const SCENARIO_META: Record<
  SeveranceScenario,
  { label: string; desc: string; note: string }
> = {
  negotiate: {
    label: '协商一致解除（公司提出，N）',
    desc: '第 36 条',
    note: '用人单位提出并与劳动者协商一致解除，支付经济补偿 N。'
  },
  layoff: {
    label: '裁员 / 无过失辞退已提前 30 天通知（N）',
    desc: '第 40 / 41 条',
    note: '依法支付经济补偿 N；依第 41 条裁员还需满足法定程序与优先留用规则。'
  },
  'no-notice': {
    label: '无过失辞退且未提前 30 天通知（N+1）',
    desc: '第 40 条',
    note: '医疗期满、不能胜任、客观情况重大变化三种情形，未提前 30 日书面通知的，另付一个月工资作为代通知金。'
  },
  illegal: {
    label: '公司违法解除 / 终止（2N）',
    desc: '第 48 / 87 条',
    note: '无法定理由或程序违法解除，按经济补偿标准的二倍支付赔偿金；劳动者也可要求继续履行合同。'
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
function formatNum(n: number): string {
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}
