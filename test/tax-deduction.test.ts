import { test } from 'node:test'
import assert from 'node:assert/strict'
import { monthlyToAnnual, type DeductionItem, type DeductionKind } from '../src/tools/tax-deduction/lib/models'
import { itemAnnualDeduction, totalAnnualDeduction } from '../src/tools/tax-deduction/lib/deduction'
import { validate } from '../src/tools/tax-deduction/lib/validator'
import { buildSplitPlans } from '../src/tools/tax-deduction/lib/split-plan'
import { annualTax, estimateSaving, marginalRate } from '../src/tools/tax-deduction/lib/estimate'
import { deriveChecklist } from '../src/tools/tax-deduction/lib/docs'

const Y = 2026
function item(kind: DeductionKind, over: Partial<DeductionItem> = {}): DeductionItem {
  return {
    id: over.id ?? `${kind}-${Math.random().toString(36).slice(2, 7)}`,
    kind,
    year: Y,
    share: 1,
    months: 12,
    createdAt: 0,
    updatedAt: 0,
    ...over
  }
}
const c = (yuan: number) => Math.round(yuan * 100)

test('monthlyToAnnual: 定额按月、分摊、月数裁剪', () => {
  assert.equal(monthlyToAnnual(c(2000), 12, 1), c(24000))
  assert.equal(monthlyToAnnual(c(2000), 12, 0.5), c(12000))
  assert.equal(monthlyToAnnual(c(2000), 3, 1), c(6000))
  assert.equal(monthlyToAnnual(c(10), 99, 1), c(120)) // 月数超过 12 裁到 12
  assert.equal(monthlyToAnnual(c(10), -5, 1), 0)
})

test('子女教育/婴幼儿照护扣除额', () => {
  assert.equal(itemAnnualDeduction(item('childEducation', { share: 1 })), c(24000))
  assert.equal(itemAnnualDeduction(item('childEducation', { share: 0.5 })), c(12000))
  assert.equal(itemAnnualDeduction(item('infantCare', { months: 6, share: 1 })), c(12000))
})

test('继续教育：学历 4800/年，职业资格取证当年 3600', () => {
  assert.equal(itemAnnualDeduction(item('continuingEducation', { ceType: 'degree', months: 12 })), c(4800))
  assert.equal(itemAnnualDeduction(item('continuingEducation', { ceType: 'degree', months: 4 })), c(1600))
  assert.equal(itemAnnualDeduction(item('continuingEducation', { ceType: 'cert' })), c(3600))
})

test('大病医疗：1.5 万起扣、8 万上限据实', () => {
  assert.equal(itemAnnualDeduction(item('seriousIllness', { selfPaidCents: c(10000) })), 0)
  assert.equal(itemAnnualDeduction(item('seriousIllness', { selfPaidCents: c(20000) })), c(5000))
  assert.equal(itemAnnualDeduction(item('seriousIllness', { selfPaidCents: c(95000) })), c(80000))
  assert.equal(itemAnnualDeduction(item('seriousIllness', { selfPaidCents: c(200000) })), c(80000))
})

test('房贷利息 1000/月可分摊，与月数挂钩', () => {
  assert.equal(itemAnnualDeduction(item('mortgageLoan', { share: 1 })), c(12000))
  assert.equal(itemAnnualDeduction(item('mortgageLoan', { share: 0.5 })), c(6000))
})

test('住房租金按城市档全额扣除', () => {
  assert.equal(itemAnnualDeduction(item('housingRent', { rentTier: 'tier1' })), c(18000))
  assert.equal(itemAnnualDeduction(item('housingRent', { rentTier: 'tier2' })), c(13200))
  assert.equal(itemAnnualDeduction(item('housingRent', { rentTier: 'tier3', months: 6 })), c(4800))
})

test('赡养老人：独生 36000，非独生上限 1500/月', () => {
  assert.equal(itemAnnualDeduction(item('elderlySupport', { onlyChild: true })), c(36000))
  assert.equal(itemAnnualDeduction(item('elderlySupport', { onlyChild: false, myShareMonthlyCents: c(1500) })), c(18000))
  // 填报 2000/月 也按 1500 上限封顶
  assert.equal(itemAnnualDeduction(item('elderlySupport', { onlyChild: false, myShareMonthlyCents: c(2000) })), c(18000))
})

test('totalAnnualDeduction 汇总', () => {
  const sum = totalAnnualDeduction([
    item('childEducation'),
    item('housingRent', { rentTier: 'tier1' }),
    item('elderlySupport', { onlyChild: true })
  ])
  assert.equal(sum, c(24000 + 18000 + 36000))
})

test('校验：空清单只给提示不误报', () => {
  const f = validate([], Y)
  assert.equal(f.length, 1)
  assert.equal(f[0].code, 'EMPTY')
})

test('校验：同一子女本人合计比例 >100% 报风险', () => {
  const f = validate(
    [
      item('childEducation', { personName: '张小宝', share: 1 }),
      item('childEducation', { personName: '张小宝', share: 0.5 })
    ],
    Y
  )
  assert.ok(f.some((x) => x.code === 'CHILDSHARE_OVER100'))
})

test('校验：100% 与 50% 分别在不同子女名下不报超额', () => {
  const f = validate(
    [
      item('childEducation', { personName: '张大宝', share: 1 }),
      item('childEducation', { personName: '张二宝', share: 0.5 })
    ],
    Y
  )
  assert.ok(!f.some((x) => x.code === 'CHILDSHARE_OVER100'))
})

test('校验：毕业终止月份早于扣除月数报风险', () => {
  const f = validate([item('childEducation', { personName: '李雷', months: 12, endMonth: `${Y}-06` })], Y)
  assert.ok(f.some((x) => x.code === 'CHILD_ENDED_MONTHS'))
})

test('校验：房贷与租金并存互斥', () => {
  const f = validate([item('mortgageLoan'), item('housingRent', { rentTier: 'tier1' })], Y)
  assert.ok(f.some((x) => x.code === 'LOAN_RENT_CONFLICT'))
})

test('校验：配偶父母不能填报本人名下', () => {
  const f = validate([item('elderlySupport', { onlyChild: true, elderlyRelation: 'spouseParent', elderlyAge: 65 })], Y)
  assert.ok(f.some((x) => x.code === 'ELDER_SPOUSE_PARENT'))
})

test('校验：被赡养人未满 60 报风险', () => {
  const f = validate([item('elderlySupport', { onlyChild: true, elderlyRelation: 'ownParent', elderlyAge: 59 })], Y)
  assert.ok(f.some((x) => x.code === 'ELDER_UNDER_60'))
})

test('校验：非独生分摊超 1500/月报风险', () => {
  const f = validate(
    [item('elderlySupport', { onlyChild: false, elderlyRelation: 'ownParent', elderlyAge: 70, myShareMonthlyCents: c(1800) })],
    Y
  )
  assert.ok(f.some((x) => x.code === 'ELDER_NONONLY_CAP'))
})

test('校验：同年多本职业资格证书只应扣一次', () => {
  const f = validate(
    [
      item('continuingEducation', { ceType: 'cert' }),
      item('continuingEducation', { ceType: 'cert' })
    ],
    Y
  )
  assert.ok(f.some((x) => x.code === 'CERT_ONCE'))
})

test('校验：合规填报无风险（仅提示 OK）', () => {
  const f = validate(
    [
      item('childEducation', { personName: '王小满', share: 1, months: 12 }),
      item('elderlySupport', { onlyChild: false, elderlyRelation: 'ownParent', elderlyAge: 66, myShareMonthlyCents: c(1500), siblingsTotalMonthlyCents: c(3000) })
    ],
    Y
  )
  assert.ok(!f.some((x) => x.level === 'error'))
})

test('夫妻方案：家庭合计不变，三方案本人/配偶分配正确', () => {
  const r = buildSplitPlans([item('childEducation', { personName: '娃', share: 1 }), item('mortgageLoan', { share: 1 })], Y)
  assert.ok(r)
  assert.equal(r!.splittableTotalCents, c(24000 + 12000))
  const all = r!.plans.find((p) => p.key === 'allSelf')!
  const half = r!.plans.find((p) => p.key === 'half')!
  const spouse = r!.plans.find((p) => p.key === 'allSpouse')!
  assert.equal(all.selfSplittableCents, c(36000))
  assert.equal(all.spouseSplittableCents, 0)
  assert.equal(half.selfSplittableCents, c(18000))
  assert.equal(half.spouseSplittableCents, c(18000))
  assert.equal(spouse.selfSplittableCents, 0)
  assert.equal(spouse.spouseSplittableCents, c(36000))
})

test('夫妻方案：含不可分摊项时计入 fixedSelf', () => {
  const r = buildSplitPlans([item('childEducation'), item('housingRent', { rentTier: 'tier1' })], Y)
  assert.ok(r)
  assert.equal(r!.fixedSelfCents, c(18000))
  assert.equal(r!.splittableTotalCents, c(24000))
})

test('夫妻方案：无可分摊项返回 null', () => {
  assert.equal(buildSplitPlans([item('housingRent', { rentTier: 'tier1' })], Y), null)
})

test('累进税额与边际税率档位', () => {
  assert.equal(annualTax(c(36000)), c(1080)) // 3%
  assert.equal(marginalRate(c(36000)), 0.03)
  assert.equal(annualTax(c(144000)), c(11880)) // 10% 档：14400-2520
  assert.equal(marginalRate(c(200000)), 0.2)
  assert.equal(annualTax(c(420000)), c(73080)) // 25%：105000-31920
  assert.equal(annualTax(0), 0)
})

test('估算少缴税额：档内为扣除额×边际税率', () => {
  const r = estimateSaving(c(200000), c(24000))
  assert.equal(r.taxBeforeCents, c(23080)) // 200000*20%-16920
  assert.equal(r.taxAfterCents, c(18280)) // 176000*20%-16920
  assert.equal(r.savedCents, c(4800))
  assert.equal(r.saturated, false)
})

test('估算：扣除把应纳税所得额压到 0 后不再退税', () => {
  const r = estimateSaving(c(20000), c(50000))
  assert.equal(r.taxAfterCents, 0)
  assert.equal(r.savedCents, annualTax(c(20000)))
  assert.equal(r.saturated, true)
})

test('资料清单：按已填项去重并给出留存到期年份（+5）', () => {
  const rows = deriveChecklist([item('childEducation'), item('childEducation', { personName: '二娃' }), item('housingRent')], Y)
  assert.equal(rows.length, 2)
  const child = rows.find((x) => x.kind === 'childEducation')!
  assert.equal(child.keepUntilYear, Y + 5)
  assert.ok(child.docs.length > 0)
})
