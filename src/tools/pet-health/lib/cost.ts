/**
 * cost.ts —— 养宠花费汇总与「自记药价」对照（纯函数）。
 * 所有价格均为主人本人手动记录，仅供换院参考，不是市场报价。
 */
import { normalizeMedName, EVENT_META } from './models'
import type { HealthEvent } from './models'

export interface CategoryTotal {
  kind: HealthEvent['kind']
  label: string
  cents: number
  count: number
}

/** 指定年份（不填=全部）某宠物花费，按事件类型汇总；守恒：各类之和=总额。 */
export function costByCategory(events: HealthEvent[], petId: string, year?: number): { items: CategoryTotal[]; totalCents: number } {
  const rows = events.filter(
    (e) => e.petId === petId && typeof e.amountCents === 'number' && e.amountCents! > 0 && (!year || e.date.startsWith(String(year)))
  )
  const map = new Map<string, CategoryTotal>()
  for (const e of rows) {
    const cur = map.get(e.kind) ?? { kind: e.kind, label: EVENT_META[e.kind].label, cents: 0, count: 0 }
    cur.cents += e.amountCents!
    cur.count += 1
    map.set(e.kind, cur)
  }
  const items = [...map.values()].sort((a, b) => b.cents - a.cents)
  return { items, totalCents: items.reduce((s, x) => s + x.cents, 0) }
}

export interface MedPriceRow {
  key: string
  /** 展示用药品名（取该组最近一次的原始名称） */
  name: string
  spec?: string
  cents: number
  hospital?: string
  date: string
}

export interface MedPriceGroup {
  key: string
  name: string
  rows: MedPriceRow[]
  minCents: number
  maxCents: number
  /** 最大-最小差额（分） */
  spreadCents: number
}

/** 同一种药（按归一名称）不同医院/时间的自录价格，时间新→旧。 */
export function medPriceCompare(events: HealthEvent[], petId: string): MedPriceGroup[] {
  const rows = events
    .filter((e) => e.petId === petId && e.kind === 'medprice' && typeof e.amountCents === 'number' && e.amountCents! > 0)
    .map((e): MedPriceRow => ({
      key: normalizeMedName(e.name),
      name: e.name,
      spec: e.spec,
      cents: e.amountCents!,
      hospital: e.hospital,
      date: e.date
    }))
  const map = new Map<string, MedPriceGroup>()
  for (const r of rows) {
    const g = map.get(r.key) ?? { key: r.key, name: r.name, rows: [], minCents: Infinity, maxCents: -Infinity, spreadCents: 0 }
    g.rows.push(r)
    if (r.cents < g.minCents) g.minCents = r.cents
    if (r.cents > g.maxCents) g.maxCents = r.cents
    map.set(r.key, g)
  }
  for (const g of map.values()) {
    g.spreadCents = g.maxCents - g.minCents
    g.rows.sort((a, b) => b.date.localeCompare(a.date))
    // 展示名取最近一次
    g.name = g.rows[0]!.name
  }
  return [...map.values()].filter((g) => g.rows.length > 0).sort((a, b) => b.spreadCents - a.spreadCents)
}
