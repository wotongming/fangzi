/** 值格式化：数值（按量级自适应精度）与日期（毫秒时间戳） */
import type { ColumnType } from './types'

/** 通用数值格式化：大数加千分位，极小数用有效位，避免一长串浮点尾巴 */
export function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  if (abs !== 0 && (abs >= 1e9 || abs < 1e-4)) return v.toExponential(3)
  if (Number.isInteger(v)) return v.toLocaleString('zh-CN')
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 3 : 5
  return v.toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: 0 })
}

const pad = (n: number) => String(n).padStart(2, '0')

/** 时间戳格式化为紧凑日期时间；整数天（无时分秒）时只显示日期 */
export function formatDate(ms: number): string {
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return '—'
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const isMidnight = d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0
  if (isMidnight) return date
  return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatValue(v: number, type: ColumnType): string {
  return type === 'date' ? formatDate(v) : formatNumber(v)
}

/** 大数据量友好显示：1,234,567 → 1.23M */
export function formatCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1e6) return `${(n / 1000).toFixed(n < 1e4 ? 1 : 0)}K`
  return `${(n / 1e6).toFixed(2)}M`
}
