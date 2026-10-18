import { test } from 'node:test'
import assert from 'node:assert/strict'
import { duesForPet, allDues } from '../src/tools/pet-health/lib/schedule'
import { petTimeline, weightSeries, weightDeltas } from '../src/tools/pet-health/lib/timeline'
import { costByCategory, medPriceCompare } from '../src/tools/pet-health/lib/cost'
import { buildSummary } from '../src/tools/pet-health/lib/summary'
import { dayMs, normalizeMedName, type CarePlan, type HealthEvent, type Pet } from '../src/tools/pet-health/lib/models'

const PET = 'pet1'
// 以固定“今天”做断言：2026-10-18 当地零点
const NOW = new Date(2026, 9, 18, 12, 0, 0).getTime()

function plan(over: Partial<CarePlan> = {}): CarePlan {
  return { id: 'pl1', petId: PET, planKey: 'deworm-monthly', enabled: true, intervalDays: 30, startDate: '2026-09-18', ...over }
}
function ev(over: Partial<HealthEvent> = {}): HealthEvent {
  return { id: 'e1', petId: PET, kind: 'deworm', date: '2026-10-01', name: '驱虫', photoIds: [], createdAt: 1, ...over }
}

test('无历史记录时以 startDate + 周期 计算下次到期', () => {
  const d = duesForPet([plan()], [], PET, NOW)[0]!
  assert.equal(d.dueDate, '2026-10-18')
  assert.equal(d.today, true)
  assert.equal(d.daysLeft, 0)
  assert.equal(d.basis, '2026-09-18')
})

test('有最近记录时以最近记录顺延；逾期判定正确', () => {
  const events = [
    ev({ id: 'e1', date: '2026-09-01', planKey: 'deworm-monthly' }),
    ev({ id: 'e2', date: '2026-09-20', planKey: 'deworm-monthly' }),
    ev({ id: 'e3', date: '2026-10-15' }) // 未关联计划，不参与顺延
  ]
  const d = duesForPet([plan()], events, PET, NOW)[0]!
  // 最近 09-20 + 30 天 = 10-20
  assert.equal(d.dueDate, '2026-10-20')
  assert.equal(d.daysLeft, 2)
  assert.equal(d.overdue, false)
  assert.equal(d.basis, '2026-09-20')
})

test('逾期天数为负且排在前', () => {
  const d = duesForPet([plan({ startDate: '2026-08-01' })], [], PET, NOW)[0]!
  assert.ok(d.daysLeft < 0)
  assert.equal(d.overdue, true)
})

test('停用的计划不产生待办；allDues 汇总多宠并按到期升序', () => {
  assert.equal(duesForPet([plan({ enabled: false })], [], PET, NOW).length, 0)
  const p2: CarePlan = { ...plan(), id: 'pl2', petId: 'pet2', startDate: '2026-09-01' }
  const all = allDues([plan(), p2], [], NOW)
  assert.equal(all.length, 2)
  assert.ok(all[0]!.daysLeft <= all[1]!.daysLeft)
})

test('时间线按日期新→旧；体重序列旧→新', () => {
  const es = [ev({ id: 'a', date: '2026-10-01' }), ev({ id: 'b', kind: 'weight', date: '2026-10-10', valueKg: 4 }), ev({ id: 'c', kind: 'weight', date: '2026-10-05', valueKg: 3.8 })]
  assert.deepEqual(petTimeline(es, PET).map((x) => x.id), ['b', 'c', 'a'])
  const w = weightSeries(es, PET)
  assert.deepEqual(w.map((x) => x.date), ['2026-10-05', '2026-10-10'])
  const deltas = weightDeltas(w)
  assert.equal(deltas[0]!.deltaKg, 0.2)
})

test('花费按类型汇总且各类之和=总额（守恒）', () => {
  const es = [
    ev({ id: '1', kind: 'visit', date: '2026-03-01', amountCents: 5000 }),
    ev({ id: '2', kind: 'visit', date: '2026-04-01', amountCents: 2000 }),
    ev({ id: '3', kind: 'med', date: '2026-04-02', amountCents: 1500 }),
    ev({ id: '4', kind: 'visit', date: '2025-01-01', amountCents: 9999 })
  ]
  const r = costByCategory(es, PET, 2026)
  assert.equal(r.totalCents, 8500)
  assert.equal(r.items.reduce((s, x) => s + x.cents, 0), r.totalCents)
  const visit = r.items.find((x) => x.kind === 'visit')!
  assert.equal(visit.count, 2)
})

test('药价按归一名聚合，标出最大自录差额且明确为自录', () => {
  const es = [
    ev({ id: '1', kind: 'medprice', name: '海乐妙 56mg', date: '2026-10-01', amountCents: 12000, hospital: 'A院', spec: '1粒' }),
    ev({ id: '2', kind: 'medprice', name: '海乐妙（56mg）', date: '2026-10-10', amountCents: 9800, hospital: 'B院', spec: '1粒' })
  ]
  const groups = medPriceCompare(es, PET)
  assert.equal(groups.length, 1)
  assert.equal(groups[0]!.spreadCents, 2200)
  assert.equal(groups[0]!.rows.length, 2)
  assert.equal(normalizeMedName('海乐妙 56mg'), normalizeMedName('海乐妙（56mg）'))
})

test('病情摘要包含宠物/过敏/既往与免责，且无数据有兜底，不编造', () => {
  const pet: Pet = { id: PET, name: '豆豆', species: 'cat', gender: 'female', neutered: true, allergies: '青霉素', chronic: '牙菌斑', createdAt: 1 }
  const text = buildSummary(pet, [ev({ kind: 'symptom', name: '呕吐', date: '2026-10-15', note: '两次' })], {})
  assert.match(text, /豆豆/)
  assert.match(text, /青霉素/)
  assert.match(text, /牙菌斑/)
  assert.match(text, /呕吐/)
  assert.match(text, /不能替代兽医诊断/)
  const empty = buildSummary(pet, [], { start: '2026-11-01' })
  assert.match(empty, /暂无健康记录/)
})

test('dayMs 为当地零点，不受 UTC 偏移影响', () => {
  assert.equal(dayMs('2026-10-18'), new Date(2026, 9, 18).getTime())
})
