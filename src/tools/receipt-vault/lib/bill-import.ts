/**
 * bill-import.ts —— 微信支付/支付宝导出账单（.xlsx / .csv）纯解析。
 *
 * 纯前端，零网络；xlsx 用 SheetJS 0.18.5（Apache-2.0）。
 * 两类账单表头差异：
 *  - 微信：前若干行是说明，真正表头行含「交易时间」「交易对方」「商品」「收/支」「金额(元)」；
 *  - 支付宝：表头行含「交易时间」「交易对方」「商品说明」「收/支」「金额（元）」。
 * 解析策略：找到表头行（含「交易时间」+「金额」），按列名映射，跳过之前的说明行。
 * 支出金额记为正数；收入/退款记为负数（报销方向正确）。
 */
import * as XLSX from 'xlsx'
import { decodeText } from '../../../../reusable-module/bill-csv/bill-csv'
import type { ReceiptRecord } from './extract'

export interface BillPreviewRow {
  date: string
  merchant: string
  amount: string // 支出为正、收入/退款为负
  note: string
}

/** 在二维表里找表头行索引（含「交易时间」且含「金额」）。 */
export function findHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const cells = (rows[i] ?? []).map((c) => String(c ?? '').replace(/\s/g, ''))
    const joined = cells.join('|')
    if (joined.includes('交易时间') && joined.includes('金额')) return i
  }
  return -1
}

/** 归一列名取值。 */
function pick(row: unknown[], headers: string[], keys: string[]): string {
  for (const k of keys) {
    const idx = headers.findIndex((h) => h.replace(/\s/g, '').includes(k))
    if (idx >= 0) {
      const v = row[idx]
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim()
    }
  }
  return ''
}

/** 金额可能是 "¥ 12.34" / "12.34" / 数字。返回带符号的字符串。 */
function parseAmount(raw: string, direction: string): string {
  const m = raw.replace(/[,¥￥\s]/g, '').match(/-?\d+(\.\d+)?/)
  if (!m) return ''
  let v = parseFloat(m[0])
  // direction: 支出 / 收入 / 不计收支
  if (direction.includes('收入') || direction.includes('退款')) v = -Math.abs(v)
  else v = Math.abs(v)
  return v.toFixed(2)
}

/** 主入口：把账单工作簿（已读为二维表）解析成预览行。 */
export function parseBillSheet(rows: unknown[][]): BillPreviewRow[] {
  const hi = findHeaderRow(rows)
  if (hi < 0) throw new Error('未找到账单表头（应含「交易时间」与「金额」列），请确认是微信/支付宝导出的账单文件')
  const headers = (rows[hi] ?? []).map((c) => String(c ?? ''))
  const out: BillPreviewRow[] = []
  for (let i = hi + 1; i < rows.length; i++) {
    const row = rows[i] ?? []
    const date = pick(row, headers, ['交易时间'])
    if (!date) continue
    const merchant = pick(row, headers, ['交易对方', '对方']) || pick(row, headers, ['商品说明', '商品'])
    const amountRaw = pick(row, headers, ['金额'])
    const direction = pick(row, headers, ['收/支', '收支'])
    const note = pick(row, headers, ['商品', '商品说明', '交易类型', '备注'])
    const amount = parseAmount(amountRaw, direction)
    if (!amount) continue
    out.push({ date: date.slice(0, 10), merchant: merchant || '（未填商家）', amount, note })
  }
  if (!out.length) throw new Error('表头识别成功但没有可导入的交易行，请检查账单是否为空')
  return out
}

/** 读 xlsx 文件（SheetJS）；csv 走 bill-csv 解码。 */
export async function readBillFile(file: File): Promise<BillPreviewRow[]> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv')) {
    const { text } = decodeText(await file.arrayBuffer())
    const rows: string[][] = text.split(/\r?\n/).map((l) => l.split(','))
    return parseBillSheet(rows)
  }
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const out: BillPreviewRow[] = []
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    if (!ws) continue
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true }) as unknown[][]
    try {
      out.push(...parseBillSheet(rows))
    } catch {
      // 跳过非账单 sheet（如说明页）
    }
  }
  if (!out.length) throw new Error('未能从该文件解析出账单交易，请确认是微信/支付宝导出的账单 xlsx')
  return out
}

/** 预览行 → 入库 ReceiptRecord（amount 保留正负）。 */
export function toRecords(rows: BillPreviewRow[], category: string): ReceiptRecord[] {
  const now = Date.now()
  return rows.map((r, i) => ({
    id: `bill-${now}-${i}-${Math.random().toString(36).slice(2, 8)}`,
    date: r.date,
    merchant: r.merchant,
    amount: r.amount,
    tax: '',
    category,
    note: r.note,
    createdAt: now + i
  }))
}
