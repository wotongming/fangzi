/**
 * attribution.ts —— 四维归因聚合纯函数（可单测，不 import Vue）。
 * 维度：主题标签 tag / 形式 format / 平台 platform / 发布时段 slot。
 * 聚合：条数 / 总阅读 / 总收益(分) / 总工时 → 单位收益(元/条)、ROI(元/小时)。
 * 工时为 0 时 ROI 回退 null，除零安全。
 */
import type { Account, AttributionDim, AttributionRow, Content, MetricSnapshot } from './types'
import { centsToYuan, FORMAT_LABEL } from './types'

/** 发布时段六桶（按本机小时）。 */
export function slotOf(publishedAt: number): string {
  const h = new Date(publishedAt).getHours()
  if (h < 6) return '凌晨 0–6 点'
  if (h < 10) return '早间 6–10 点'
  if (h < 14) return '午间 10–14 点'
  if (h < 18) return '下午 14–18 点'
  if (h < 21) return '晚高峰 18–21 点'
  return '夜间 21–24 点'
}

interface Bucket {
  count: number
  views: number
  cents: number
  hours: number
}

function bucketKeySet(c: Content, dim: AttributionDim, platformOf: (accountId: string) => string): string[] {
  switch (dim) {
    case 'tag':
      return c.tags.length ? c.tags : ['(无标签)']
    case 'format':
      return [FORMAT_LABEL[c.format]]
    case 'platform':
      return [platformOf(c.accountId)]
    case 'slot':
      return [slotOf(c.publishedAt)]
  }
}

/**
 * 四维归因：每条内容的阅读/收益按其所属维度键分摊。
 * tag 维度下一条内容有 N 个标签，则该内容的条数/阅读/收益/工时会计入每个标签桶一次
 * （即多标签内容会在多个主题桶各计一条，反映"同时押中多个选题"）。
 */
export function attribute(
  contents: Content[],
  metrics: MetricSnapshot[],
  accounts: Account[],
  dim: AttributionDim
): AttributionRow[] {
  const platformMap = new Map(accounts.map((a) => [a.id, a.platform || '其他']))
  const platformOf = (accountId: string): string => platformMap.get(accountId) ?? '未知账号'

  const metricsByContent = new Map<string, MetricSnapshot[]>()
  for (const m of metrics) {
    const arr = metricsByContent.get(m.contentId) ?? []
    arr.push(m)
    metricsByContent.set(m.contentId, arr)
  }

  const bucket = new Map<string, Bucket>()
  for (const c of contents) {
    const ms = metricsByContent.get(c.id) ?? []
    const revenue = ms.reduce((s, m) => s + m.revenueCents, 0)
    const views = ms.reduce((s, m) => s + m.views, 0)
    const keys = bucketKeySet(c, dim, platformOf)
    for (const k of keys) {
      const b = bucket.get(k) ?? { count: 0, views: 0, cents: 0, hours: 0 }
      b.count += 1
      b.views += views
      b.cents += revenue
      b.hours += c.hours
      bucket.set(k, b)
    }
  }

  return [...bucket.entries()]
    .map(([label, b]) => {
      const revenueYuan = centsToYuan(b.cents)
      return {
        label,
        count: b.count,
        views: b.views,
        revenueCents: b.cents,
        revenueYuan,
        perContentYuan: b.count > 0 ? revenueYuan / b.count : 0,
        hours: b.hours,
        roiYuanPerHour: b.hours > 0 ? revenueYuan / b.hours : null
      }
    })
    .sort((a, b) => b.revenueYuan - a.revenueYuan)
}

/** 汇总全部内容的总收益（分），供看板顶部概览。 */
export function totalRevenueCents(metrics: MetricSnapshot[]): number {
  return metrics.reduce((s, m) => s + m.revenueCents, 0)
}

/**
 * 近 30 天已完成商单报价参考区间 [minCents, maxCents]；无数据返回 null。
 */
export function priceRange(
  deals: Array<{ date: number; amountCents: number; result: string }>,
  now: number,
  days = 30
): { minCents: number; maxCents: number; count: number } | null {
  const since = now - days * 86400000
  const done = deals.filter((d) => d.result === 'done' && d.date >= since && d.amountCents > 0)
  if (!done.length) return null
  const amounts = done.map((d) => d.amountCents)
  return {
    minCents: Math.min(...amounts),
    maxCents: Math.max(...amounts),
    count: done.length
  }
}
