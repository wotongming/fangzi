/**
 * 家庭财务管家 —— 省钱洞察（规则引擎，纯函数）
 *
 * 从「分类占比 / 预算执行 / 支出趋势 / 储蓄率」四条规则推导可执行建议。
 * 本地 AI 洞察为后续可选增强：本引擎保持纯函数，可被订阅层直接调用。
 */
import type { LedgerEntry } from './ledger'
import { aggregateByCategory, fmtYuan, inMonth, totalByType, type Category } from './ledger'
import type { Budget } from './budget'
import { monthlyBudgetStatus } from './budget'
import { changeRatio, monthlyReport, trendReport } from './report'

export interface Insight {
  level: 'info' | 'warn' | 'good'
  title: string
  detail: string
}

/** 高占比可优化类目（餐饮 / 购物 / 娱乐等常是可砍项） */
const OPTIMIZABLE = new Set(['餐饮', '购物', '娱乐', '外卖', '零食', '游戏'])

/** 从账目与预算推导省钱洞察；categories 用于把分类 id 映射为可读名称（缺省时按原值处理） */
export function generateInsights(
  entries: LedgerEntry[],
  budgets: Budget[],
  month: string,
  categories?: Category[]
): Insight[] {
  const out: Insight[] = []
  const monthEntries = entries.filter((e) => inMonth(e, month))
  const expenseCents = totalByType(monthEntries, 'expense')

  if (expenseCents === 0) return out

  const nameOf = (id: string): string => categories?.find((x) => x.id === id)?.name ?? id

  // 规则 1：高占比类目（前 3 名中占比 ≥30% 且可优化）
  for (const c of aggregateByCategory(monthEntries, { type: 'expense' }).slice(0, 3)) {
    const name = nameOf(c.category)
    if (c.ratio >= 0.3 && OPTIMIZABLE.has(name)) {
      out.push({
        level: 'warn',
        title: `${name}占比偏高（${(c.ratio * 100).toFixed(0)}%）`,
        detail: `${name}支出了 ¥${fmtYuan(c.amountCents)}，占本月总支出的 ${(c.ratio * 100).toFixed(0)}%。连续偏高的话，建议为它设一个分类预算或做一次消费复盘。`
      })
    }
  }

  // 规则 2：预算执行（超支 / 接近上限）
  for (const s of monthlyBudgetStatus(entries, budgets, month)) {
    const label = s.budget.category === '__all__' ? '总预算' : nameOf(s.budget.category)
    if (s.over) {
      out.push({
        level: 'warn',
        title: `${label}已超支`,
        detail: `本月${label === '总预算' ? '支出' : label} ¥${fmtYuan(s.spentCents)}，超出预算 ¥${fmtYuan(-s.remainCents)}。`
      })
    } else if (s.usedRatio >= 0.9) {
      out.push({
        level: 'info',
        title: `${label}快用完了`,
        detail: `已用 ${(s.usedRatio * 100).toFixed(0)}%，剩余 ¥${fmtYuan(s.remainCents)}。`
      })
    }
  }

  // 规则 3：最近两月支出环比上升 ≥15%
  const base = new Date(month + '-01T00:00:00')
  const months = [month]
  const prev = new Date(base.getFullYear(), base.getMonth() - 1, 1)
  months.unshift(`${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`)
  const trend = trendReport(entries, months)
  if (trend.length === 2) {
    const ratio = changeRatio(trend[1]!.expenseCents, trend[0]!.expenseCents)
    if (ratio !== null && ratio >= 0.15) {
      out.push({
        level: 'info',
        title: `${trend[1]!.month}支出环比上升 ${(ratio * 100).toFixed(0)}%`,
        detail: `支出从 ¥${fmtYuan(trend[0]!.expenseCents)} 增至 ¥${fmtYuan(trend[1]!.expenseCents)}，建议留意本月消费节奏。`
      })
    }
  }

  // 规则 4：储蓄率健康提示
  const r = monthlyReport(entries, month)
  if (r.incomeCents > 0) {
    const saveRatio = r.balanceCents / r.incomeCents
    if (r.balanceCents >= 0 && saveRatio >= 0.3) {
      out.push({
        level: 'good',
        title: '储蓄率不错',
        detail: `本月结余 ¥${fmtYuan(r.balanceCents)}，占收入 ${(saveRatio * 100).toFixed(0)}%，继续保持。`
      })
    }
  }

  return out
}
