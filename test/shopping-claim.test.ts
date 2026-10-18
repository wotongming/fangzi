import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addDays,
  addMonths,
  diffDays,
  fmtYuan,
  yuanToCents,
  type Category,
  type ClaimCase
} from '../src/tools/shopping-claim/lib/models'
import { computeWindows } from '../src/tools/shopping-claim/lib/deadline-engine'
import { newCase, moveStatus, nextStatus, prevStatus, STATUS_ORDER } from '../src/tools/shopping-claim/lib/case-state'
import { buildLetter, hasUnfilledPlaceholder, SCENARIOS, LETTER_TYPES } from '../src/tools/shopping-claim/lib/letters'
import { buildReminders, buildIcs } from '../src/tools/shopping-claim/lib/notify'
import { evidenceFileName } from '../src/tools/shopping-claim/lib/evidence'

function mkCase(over: Partial<ClaimCase> = {}): ClaimCase {
  const base: Omit<ClaimCase, 'id' | 'status' | 'logs' | 'createdAt' | 'updatedAt'> = {
    product: '测试变频空调',
    channel: '某平台某旗舰店',
    orderNo: 'SO20261001001',
    amountCents: 299900,
    receivedDate: '2026-10-01',
    foundDate: '2026-10-04',
    category: 'appliance',
    customMade: false,
    priceProtectDays: 30
  }
  return newCase({ ...base, ...over } as Omit<ClaimCase, 'id' | 'status' | 'logs' | 'createdAt' | 'updatedAt'>)
}

function byKey(c: ClaimCase, today: string, key: string) {
  return computeWindows(c, today).find((w) => w.key === key)
}

test('日期工具：addDays / diffDays / 跨月', () => {
  assert.equal(addDays('2026-10-01', 7), '2026-10-08')
  assert.equal(addDays('2026-10-30', 5), '2026-11-04')
  assert.equal(diffDays('2026-10-05', '2026-10-08'), 3)
  assert.equal(diffDays('2026-10-09', '2026-10-08'), -1)
})

test('addMonths：跨月取月末，闰年 2 月', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28')
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29')
  assert.equal(addMonths('2026-10-01', 12), '2027-10-01')
  assert.equal(addMonths('2026-03-31', 1), '2026-04-30')
})

test('金额整数分：解析与格式化', () => {
  assert.equal(yuanToCents('2999'), 299900)
  assert.equal(yuanToCents('¥1,299.90'), 129990)
  assert.equal(yuanToCents(''), undefined)
  assert.equal(yuanToCents('abc'), undefined)
  assert.equal(fmtYuan(990), '¥9.90')
})

test('7 天无理由：进行中 / 今天到期 / 已过期', () => {
  const c = mkCase()
  assert.equal(byKey(c, '2026-10-05', 'noReason')?.state, 'open')
  assert.equal(byKey(c, '2026-10-05', 'noReason')?.daysLeft, 3)
  assert.equal(byKey(c, '2026-10-08', 'noReason')?.state, 'due-soon')
  assert.equal(byKey(c, '2026-10-09', 'noReason')?.state, 'expired')
})

test('质量问题：无理由过期后，动作提示改走质量通道', () => {
  const c = mkCase()
  const w = byKey(c, '2026-10-20', 'noReason')
  assert.equal(w?.state, 'expired')
  assert.match(w!.action, /质量问题/)
})

test('三包 15 日换货：仅适用品类；家具/服饰无此窗口', () => {
  assert.ok(byKey(mkCase({ category: 'appliance' }), '2026-10-05', 'exchange15'))
  assert.ok(byKey(mkCase({ category: 'computer' }), '2026-10-05', 'exchange15'))
  assert.equal(byKey(mkCase({ category: 'furniture' }), '2026-10-05', 'exchange15'), undefined)
  assert.equal(byKey(mkCase({ category: 'clothing' }), '2026-10-05', 'exchange15'), undefined)
})

test('保修期：家电/电脑/家具有月数；一般商品为不适用', () => {
  assert.equal(byKey(mkCase({ category: 'appliance' }), '2026-10-05', 'warranty')?.end, '2027-10-01')
  assert.equal(byKey(mkCase({ category: 'general' }), '2026-10-05', 'warranty')?.state, 'na')
})

test('价保：天数为 0 时不生成窗口', () => {
  assert.ok(byKey(mkCase({ priceProtectDays: 30 }), '2026-10-05', 'priceProtect'))
  assert.equal(byKey(mkCase({ priceProtectDays: 0 }), '2026-10-05', 'priceProtect'), undefined)
})

test('定作商品：7 天无理由标记为不适用，但仍提示质量通道', () => {
  const c = mkCase({ customMade: true })
  const w = byKey(c, '2026-10-05', 'noReason')
  assert.equal(w?.state, 'na')
  assert.match(w!.action, /质量问题/)
})

test('窗口排序：临期优先', () => {
  const c = mkCase()
  const wins = computeWindows(c, '2026-10-07')
  // 10-07：无理由剩 1 天（due-soon）应排最前
  assert.equal(wins[0]!.key, 'noReason')
})

test('状态机：新建在待取证，可前进到完成、可回退', () => {
  let c = mkCase()
  assert.equal(c.status, 'evidence')
  assert.equal(nextStatus('evidence'), 'negotiate')
  assert.equal(prevStatus('evidence'), null)
  c = moveStatus(c, 'platform', '申请介入')
  assert.equal(c.status, 'platform')
  assert.equal(c.logs[c.logs.length - 1]!.note, '申请介入')
  c = moveStatus(c, 'negotiate', '回退')
  assert.equal(c.status, 'negotiate')
  assert.equal(STATUS_ORDER[STATUS_ORDER.length - 1], 'done')
})

test('文书：5 情形 × 3 类型都无空占位、含商品与关键信息', () => {
  const c = mkCase()
  for (const s of SCENARIOS) {
    for (const t of LETTER_TYPES) {
      const text = buildLetter(c, s.key, t.key)
      assert.ok(!hasUnfilledPlaceholder(text), `${s.key}/${t.key} 残留占位符`)
      assert.ok(text.includes(c.product), `${s.key}/${t.key} 缺商品名`)
      assert.ok(text.includes(c.orderNo), `${s.key}/${t.key} 缺订单号`)
      assert.ok(text.includes('诉求'), `${s.key}/${t.key} 缺诉求`)
    }
  }
  const c12315 = buildLetter(c, 'quality', 'complain12315')
  assert.match(c12315, /12315|市场监管/)
  assert.match(c12315, /不构成法律意见|自述草稿/)
  const nego = buildLetter(c, 'noReason', 'negotiate')
  assert.match(nego, /无理由/)
})

test('文书：缺金额/渠道/发现日期也不留空（显示未填）', () => {
  const c = mkCase({ amountCents: undefined, channel: '', foundDate: undefined })
  const text = buildLetter(c, 'wrong', 'platform')
  assert.ok(!hasUnfilledPlaceholder(text))
  assert.ok(text.includes('未填'))
})

test('提醒：生成到期与提前 2 天事件，ics 合法', () => {
  const c = mkCase()
  const wins = computeWindows(c, '2026-10-05')
  const evs = buildReminders(wins, c.product)
  assert.ok(evs.some((e) => e.date === '2026-10-08')) // 无理由到期
  const ics = buildIcs(evs)
  assert.match(ics, /BEGIN:VCALENDAR/)
  assert.match(ics, /BEGIN:VEVENT/)
  assert.match(ics, /DTSTART;VALUE=DATE:20261008/)
  assert.match(ics, /END:VCALENDAR/)
})

test('证据文件名：序号_类型_时间戳.jpg 连续可追溯', () => {
  const name = evidenceFileName({
    id: 'e1',
    caseId: 'c1',
    seq: 1,
    kind: 'order',
    originalName: 'a.png',
    mime: 'image/jpeg',
    width: 100,
    height: 100,
    bytes: 1234,
    blob: new Blob(),
    capturedAt: new Date(2026, 9, 18, 9, 7, 5).getTime(),
    createdAt: 0
  })
  assert.match(name, /^01_order_20261018-090705\.jpg$/)
})

test('全部六类品类都能算出窗口数组且不抛错', () => {
  for (const category of ['digital', 'appliance', 'computer', 'furniture', 'clothing', 'general'] as Category[]) {
    const wins = computeWindows(mkCase({ category }), '2026-10-05')
    assert.ok(wins.length >= 2)
  }
})
