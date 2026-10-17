/**
 * subscriptions.ts —— 在通用 recurring-detect 之上做方子订阅业务封装：
 * 展示名、平台、类别、智能标注（涨价/同类重复/疑似闲置/试用转正）、年化与预测，
 * 以及人工纠正（忽略/改周期/合并/决定）的应用。金额一律整数分。
 */
import {
  detectRecurring,
  normalizeMerchant,
  CADENCE_INFO,
  type Cadence,
  type RecurringGroup
} from '../../../../reusable-module/recurring-detect/recurring-detect'
import type { Platform, TxRecord } from './platforms'

export type { Cadence }
export type SubAction = 'keep' | 'cancel' | 'watch'
export type SubFlag = 'price-up' | 'duplicate' | 'idle' | 'trial'

export interface Subscription {
  id: string
  merchantNorm: string
  displayName: string
  platforms: Platform[]
  cadence: Cadence
  cadenceLabel: string
  priceCents: number
  count: number
  firstAt: number
  lastAt: number
  avgGapDays: number
  nextAt: number
  annualCents: number
  totalCents: number
  minCents: number
  maxCents: number
  flags: SubFlag[]
  category: string | null
  action: SubAction | 'none'
  note?: string
  ignored: boolean
}

export interface SubOverrides {
  /** key: sub.id */
  ignored?: Record<string, boolean>
  cadence?: Record<string, Cadence>
  action?: Record<string, SubAction>
  note?: Record<string, string>
  /** 被合并方 id → 目标 id */
  mergeInto?: Record<string, string>
}

const DAY = 86400000

/** 类别关键词（用于“同类重复会员”判定） */
const CATEGORY_RULES: Array<{ cat: string; re: RegExp }> = [
  { cat: '视频会员', re: /(爱奇艺|腾讯视频|优酷|哔哩哔哩|bilibili|b站|芒果|netflix|网飞|搜狐视频|视频会员|vip视频)/i },
  { cat: '音乐音频', re: /(网易云|qq音乐|音乐会员|spotify|apple\s?music|酷狗|酷我|喜马拉雅|听书)/i },
  { cat: '网盘云存储', re: /(百度网盘|百度云|夸克|阿里云盘|天翼云盘|网盘|icloud|onedrive|dropbox|google\s?one|云存储)/i },
  { cat: '健身运动', re: /(keep|乐刻|超级猩猩|健身|瑜伽|咕咚|悦跑|gym)/i },
  { cat: '办公效率', re: /(wps|office|adobe|notion|印象笔记|网盘会员|钉钉|飞书|会员办公|cad)/i },
  { cat: '购物省钱', re: /(京东plus|plus会员|88vip|山姆|costco|省钱月卡|会员省钱)/i }
]

const TRIAL_RE = /(试用|首月|首期|首季|首年|0元|1元|一分|体验|优惠开通|新人)/

function categoryOf(text: string): string | null {
  for (const r of CATEGORY_RULES) if (r.re.test(text)) return r.cat
  return null
}

function subId(merchantNorm: string, cadence: Cadence): string {
  return `${merchantNorm}@${cadence}`
}

function modeName(names: string[]): string {
  const freq = new Map<string, number>()
  for (const n of names) {
    if (!n) continue
    freq.set(n, (freq.get(n) ?? 0) + 1)
  }
  let best = ''
  let bestN = 0
  for (const [n, c] of freq) {
    if (c > bestN) {
      best = n
      bestN = c
    }
  }
  return best || names[0] || ''
}

/** 用 UTC getter 显示“浮动本地时间”（与 parseFlexibleDate 的 UTC 编码对应）。 */
export function fmtDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

export function yuan(cents: number): string {
  return (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export interface BuildOptions {
  now?: number
  overrides?: SubOverrides
}

/** 由标准化账单记录构建订阅清单（应用人工纠正）。 */
export function buildSubscriptions(rows: TxRecord[], opts: BuildOptions = {}): Subscription[] {
  const now = opts.now ?? Date.now()
  const overrides = opts.overrides ?? {}

  const expenses = rows
    .filter((r) => r.direction === 'expense')
    .map((r) => ({ id: r.id, time: r.time, merchantNorm: normalizeMerchant(r.displayName), amountCents: r.amountCents }))
    .filter((r) => r.merchantNorm.length >= 2)

  const groups: RecurringGroup[] = detectRecurring(expenses)
  const recordById = new Map(rows.map((r) => [r.id, r]))

  // 初步封装
  let subs: Subscription[] = groups.map((g) => {
    const recs = g.ids.map((id) => recordById.get(id)).filter((x): x is TxRecord => !!x)
    const displayName = modeName(recs.map((r) => r.displayName)) || g.merchantNorm
    const platforms = Array.from(new Set(recs.map((r) => r.platform))).filter((p) => p !== 'unknown')
    const textForCat = `${displayName} ${recs.map((r) => r.counterparty).join(' ')}`
    const flags: SubFlag[] = []
    if (g.maxCents >= g.minCents && (g.maxCents - g.minCents) / Math.max(1, g.minCents) >= 0.1) flags.push('price-up')
    if (TRIAL_RE.test(displayName) || recs.some((r) => TRIAL_RE.test(r.product))) flags.push('trial')
    const idleDays = (now - g.lastAt) / DAY
    if (idleDays > 2 * g.avgGapDays) flags.push('idle')

    const id = subId(g.merchantNorm, g.cadence)
    return {
      id,
      merchantNorm: g.merchantNorm,
      displayName,
      platforms: platforms.length ? platforms : ['unknown'],
      cadence: g.cadence,
      cadenceLabel: CADENCE_INFO[g.cadence].label,
      priceCents: Math.round(g.priceCents),
      count: g.count,
      firstAt: g.firstAt,
      lastAt: g.lastAt,
      avgGapDays: g.avgGapDays,
      nextAt: g.nextAt,
      annualCents: g.annualCents,
      totalCents: g.totalCents,
      minCents: g.minCents,
      maxCents: g.maxCents,
      flags,
      category: categoryOf(textForCat),
      action: overrides.action?.[id] ?? 'none',
      note: overrides.note?.[id],
      ignored: !!overrides.ignored?.[id]
    }
  })

  // 人工合并（B → A）
  const mergeMap = overrides.mergeInto ?? {}
  const byId = new Map(subs.map((s) => [s.id, s]))
  const removed = new Set<string>()
  for (const [fromId, toId] of Object.entries(mergeMap)) {
    const a = byId.get(toId)
    const b = byId.get(fromId)
    if (!a || !b || a.id === b.id) continue
    a.annualCents += b.annualCents
    a.totalCents += b.totalCents
    a.count += b.count
    a.priceCents = Math.round((a.priceCents + b.priceCents) / 2)
    a.minCents = Math.min(a.minCents, b.minCents)
    a.maxCents = Math.max(a.maxCents, b.maxCents)
    a.nextAt = Math.min(a.nextAt, b.nextAt)
    a.platforms = Array.from(new Set([...a.platforms, ...b.platforms]))
    if (!a.category && b.category) a.category = b.category
    removed.add(fromId)
  }
  subs = subs.filter((s) => !removed.has(s.id))

  // 人工改周期
  for (const s of subs) {
    const forced = overrides.cadence?.[s.id]
    if (forced && forced !== s.cadence) {
      s.cadence = forced
      s.cadenceLabel = CADENCE_INFO[forced].label
      const period = CADENCE_INFO[forced].period
      s.annualCents = Math.round((s.priceCents * 365.25) / period)
      s.nextAt = s.lastAt + Math.round(period) * DAY
    }
  }

  // 同类重复（基于最终可见订阅）
  const byCat = new Map<string, Subscription[]>()
  for (const s of subs) {
    if (s.ignored || !s.category) continue
    const arr = byCat.get(s.category) ?? []
    arr.push(s)
    byCat.set(s.category, arr)
  }
  for (const arr of byCat.values()) {
    if (arr.length >= 2) for (const s of arr) if (!s.flags.includes('duplicate')) s.flags.push('duplicate')
  }

  return subs.sort((a, b) => b.annualCents - a.annualCents)
}
