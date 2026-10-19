/**
 * tax-deduction —— 类型与日期/金额工具。
 * 金额一律整数分；日期用本地日历日字符串 YYYY-MM / YYYY-MM-DD。
 * 边界：只做规则参考与估算，不代申报、不构成税务/法律意见，以税务机关与个税 App 为准。
 */

/** 七项专项附加扣除种类 */
export type DeductionKind =
  | 'childEducation' // 子女教育
  | 'infantCare' // 3 岁以下婴幼儿照护
  | 'continuingEducation' // 继续教育
  | 'seriousIllness' // 大病医疗
  | 'mortgageLoan' // 住房贷款利息
  | 'housingRent' // 住房租金
  | 'elderlySupport' // 赡养老人

/** 继续教育类型：学历（学位）继续教育 / 职业资格继续教育 */
export type CeType = 'degree' | 'cert'
/** 住房租金城市档：tier1 直辖市/省会/计划单列市；tier2 市辖区户籍人口>100万；tier3 其余 */
export type RentTier = 'tier1' | 'tier2' | 'tier3'
/** 被赡养人与本人关系 */
export type ElderRelation = 'ownParent' | 'spouseParent' | 'grandparent'

/** 一条扣除记录（一个纳税年度内） */
export interface DeductionItem {
  id: string
  kind: DeductionKind
  /** 纳税年度，如 2025 */
  year: number
  /** 本人承担比例：1=由本人 100% 扣除；0.5=夫妻各 50%。大病医疗/租金为按人全额扣除，恒为 1 */
  share: 1 | 0.5
  /** 本年可享受的月数（按月扣除项，1-12） */
  months: number
  /** 子女/被赡养人姓名或标识（用于同子女比例、分组校验） */
  personName?: string
  /** 子女教育 / 婴幼儿：学籍或照护终止年月 YYYY-MM（毕业、满 3 岁等） */
  endMonth?: string
  // —— 继续教育 ——
  ceType?: CeType
  /** 学历继续教育累计已享受月数（含本年），用于 48 个月上限提示，可空 */
  degreeCumulativeMonths?: number
  // —— 大病医疗：医保目录范围内个人自付总额（整数分，年度） ——
  selfPaidCents?: number
  // —— 住房租金 ——
  rentTier?: RentTier
  /** 夫妻主要工作城市是否相同（租金扣除城市相同只能由一方扣） */
  coupleSameCity?: boolean
  // —— 赡养老人 ——
  /** 是否独生子女 */
  onlyChild?: boolean
  /** 非独生子女：本人每月分摊额（整数分，≤1500） */
  myShareMonthlyCents?: number
  /** 非独生子女：兄弟姐妹合计每月分摊额（整数分，应由兄弟姐妹凑满 3000） */
  siblingsTotalMonthlyCents?: number
  /** 被赡养人在该纳税年度内的年龄（周岁，取年末年龄用于满 60 判断） */
  elderlyAge?: number
  elderlyRelation?: ElderRelation
  createdAt: number
  updatedAt: number
}

// —————————————————— 金额工具（整数分） ——————————————————

/** 把用户输入的元解析为整数分；非法返回 null。 */
export function yuanToCents(text: string): number | null {
  const t = String(text ?? '').trim()
  if (!t) return null
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  const [yuan, frac = ''] = t.split('.')
  const cents = Number(yuan) * 100 + Number((frac + '00').slice(0, 2))
  return Number.isFinite(cents) ? cents : null
}

export function yuan(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2)
}

/** 每月整数分 × 月数 × 分摊比例 → 年度整数分（0.5 用减半避免小数）。 */
export function monthlyToAnnual(monthlyCents: number, months: number, share: 1 | 0.5 = 1): number {
  const m = Math.min(Math.max(Math.trunc(months) || 0, 0), 12)
  const base = monthlyCents * m
  return share === 0.5 ? Math.floor(base / 2) : base
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}
