import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findHeaderRow, parseBillSheet } from '../src/tools/receipt-vault/lib/bill-import.ts'

test('微信账单：跳过前 N 行说明，命中表头，金额方向正确', () => {
  const rows = [
    ['微信支付账单明细列表'],
    ['起始时间：2026-10-01'],
    ['微信账号：x'],
    [],
    ['交易时间', '交易类型', '交易对方', '商品', '收/支', '金额(元)', '支付状态'],
    ['2026-10-12 12:30:00', '商户消费', '星巴克咖啡南京', '拿铁', '支出', '¥ 42.45', '支付成功'],
    ['2026-10-13 09:00:00', '退款', '滴滴出行', '快车', '收入', '¥ 12.00', '退款成功'],
    ['2026-10-14 18:00:00', '转账', '张三', '', '支出', '50.00', '']
  ] as unknown[][]
  const hi = findHeaderRow(rows)
  assert.equal(hi, 4)
  const out = parseBillSheet(rows)
  assert.equal(out.length, 3)
  assert.equal(out[0]!.merchant, '星巴克咖啡南京')
  assert.equal(out[0]!.amount, '42.45') // 支出正
  assert.equal(out[1]!.amount, '-12.00') // 退款/收入负
  assert.equal(out[2]!.amount, '50.00')
  assert.equal(out[0]!.date, '2026-10-12')
})

test('支付宝账单：「商品说明」列也能映射', () => {
  const rows = [
    ['交易时间', '交易分类', '交易对方', '商品说明', '收/支', '金额（元）'],
    ['2026-10-15 10:00', '餐饮', '海底捞', '火锅套餐', '支出', '¥288.00']
  ] as unknown[][]
  const out = parseBillSheet(rows)
  assert.equal(out.length, 1)
  assert.equal(out[0]!.merchant, '海底捞')
  assert.equal(out[0]!.amount, '288.00')
})

test('无表头 / 空数据明确报错', () => {
  assert.throws(() => parseBillSheet([['a', 'b'], ['c', 'd']]), /未找到账单表头/)
  assert.throws(() => parseBillSheet([['交易时间', '金额'], []]), /没有可导入的交易行/)
})
