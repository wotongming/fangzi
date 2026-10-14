/**
 * 家庭财务管家 —— 业务纯函数单测
 * 覆盖：记账/分类聚合、预算与超支预警、月报/趋势/环比、省钱洞察规则。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  aggregateByCategory,
  aggregateByDay,
  aggregateByPlatform,
  currentMonth,
  fmtYuan,
  inMonth,
  recentMonths,
  today,
  totalByType,
  type LedgerEntry
} from '../src/tools/household-finance/ledger.ts'
import { budgetStatus, monthlyBudgetStatus, type Budget } from '../src/tools/household-finance/budget.ts'
import { changeRatio, monthlyReport, trendReport } from '../src/tools/household-finance/report.ts'
import { generateInsights } from '../src/tools/household-finance/insight.ts'

function entry(patch: Partial<LedgerEntry> & Pick<LedgerEntry, 'amountCents'>): LedgerEntry {
  return {
    id: patch.id ?? `e-${Math.random().toString(36).slice(2)}`,
    type: patch.type ?? 'expense',
    amountCents: patch.amountCents,
    category: patch.category ?? '餐饮',
    tags: patch.tags ?? [],
    platform: patch.platform ?? 'wechat',
    date: patch.date ?? '2026-10-05',
    createdAt: patch.createdAt ?? Date.now(),
    note: patch.note
  }
}

const OCT_SAMPLE: LedgerEntry[] = [
  entry({ amountCents: 3000, category: '餐饮', date: '2026-10-01', platform: 'wechat' }),
  entry({ amountCents: 2000, category: '餐饮', date: '2026-10-03', platform: 'alipay' }),
  entry({ amountCents: 5000, category: '购物', date: '2026-10-05', platform: 'wechat' }),
  entry({ amountCents: 1000, category: '交通', date: '2026-10-08', platform: 'bank' }),
  entry({ amountCents: 30000, type: 'income', category: '工资', date: '2026-10-10', platform: 'bank' }),
  entry({ amountCents: 800, category: '餐饮', date: '2026-09-28', platform: 'cash' })
]

test('ledger：inMonth 只命中目标月份', () => {
  assert.equal(inMonth(OCT_SAMPLE[0]!, '2026-10'), true)
  assert.equal(inMonth(OCT_SAMPLE[5]!, '2026-10'), false)
})

test('ledger：按类型汇总金额正确（支出 11800 / 收入 30000，含 9 月一条）', () => {
  assert.equal(totalByType(OCT_SAMPLE, 'expense'), 11800)
  assert.equal(totalByType(OCT_SAMPLE, 'income'), 30000)
})

test('ledger：按分类聚合按金额降序并计算占比', () => {
  const agg = aggregateByCategory(OCT_SAMPLE, { type: 'expense', month: '2026-10' })
  assert.equal(agg.length, 3)
  assert.equal(agg[0]!.category, '餐饮')
  assert.equal(agg[0]!.amountCents, 5000)
  assert.equal(agg[0]!.count, 2)
  assert.ok(Math.abs(agg[0]!.ratio - 5000 / 11000) < 1e-9)
  assert.equal(agg[2]!.category, '交通')
})

test('ledger：按平台聚合多平台支出', () => {
  const agg = aggregateByPlatform(OCT_SAMPLE, { type: 'expense', month: '2026-10' })
  const wechat = agg.find((a) => a.platform === 'wechat')!
  assert.equal(wechat.amountCents, 8000)
  assert.equal(wechat.count, 2)
})

test('ledger：按日聚合月内收支', () => {
  const days = aggregateByDay(OCT_SAMPLE, '2026-10')
  assert.equal(days.length, 5)
  assert.equal(days[0]!.expenseCents, 3000)
  assert.ok(days.some((d) => d.date === '2026-10-10' && d.incomeCents === 30000))
})

test('ledger：recentMonths / currentMonth / today 格式正确', () => {
  const months = recentMonths(3, new Date(2026, 9, 14))
  assert.deepEqual(months, ['2026-10', '2026-09', '2026-08'])
  assert.equal(currentMonth(new Date(2026, 9, 14)), '2026-10')
  assert.equal(today(new Date(2026, 9, 14)), '2026-10-14')
  assert.equal(fmtYuan(12345), '123.45')
})

test('budget：budgetStatus 未超支 / 超支 / 零预算', () => {
  assert.deepEqual(budgetStatus(5000, 10000), { usedRatio: 0.5, over: false, remainCents: 5000 })
  const over = budgetStatus(12000, 10000)
  assert.equal(over.over, true)
  assert.equal(over.remainCents, -2000)
  assert.equal(budgetStatus(100, 0).over, true)
})

test('budget：monthlyBudgetStatus 汇总总预算与分类预算并排序', () => {
  const budgets: Budget[] = [
    { id: 'b1', category: '__all__', month: '*', amountCents: 12000 },
    { id: 'b2', category: '餐饮', month: '*', amountCents: 4000 },
    { id: 'b3', category: '购物', month: '*', amountCents: 9000 }
  ]
  const status = monthlyBudgetStatus(OCT_SAMPLE, budgets, '2026-10')
  const all = status.find((s) => s.budget.id === 'b1')!
  const food = status.find((s) => s.budget.id === 'b2')!
  assert.equal(all.spentCents, 11000)
  assert.equal(all.over, false)
  assert.equal(food.usedRatio, 5000 / 4000)
  assert.equal(food.over, true)
  // 不匹配月份的预算应被跳过
  const octOnly: Budget[] = [{ id: 'b4', category: '餐饮', month: '2026-11', amountCents: 10000 }]
  assert.equal(monthlyBudgetStatus(OCT_SAMPLE, octOnly, '2026-10').length, 0)
})

test('report：monthlyReport 收支结余与分类/日聚合正确', () => {
  const r = monthlyReport(OCT_SAMPLE, '2026-10')
  assert.equal(r.incomeCents, 30000)
  assert.equal(r.expenseCents, 11000)
  assert.equal(r.balanceCents, 19000)
  assert.equal(r.byCategory.length, 3)
  assert.equal(r.byDay.length, 5)
})

test('report：trendReport 覆盖指定月份升序', () => {
  const trend = trendReport(OCT_SAMPLE, ['2026-09', '2026-10'])
  assert.equal(trend.length, 2)
  assert.equal(trend[0]!.month, '2026-09')
  assert.equal(trend[0]!.expenseCents, 800)
  assert.equal(trend[1]!.month, '2026-10')
  assert.equal(trend[1]!.expenseCents, 11000)
})

test('report：changeRatio 环比与零分母边界', () => {
  assert.equal(changeRatio(120, 100), 0.2)
  assert.equal(changeRatio(0, 0), 0)
  assert.equal(changeRatio(50, 0), null)
})

test('insight：高占比可优化类目触发预警', () => {
  const entries = [
    entry({ amountCents: 6000, category: '餐饮', date: '2026-10-02' }),
    entry({ amountCents: 2000, category: '餐饮', date: '2026-10-03' }),
    entry({ amountCents: 2000, category: '交通', date: '2026-10-04' })
  ]
  const insights = generateInsights(entries, [], '2026-10')
  assert.ok(insights.some((i) => i.level === 'warn' && i.title.startsWith('餐饮占比偏高')))
})

test('insight：超支预算触发预警，接近上限触发提示', () => {
  const budgets: Budget[] = [
    { id: 'b1', category: '__all__', month: '*', amountCents: 12000 },
    { id: 'b2', category: '餐饮', month: '*', amountCents: 4500 }
  ]
  const insights = generateInsights(OCT_SAMPLE, budgets, '2026-10')
  assert.ok(insights.some((i) => i.title === '总预算快用完了'))
  assert.ok(insights.some((i) => i.title === '餐饮已超支'))
})

test('insight：支出环比上升 ≥15% 触发提示', () => {
  const entries = [
    entry({ amountCents: 1000, category: '餐饮', date: '2026-09-01' }),
    entry({ amountCents: 3000, category: '餐饮', date: '2026-10-01' })
  ]
  const insights = generateInsights(entries, [], '2026-10')
  assert.ok(insights.some((i) => i.title.includes('支出环比上升')))
})

test('insight：储蓄率 ≥30% 给出正向提示', () => {
  const entries = [
    entry({ amountCents: 1000, category: '餐饮', date: '2026-10-01' }),
    entry({ amountCents: 10000, type: 'income', category: '工资', date: '2026-10-05' })
  ]
  const insights = generateInsights(entries, [], '2026-10')
  assert.ok(insights.some((i) => i.level === 'good' && i.title === '储蓄率不错'))
})

test('insight：无支出时返回空洞察', () => {
  assert.equal(generateInsights([], [], '2026-10').length, 0)
})
