/**
 * timeline.ts —— 多类型健康事件合并为时间线（纯函数）。
 */
import { dayMs } from './models'
import type { HealthEvent } from './models'

/** 某宠物时间线：日期新→旧；同日按创建时间新→旧。 */
export function petTimeline(events: HealthEvent[], petId: string): HealthEvent[] {
  return events
    .filter((e) => e.petId === petId)
    .sort((a, b) => dayMs(b.date) - dayMs(a.date) || b.createdAt - a.createdAt)
}

/** 某宠物体重序列（kg）：日期旧→新。 */
export function weightSeries(events: HealthEvent[], petId: string): { date: string; kg: number }[] {
  return events
    .filter((e) => e.petId === petId && e.kind === 'weight' && typeof e.valueKg === 'number' && e.valueKg! > 0)
    .map((e) => ({ date: e.date, kg: e.valueKg! }))
    .sort((a, b) => dayMs(a.date) - dayMs(b.date))
}

/** 相邻两次体重变化（kg 与百分比），用于异常波动提示（仅提示，非诊断）。 */
export function weightDeltas(points: { date: string; kg: number }[]): { from: string; to: string; deltaKg: number; pct: number }[] {
  const out: { from: string; to: string; deltaKg: number; pct: number }[] = []
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    const deltaKg = +(b.kg - a.kg).toFixed(2)
    const pct = a.kg > 0 ? +(((b.kg - a.kg) / a.kg) * 100).toFixed(1) : 0
    out.push({ from: a.date, to: b.date, deltaKg, pct })
  }
  return out
}
