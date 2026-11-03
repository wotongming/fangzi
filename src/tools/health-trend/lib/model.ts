/**
 * model.ts —— 体检趋势纯逻辑层（无 DOM，可独立单测）。
 * 指标条目：某年某指标的一次测量；趋势判定只认数值与参考范围。
 */

export interface MetricRecord {
  id: string
  /** 体检年份，如 2024 */
  year: number
  /** 指标名，如 总胆固醇 */
  name: string
  value: number
  unit: string
  refLow?: number | null
  refHigh?: number | null
}

export type TrendStatus = 'ok' | 'abnormal' | 'climb'

/**
 * 趋势判定（纯函数）：
 * - abnormal：最新值超出参考范围（高或低）
 * - climb：连续 ≥2 年上升且累计涨幅 ≥20%，且最新值 ≥ 参考上限的 80%（缓慢爬升接近红线）
 * - 否则 ok
 * 参考范围缺失时只判上升，不给 climb。
 */
export function trendStatus(name: string, records: Array<{ year: number; value: number; refHigh?: number | null }>): {
  status: TrendStatus
  note: string
} {
  const sorted = records.slice().sort((a, b) => a.year - b.year)
  if (sorted.length === 0) return { status: 'ok', note: '无数据' }
  const last = sorted[sorted.length - 1]!
  // 异常：超出参考范围
  if (last.refHigh != null && last.value > last.refHigh) {
    return { status: 'abnormal', note: `${name} 最新值 ${last.value} 高于参考上限 ${last.refHigh}` }
  }
  // 缓慢爬升预警：连续两年上升 + 累计涨幅 ≥20% + 接近上限
  if (sorted.length >= 2 && last.refHigh != null) {
    const first = sorted[0]!
    const rising = sorted.every((r, i) => i === 0 || r.value >= sorted[i - 1]!.value)
    const growth = first.value > 0 ? (last.value - first.value) / first.value : 0
    const nearCeil = last.value >= last.refHigh * 0.8
    if (rising && growth >= 0.2 && nearCeil) {
      return {
        status: 'climb',
        note: `${name} ${first.year}→${last.year} 连续上升 ${(growth * 100).toFixed(0)}%，已达参考上限 ${((last.value / last.refHigh) * 100).toFixed(0)}%，建议复查`
      }
    }
  }
  return { status: 'ok', note: `${name} 趋势平稳` }
}

/** 按指标名分组所有记录（纯函数）。 */
export function groupByName(records: MetricRecord[]): Map<string, MetricRecord[]> {
  const m = new Map<string, MetricRecord[]>()
  for (const r of records) {
    const arr = m.get(r.name) ?? []
    arr.push(r)
    m.set(r.name, arr)
  }
  for (const arr of m.values()) arr.sort((a, b) => a.year - b.year)
  return m
}

export interface ActionItem {
  name: string
  status: TrendStatus
  note: string
}

/** 复查行动清单：所有 abnormal/climb 指标（纯函数）。 */
export function buildActionList(records: MetricRecord[]): ActionItem[] {
  const groups = groupByName(records)
  const out: ActionItem[] = []
  for (const [name, arr] of groups) {
    const { status, note } = trendStatus(name, arr)
    if (status !== 'ok') out.push({ name, status, note })
  }
  const order: Record<TrendStatus, number> = { abnormal: 0, climb: 1, ok: 2 }
  return out.sort((a, b) => order[a.status] - order[b.status])
}

export function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}
