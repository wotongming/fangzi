/**
 * 数据集构建：CSV/JSON 行 → typed array（rawX/rawY）→ 归一化坐标（xy）。
 *
 * DatasetBuilder 支持流式逐行喂入（Worker 百万行场景不保留字符串矩阵）：
 *   const b = new DatasetBuilder(headers, types, xIdx, yIdx, name, limit)
 *   scanner 每行调用 b.addRow(fields)（达到 limit 后自动停止收集）
 *   const ds = b.finish(totalRows)
 */
import { cellToNumber, inferColumnType, parseCsv, parseJsonData, type CsvTable } from './parse'
import type { ColumnMeta, ColumnType, Dataset } from './types'

/** 免费版单次可载入点数上限（Pro 解锁后不限，仍受浏览器内存约束） */
export const FREE_POINT_LIMIT = 500_000

function inferTypes(headers: string[], rows: string[][], sampleSize = 2000): ColumnType[] {
  const n = Math.min(rows.length, sampleSize)
  return headers.map((_, col) => {
    const sample: string[] = []
    for (let r = 0; r < n; r++) {
      const v = rows[r]?.[col]
      if (v !== undefined) sample.push(v)
    }
    return inferColumnType(sample)
  })
}

/** 对外暴露的列类型推断（Worker 预扫描后使用） */
export function inferColumnTypes(headers: string[], rows: string[][], sampleSize = 2000): ColumnType[] {
  return inferTypes(headers, rows, sampleSize)
}

export class DatasetBuilder {
  readonly headers: string[]
  readonly types: ColumnType[]
  readonly xIdx: number
  readonly yIdx: number
  readonly sourceName: string
  readonly limit: number
  /** 已收集行数（<= limit） */
  collected = 0
  private rawX: Float64Array
  private rawY: Float64Array
  private xMin = Infinity
  private xMax = -Infinity
  private yMin = Infinity
  private yMax = -Infinity
  /** 小数据集（<= RAW_LINE_LIMIT）保留原始行，供刷选导出完整列；大数据置空 */
  /** 小数据集（<=10 万）保留原始行，供刷选导出完整列；大数据置空 */
  rawLines: string[] = []
  private readonly keepLines: boolean

  constructor(
    headers: string[],
    types: ColumnType[],
    xIdx: number,
    yIdx: number,
    sourceName: string,
    limit: number,
    totalHint = 0
  ) {
    if (xIdx === yIdx) throw new Error('X 轴与 Y 轴不能选择同一列')
    if (types[xIdx] === 'string' || types[yIdx] === 'string') throw new Error('坐标轴只能选择数值或日期列')
    this.headers = headers
    this.types = types
    this.xIdx = xIdx
    this.yIdx = yIdx
    this.sourceName = sourceName
    this.limit = Math.max(1, limit)
    const cap = Math.max(this.limit, totalHint > 0 ? Math.min(totalHint, this.limit) : 0)
    this.rawX = new Float64Array(cap)
    this.rawY = new Float64Array(cap)
    this.keepLines = cap <= 100_000
  }

  /** 喂入一行；返回是否仍在收集（false=达到上限，调用方可继续计数但不必再调） */
  addRow(fields: string[]): boolean {
    if (this.collected >= this.limit) return false
    const x = cellToNumber(fields[this.xIdx] ?? '', this.types[this.xIdx]!)
    const y = cellToNumber(fields[this.yIdx] ?? '', this.types[this.yIdx]!)
    if (Number.isNaN(x) || Number.isNaN(y)) return true // 跳过坏行但继续收集
    const i = this.collected
    this.rawX[i] = x
    this.rawY[i] = y
    if (x < this.xMin) this.xMin = x
    if (x > this.xMax) this.xMax = x
    if (y < this.yMin) this.yMin = y
    if (y > this.yMax) this.yMax = y
    if (this.keepLines) this.rawLines.push(fields.join(','))
    this.collected++
    return this.collected < this.limit
  }

  finish(totalRows: number): Dataset {
    const n = this.collected
    if (n === 0) throw new Error('所选 X/Y 列没有可用的数值数据')
    const rx = this.rawX.subarray(0, n)
    const ry = this.rawY.subarray(0, n)
    const xr = this.xMax - this.xMin
    const yr = this.yMax - this.yMin
    const xy = new Float32Array(n * 2)
    for (let i = 0; i < n; i++) {
      // 常量列退化为 0.5，避免除零
      xy[i * 2] = xr === 0 ? 0.5 : (rx[i]! - this.xMin) / xr
      xy[i * 2 + 1] = yr === 0 ? 0.5 : (ry[i]! - this.yMin) / yr
    }
    const columns: ColumnMeta[] = this.headers.map((name, i) => ({
      name,
      index: i,
      type: this.types[i] ?? 'string',
      min: i === this.xIdx ? this.xMin : i === this.yIdx ? this.yMin : NaN,
      max: i === this.xIdx ? this.xMax : i === this.yIdx ? this.yMax : NaN
    }))
    return {
      headers: this.headers,
      columns,
      rowCount: n,
      totalRows: Math.max(totalRows, n),
      truncated: totalRows > n,
      xy,
      rawX: Float64Array.from(rx),
      rawY: Float64Array.from(ry),
      xMeta: columns[this.xIdx]!,
      yMeta: columns[this.yIdx]!,
      sourceName: this.sourceName,
      rawLines: this.keepLines ? this.rawLines : undefined
    }
  }
}

export interface LoadResult {
  table: CsvTable
  sourceName: string
}

/** 从 CSV/JSON 文本载入（粘贴 / 小文件路径），自动识别格式 */
export function loadTableFromText(text: string, sourceName: string, isJson = false): LoadResult {
  const table = isJson ? parseJsonData(text) : parseCsv(text)
  if (table.headers.length < 2) throw new Error('数据至少需要两列（X 轴与 Y 轴各一列）')
  if (table.rows.length === 0) throw new Error('文件没有数据行')
  return { table, sourceName }
}

/** 从内存行表构建数据集（自动推断列类型；xIdx/yIdx 缺省时取前两个数值/日期列） */
export function buildDatasetFromTable(
  table: CsvTable,
  sourceName: string,
  xIdx?: number,
  yIdx?: number,
  limit = table.rows.length
): Dataset {
  const types = inferTypes(table.headers, table.rows)
  const numericCols = types.map((t, i) => ({ t, i })).filter((c) => c.t !== 'string')
  if (numericCols.length < 2) throw new Error('至少需要两个数值或日期列才能绘图')
  const xi = xIdx ?? numericCols[0]!.i
  const yi = yIdx ?? numericCols[1]!.i
  if (types[xi] === 'string' || types[yi] === 'string') throw new Error('坐标轴只能选择数值或日期列')
  const b = new DatasetBuilder(table.headers, types, xi, yi, sourceName, limit, table.rows.length)
  for (const row of table.rows) {
    if (!b.addRow(row)) break
  }
  return b.finish(table.rows.length)
}
