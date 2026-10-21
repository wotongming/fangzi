import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeAmount,
  parseDate,
  parseAmount,
  parseTax,
  parseMerchant,
  parseReceipt,
  csvCell,
  toCsv,
  summarizeByCategory,
  type ReceiptRecord
} from '../src/tools/receipt-vault/lib/extract.ts'

test('normalizeAmount：千分位/货币符号去除', () => {
  assert.equal(normalizeAmount('¥1,234.56'), '1234.56')
  assert.equal(normalizeAmount('￥99,999.00'), '99999.00')
})

test('parseDate：多版式', () => {
  assert.equal(parseDate('2026年10月21日 消费'), '2026-10-21')
  assert.equal(parseDate('2026/10/21'), '2026-10-21')
  assert.equal(parseDate('交易时间 10-21'), '')
})

test('parseAmount：合计/价税合计优先，兜底最大数', () => {
  assert.equal(parseAmount('合计 128.50\n明细 30.00'), '128.50')
  assert.equal(parseAmount('价税合计(小写) ¥56.70'), '56.70')
  assert.equal(parseAmount('A 12.00 B 99.00'), '99')
})

test('parseTax：税额标签', () => {
  assert.equal(parseTax('税额 3.40'), '3.40')
  assert.equal(parseTax('无税额行'), '')
})

test('parseMerchant：标签后/兜底首行', () => {
  assert.equal(parseMerchant('商户：星巴克咖啡南京店'), '星巴克咖啡南京店')
  assert.equal(parseMerchant('永辉超市\n鸡蛋 12.00'), '永辉超市')
})

test('parseReceipt：综合置信度', () => {
  const p = parseReceipt('商户：麦当劳\n2026-10-21\n合计 45.00\n税额 2.55')
  assert.equal(p.merchant, '麦当劳')
  assert.equal(p.date, '2026-10-21')
  assert.equal(p.amount, '45.00')
  assert.ok(p.confidence >= 0.7)
})

test('csvCell：转义与 toCsv', () => {
  assert.equal(csvCell('普通'), '普通')
  assert.equal(csvCell('a,b'), '"a,b"')
  assert.equal(csvCell('说"你好"'), '"说""你好"""')
  const rows: ReceiptRecord[] = [
    { id: '1', date: '2026-10-21', merchant: 'A', amount: '12.5', tax: '1', category: '餐饮', note: '', createdAt: 0 }
  ]
  assert.ok(toCsv(rows).includes('餐饮'))
})

test('summarizeByCategory', () => {
  const rows: ReceiptRecord[] = [
    { id: '1', date: '', merchant: '', amount: '10.00', tax: '', category: '餐饮', note: '', createdAt: 0 },
    { id: '2', date: '', merchant: '', amount: '20.50', tax: '', category: '餐饮', note: '', createdAt: 0 },
    { id: '3', date: '', merchant: '', amount: '5.00', tax: '', category: '交通', note: '', createdAt: 0 }
  ]
  assert.deepEqual(summarizeByCategory(rows), { 餐饮: 30.5, 交通: 5 })
})
