import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attribute, slotOf, priceRange } from '../src/tools/creator-attribution/lib/attribution'
import { buildMonthlyReport } from '../src/tools/creator-attribution/lib/report'
import { mapCsvColumns, normalizeLooseTags, parseCsvImport } from '../src/tools/creator-attribution/lib/csv'
import { centsToYuan, FREE_ACCOUNT_LIMIT, FREE_CONTENT_LIMIT } from '../src/tools/creator-attribution/lib/types'
import type { Account, Content, MetricSnapshot } from '../src/tools/creator-attribution/lib/types'

// —— 夹具 ——
const accounts: Account[] = [
  { id: 'a1', platform: '抖音', nickname: '老王', createdAt: 1 },
  { id: 'a2', platform: '小红书', nickname: '小李', createdAt: 2 }
]
function at(hour: number): number {
  // 本地时区指定小时，便于 slotOf 边界断言
  return new Date(2026, 9, 5, hour, 0, 0).getTime()
}
const contents: Content[] = [
  {
    id: 'c1', accountId: 'a1', title: '探店视频', tags: ['美食', '探店'], format: 'video',
    publishedAt: at(8), hours: 2, createdAt: 1, updatedAt: 1
  },
  {
    id: 'c2', accountId: 'a2', title: '美食图文', tags: ['美食'], format: 'graphic',
    publishedAt: at(20), hours: 1, createdAt: 2, updatedAt: 2
  }
]
const metrics: MetricSnapshot[] = [
  { id: 'm1', contentId: 'c1', capturedAt: at(8), views: 10000, followersDelta: 100, revenueCents: 1000, note: '' },
  { id: 'm2', contentId: 'c2', capturedAt: at(20), views: 2000, followersDelta: 20, revenueCents: 500, note: '' }
]

test('tag 维度聚合数值手算一致（美食桶含两条）', () => {
  const rows = attribute(contents, metrics, accounts, 'tag')
  const food = rows.find((r) => r.label === '美食')!
  assert.ok(food)
  assert.equal(food.count, 2)
  assert.equal(food.views, 12000)
  assert.equal(food.revenueCents, 1500)
  assert.equal(food.hours, 3)
  assert.equal(food.perContentYuan, 7.5)
  assert.equal(food.roiYuanPerHour, 5) // 15 元 / 3 小时
})

test('tag 多标签分摊：探店桶只含 c1', () => {
  const rows = attribute(contents, metrics, accounts, 'tag')
  const tan = rows.find((r) => r.label === '探店')!
  assert.equal(tan.count, 1)
  assert.equal(tan.revenueCents, 1000)
  assert.equal(tan.hours, 2)
})

test('format 维度：视频/图文各一桶', () => {
  const rows = attribute(contents, metrics, accounts, 'format')
  assert.equal(rows.length, 2)
  const video = rows.find((r) => r.label === '视频')!
  assert.equal(video.count, 1)
  assert.equal(video.revenueCents, 1000)
  assert.equal(video.roiYuanPerHour, 5)
})

test('platform 维度：抖音/小红书各一桶', () => {
  const rows = attribute(contents, metrics, accounts, 'platform')
  const dy = rows.find((r) => r.label === '抖音')!
  assert.equal(dy.count, 1)
  assert.equal(dy.revenueCents, 1000)
  const xhs = rows.find((r) => r.label === '小红书')!
  assert.equal(xhs.revenueCents, 500)
})

test('slot 时段桶边界', () => {
  assert.equal(slotOf(at(5)), '凌晨 0–6 点')
  assert.equal(slotOf(at(6)), '早间 6–10 点')
  assert.equal(slotOf(at(9)), '早间 6–10 点')
  assert.equal(slotOf(at(10)), '午间 10–14 点')
  assert.equal(slotOf(at(13)), '午间 10–14 点')
  assert.equal(slotOf(at(14)), '下午 14–18 点')
  assert.equal(slotOf(at(17)), '下午 14–18 点')
  assert.equal(slotOf(at(18)), '晚高峰 18–21 点')
  assert.equal(slotOf(at(20)), '晚高峰 18–21 点')
  assert.equal(slotOf(at(21)), '夜间 21–24 点')
})

test('slot 维度按发布时段聚合', () => {
  const rows = attribute(contents, metrics, accounts, 'slot')
  assert.equal(rows.length, 2)
})

test('ROI 工时 0 回退 null（除零安全）', () => {
  const zero: Content[] = [
    { id: 'z1', accountId: 'a1', title: '零工时', tags: ['t1'], format: 'video', publishedAt: at(8), hours: 0, createdAt: 1, updatedAt: 1 }
  ]
  const ms: MetricSnapshot[] = [{ id: 'mz', contentId: 'z1', capturedAt: at(8), views: 100, followersDelta: 0, revenueCents: 300, note: '' }]
  const rows = attribute(zero, ms, accounts, 'tag')
  assert.equal(rows[0]!.roiYuanPerHour, null)
  assert.equal(rows[0]!.perContentYuan, 3)
})

test('空数据返回空数组', () => {
  assert.equal(attribute([], [], accounts, 'tag').length, 0)
  assert.equal(attribute([], [], accounts, 'format').length, 0)
})

test('金额分元换算', () => {
  assert.equal(centsToYuan(1500), 15)
  assert.equal(centsToYuan(1), 0.01)
  assert.equal(centsToYuan(1990), 19.9)
})

test('CSV 列模糊定位：中文别名命中', () => {
  const m = mapCsvColumns(['内容标题', '平台', '发布日期', '阅读量', '收益(元)'])
  assert.ok(!('error' in m))
  if ('error' in m) return
  assert.equal(m.title, 0)
  assert.equal(m.platform, 1)
  assert.equal(m.date, 2)
  assert.equal(m.views, 3)
  assert.equal(m.revenue, 4)
})

test('CSV 缺必需列报错不写入', () => {
  const m = mapCsvColumns(['平台', '收益'])
  assert.ok('error' in m)
  if ('error' in m) {
    assert.ok(m.missingRequired.includes('标题'))
    assert.ok(m.missingRequired.includes('发布时间'))
  }
})

test('CSV UTF-8 解析：草稿字段映射与错误行跳过', () => {
  const csv = '标题,平台,发布时间,标签,阅读量,收益元\n探店A,抖音,2026-09-01,美食 探店,10000,10.5\n,抖音,2026-09-02,标签,100,3\n无效行,bad-date,标签,100,3\n'
  const buf = new TextEncoder().encode(csv).buffer as ArrayBuffer
  const res = parseCsvImport(buf)
  assert.equal(res.encoding, 'utf-8')
  assert.equal(res.drafts.length, 1)
  assert.equal(res.skipped, 2) // 空标题 + 坏日期
  assert.equal(res.drafts[0]!.title, '探店A')
  assert.equal(res.drafts[0]!.revenueCents, 1050)
  assert.deepEqual(res.drafts[0]!.tags, ['美食', '探店'])
})

test('CSV GBK 解码回退（构造非法 utf-8 字节）', () => {
  // "标题" 的 GBK 编码：B1 EA CC E2
  const bytes = new Uint8Array([0xB1, 0xEA, 0xCC, 0xE2, 0x2C, 0x31])
  const { decodeText } = (() => {
    // 直接复用 bill-csv decodeText
    return { decodeText: (b: ArrayBuffer) => {
      const utf8 = new TextDecoder('utf-8').decode(b)
      if (utf8.includes('�')) return new TextDecoder('gbk').decode(b)
      return utf8
    } }
  })()
  const text = decodeText(bytes.buffer as ArrayBuffer)
  assert.equal(text, '标题,1')
})

test('normalizeLooseTags 归一去重', () => {
  assert.deepEqual(normalizeLooseTags('美食, 探店、美食 视频'), ['美食', '探店', '视频'])
  assert.deepEqual(normalizeLooseTags(''), [])
})

test('priceRange 近 30 天报价区间', () => {
  const now = Date.now()
  const deals = [
    { date: now - 5 * 86400000, amountCents: 80000, result: 'done' },
    { date: now - 10 * 86400000, amountCents: 120000, result: 'done' },
    { date: now - 5 * 86400000, amountCents: 50000, result: 'doing' },
    { date: now - 90 * 86400000, amountCents: 10000, result: 'done' }
  ]
  const r = priceRange(deals, now, 30)
  assert.ok(r)
  assert.equal(r!.minCents, 80000)
  assert.equal(r!.maxCents, 120000)
  assert.equal(r!.count, 2)
  assert.equal(priceRange([], now), null)
})

test('免费限额常量', () => {
  assert.equal(FREE_ACCOUNT_LIMIT, 3)
  assert.equal(FREE_CONTENT_LIMIT, 30)
})

test('月报 Markdown 含关键段落', () => {
  const md = buildMonthlyReport('2026-10', contents, metrics, accounts, [])
  assert.ok(md.includes('创作经营月报 · 2026-10'))
  assert.ok(md.includes('本月概览'))
  assert.ok(md.includes('收入构成'))
  assert.ok(md.includes('TOP3'))
  assert.ok(md.includes('下月策略'))
  assert.ok(md.includes('商单汇总'))
})
