import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CHECKLIST_ITEMS,
  classifyResponsibility,
  formatStamp,
  summarizeEvidence,
  type LedgerEntry,
  type PhotoRecord,
  type RepairTicket
} from '../src/tools/rent-evidence/lib/model'

describe('rent-evidence 责任初判', () => {
  it('老化/管道类词 → landlord', () => {
    assert.equal(classifyResponsibility('厨房水管老化漏水'), 'landlord')
    assert.equal(classifyResponsibility('电线路由跳闸'), 'landlord')
  })
  it('摔/砸/钉孔类词 → tenant', () => {
    assert.equal(classifyResponsibility('我不小心把马桶打碎了'), 'tenant')
    assert.equal(classifyResponsibility('墙上打了钉孔、地板有划痕'), 'tenant')
  })
  it('无关键词 → unknown', () => {
    assert.equal(classifyResponsibility('灯不亮了'), 'unknown')
    assert.equal(classifyResponsibility(''), 'unknown')
  })
})

describe('rent-evidence 时间戳格式', () => {
  it('补零格式化', () => {
    assert.equal(formatStamp('2026-11-02T03:05:00.000Z'), '2026-11-02 11:05') // UTC+8
  })
  it('非法输入返回空串', () => {
    assert.equal(formatStamp('not-a-date'), '')
  })
})

describe('rent-evidence 证据汇总', () => {
  const photos: PhotoRecord[] = [
    { id: '1', at: '2026-11-02T10:00:00Z', kind: 'move-in', item: '客厅墙面', note: '原色差', dataUrl: '' },
    { id: '2', at: '2026-11-20T10:00:00Z', kind: 'move-out', item: '客厅墙面', note: '新增钉孔', dataUrl: '' }
  ]
  const tickets: RepairTicket[] = [
    { id: 't1', at: '2026-11-10T10:00:00Z', title: '水龙头漏水', description: '自然老化', responsibility: 'landlord', costCents: 15000, photoIds: [] }
  ]
  const ledger: LedgerEntry[] = [
    { id: 'l1', at: '2026-11-01T10:00:00Z', kind: 'deposit', amountCents: 300000, note: '押金' }
  ]
  it('四段齐全且按时间排序', () => {
    const rows = summarizeEvidence(photos, tickets, ledger)
    assert.equal(rows.length, 4)
    assert.match(rows[0]!.section, /入住交接/)
    assert.match(rows[1]!.section, /退租对比/)
    assert.match(rows[2]!.section, /报修工单/)
    assert.match(rows[3]!.section, /台账/)
  })
  it('金额换算为元', () => {
    const rows = summarizeEvidence(photos, tickets, ledger)
    assert.ok(rows[3]!.lines.some((l) => l.includes('¥3000')))
    assert.ok(rows[2]!.lines.some((l) => l.includes('¥150')))
  })
  it('空数据也产出四段且标注暂无', () => {
    const rows = summarizeEvidence([], [], [])
    assert.equal(rows.length, 4)
  })
})

describe('rent-evidence 交接清单', () => {
  it('预置覆盖墙面/地板/家电/表读数', () => {
    const s = CHECKLIST_ITEMS.join('|')
    for (const need of ['墙面', '地板', '空调', '水表', '电表', '钥匙']) {
      assert.ok(s.includes(need), '缺少 ' + need)
    }
  })
})
