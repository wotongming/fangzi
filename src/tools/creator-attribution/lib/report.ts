/**
 * report.ts —— 月度经营报告 Markdown 生成纯函数。
 * 收入构成 / TOP3 内容 / 下月策略（按 ROI Top2 主题）/ 商单汇总。
 */
import type { Account, Content, Deal, MetricSnapshot } from './types'
import { centsToYuan, FORMAT_LABEL } from './types'
import { attribute } from './attribution'

function ymOf(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function yuan(cents: number): string {
  return `¥${centsToYuan(cents).toFixed(2)}`
}

/**
 * 生成某月报告。ym 形如 '2026-10'。
 * 口径：发布于该月的内容，其全部数据快照收益计入该月；商单按成交日期计入。
 */
export function buildMonthlyReport(
  ym: string,
  contents: Content[],
  metrics: MetricSnapshot[],
  accounts: Account[],
  deals: Deal[]
): string {
  const monthContents = contents.filter((c) => ymOf(c.publishedAt) === ym)
  const accountMap = new Map(accounts.map((a) => [a.id, a]))
  const revByContent = new Map<string, number>()
  const viewsByContent = new Map<string, number>()
  for (const m of metrics) {
    revByContent.set(m.contentId, (revByContent.get(m.contentId) ?? 0) + m.revenueCents)
    viewsByContent.set(m.contentId, (viewsByContent.get(m.contentId) ?? 0) + m.views)
  }

  const lines: string[] = []
  lines.push(`# 创作经营月报 · ${ym}`)
  lines.push('')
  lines.push(`> 本报告由「创作归因台」自动生成，数据仅来自你本机手动录入与 CSV 导入。`)
  lines.push('')

  // 概览
  const totalCents = monthContents.reduce((s, c) => s + (revByContent.get(c.id) ?? 0), 0)
  const totalViews = monthContents.reduce((s, c) => s + (viewsByContent.get(c.id) ?? 0), 0)
  const totalHours = monthContents.reduce((s, c) => s + c.hours, 0)
  lines.push('## 一、本月概览')
  lines.push(`- 发布内容：**${monthContents.length}** 条`)
  lines.push(`- 累计阅读/播放：**${totalViews.toLocaleString()}**`)
  lines.push(`- 本月收益合计：**${yuan(totalCents)}**`)
  lines.push(`- 投入工时：**${totalHours.toFixed(1)}** 小时`)
  lines.push(
    totalHours > 0
      ? `- 整体时薪（参考）：**${yuan(centsToYuan(totalCents) / totalHours)}/小时**`
      : `- 整体时薪：工时记为 0，暂无法计算，建议补录工时。`
  )
  lines.push('')

  // 收入构成（按形式）
  const byFormat = attribute(monthContents, metrics, accounts, 'format')
  lines.push('## 二、收入构成（按形式）')
  if (!byFormat.length) {
    lines.push('- 本月无内容数据。')
  } else {
    for (const row of byFormat) {
      lines.push(
        `- ${row.label}：${row.count} 条，收益 ${yuan(row.revenueCents)}，单位收益 ${yuan(row.perContentYuan)}/条`
      )
    }
  }
  lines.push('')

  // TOP3 内容
  const ranked = monthContents
    .map((c) => ({ c, rev: revByContent.get(c.id) ?? 0, views: viewsByContent.get(c.id) ?? 0 }))
    .sort((a, b) => b.rev - a.rev)
  lines.push('## 三、本月 TOP3 内容')
  const top3 = ranked.slice(0, 3).filter((r) => r.rev > 0 || r.views > 0)
  if (!top3.length) {
    lines.push('- 本月暂无收益/阅读数据，录几次数据回收后自动排行。')
  } else {
    top3.forEach((r, i) => {
      const acc = accountMap.get(r.c.accountId)
      lines.push(
        `${i + 1}. **《${r.c.title}》**（${acc?.platform ?? ''}${acc?.nickname ? '@' + acc.nickname : ''} · ${FORMAT_LABEL[r.c.format]}）— 收益 ${yuan(r.rev)}，阅读 ${r.views.toLocaleString()}`
      )
    })
  }
  lines.push('')

  // 下月策略：ROI Top2 主题
  const byTag = attribute(monthContents, metrics, accounts, 'tag').filter((r) => r.roiYuanPerHour !== null)
  lines.push('## 四、下月策略建议')
  if (byTag.length) {
    const topTags = [...byTag].sort((a, b) => (b.roiYuanPerHour ?? 0) - (a.roiYuanPerHour ?? 0)).slice(0, 2)
    lines.push('按「单位工时收益（ROI）」排序，建议下月主攻方向：')
    for (const t of topTags) {
      lines.push(
        `- 主题 **${t.label}**：${t.count} 条，收益 ${yuan(t.revenueCents)}，时薪 ${yuan(t.roiYuanPerHour ?? 0)}/小时`
      )
    }
    lines.push('（这是基于你本机历史数据的保守参考，不构成任何收益承诺。）')
  } else {
    lines.push('- 本月还没有可计算 ROI 的数据（需内容投入工时 > 0），补录工时后给出建议。')
  }
  lines.push('')

  // 商单汇总
  const monthDeals = deals.filter((d) => ymOf(d.date) === ym)
  const doneCents = monthDeals.filter((d) => d.result === 'done').reduce((s, d) => s + d.amountCents, 0)
  lines.push('## 五、商单汇总')
  lines.push(`- 本月商单记录：**${monthDeals.length}** 条，已结合计 **${yuan(doneCents)}**`)
  if (monthDeals.length) {
    for (const d of monthDeals) {
      const resultText = d.result === 'done' ? '已结' : d.result === 'doing' ? '在谈' : '黄了'
      lines.push(`  - ${d.brand}：${yuan(d.amountCents)}（${resultText}）`)
    }
  }
  lines.push('')
  lines.push('---')
  lines.push('*数据仅保存在本机浏览器，不上传任何服务器。*')
  return lines.join('\n')
}
