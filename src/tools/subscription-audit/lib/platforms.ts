/**
 * platforms.ts —— 微信支付 / 支付宝官方导出账单 CSV 的字段映射与标准化。
 * 策略：定位“表头行”（含关键列名）→ 按候选列名映射 → 只保留收支明细行 → 多文件去重。
 * 平台版式若变化，只需维护下方列名候选与 skipRows 判定。
 */
import { findColumn, parseCsv, parseFlexibleDate, yuanToCents } from '../../../../reusable-module/bill-csv/bill-csv'

export type Platform = 'wechat' | 'alipay' | 'unknown'
export type Direction = 'expense' | 'income'

export interface TxRecord {
  id: string
  platform: Platform
  /** 账户标签（多账户区分，默认平台名） */
  account: string
  /** epoch ms（按浮动本地时间解析） */
  time: number
  /** 交易对方（原始） */
  counterparty: string
  /** 商品/商品名称（原始） */
  product: string
  /** 用于展示的名称：优先商品名 */
  displayName: string
  amountCents: number
  direction: Direction
  orderNo: string
  /** 来源文件 */
  source: string
}

interface ColMap {
  time: number
  party: number
  product: number
  amount: number
  dir: number
  orderNo: number
}

interface PlatformSpec {
  platform: Platform
  /** 用于自动识别的表头特征（该行需命中其中任意关键列） */
  markers: string[]
  cols: {
    time: string[]
    party: string[]
    product: string[]
    amount: string[]
    dir: string[]
    orderNo: string[]
  }
}

const SPECS: PlatformSpec[] = [
  // 支付宝必须排在微信之前：其表头列「交易创建时间」包含子串「交易时间」，
  // 若先匹配微信规则会把支付宝账单误判成微信。
  {
    platform: 'alipay',
    markers: ['交易创建时间', '交易对方'],
    cols: {
      time: ['交易创建时间', '付款时间', '交易时间'],
      party: ['交易对方', '对方'],
      product: ['商品名称', '商品', '交易说明'],
      amount: ['金额(元)', '金额（元）', '金额'],
      dir: ['收/支', '收支方向', '收支'],
      orderNo: ['交易号', '交易订单号', '商家订单号', '订单号']
    }
  },
  {
    platform: 'wechat',
    markers: ['交易时间', '交易对方'],
    cols: {
      time: ['交易时间', '交易创建时间'],
      party: ['交易对方'],
      product: ['商品', '商品说明', '交易类型'],
      amount: ['金额(元)', '金额（元）', '金额'],
      dir: ['收/支', '收支'],
      orderNo: ['交易单号', '交易订单号', '订单号']
    }
  }
]

/** 跳过表头之外的说明/汇总行：首列或任意单元格命中这些词 */
const SKIP_RE =
  /(微信支付账单|支付宝交易记录|支付宝交易凭证|^-+$|^={2,}$|导出时间|起始时间|终止时间|导出类型|微信昵称|账号|账户|共\s*\d+\s*笔|笔记录|账单|明细查询|交易笔数|收入小计|支出小计|结余|统计|温馨提示|说明：)/

/** 自动识别平台：在所有行里找含特征列名的表头行。 */
function locateHeader(rows: string[][], spec: PlatformSpec): { headerIdx: number; map: ColMap } | null {
  for (let i = 0; i < rows.length; i++) {
    const header = rows[i]!.map((c) => c.trim())
    const hitMarkers = spec.markers.filter((mk) => header.some((h) => h.replace(/\s/g, '').includes(mk)))
    if (hitMarkers.length === 0) continue
    const map: ColMap = {
      time: findColumn(header, spec.cols.time),
      party: findColumn(header, spec.cols.party),
      product: findColumn(header, spec.cols.product),
      amount: findColumn(header, spec.cols.amount),
      dir: findColumn(header, spec.cols.dir),
      orderNo: findColumn(header, spec.cols.orderNo)
    }
    if (map.time >= 0 && map.party >= 0 && map.amount >= 0) return { headerIdx: i, map }
  }
  return null
}

export function sniffPlatform(text: string): Platform {
  const rows = parseCsv(text).slice(0, 40)
  for (const spec of SPECS) {
    if (locateHeader(rows, spec)) return spec.platform
  }
  return 'unknown'
}

const cell = (row: string[], i: number): string => (i >= 0 && i < row.length ? row[i]!.trim() : '')

function parseWithSpec(
  rows: string[][],
  spec: PlatformSpec,
  source: string,
  account: string
): { platform: Platform; records: TxRecord[] } {
  const located = locateHeader(rows.slice(0, 60), spec)
  if (!located) return { platform: 'unknown', records: [] }
  const { headerIdx, map } = located
  const records: TxRecord[] = []
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i]!
    const joined = row.map((c) => c.trim()).join('')
    if (!joined || SKIP_RE.test(joined)) continue

    const time = parseFlexibleDate(cell(row, map.time))
    if (time == null) continue

    const amountCents = yuanToCents(cell(row, map.amount))
    if (amountCents == null) continue

    const dirRaw = cell(row, map.dir)
    let direction: Direction | null = null
    if (/支/.test(dirRaw)) direction = 'expense'
    else if (/收/.test(dirRaw)) direction = 'income'
    // 极少数无收支列：金额为正按支出处理（账单默认列示）
    if (direction == null) direction = amountCents >= 0 ? 'expense' : 'income'

    const counterparty = cell(row, map.party)
    const product = cell(row, map.product)
    if (!counterparty && !product) continue

    const orderNo = cell(row, map.orderNo)
    const id = `${spec.platform}:${orderNo || [time, counterparty, amountCents].join('-')}`
    records.push({
      id,
      platform: spec.platform,
      account,
      time,
      counterparty,
      product,
      displayName: product || counterparty,
      amountCents: Math.abs(amountCents),
      direction,
      orderNo,
      source
    })
  }
  return { platform: spec.platform, records }
}

export interface ParseResult {
  platform: Platform
  records: TxRecord[]
  /** 未识别时为 true，UI 提示按指引导出 */
  unrecognized: boolean
}

/** 解析一份账单文本（已解码）。forcePlatform 可手动指定。account 为账户标签。 */
export function parseBillText(text: string, source: string, account: string, force?: Platform): ParseResult {
  const rows = parseCsv(text)
  const order: PlatformSpec[] =
    force && force !== 'unknown' ? SPECS.filter((s) => s.platform === force) : SPECS
  for (const spec of order) {
    const r = parseWithSpec(rows, spec, source, account)
    if (r.records.length > 0) return { ...r, unrecognized: false }
  }
  return { platform: force ?? 'unknown', records: [], unrecognized: true }
}

/** 多份账单合并去重：同平台+订单号，或同时间+商户+金额视为同一笔。 */
export function mergeRecords(batches: TxRecord[][]): TxRecord[] {
  const seen = new Set<string>()
  const out: TxRecord[] = []
  for (const batch of batches) {
    for (const r of batch) {
      const key1 = r.orderNo ? `${r.platform}:${r.orderNo}` : ''
      const key2 = `${r.platform}:${r.time}:${r.counterparty}:${r.amountCents}`
      const key = key1 || key2
      if (seen.has(key)) continue
      seen.add(key)
      out.push(r)
    }
  }
  return out.sort((a, b) => b.time - a.time)
}
