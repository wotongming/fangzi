import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDashboard,
  bucketOf,
  centsToYuan,
  daysOverdue,
  fillTemplate,
  stageOf,
  statusLabel
} from '../src/tools/payment-chaser/lib/aging.ts'
import { renderLetter } from '../src/tools/payment-chaser/lib/templates.ts'
import type { Invoice } from '../src/tools/payment-chaser/lib/models.ts'

function inv(partial: Partial<Invoice>): Invoice {
  return {
    id: partial.id ?? 'x',
    clientName: partial.clientName ?? '客户A',
    projectName: partial.projectName ?? '项目X',
    amountCents: partial.amountCents ?? 100000,
    dueDate: partial.dueDate ?? '2026-09-01',
    paid: partial.paid ?? false,
    timeline: partial.timeline ?? [],
    createdAt: '2026-10-01T00:00:00Z',
    ...partial
  } as Invoice
}

test('daysOverdue：未到期为负，已付清为 0', () => {
  assert.equal(daysOverdue(inv({ dueDate: '2026-11-01' }), '2026-10-22'), -10)
  assert.equal(daysOverdue(inv({ dueDate: '2026-09-22' }), '2026-10-22'), 30)
  assert.equal(daysOverdue(inv({ dueDate: '2026-09-22', paid: true }), '2026-10-22'), 0)
})

test('bucketOf 边界：29/30/59/60/89/90 正确分桶', () => {
  assert.equal(bucketOf(-1), 'notdue')
  assert.equal(bucketOf(0), '0-30')
  assert.equal(bucketOf(29), '0-30')
  assert.equal(bucketOf(30), '30-60')
  assert.equal(bucketOf(59), '30-60')
  assert.equal(bucketOf(60), '60-90')
  assert.equal(bucketOf(89), '60-90')
  assert.equal(bucketOf(90), '90+')
})

test('stageOf：<7 礼貌，<30 正式，>=30 最后通牒', () => {
  assert.equal(stageOf(5), 1)
  assert.equal(stageOf(14), 2)
  assert.equal(stageOf(45), 3)
})

test('buildDashboard：未付按桶汇总，已付清不计入，坏账=90+', () => {
  const today = '2026-10-22'
  const list = [
    inv({ id: 'a', dueDate: '2026-10-10', amountCents: 100000 }), // 逾期12天 0-30
    inv({ id: 'b', dueDate: '2026-08-01', amountCents: 200000 }), // 逾期82天 60-90
    inv({ id: 'c', dueDate: '2026-06-01', amountCents: 300000 }), // 逾期143天 90+
    inv({ id: 'd', dueDate: '2026-10-10', amountCents: 50000, paid: true }) // 已付不计
  ]
  const d = buildDashboard(list, today)
  assert.equal(d.totalOutstandingCents, 600000)
  assert.equal(d.totalOutstandingCount, 3)
  assert.equal(d.badDebtCents, 300000)
  const b30 = d.buckets.find((b) => b.key === '0-30')!
  assert.equal(b30.cents, 100000)
  assert.equal(b30.count, 1)
  const b90 = d.buckets.find((b) => b.key === '90+')!
  assert.equal(b90.cents, 300000)
})

test('centsToYuan：千分位与两位小数', () => {
  assert.equal(centsToYuan(100), '¥1.00')
  assert.equal(centsToYuan(1234567), '¥12,345.67')
})

test('fillTemplate：变量替换，未命中保留', () => {
  const out = fillTemplate('{{client}} 项目 {{project}} 金额 {{amount}} 日期 {{dueDate}} {{days}} 天 {{x}}', {
    client: '王总',
    project: '官网',
    amount: '¥8,000.00',
    dueDate: '2026-09-01',
    days: 45
  })
  assert.equal(out, '王总 项目 官网 金额 ¥8,000.00 日期 2026-09-01 45 天 {{x}}')
})

test('renderLetter：三档标题与客户/金额/天数填入', () => {
  const vars = { client: '李总', project: '海报', amount: '¥3,000.00', dueDate: '2026-09-01', days: 45 }
  const l1 = renderLetter(1, vars)
  const l3 = renderLetter(3, vars)
  assert.ok(l1.includes('礼貌提醒'))
  assert.ok(l3.includes('最后通牒'))
  assert.ok(l3.includes('李总'))
  assert.ok(l3.includes('¥3,000.00'))
  assert.ok(l3.includes('45'))
})

test('statusLabel: 逾期>0 显示逾期 N 天', () => {
  assert.deepStrictEqual(statusLabel(45), { text: '逾期 45 天', tone: 'overdue' })
  assert.deepStrictEqual(statusLabel(1), { text: '逾期 1 天', tone: 'overdue' })
})

test('statusLabel: 未到期不出现负逾期', () => {
  assert.deepStrictEqual(statusLabel(-10), { text: '未到期（10 天后到期）', tone: 'dueSoon' })
  assert.deepStrictEqual(statusLabel(0), { text: '今天到期', tone: 'dueSoon' })
})

test('renderLetter: 未到期单用友好提醒而非催告', () => {
  const out = renderLetter(3, { client: '张老师', project: '海报', amount: '¥3,000.00', dueDate: '2026-11-01', days: -10 })
  assert.ok(!out.includes('逾期'))
  assert.ok(out.includes('到期前友好提醒'))
  assert.ok(out.includes('10 天'))
})
