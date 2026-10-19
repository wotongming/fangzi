import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addDays, daysBetween, type Med } from '../src/tools/home-medicine/lib/models'
import { openedExpiryDate, effectiveExpiry, expiryInfo } from '../src/tools/home-medicine/lib/expiry'
import { reviewMeds, countByLevel } from '../src/tools/home-medicine/lib/safety'
import { isTakingOn, todayPlan } from '../src/tools/home-medicine/lib/schedule'
import { buildClinicText } from '../src/tools/home-medicine/lib/clinic-list'

const TODAY = '2026-10-19'
let seq = 0
function med(over: Partial<Med> = {}): Med {
  seq += 1
  return {
    id: over.id ?? `m${seq}`,
    memberId: 'mem1',
    name: over.name ?? `药品${seq}`,
    type: 'rx',
    form: 'tablet',
    ingredientKeys: [],
    slots: [],
    active: true,
    createdAt: seq,
    updatedAt: seq,
    ...over
  }
}

// ————— 日期基础 —————
test('daysBetween / addDays 跨月正确', () => {
  assert.equal(daysBetween('2026-10-01', '2026-10-19'), 18)
  assert.equal(daysBetween('', '2026-10-19'), null)
  assert.equal(addDays('2026-01-31', 28), '2026-02-28') // 跨 2 月（2026 平年）
  assert.equal(addDays('2026-09-01', 28), '2026-09-29')
})

// ————— 开封后期限 —————
test('滴眼液开封后默认 28 天', () => {
  assert.equal(openedExpiryDate(med({ form: 'eyeDrop', openedDate: '2026-09-01' })), '2026-09-29')
})
test('自定义开封天数优先于剂型默认', () => {
  assert.equal(openedExpiryDate(med({ form: 'liquid', openedDate: '2026-10-01', openDays: 14 })), '2026-10-15')
})
test('无开封日或剂型无默认期限返回 null', () => {
  assert.equal(openedExpiryDate(med({ form: 'eyeDrop' })), null)
  assert.equal(openedExpiryDate(med({ form: 'tablet', openedDate: '2026-10-01' })), null)
})

test('有效期与开封到期取更早者', () => {
  // 开封更早到期
  let e = effectiveExpiry(med({ form: 'eyeDrop', expiryDate: '2027-01-01', openedDate: '2026-09-01' }))
  assert.equal(e.date, '2026-09-29')
  assert.equal(e.basis, 'both')
  // 有效期更早
  e = effectiveExpiry(med({ form: 'eyeDrop', expiryDate: '2026-09-10', openedDate: '2026-09-01' }))
  assert.equal(e.date, '2026-09-10')
  assert.equal(effectiveExpiry(med({})).basis, 'none')
})

test('expiryInfo 分级 expired/near/ok/none', () => {
  assert.equal(expiryInfo(med({ expiryDate: '2026-01-01' }), TODAY).level, 'expired')
  assert.equal(expiryInfo(med({ expiryDate: '2026-12-01' }), TODAY).level, 'near') // 43 天
  assert.equal(expiryInfo(med({ expiryDate: '2027-06-01' }), TODAY).level, 'ok')
  assert.equal(expiryInfo(med({}), TODAY).level, 'none')
})

// ————— 安全梳理 —————
test('过期药产生 danger，临期产生 info', () => {
  const f = reviewMeds([med({ name: '旧药', expiryDate: '2026-01-01' }), med({ name: '将到期', expiryDate: '2026-12-01' })], TODAY)
  assert.ok(f.some((x) => x.type === 'expired' && x.level === 'danger'))
  assert.ok(f.some((x) => x.type === 'near' && x.level === 'info'))
})

test('开封超期（滴眼液）按开封口径提示停用', () => {
  const f = reviewMeds([med({ name: '眼药水', form: 'eyeDrop', expiryDate: '2027-01-01', openedDate: '2026-09-01' })], TODAY)
  const ex = f.find((x) => x.type === 'expired')
  assert.ok(ex)
  assert.match(ex!.title, /开封/)
})

test('两种含对乙酰氨基酚的活跃药触发成分重复', () => {
  const f = reviewMeds(
    [
      med({ name: '复方感冒药A', ingredientKeys: ['acetaminophen'] }),
      med({ name: '退烧药B', ingredientKeys: ['acetaminophen'] })
    ],
    TODAY
  )
  assert.ok(f.some((x) => x.type === 'duplicate' && /对乙酰氨基酚/.test(x.title)))
})

test('仅一种含该成分不误报', () => {
  const f = reviewMeds([med({ ingredientKeys: ['acetaminophen'] })], TODAY)
  assert.ok(!f.some((x) => x.type === 'duplicate'))
})

test('抗凝/抗血小板 + NSAID 不同药品触发高风险', () => {
  const f = reviewMeds(
    [
      med({ name: '华法林', ingredientKeys: ['warfarin'] }),
      med({ name: '布洛芬', ingredientKeys: ['ibuprofen'] })
    ],
    TODAY
  )
  assert.ok(f.some((x) => x.type === 'risk' && x.level === 'danger'))
})

test('单药不与自己配对触发跨组高风险（必须是两种不同药品）', () => {
  const f = reviewMeds([med({ name: '阿司匹林', ingredientKeys: ['aspirin'] })], TODAY)
  assert.ok(!f.some((x) => x.type === 'risk'))
})

test('已停用药品不参与成分/高风险判断，但仍检查有效期', () => {
  const f = reviewMeds(
    [
      med({ name: '停用药', active: false, ingredientKeys: ['acetaminophen'] }),
      med({ name: '在用', ingredientKeys: ['acetaminophen'] })
    ],
    TODAY
  )
  assert.ok(!f.some((x) => x.type === 'duplicate'))
})

test('未勾选已知成分时不凭空误报', () => {
  const f = reviewMeds([med({ name: '未知成分药A' }), med({ name: '未知成分药B' })], TODAY)
  assert.deepEqual(f, [])
})

test('countByLevel 统计', () => {
  const c = countByLevel(reviewMeds([med({ expiryDate: '2026-01-01' }), med({ expiryDate: '2026-12-01' })], TODAY))
  assert.equal(c.danger, 1)
  assert.equal(c.info, 1)
  assert.equal(c.warn, 0)
})

// ————— 服药计划 —————
test('isTakingOn 依据 active 与起止日期', () => {
  assert.equal(isTakingOn(med({ active: true }), TODAY), true)
  assert.equal(isTakingOn(med({ active: true, startDate: '2026-11-01' }), TODAY), false)
  assert.equal(isTakingOn(med({ active: true, stopDate: '2026-09-01' }), TODAY), false)
  assert.equal(isTakingOn(med({ active: false }), TODAY), false)
})

test('todayPlan 按早中晚睡前排序并过滤时段', () => {
  const plan = todayPlan(
    [
      med({ name: '晚药', slots: ['evening'] }),
      med({ name: '早药', slots: ['morning'] }),
      med({ name: '停服', slots: ['morning'], stopDate: '2026-09-01' })
    ],
    TODAY
  )
  assert.deepEqual(plan.map((p) => p.slot), ['morning', 'evening'])
  assert.equal(plan[0].items[0].med.name, '早药')
})

// ————— 就诊清单 —————
test('就诊清单包含分类与药品信息', () => {
  const txt = buildClinicText(
    { id: 'mem1', name: '爸爸', createdAt: 0, updatedAt: 0 },
    [
      med({ name: '氨氯地平', spec: '5mg*7片', type: 'rx', doseText: '1片', slots: ['morning'] }),
      med({ name: '钙片', type: 'supplement', slots: ['noon'] })
    ],
    TODAY
  )
  assert.match(txt, /就诊带药清单/)
  assert.match(txt, /处方药/)
  assert.match(txt, /氨氯地平/)
  assert.match(txt, /保健品/)
  assert.match(txt, /钙片/)
})
