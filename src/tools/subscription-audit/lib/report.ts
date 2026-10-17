/**
 * report.ts —— 订阅成本汇总、可省金额、报告 CSV 导出。
 */
import { fmtDate, yuan, type Subscription } from './subscriptions'

export interface CategorySlice {
  category: string
  annualCents: number
  count: number
}

export interface AuditReport {
  totalAnnual: number
  totalThreeYear: number
  totalKeptAnnual: number
  savingsAnnual: number
  canceledCount: number
  watchCount: number
  activeCount: number
  nearestNext: Subscription | null
  byCategory: CategorySlice[]
}

export function summarize(subs: Subscription[]): AuditReport {
  const visible = subs.filter((s) => !s.ignored)
  let totalAnnual = 0
  let savingsAnnual = 0
  let canceledCount = 0
  let watchCount = 0
  const catMap = new Map<string, { annual: number; count: number }>()
  let nearest: Subscription | null = null
  const now = Date.now()

  for (const s of visible) {
    totalAnnual += s.annualCents
    const slice = catMap.get(s.category ?? '其他') ?? { annual: 0, count: 0 }
    slice.annual += s.annualCents
    slice.count += 1
    catMap.set(s.category ?? '其他', slice)
    if (s.action === 'cancel') {
      savingsAnnual += s.annualCents
      canceledCount += 1
    } else if (s.action === 'watch') {
      watchCount += 1
    }
    if (s.nextAt > now && (!nearest || s.nextAt < nearest.nextAt)) nearest = s
  }

  const byCategory = Array.from(catMap.entries())
    .map(([category, v]) => ({ category, annualCents: v.annual, count: v.count }))
    .sort((a, b) => b.annualCents - a.annualCents)

  return {
    totalAnnual,
    totalThreeYear: totalAnnual * 3,
    totalKeptAnnual: totalAnnual - savingsAnnual,
    savingsAnnual,
    canceledCount,
    watchCount,
    activeCount: visible.length,
    nearestNext: nearest,
    byCategory
  }
}

const csvCell = (v: string | number | undefined | null): string => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** 生成订阅清单 CSV（带 UTF-8 BOM，Excel 打开中文不乱码）。 */
export function toReportCsv(subs: Subscription[]): string {
  const header = [
    '服务', '平台', '类别', '周期', '单价(元)', '次数', '首次扣费', '最近扣费', '预测下次扣费',
    '年支出(元)', '累计(元)', '标注', '我的决定', '备注'
  ]
  const platformLabel: Record<string, string> = { wechat: '微信', alipay: '支付宝', unknown: '未知' }
  const flagLabel: Record<string, string> = {
    'price-up': '涨价', duplicate: '同类重复', idle: '疑似闲置', trial: '试用留意转正'
  }
  const actionLabel: Record<string, string> = { keep: '保留', cancel: '取消', watch: '观望', none: '' }
  const lines = [header.map(csvCell).join(',')]
  for (const s of subs.filter((x) => !x.ignored)) {
    lines.push(
      [
        s.displayName,
        s.platforms.map((p) => platformLabel[p] ?? p).join('/'),
        s.category ?? '',
        s.cadenceLabel,
        yuan(s.priceCents),
        s.count,
        fmtDate(s.firstAt),
        fmtDate(s.lastAt),
        fmtDate(s.nextAt),
        yuan(s.annualCents),
        yuan(s.totalCents),
        s.flags.map((f) => flagLabel[f]).join('/'),
        actionLabel[s.action],
        s.note ?? ''
      ]
        .map(csvCell)
        .join(',')
    )
  }
  return '\uFEFF' + lines.join('\r\n')
}
