import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildActionList, groupByName, trendStatus, type MetricRecord } from '../src/tools/health-trend/lib/model'

test('trendStatus: 正常平稳', () => {
  const { status } = trendStatus('总胆固醇', [
    { year: 2023, value: 4.8, refHigh: 5.2 },
    { year: 2024, value: 4.9, refHigh: 5.2 }
  ])
  assert.equal(status, 'ok')
})

test('trendStatus: 超限判 abnormal', () => {
  const { status } = trendStatus('总胆固醇', [
    { year: 2024, value: 5.6, refHigh: 5.2 }
  ])
  assert.equal(status, 'abnormal')
})

test('trendStatus: 连续上升+涨幅20%+接近上限 → climb', () => {
  const { status, note } = trendStatus('空腹血糖', [
    { year: 2022, value: 5.0, refHigh: 6.1 },
    { year: 2023, value: 5.5, refHigh: 6.1 },
    { year: 2024, value: 6.0, refHigh: 6.1 }
  ])
  assert.equal(status, 'climb')
  assert.match(note, /连续上升/)
})

test('trendStatus: 涨幅<20% 不预警', () => {
  const { status } = trendStatus('血压', [
    { year: 2022, value: 120, refHigh: 140 },
    { year: 2024, value: 130, refHigh: 140 }
  ])
  assert.equal(status, 'ok')
})

test('buildActionList: abnormal 优先于 climb', () => {
  const recs: MetricRecord[] = [
    { id: '1', year: 2024, name: '尿酸', value: 480, unit: 'μmol/L', refHigh: 420 },
    { id: '2', year: 2022, name: '血糖', value: 5.0, unit: 'mmol/L', refHigh: 6.1 },
    { id: '3', year: 2023, name: '血糖', value: 5.5, unit: 'mmol/L', refHigh: 6.1 },
    { id: '4', year: 2024, name: '血糖', value: 6.0, unit: 'mmol/L', refHigh: 6.1 },
    { id: '5', year: 2024, name: '体重', value: 68, unit: 'kg', refHigh: null }
  ]
  const list = buildActionList(recs)
  assert.equal(list.length, 2)
  assert.equal(list[0]!.status, 'abnormal')
  assert.equal(list[0]!.name, '尿酸')
})

test('groupByName: 按指标名分组并按年排序', () => {
  const recs: MetricRecord[] = [
    { id: '1', year: 2024, name: '尿酸', value: 480, unit: '', refHigh: null },
    { id: '2', year: 2023, name: '尿酸', value: 420, unit: '', refHigh: null }
  ]
  const g = groupByName(recs)
  assert.equal(g.size, 1)
  assert.deepEqual([...g.get('尿酸')!].map(r => r.year), [2023, 2024])
})

test('单条编辑后趋势重算：climb 改平 → ok', () => {
  const base: MetricRecord[] = [
    { id: '1', year: 2022, name: '血糖', value: 5.0, unit: '', refHigh: 6.1 },
    { id: '2', year: 2023, name: '血糖', value: 5.5, unit: '', refHigh: 6.1 },
    { id: '3', year: 2024, name: '血糖', value: 6.0, unit: '', refHigh: 6.1 }
  ]
  assert.equal(trendStatus('血糖', base).status, 'climb')
  const edited = base.map(r => r.id === '3' ? { ...r, value: 5.2 } : r)
  assert.equal(trendStatus('血糖', edited).status, 'ok')
  assert.equal(buildActionList(edited).length, 0)
})

test('climb 三条件门槛缺一不可：中间回落不连续 → 不预警', () => {
  const noRise: MetricRecord[] = [
    { id: '1', year: 2022, name: '血糖', value: 5.0, unit: '', refHigh: 6.1 },
    { id: '2', year: 2023, name: '血糖', value: 4.8, unit: '', refHigh: 6.1 },
    { id: '3', year: 2024, name: '血糖', value: 6.0, unit: '', refHigh: 6.1 }
  ]
  assert.equal(trendStatus('血糖', noRise).status, 'ok')
})
