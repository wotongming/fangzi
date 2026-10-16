import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareBonusTax } from '../src/tools/year-bonus-tax/tax.ts'
import { calcSeverance } from '../src/tools/severance-pay/severance.ts'
import { calcOvertime } from '../src/tools/overtime-pay/overtime.ts'
import { md5 } from '../src/tools/file-hash-check/md5.ts'
import { renderMarkdown } from '../src/core/markdown.ts'
import { cosineSimilarity } from '../src/core/search/vector.ts'

test('年终奖单独计税：36000 元适用 3% 档，税额 1080', () => {
  const r = compareBonusTax(36000, 0)
  assert.equal(r.separate.rate, 0.03)
  assert.equal(r.separate.tax, 1080)
  assert.equal(r.separate.takeHome, 34920)
})

test('年终奖临界点盲区：36001 跳入 10% 档，税额显著上升', () => {
  const r = compareBonusTax(36001, 0)
  assert.equal(r.separate.rate, 0.1)
  assert.ok(r.separate.tax > 3000)
})

test('两种方式均给出可比较结果并选出更优', () => {
  const r = compareBonusTax(30000, 60000)
  assert.ok(['separate', 'combined'].includes(r.better))
  assert.ok(r.saving >= 0)
  assert.equal(
    r.saving,
    Math.abs(r.separate.tax - r.combined.taxAttributableToBonus)
  )
})

test('离职补偿：3 年 7 个月协商解除 = 4N', () => {
  const r = calcSeverance({ monthlyWage: 15000, localAvgWage: 12000, years: 3, months: 7, scenario: 'negotiate' })
  assert.equal(r.nFactor, 4)
  assert.equal(r.economicComp, 60000)
  assert.equal(r.total, 60000)
  assert.equal(r.capped, false)
})

test('离职补偿：不满 6 个月按 0.5 个月；N+1 含代通知金', () => {
  const r = calcSeverance({ monthlyWage: 10000, localAvgWage: 12000, years: 2, months: 3, scenario: 'no-notice' })
  assert.equal(r.nFactor, 2.5)
  assert.equal(r.economicComp, 25000)
  assert.equal(r.noticePay, 10000)
  assert.equal(r.total, 35000)
})

test('离职补偿：违法解除 = 2N', () => {
  const r = calcSeverance({ monthlyWage: 10000, localAvgWage: 12000, years: 2, months: 0, scenario: 'illegal' })
  assert.equal(r.total, 40000)
})

test('离职补偿：超社平三倍封顶，年限封顶 12 年', () => {
  const r = calcSeverance({ monthlyWage: 50000, localAvgWage: 12000, years: 13, months: 0, scenario: 'layoff' })
  assert.equal(r.capped, true)
  assert.equal(r.baseWage, 36000)
  assert.equal(r.nFactor, 12)
  assert.equal(r.total, 432000)
})

test('加班费：日薪 1000 / 时薪 125 时三档合计正确', () => {
  const r = calcOvertime({ monthlyBase: 21750, weekdayHours: 10, restdayHours: 8, holidayHours: 8 })
  assert.equal(r.dailyWage, 1000)
  assert.equal(r.hourlyWage, 125)
  assert.equal(r.weekdayPay, 1875)
  assert.equal(r.restdayPay, 2000)
  assert.equal(r.holidayPay, 3000)
  assert.equal(r.total, 6875)
})

test('MD5 标准向量', () => {
  const enc = new TextEncoder()
  assert.equal(md5(enc.encode('abc')), '900150983cd24fb0d6963f7d28e17f72')
  assert.equal(md5(enc.encode('')), 'd41d8cd98f00b204e9800998ecf8427e')
})

test('Markdown 渲染：转义危险内容，链接安全', () => {
  const html = renderMarkdown('# 标题\n\n<script>alert(1)</script>\n\n[方子](https://a.com)')
  // 标题生成与 GitCode/GitHub 一致的锚点 id，供目录页内跳转
  assert.ok(html.includes('<h1 id="标题">标题</h1>'))
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(html.includes('target="_blank"'))
  assert.ok(!html.includes('javascript:'))
})

test('Markdown 渲染：页内锚点不带 target，slug 与 GitCode 规则一致', () => {
  const html = renderMarkdown('## 2. 打开与安装（PWA）\n\n[跳转](#2-打开与安装pwa)')
  assert.ok(html.includes('<h2 id="2-打开与安装pwa">'))
  assert.ok(html.includes('<a href="#2-打开与安装pwa" class="md-anchor">跳转</a>'))
  // 页内锚点绝不能新开标签页（否则在 hash 路由下会跳走）
  assert.ok(!html.includes('href="#2-打开与安装pwa" target'))
})

test('cosine：正交为 0，同向为 1', () => {
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0)
  assert.ok(Math.abs(cosineSimilarity([1, 1], [2, 2]) - 1) < 1e-9)
  assert.equal(cosineSimilarity([1], [1, 2]), 0) // 维度不同
})
