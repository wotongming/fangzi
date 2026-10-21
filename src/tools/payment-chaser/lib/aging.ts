/**
 * payment-chaser —— 账龄分桶 / 梯度阶段 / 模板变量填充（纯函数，可 node 单测）。
 * 日期统一按本地日历日差（不做时分秒折算），输入 YYYY-MM-DD。
 */
import type { AgingBucketKey, Dashboard, Invoice } from './models'

const DAY_MS = 24 * 60 * 60 * 1000

function parseDay(s: string): number {
  // 用 UTC 午夜避免时区漂移
  const parts = s.split('-')
  const ys = parts[0] ?? '1970'
  const ms = parts[1] ?? '1'
  const ds = parts[2] ?? '1'
  return Date.UTC(parseInt(ys, 10), (parseInt(ms, 10) || 1) - 1, parseInt(ds, 10) || 1)
}

/** 未付账款相对 today 的逾期天数；未到期返回负数；已付清返回 0。 */
export function daysOverdue(inv: Pick<Invoice, 'dueDate' | 'paid'>, today: string): number {
  if (inv.paid) return 0
  const diff = Math.round((parseDay(today) - parseDay(inv.dueDate)) / DAY_MS)
  return diff
}

export function bucketOf(days: number): AgingBucketKey {
  if (days < 0) return 'notdue'
  if (days < 30) return '0-30'
  if (days < 60) return '30-60'
  if (days < 90) return '60-90'
  return '90+'
}

/** 梯度催收阶段：1 礼貌提醒 / 2 正式催告 / 3 最后通牒。 */
export function stageOf(days: number): 1 | 2 | 3 {
  if (days < 7) return 1
  if (days < 30) return 2
  return 3
}

const BUCKET_LABEL: Record<AgingBucketKey, string> = {
  notdue: '未到期',
  '0-30': '逾期 0–30 天',
  '30-60': '逾期 30–60 天',
  '60-90': '逾期 60–90 天',
  '90+': '逾期 90 天以上'
}

export function buildDashboard(invoices: Invoice[], today: string): Dashboard {
  const keys: AgingBucketKey[] = ['notdue', '0-30', '30-60', '60-90', '90+']
  const agg = new Map<AgingBucketKey, { count: number; cents: number }>()
  for (const k of keys) agg.set(k, { count: 0, cents: 0 })
  let totalOutstandingCents = 0
  let totalOutstandingCount = 0
  let badDebtCents = 0
  let dueSoonCents = 0
  for (const inv of invoices) {
    if (inv.paid) continue
    const days = daysOverdue(inv, today)
    const b = agg.get(bucketOf(days))!
    b.count += 1
    b.cents += inv.amountCents
    totalOutstandingCents += inv.amountCents
    totalOutstandingCount += 1
    if (bucketOf(days) === '90+') badDebtCents += inv.amountCents
    if (days >= 0 && days <= 7) dueSoonCents += inv.amountCents
  }
  return {
    buckets: keys.map((k) => ({ key: k, label: BUCKET_LABEL[k], ...agg.get(k)! })),
    totalOutstandingCents,
    totalOutstandingCount,
    badDebtCents,
    dueSoonCents
  }
}

/** 分 → 展示元字符串（¥1,234.56）。 */
export function centsToYuan(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const yuan = Math.floor(abs / 100)
  const fen = abs % 100
  const intStr = yuan.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${sign}¥${intStr}.${fen.toString().padStart(2, '0')}`
}

export interface TemplateVars {
  client: string
  project: string
  amount: string
  dueDate: string
  days: number
}

/** 简单 {{var}} 模板填充，未命中占位符原样保留。 */
export function fillTemplate(tpl: string, vars: TemplateVars): string {
  return tpl
    .replaceAll('{{client}}', vars.client)
    .replaceAll('{{project}}', vars.project)
    .replaceAll('{{amount}}', vars.amount)
    .replaceAll('{{dueDate}}', vars.dueDate)
    .replaceAll('{{days}}', String(vars.days))
}
