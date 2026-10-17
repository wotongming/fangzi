/**
 * recurring-detect —— 通用周期性扣费/订阅识别纯函数（零依赖）。
 * 输入标准化支出记录，按“同名商户 + 近似金额 + 近似周期”聚类，输出月/季/半年/年订阅。
 * 由 subscription-audit（pipeline 009）沉淀；004/008 等账单/提醒类工具可复用。
 */

export interface GenericExpense {
  id: string
  /** epoch ms（建议用 bill-csv.parseFlexibleDate，按“浮动本地时间”解析） */
  time: number
  /** 已归一化的商户/服务名（normalizeMerchant） */
  merchantNorm: string
  /** 支出金额，单位分（正数） */
  amountCents: number
}

export type Cadence = 'monthly' | 'quarterly' | 'semiannual' | 'yearly'

export interface RecurringGroup {
  key: string
  merchantNorm: string
  cadence: Cadence
  /** 周期天数（标称：30.4/91.3/182.6/365.25） */
  periodDays: number
  /** 实际平均间隔（天，相邻间隔均值） */
  avgGapDays: number
  /** 间隔变异系数（0~1，越小越规律） */
  cv: number
  priceCents: number
  minCents: number
  maxCents: number
  count: number
  firstAt: number
  lastAt: number
  /** 预测下次扣费 = lastAt + 平均间隔 */
  nextAt: number
  /** 年化金额（分）= 价格 * 365.25 / 平均间隔 */
  annualCents: number
  /** 累计金额（分） */
  totalCents: number
  ids: string[]
}

export interface DetectOptions {
  /** 同名至少几笔才可能成订阅 */
  minCount?: number
  /** 金额归桶容差比例（相对参考价） */
  priceTolRatio?: number
  /** 金额归桶绝对容差（分），吸收零头 */
  priceTolAbs?: number
  /** 间隔变异系数上限，超过视为不规律 */
  maxCv?: number
}

const DAY = 86400000
export const CADENCE_INFO: Record<Cadence, { period: number; min: number; max: number; label: string }> = {
  monthly: { period: 30.4, min: 26, max: 35, label: '每月' },
  quarterly: { period: 91.3, min: 85, max: 98, label: '每季' },
  semiannual: { period: 182.6, min: 170, max: 200, label: '每半年' },
  yearly: { period: 365.25, min: 340, max: 392, label: '每年' }
}

export function median(nums: number[]): number {
  const a = [...nums].sort((x, y) => x - y)
  const n = a.length
  if (n === 0) return 0
  const mid = Math.floor(n / 2)
  return n % 2 ? a[mid]! : (a[mid - 1]! + a[mid]!) / 2
}

function mean(nums: number[]): number {
  return nums.length ? nums.reduce((s, x) => s + x, 0) / nums.length : 0
}

function coeffOfVariation(nums: number[]): number {
  const m = mean(nums)
  if (m === 0) return Infinity
  const variance = mean(nums.map((x) => (x - m) * (x - m)))
  return Math.sqrt(variance) / m
}

function bucketCadence(gapDays: number): Cadence | null {
  if (gapDays >= CADENCE_INFO.monthly.min && gapDays <= CADENCE_INFO.monthly.max) return 'monthly'
  if (gapDays >= CADENCE_INFO.quarterly.min && gapDays <= CADENCE_INFO.quarterly.max) return 'quarterly'
  if (gapDays >= CADENCE_INFO.semiannual.min && gapDays <= CADENCE_INFO.semiannual.max) return 'semiannual'
  if (gapDays >= CADENCE_INFO.yearly.min && gapDays <= CADENCE_INFO.yearly.max) return 'yearly'
  return null
}

/**
 * 商户/服务名归一化：去交易单号、括号备注、尾号、emoji/符号、连续空白与常见前缀。
 * 例：「腾讯视频VIP(自动续费)」「腾讯视频-1234」→「腾讯视频VIP」。
 */
export function normalizeMerchant(raw: string): string {
  if (!raw) return ''
  let s = String(raw)
  // 去 emoji / 变体选择符 / zwj
  s = s.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
  // 去括号及其中备注（自动续费/会员续费/订单尾号等）
  s = s.replace(/[（(【\[][^）)】\]]*[）)】\]]/g, '')
  // 去 -数字尾号 / #数字 / 空格数字尾串
  s = s.replace(/[-#]\d{2,}$/g, '')
  // 去常见纯数字长单号残留（连续 8 位以上）
  s = s.replace(/\d{8,}/g, '')
  // 去“自动扣费/自动续费/连续包月/续费”等后缀词
  s = s.replace(/(自动扣费|自动续费|连续包月|连续包年|续费成功|扣款|消费)/g, '')
  s = s.replace(/[\s·•|_]+/g, '')
  return s.trim().toLowerCase()
}

function groupAmounts(items: GenericExpense[], ratio: number, abs: number): GenericExpense[][] {
  const sorted = [...items].sort((a, b) => a.amountCents - b.amountCents)
  const buckets: GenericExpense[][] = []
  for (const it of sorted) {
    const hit = buckets.find((b) => {
      const ref = b[0]!.amountCents
      return Math.abs(it.amountCents - ref) <= Math.max(abs, Math.round(ref * ratio))
    })
    if (hit) hit.push(it)
    else buckets.push([it])
  }
  return buckets
}

/**
 * 识别周期订阅。
 * 流程：按归一化商户分组 → 金额归桶（容差吸收小幅涨价/零头）→ 同桶按时间求间隔，
 * 间隔中位数落在月/季/半年/年区间且变异系数 ≤ 阈值 → 判为规律订阅。
 */
export function detectRecurring(rows: GenericExpense[], opts: DetectOptions = {}): RecurringGroup[] {
  const minCount = opts.minCount ?? 2
  const ratio = opts.priceTolRatio ?? 0.12
  const abs = opts.priceTolAbs ?? 500
  const maxCv = opts.maxCv ?? 0.25

  const byMerchant = new Map<string, GenericExpense[]>()
  for (const r of rows) {
    if (!r.merchantNorm || r.amountCents <= 0) continue
    const arr = byMerchant.get(r.merchantNorm) ?? []
    arr.push(r)
    byMerchant.set(r.merchantNorm, arr)
  }

  const out: RecurringGroup[] = []
  for (const [merchantNorm, items] of byMerchant) {
    if (items.length < minCount) continue
    for (const bucket of groupAmounts(items, ratio, abs)) {
      if (bucket.length < minCount) continue
      const pts = bucket.map((b) => ({ id: b.id, t: b.time, amt: b.amountCents })).sort((a, b) => a.t - b.t)
      const gaps: number[] = []
      for (let i = 1; i < pts.length; i++) gaps.push((pts[i]!.t - pts[i - 1]!.t) / DAY)
      if (gaps.length === 0) continue
      const gap = median(gaps)
      const cadence = bucketCadence(gap)
      if (!cadence) continue
      const cv = coeffOfVariation(gaps)
      if (cv > maxCv) continue

      const amounts = pts.map((p) => p.amt)
      const priceCents = median(amounts)
      const firstAt = pts[0]!.t
      const lastAt = pts[pts.length - 1]!.t
      const avgGapDays = mean(gaps)
      const nextAt = lastAt + Math.round(avgGapDays) * DAY
      const annualCents = Math.round((priceCents * 365.25) / avgGapDays)
      out.push({
        key: merchantNorm,
        merchantNorm,
        cadence,
        periodDays: CADENCE_INFO[cadence].period,
        avgGapDays,
        cv,
        priceCents,
        minCents: Math.min(...amounts),
        maxCents: Math.max(...amounts),
        count: pts.length,
        firstAt,
        lastAt,
        nextAt,
        annualCents,
        totalCents: amounts.reduce((s, x) => s + x, 0),
        ids: pts.map((p) => p.id)
      })
    }
  }
  return out.sort((a, b) => b.annualCents - a.annualCents)
}
