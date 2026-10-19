/**
 * tax-deduction —— 七项专项附加扣除规则表（中国大陆，2023 年起提高后的现行标准）。
 *
 * 规则版本 RULE_VERSION：每年税季后需依据税务总局/官媒口径复核。
 * 现行标准（2023-01-01 起执行，2025 年度汇算仍适用）：
 * - 3 岁以下婴幼儿照护、子女教育：每个子女每月 2000 元；父母一方 100% 或双方各 50%。
 * - 赡养老人：每月 3000 元；独生子女全额 3000，非独生与兄弟姐妹分摊、每人每月不超过 1500。
 * - 继续教育：学历（学位）教育每月 400 元、同一学历最长 48 个月；取证当年职业资格 3600 元/年。
 * - 大病医疗：医保目录范围内个人自付累计超过 15000 元的部分据实扣除，年度上限 80000 元。
 * - 住房贷款利息：首套住房贷款每月 1000 元，最长 240 个月；夫妻一方 100% 或各 50%。
 * - 住房租金：直辖市/省会/计划单列市 1500、市辖区户籍人口超 100 万城市 1100、其余 800（元/月）。
 * - 住房贷款利息与住房租金在一个纳税年度内只能二选一，不能同时享受。
 *
 * 来源（公开）：央视网、国家税务总局政策法规库、自然人电子税务局、光明网（见 README/docs）。
 */
import type { DeductionKind, RentTier } from './models'

export const RULE_VERSION = 'cn-2026-10'
/** 该标准自哪一纳税年度起适用（2000/3000 提高后的口径） */
export const RULE_SINCE_YEAR = 2023
/** 资料留存年限（年） */
export const KEEP_YEARS = 5

export const LIMIT = {
  childMonthlyCents: 200000, // 2000 元/月/每个子女
  infantMonthlyCents: 200000, // 2000 元/月/每个婴幼儿
  ceDegreeMonthlyCents: 40000, // 400 元/月
  ceDegreeMaxMonths: 48, // 同一学历最长 48 个月
  ceCertYearCents: 360000, // 取证当年 3600 元
  illnessFloorCents: 1500000, // 自付超过 15000 起扣
  illnessCapCents: 8000000, // 年度扣除上限 80000
  mortgageMonthlyCents: 100000, // 1000 元/月
  mortgageMaxMonths: 240, // 最长 240 个月
  rentMonthlyCents: { tier1: 150000, tier2: 110000, tier3: 80000 } as Record<RentTier, number>,
  elderlyTotalMonthlyCents: 300000, // 合计 3000 元/月
  elderlyNonOnlyCapMonthlyCents: 150000 // 非独生每人不超过 1500 元/月
}

export interface RuleMeta {
  kind: DeductionKind
  name: string
  short: string
  /** 一句话标准 */
  standard: string
  /** 是否按实际发生额（年度）而非定额按月 */
  annualActual?: boolean
  /** 是否可夫妻 50/50 分摊 */
  splittable: boolean
  /** 需要留存备查的材料（清单） */
  docs: string[]
}

export const RULES: RuleMeta[] = [
  {
    kind: 'childEducation',
    name: '子女教育',
    short: '子女教育',
    standard: '每个子女每月 2000 元；父母一方 100% 或双方各 50%，年内不变更',
    splittable: true,
    docs: ['子女在境内/境外接受教育的证明（学籍信息、录取通知书等）', '境外教育还需留存录取通知书、留学签证等']
  },
  {
    kind: 'infantCare',
    name: '3 岁以下婴幼儿照护',
    short: '婴幼儿照护',
    standard: '每个婴幼儿每月 2000 元；父母一方 100% 或双方各 50%，至满 3 岁前一月',
    splittable: true,
    docs: ['婴幼儿出生医学证明等能证明亲子关系与年龄的资料']
  },
  {
    kind: 'continuingEducation',
    name: '继续教育',
    short: '继续教育',
    standard: '学历（学位）教育每月 400 元、同一学历最长 48 个月；取证当年职业资格 3600 元',
    splittable: false,
    docs: ['学历（学位）继续教育入学/学籍证明', '技能人员/专业技术人员职业资格证书']
  },
  {
    kind: 'seriousIllness',
    name: '大病医疗',
    short: '大病医疗',
    standard: '医保目录范围内个人自付累计超 15000 元部分据实扣除，年度上限 80000 元',
    annualActual: true,
    splittable: false,
    docs: ['医疗服务收费及医保报销相关票据原件或复印件', '医疗保障部门出具的纳税年度医药费用清单']
  },
  {
    kind: 'mortgageLoan',
    name: '住房贷款利息',
    short: '房贷利息',
    standard: '首套住房贷款每月 1000 元，最长 240 个月；夫妻一方 100% 或各 50%',
    splittable: true,
    docs: ['住房贷款合同', '贷款还款支出凭证']
  },
  {
    kind: 'housingRent',
    name: '住房租金',
    short: '住房租金',
    standard: '按城市每月 1500 / 1100 / 800 元；同城夫妻只能由一方扣除，与房贷利息二选一',
    splittable: false,
    docs: ['住房租赁合同或协议']
  },
  {
    kind: 'elderlySupport',
    name: '赡养老人',
    short: '赡养老人',
    standard: '每月合计 3000 元；独生子女全额，非独生分摊每人每月不超过 1500 元',
    splittable: false,
    docs: ['被赡养人年满 60 周岁的身份证明', '非独生子女约定/指定分摊需留存书面分摊协议']
  }
]

export function ruleOf(kind: DeductionKind): RuleMeta {
  const r = RULES.find((x) => x.kind === kind)
  if (!r) throw new Error(`未知扣除种类：${kind}`)
  return r
}
