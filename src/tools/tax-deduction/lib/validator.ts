/**
 * tax-deduction —— 填报错误/风险预检（纯函数）。
 * 输入某纳税年度的全部扣除记录，输出分级问题清单；无记录时不误报。
 */
import { LIMIT } from './rules-cn'
import type { DeductionItem } from './models'

export type FindingLevel = 'error' | 'warn' | 'info'

export interface Finding {
  level: FindingLevel
  code: string
  msg: string
}

function endMonthToMonths(endMonth: string | undefined, year: number): number | null {
  if (!endMonth) return null
  const m = /^(\d{4})-(\d{1,2})$/.exec(endMonth.trim())
  if (!m) return null
  const ey = Number(m[1])
  const em = Number(m[2])
  if (ey < year) return 0
  if (ey > year) return 12
  return Math.min(Math.max(em, 0), 12)
}

function nameKey(it: DeductionItem): string {
  return (it.personName ?? '').trim()
}

export function validate(items: DeductionItem[], year: number): Finding[] {
  const out: Finding[] = Finding_start()

  if (items.length === 0) {
    out.push({ level: 'info', code: 'EMPTY', msg: '还没有扣除项：先在「扣除项」页添加本年实际符合条件的项目。' })
    return out
  }

  for (const it of items) {
    if (it.year !== year) continue
    if (it.months < 1 || it.months > 12) {
      out.push({ level: 'warn', code: 'MONTHS_INVALID', msg: `有扣除项的享受月数为 ${it.months}，应在 1–12 之间，请核对。` })
    }
  }

  // 同一子女/婴幼儿：同阶段重复记录导致本人合计比例 >100%
  checkSameChildShare(items, year, 'childEducation', '子女教育', out)
  checkSameChildShare(items, year, 'infantCare', '3岁以下婴幼儿照护', out)

  // 同一姓名同时出现在婴幼儿照护与子女教育（3 岁前后衔接需确认月份不重叠）
  const infantNames = new Set(items.filter((x) => x.kind === 'infantCare').map(nameKey).filter(Boolean))
  for (const it of items) {
    if (it.kind === 'childEducation' && nameKey(it) && infantNames.has(nameKey(it))) {
      out.push({
        level: 'warn',
        code: 'CHILD_STAGE_OVERLAP',
        msg: `「${nameKey(it)}」同时填报了婴幼儿照护与子女教育：请确认满 3 岁前后的起止月份，两个项目在同一月份不能重复扣除。`
      })
    }
  }

  // 毕业 / 满 3 岁终止时间与扣除月数一致性
  for (const it of items) {
    if (it.kind !== 'childEducation' && it.kind !== 'infantCare') continue
    const max = endMonthToMonths(it.endMonth, year)
    if (max !== null && it.months > max) {
      const label = it.kind === 'childEducation' ? '子女毕业/终止' : '婴幼儿满 3 岁'
      out.push({
        level: 'error',
        code: 'CHILD_ENDED_MONTHS',
        msg: `「${nameKey(it) || '子女'}」${label}时间为 ${it.endMonth}，本年最多只能扣 ${max} 个月，但当前填了 ${it.months} 个月；毕业后未终止继续扣除是高频风险项。`
      })
    }
  }

  // 继续教育
  const deg = items.filter((x) => x.kind === 'continuingEducation' && x.ceType === 'degree')
  for (const it of deg) {
    if ((it.degreeCumulativeMonths ?? it.months) > LIMIT.ceDegreeMaxMonths) {
      out.push({ level: 'warn', code: 'CE_DEGREE_48', msg: '同一学历（学位）继续教育最长扣除 48 个月，累计月数已超 48，请核对。' })
    }
  }
  const certCount = items.filter((x) => x.kind === 'continuingEducation' && x.ceType === 'cert').length
  if (certCount > 1) {
    out.push({ level: 'error', code: 'CERT_ONCE', msg: `本年登记了 ${certCount} 条职业资格继续教育：同一纳税年度取得多本证书，职业资格继续教育也只能定额扣除一次 3600 元，请合并为一条。` })
  }

  // 大病医疗
  for (const it of items.filter((x) => x.kind === 'seriousIllness')) {
    const paid = it.selfPaidCents ?? 0
    if (paid <= 0) {
      out.push({ level: 'warn', code: 'ILLNESS_NO_AMOUNT', msg: '大病医疗未填写医保目录范围内个人自付总额，无法计算。' })
    } else if (paid <= LIMIT.illnessFloorCents) {
      out.push({ level: 'info', code: 'ILLNESS_BELOW_FLOOR', msg: `本年个人自付 ${(paid / 100).toFixed(2)} 元未超过 15000 元起扣线，大病医疗本年不可扣除（不影响其他项目）。` })
    }
  }

  // 房贷利息与住房租金互斥
  if (items.some((x) => x.kind === 'mortgageLoan') && items.some((x) => x.kind === 'housingRent')) {
    out.push({ level: 'error', code: 'LOAN_RENT_CONFLICT', msg: '同一纳税年度内，住房贷款利息与住房租金只能二选一，不能同时享受，请删除其中一项。' })
  }
  if (items.filter((x) => x.kind === 'mortgageLoan').length > 1) {
    out.push({ level: 'warn', code: 'MORTGAGE_DUP', msg: '住房贷款利息仅限一套首套住房贷款，请确认是否重复登记。' })
  }
  if (items.filter((x) => x.kind === 'housingRent').length > 1) {
    out.push({ level: 'warn', code: 'RENT_DUP', msg: '住房租金一般登记一条即可；夫妻主要工作城市相同的，只能由一方扣除。' })
  }

  // 赡养老人
  const elders = items.filter((x) => x.kind === 'elderlySupport')
  for (const it of elders) {
    if (it.elderlyRelation === 'spouseParent') {
      out.push({ level: 'error', code: 'ELDER_SPOUSE_PARENT', msg: '配偶的父母应由配偶本人按其赡养老人项目扣除，不能填报在本人名下。' })
    }
    if (typeof it.elderlyAge === 'number' && it.elderlyAge < 60) {
      out.push({ level: 'error', code: 'ELDER_UNDER_60', msg: `被赡养人${nameKey(it) ? '「' + nameKey(it) + '」' : ''}年末未满 60 周岁，本年不符合赡养老人扣除条件（年满 60 岁当月起方可扣除）。` })
    }
    if (it.onlyChild) {
      if (typeof it.myShareMonthlyCents === 'number' && it.myShareMonthlyCents > 0 && it.myShareMonthlyCents !== LIMIT.elderlyTotalMonthlyCents) {
        out.push({ level: 'warn', code: 'ELDER_ONLY_AMOUNT', msg: '独生子女按每月 3000 元全额扣除，无需手填分摊额。' })
      }
    } else {
      const mine = it.myShareMonthlyCents ?? 0
      if (mine <= 0) {
        out.push({ level: 'warn', code: 'ELDER_NONONLY_ZERO', msg: '非独生子女请填写本人每月分摊额（与兄弟姐妹分摊 3000 元，本人不超过 1500 元）。' })
      } else if (mine > LIMIT.elderlyNonOnlyCapMonthlyCents) {
        out.push({ level: 'error', code: 'ELDER_NONONLY_CAP', msg: `非独生子女每人每月分摊不得超过 1500 元，当前填了 ${(mine / 100).toFixed(2)} 元。` })
      }
      if (typeof it.siblingsTotalMonthlyCents === 'number' && it.siblingsTotalMonthlyCents > 0 && it.siblingsTotalMonthlyCents !== LIMIT.elderlyTotalMonthlyCents) {
        out.push({ level: 'warn', code: 'ELDER_SIBLINGS_TOTAL', msg: `非独生子女兄弟姐妹合计分摊应为每月 3000 元，当前登记合计 ${(it.siblingsTotalMonthlyCents / 100).toFixed(2)} 元，请核对。` })
      }
    }
  }
  // 赡养老人按纳税人每月合计定额，不按老人人数翻倍
  const eligibleElders = elders.filter((x) => x.elderlyRelation !== 'spouseParent')
  if (eligibleElders.length > 1) {
    out.push({
      level: 'warn',
      code: 'ELDER_MULTI',
      msg: `登记了 ${eligibleElders.length} 位被赡养人：赡养老人按每位纳税人每月合计定额（独生 3000 / 非独生分摊 3000），不按老人人数翻倍，请合并为一条或调整金额。`
    })
  }

  if (out.length === 0) {
    out.push({ level: 'info', code: 'OK', msg: '未发现明显填报风险。结果仅供参考，仍请以个税 App 与税务机关口径为准。' })
  }
  return out
}

function Finding_start(): Finding[] {
  return []
}

function checkSameChildShare(
  items: DeductionItem[],
  year: number,
  kind: 'childEducation' | 'infantCare',
  label: string,
  out: Finding[]
): void {
  const groups = new Map<string, { share: number; count: number }>()
  for (const it of items) {
    if (it.kind !== kind || it.year !== year) continue
    const key = nameKey(it)
    if (!key) continue
    const g = groups.get(key) ?? { share: 0, count: 0 }
    g.share += it.share
    g.count += 1
    groups.set(key, g)
  }
  for (const [key, g] of groups) {
    if (g.share > 1 + 1e-9) {
      out.push({
        level: 'error',
        code: 'CHILDSHARE_OVER100',
        msg: `「${key}」的${label}在本人名下合计分摊比例为 ${Math.round(g.share * 100)}%，同一子女合计不得超过 100%（父母一方 100% 或双方各 50%），请删除重复记录。`
      })
    }
  }
}

/** 错误数量（用于界面分级汇总）。 */
export function countByLevel(findings: Finding[]): Record<FindingLevel, number> {
  return findings.reduce(
    (acc, f) => {
      acc[f.level] += 1
      return acc
    },
    { error: 0, warn: 0, info: 0 }
  )
}
