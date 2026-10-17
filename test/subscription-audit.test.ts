import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseCsv,
  yuanToCents,
  parseFlexibleDate,
  findColumn,
  decodeText
} from '../reusable-module/bill-csv/bill-csv'
import { normalizeMerchant, detectRecurring } from '../reusable-module/recurring-detect/recurring-detect'
import { parseBillText, mergeRecords } from '../src/tools/subscription-audit/lib/platforms'
import { buildSubscriptions } from '../src/tools/subscription-audit/lib/subscriptions'
import { summarize, toReportCsv } from '../src/tools/subscription-audit/lib/report'
import { buildIcs } from '../src/tools/subscription-audit/lib/remind'

const DAY = 86400000

test('parseCsv 处理引号/逗号/换行/转义', () => {
  const rows = parseCsv('a,b,"c,d"\n"x""y","line1\nline2",z\n')
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], ['a', 'b', 'c,d'])
  assert.deepEqual(rows[1], ['x"y', 'line1\nline2', 'z'])
})

test('yuanToCents 去符号并整数化，非法返回 null', () => {
  assert.equal(yuanToCents('¥19.90'), 1990)
  assert.equal(yuanToCents('1,299.00'), 129900)
  assert.equal(yuanToCents('abc'), null)
})

test('parseFlexibleDate 多格式', () => {
  assert.equal(new Date(parseFlexibleDate('2026-09-01 12:30:00')!).getUTCDate(), 1)
  assert.equal(new Date(parseFlexibleDate('2026/9/1 12:30')!).getUTCMonth(), 8)
  assert.equal(parseFlexibleDate('无日期'), null)
})

test('findColumn 精确与包含', () => {
  assert.equal(findColumn(['交易时间', '金额(元)', '备注'], ['金额（元）', '金额']), 1)
  assert.equal(findColumn(['x'], ['不存在']), -1)
})

test('decodeText GBK 回退（构造非法 utf-8 字节）', () => {
  const buf = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]).buffer // GBK「你好」
  const { text } = decodeText(buf)
  assert.ok(text.includes('你好'))
})

test('normalizeMerchant 去备注/尾号/续费词', () => {
  assert.equal(normalizeMerchant('腾讯视频VIP(自动续费)'), normalizeMerchant('腾讯视频VIP-1234'))
  assert.ok(normalizeMerchant('爱奇艺会员连续包月').includes('爱奇艺会员'))
})

function monthlyRows(name: string, platform: 'wechat' | 'alipay', n: number, price: number): ReturnType<typeof parseBillText>['records'] {
  const out = []
  const start = Date.UTC(2026, 0, 1)
  for (let i = 0; i < n; i++) {
    out.push({
      id: `${platform}-${name}-${i}`,
      platform,
      account: platform === 'wechat' ? '微信账户' : '支付宝账户',
      time: start + i * 30 * DAY,
      counterparty: name,
      product: name + '会员',
      displayName: name + '会员',
      amountCents: price,
      direction: 'expense',
      orderNo: `O-${name}-${i}`,
      source: 'x.csv'
    })
  }
  return out
}

test('detectRecurring 识别月付并预测下次/年化', () => {
  const rows = monthlyRows('腾讯视频', 'wechat', 4, 2500).map((r) => ({
    id: r.id, time: r.time, amountCents: r.amountCents, merchantNorm: normalizeMerchant(r.displayName)
  }))
  const groups = detectRecurring(rows)
  assert.equal(groups.length, 1)
  assert.equal(groups[0]!.cadence, 'monthly')
  assert.equal(groups[0]!.count, 4)
  assert.ok(Math.abs(groups[0]!.annualCents - Math.round((2500 * 365.25) / 30)) <= 1)
})

test('detectRecurring 过滤不规律同额消费', () => {
  const base = Date.UTC(2026, 0, 1)
  const days = [0, 40, 43, 100] // 间隔混乱
  const rows = days.map((d, i) => ({
    id: `r${i}`, time: base + d * DAY, amountCents: 3000, merchantNorm: '某店'
  }))
  assert.equal(detectRecurring(rows).length, 0)
})

test('微信账单 CSV 端到端解析并跳过说明/汇总行', () => {
  const csv = [
    '微信支付账单明细',
    '起始时间:[2026-01-01] 终止时间:[2026-09-30]',
    '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号',
    '2026-01-01 10:00:00,商户消费,腾讯视频,腾讯视频会员,支出,¥25.00,零钱,支付成功,WX001',
    '2026-02-01 10:00:00,商户消费,腾讯视频,腾讯视频会员,支出,¥25.00,零钱,支付成功,WX002',
    '2026-03-01 10:00:00,转账,张三,还钱,收入,¥100.00,零钱,已收钱,WX003',
    '共3笔记录'
  ].join('\r\n')
  const r = parseBillText(csv, 'wechat.csv', '我的微信', 'wechat')
  assert.equal(r.unrecognized, false)
  assert.equal(r.records.length, 3)
  assert.equal(r.records.filter((x) => x.direction === 'expense').length, 2)
  assert.equal(r.records[0]!.amountCents, 2500)
})

test('支付宝账单 CSV 字段映射与金额', () => {
  const csv = [
    '支付宝交易记录明细查询',
    '交易创建时间,交易对方,商品名称,收/支,金额(元),交易状态,交易号',
    '2026-01-05 09:00:00,网易云音乐,黑胶VIP,支出,15.00,交易成功,ALI1',
    '2026-02-05 09:00:00,网易云音乐,黑胶VIP,支出,15.00,交易成功,ALI2'
  ].join('\n')
  const r = parseBillText(csv, 'ali.csv', '支付宝')
  assert.equal(r.platform, 'alipay')
  assert.equal(r.records.length, 2)
  assert.equal(r.records[0]!.counterparty, '网易云音乐')
})

test('mergeRecords 跨文件按订单号去重', () => {
  const a = monthlyRows('腾讯视频', 'wechat', 2, 2500)
  const b = [ { ...a[0]! } ] // 完全重复一笔
  const merged = mergeRecords([a, b])
  assert.equal(merged.length, 2)
})

test('buildSubscriptions 标注同类重复/涨价/试用并应用决定与忽略', () => {
  const now = Date.UTC(2026, 8, 2)
  const iqiyi = monthlyRows('爱奇艺', 'wechat', 4, 2500)
  const tencent = monthlyRows('腾讯视频', 'wechat', 4, 2500)
  // 涨价：优酷首笔 20 元、其后 30 元（同桶容差 12%+5 元 → 20 与 30 差 10 元会分桶，改造成 25→29 触发 price-up）
  const youku: ReturnType<typeof monthlyRows> = []
  const start = Date.UTC(2026, 0, 2)
  ;[2500, 2900, 2900, 2900].forEach((amt, i) =>
    youku.push({
      id: `y${i}`, platform: 'wechat', account: '微信账户', time: start + i * 30 * DAY,
      counterparty: '优酷视频', product: '优酷会员', displayName: '优酷会员', amountCents: amt,
      direction: 'expense', orderNo: `Y${i}`, source: 'y.csv'
    })
  )
  // 试用
  const trial: ReturnType<typeof monthlyRows> = []
  ;[100, 100].forEach((amt, i) =>
    trial.push({
      id: `t${i}`, platform: 'alipay', account: '支付宝账户', time: start + i * 30 * DAY,
      counterparty: '某网盘', product: '首月1元试用会员', displayName: '首月1元试用会员', amountCents: amt,
      direction: 'expense', orderNo: `T${i}`, source: 't.csv'
    })
  )
  const all = [...iqiyi, ...tencent, ...youku, ...trial]
  const subs = buildSubscriptions(all, { now })
  const byName = Object.fromEntries(subs.map((s) => [s.displayName, s]))
  assert.ok(byName['爱奇艺会员']!.flags.includes('duplicate'))
  assert.ok(byName['腾讯视频会员']!.flags.includes('duplicate'))
  assert.ok(byName['优酷会员']!.flags.includes('price-up'))
  assert.ok(byName['首月1元试用会员']!.flags.includes('trial'))

  // 决定与忽略
  const id = byName['优酷会员']!.id
  const withAction = buildSubscriptions(all, { now, overrides: { action: { [id]: 'cancel' } } })
  const target = withAction.find((s) => s.id === id)!
  assert.equal(target.action, 'cancel')
  const report = summarize(withAction)
  assert.equal(report.canceledCount, 1)
  assert.ok(report.savingsAnnual > 0)

  const ignored = buildSubscriptions(all, { now, overrides: { ignored: { [id]: true } } })
  assert.ok(ignored.find((s) => s.id === id)!.ignored)
  assert.equal(summarize(ignored).activeCount, subs.length - 1)
})

test('toReportCsv 带 BOM 且含表头与服务名', () => {
  const now = Date.UTC(2026, 8, 2)
  const subs = buildSubscriptions(monthlyRows('腾讯视频', 'wechat', 4, 2500), { now })
  const csv = toReportCsv(subs)
  assert.ok(csv.startsWith('\uFEFF'))
  assert.ok(csv.includes('服务') && csv.includes('腾讯视频会员'))
})

test('buildIcs 含 VEVENT/RRULE/VALARM 且按周期', () => {
  const now = Date.UTC(2026, 8, 2)
  const subs = buildSubscriptions(monthlyRows('腾讯视频', 'wechat', 4, 2500), { now })
  const ics = buildIcs(subs)
  assert.ok(ics.includes('BEGIN:VEVENT') && ics.includes('FREQ=MONTHLY') && ics.includes('BEGIN:VALARM'))
  assert.ok(ics.includes('腾讯视频'))
})
