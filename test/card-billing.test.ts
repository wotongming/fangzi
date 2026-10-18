import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addDays, diffDays, yuanToCents, yuan, clampDay, daysInMonth, type CreditCard } from '../src/tools/card-billing/lib/models'
import {
  billingDateInMonth,
  repaymentDate,
  billingCycle,
  statementBillingForSpend,
  interestFreeDays
} from '../src/tools/card-billing/lib/cycle'
import { upcomingDues } from '../src/tools/card-billing/lib/timeline'
import { feeStatus } from '../src/tools/card-billing/lib/annual-fee'
import { revolvingInterest, installmentFee, latePenalty } from '../src/tools/card-billing/lib/interest'

function makeCard(over: Partial<CreditCard> = {}): CreditCard {
  return {
    id: 'c1',
    name: '测试卡',
    last4: '1234',
    billingDay: 5,
    dueMode: 'offset',
    dueDay: 10,
    dueOffsetDays: 20,
    limitCents: 0,
    billingDayConsumptionIntoCurrent: false,
    feeGoal: null,
    createdAt: 0,
    updatedAt: 0,
    ...over
  }
}

test('日期工具：UTC 午夜整数差，跨年/大小月正确', () => {
  assert.equal(diffDays('2026-02-06', '2026-03-25'), 47)
  assert.equal(diffDays('2026-12-31', '2027-01-01'), 1)
  assert.equal(addDays('2026-02-28', 1), '2026-03-01')
  assert.equal(daysInMonth(2026, 2), 28) // 2026 平年
  assert.equal(daysInMonth(2024, 2), 29) // 2024 闰年
  assert.equal(clampDay(2026, 2, 31), '2026-02-28')
  assert.equal(clampDay(2024, 2, 31), '2024-02-29')
})

test('金额：元转整数分，最多两位小数，非法返回 null', () => {
  assert.equal(yuanToCents('10000'), 1000000)
  assert.equal(yuanToCents('12.34'), 1234)
  assert.equal(yuanToCents('0.1'), 10)
  assert.equal(yuanToCents('12.345'), null)
  assert.equal(yuanToCents('abc'), null)
  assert.equal(yuanToCents(''), null)
  assert.equal(yuan(13500), '135.00')
})

test('账单日 31 号在小月落到月末', () => {
  const c = makeCard({ billingDay: 31 })
  assert.equal(billingDateInMonth(c, 2026, 2), '2026-02-28')
  assert.equal(billingDateInMonth(c, 2026, 4), '2026-04-30')
  assert.equal(billingDateInMonth(c, 2026, 12), '2026-12-31')
})

test('offset 还款日：账单日后第 N 天（含小月、跨年）', () => {
  const c = makeCard({ billingDay: 5, dueMode: 'offset', dueOffsetDays: 20 })
  assert.equal(repaymentDate(c, '2026-02-05'), '2026-02-25')
  const c31 = makeCard({ billingDay: 31, dueMode: 'offset', dueOffsetDays: 20 })
  assert.equal(repaymentDate(c31, '2026-02-28'), '2026-03-20')
  assert.equal(repaymentDate(c31, '2026-12-31'), '2027-01-20')
})

test('fixed 还款日：同日号早于账单日则顺延下月，小月兜底', () => {
  const early = makeCard({ billingDay: 20, dueMode: 'fixed', dueDay: 10 })
  assert.equal(repaymentDate(early, '2026-02-20'), '2026-03-10')
  const normal = makeCard({ billingDay: 5, dueMode: 'fixed', dueDay: 10 })
  assert.equal(repaymentDate(normal, '2026-02-05'), '2026-02-10')
  const small = makeCard({ billingDay: 31, dueMode: 'fixed', dueDay: 10 })
  assert.equal(repaymentDate(small, '2026-01-31'), '2026-02-10')
})

test('账期归属：账单日当天默认计入下期，开关打开计入当期', () => {
  const next = makeCard({ billingDay: 5 })
  assert.equal(statementBillingForSpend(next, '2026-02-05'), '2026-03-05')
  const curr = makeCard({ billingDay: 5, billingDayConsumptionIntoCurrent: true })
  assert.equal(statementBillingForSpend(curr, '2026-02-05'), '2026-02-05')
  // 账单日次日消费进入下一期
  assert.equal(statementBillingForSpend(next, '2026-02-06'), '2026-03-05')
  // 跨年
  assert.equal(statementBillingForSpend(next, '2026-12-20'), '2027-01-05')
})

test('免息天数 = 所在账期还款日 - 消费日', () => {
  const c = makeCard({ billingDay: 5 })
  assert.equal(interestFreeDays(c, '2026-02-06'), 47)
  assert.equal(interestFreeDays(c, '2026-02-05'), 48) // 账单日记入下期，免息更长
  const curr = makeCard({ billingDay: 5, billingDayConsumptionIntoCurrent: true })
  assert.equal(interestFreeDays(curr, '2026-02-05'), 20) // 计入当期
  assert.equal(interestFreeDays(c, '2026-12-20'), 36)
})

test('billingCycle：今天在账单日后取本期，账单日前取上一期', () => {
  const c = makeCard({ billingDay: 5, dueOffsetDays: 20 })
  const after = billingCycle(c, '2026-10-19')
  assert.deepEqual(
    { lastBilling: after.lastBilling, due: after.due, nextBilling: after.nextBilling, nextDue: after.nextDue },
    { lastBilling: '2026-10-05', due: '2026-10-25', nextBilling: '2026-11-05', nextDue: '2026-11-25' }
  )
  const before = billingCycle(c, '2026-10-03')
  assert.equal(before.lastBilling, '2026-09-05')
  assert.equal(before.due, '2026-09-25')
  assert.equal(before.nextBilling, '2026-10-05')
  // 跨年（31 号卡）
  const c31 = makeCard({ billingDay: 31, dueOffsetDays: 20 })
  const cy = billingCycle(c31, '2026-12-20')
  assert.equal(cy.lastBilling, '2026-11-30')
  assert.equal(cy.due, '2026-12-20')
  assert.equal(cy.nextBilling, '2026-12-31')
  assert.equal(cy.nextDue, '2027-01-20')
})

test('upcomingDues：未还显示本期，已还自动切到下一期，按临近排序', () => {
  const c = makeCard({ billingDay: 5, dueOffsetDays: 20 })
  const unpaid = upcomingDues([c], '2026-10-19', [])
  assert.equal(unpaid[0].billing, '2026-10-05')
  assert.equal(unpaid[0].daysLeft, 6)
  assert.equal(unpaid[0].urgent, 'normal')
  const paid = upcomingDues(
    [c],
    '2026-10-19',
    [{ id: 'p1', cardId: 'c1', periodBilling: '2026-10-05', paidAt: 1, amountCents: 0 }]
  )
  assert.equal(paid[0].billing, '2026-10-05')
  assert.equal(paid[0].due, '2026-10-25')
  assert.equal(paid[0].paid, true)
})

test('urgent 分级：逾期/今天/3天内/正常', () => {
  const c = makeCard({ billingDay: 5, dueMode: 'fixed', dueDay: 10 })
  const overdue = upcomingDues([c], '2026-03-11', [])
  assert.equal(overdue[0].urgent, 'overdue')
  const todayDue = upcomingDues([c], '2026-03-10', [])
  assert.equal(todayDue[0].urgent, 'today')
  const soon = upcomingDues([c], '2026-03-09', [])
  assert.equal(soon[0].urgent, 'soon')
})

test('年费刷免：笔数与金额双条件，滚动到年度截止', () => {
  const base = makeCard({
    feeGoal: { yearEnd: '2026-12-31', targetCount: 6, targetAmountCents: 0, progressCount: 4, progressAmountCents: 0 }
  })
  const s1 = feeStatus(base, '2026-10-19')!
  assert.equal(s1.countMet, false)
  assert.equal(s1.amountMet, true)
  assert.equal(s1.met, false)
  assert.equal(s1.needCount, 2)
  const done = makeCard({
    feeGoal: { yearEnd: '2026-12-31', targetCount: 6, targetAmountCents: 300000, progressCount: 6, progressAmountCents: 350000 }
  })
  const s2 = feeStatus(done, '2026-10-19')!
  assert.equal(s2.met, true)
  assert.equal(s2.needAmountCents, 0)
  assert.equal(feeStatus(makeCard(), '2026-10-19'), null)
})

test('利息/费用演示为整数分', () => {
  assert.equal(
    revolvingInterest({ billCents: 1000000, paidCents: 100000, days: 30, dailyRate: 0.0005 }),
    13500
  )
  assert.equal(installmentFee(1200000, 0.006, 12), 86400)
  assert.equal(latePenalty(200000), 10000)
  // 已全额还款 -> 0 利息
  assert.equal(
    revolvingInterest({ billCents: 100000, paidCents: 100000, days: 30, dailyRate: 0.0005 }),
    0
  )
})
