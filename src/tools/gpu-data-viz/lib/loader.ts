/**
 * 数据加载调度：
 * - CSV/TSV 文件走流式 Worker（百万行不阻塞主线程）；
 * - JSON 文件与粘贴文本在主线程解析（通常体量较小）。
 */
import { parseJsonData } from './parse'
import { buildDatasetFromTable, inferColumnTypes, loadTableFromText } from './store'
import type { ColumnType, Dataset } from './types'
import { createLoadWorker } from './worker'

export interface InspectInfo {
  kind: 'csv' | 'json'
  headers: string[]
  types: ColumnType[]
  totalRows: number
  sourceName: string
  file?: File
  /** 主线程路径（JSON / 粘贴文本）保留的原文 */
  text?: string
}

export function isLikelyJson(name: string): boolean {
  return /\.json($|\?)/i.test(name)
}

function textToInspect(text: string, sourceName: string, forceJson: boolean): InspectInfo {
  const asJson = forceJson || isLikelyJson(sourceName)
  const { table } = loadTableFromText(text, sourceName, asJson)
  const types = inferColumnTypes(table.headers, table.rows)
  return {
    kind: asJson ? 'json' : 'csv',
    headers: table.headers,
    types,
    totalRows: table.rows.length,
    sourceName,
    text
  }
}

/** 探测文件：返回表头、列类型、总行数（不落数据） */
export async function inspectFile(file: File): Promise<InspectInfo> {
  if (isLikelyJson(file.name)) {
    return textToInspect(await file.text(), file.name, true)
  }
  return inspectCsvInWorker(file, file.name)
}

/** 探测粘贴文本：先尝试 JSON，失败按 CSV 处理 */
export function inspectText(text: string, sourceName = '粘贴数据.csv'): InspectInfo {
  const trimmed = text.trim()
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const table = parseJsonData(text)
      return {
        kind: 'json',
        headers: table.headers,
        types: inferColumnTypes(table.headers, table.rows),
        totalRows: table.rows.length,
        sourceName,
        text
      }
    } catch {
      /* 落到 CSV */
    }
  }
  return textToInspect(text, sourceName, false)
}

function inspectCsvInWorker(file: File, sourceName: string): Promise<InspectInfo> {
  const worker = createLoadWorker()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.terminate()
      reject(new Error('文件解析超时'))
    }, 300_000)
    worker.onmessage = (ev: MessageEvent) => {
      const d = ev.data as { ok?: boolean; headers?: string[]; types?: ColumnType[]; totalRows?: number; error?: string }
      if (d.ok) {
        clearTimeout(timer)
        worker.terminate()
        resolve({ kind: 'csv', headers: d.headers!, types: d.types!, totalRows: d.totalRows ?? 0, sourceName, file })
      } else if (d.ok === false) {
        clearTimeout(timer)
        worker.terminate()
        reject(new Error(d.error ?? '解析失败'))
      }
    }
    worker.onerror = (e) => {
      clearTimeout(timer)
      worker.terminate()
      reject(new Error(e.message || 'Worker 解析失败'))
    }
    worker.postMessage({ kind: 'inspectCsv', file, sourceName })
  })
}

/** 按选定轴与点数上限构建数据集 */
export async function buildDataset(
  info: InspectInfo,
  xIdx: number,
  yIdx: number,
  limit: number,
  onProgress?: (loaded: number, total: number) => void
): Promise<Dataset> {
  if (info.kind === 'json' || !info.file) {
    const { table } = loadTableFromText(info.text ?? '', info.sourceName, info.kind === 'json')
    return buildDatasetFromTable(table, info.sourceName, xIdx, yIdx, limit)
  }
  return buildCsvInWorker(info, xIdx, yIdx, limit, onProgress)
}

interface WorkerPayload {
  headers: string[]
  columns: Dataset['columns']
  xIdx: number
  yIdx: number
  rowCount: number
  totalRows: number
  truncated: boolean
  sourceName: string
  rawLines?: string[]
}

function buildCsvInWorker(
  info: InspectInfo,
  xIdx: number,
  yIdx: number,
  limit: number,
  onProgress?: (loaded: number, total: number) => void
): Promise<Dataset> {
  const worker = createLoadWorker()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.terminate()
      reject(new Error('数据载入超时'))
    }, 600_000)
    worker.onmessage = (ev: MessageEvent) => {
      const d = ev.data as { ok?: boolean; progress?: boolean; loaded?: number; payload?: WorkerPayload; error?: string }
      if (d.progress) {
        onProgress?.(d.loaded ?? 0, info.totalRows)
        return
      }
      if (d.ok && d.payload) {
        clearTimeout(timer)
        worker.terminate()
        const p = d.payload
        resolve({
          headers: p.headers,
          columns: p.columns,
          rowCount: p.rowCount,
          totalRows: p.totalRows,
          truncated: p.truncated,
          xy: new Float32Array((ev.data as { xy: ArrayBuffer }).xy),
          rawX: new Float64Array((ev.data as { rawX: ArrayBuffer }).rawX),
          rawY: new Float64Array((ev.data as { rawY: ArrayBuffer }).rawY),
          xMeta: p.columns[p.xIdx]!,
          yMeta: p.columns[p.yIdx]!,
          sourceName: p.sourceName,
          rawLines: p.rawLines
        })
      } else if (d.ok === false) {
        clearTimeout(timer)
        worker.terminate()
        reject(new Error(d.error ?? '构建数据集失败'))
      }
    }
    worker.onerror = (e) => {
      clearTimeout(timer)
      worker.terminate()
      reject(new Error(e.message || 'Worker 载入失败'))
    }
    worker.postMessage(
      {
        kind: 'buildCsv',
        file: info.file,
        sourceName: info.sourceName,
        headers: info.headers,
        types: info.types,
        xIdx,
        yIdx,
        limit,
        totalHint: Math.min(info.totalRows, limit)
      },
      info.file ? [info.file] : []
    )
  })
}
