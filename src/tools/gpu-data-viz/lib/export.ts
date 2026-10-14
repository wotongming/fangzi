/**
 * 报告导出：
 * - 合成数据层（WebGPU/WebGL/Canvas2D）与 HUD 层两张 canvas 导出 PNG；
 * - 刷选结果导出 CSV（X/Y 两列，日期列还原为 ISO 字符串）；
 * - 小数据集可导出原始完整行 CSV。
 */
import type { Dataset } from './types'

function timestamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/** 合成数据层与 HUD 层为一张 PNG 并下载 */
export function exportPng(dataCanvas: HTMLCanvasElement, hudCanvas: HTMLCanvasElement, sourceName: string): void {
  const w = Math.max(dataCanvas.width, hudCanvas.width)
  const h = Math.max(dataCanvas.height, hudCanvas.height)
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ctx = out.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(dataCanvas, 0, 0, w, h)
  ctx.drawImage(hudCanvas, 0, 0, w, h)
  out.toBlob((blob) => {
    if (!blob) throw new Error('PNG 生成失败')
    const base = sourceName.replace(/\.(csv|tsv|json)$/i, '') || 'chart'
    downloadBlob(blob, `${base}-gpu-viz-${timestamp()}.png`)
  }, 'image/png')
}

function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

function valueToCsv(v: number, type: 'number' | 'date' | 'string'): string {
  return type === 'date' ? new Date(v).toISOString() : String(v)
}

/** 导出选中点（或全部点）的 X/Y 两列 CSV */
export function exportSelectionCsv(dataset: Dataset, idxs?: Uint32Array): void {
  const lines: string[] = [[dataset.xMeta.name, dataset.yMeta.name].map(csvCell).join(',')]
  const n = idxs && idxs.length > 0 ? idxs.length : dataset.rowCount
  for (let k = 0; k < n; k++) {
    const i = idxs ? idxs[k]! : k
    lines.push(
      [valueToCsv(dataset.rawX[i]!, dataset.xMeta.type), valueToCsv(dataset.rawY[i]!, dataset.yMeta.type)]
        .map(csvCell)
        .join(',')
    )
  }
  const base = dataset.sourceName.replace(/\.(csv|tsv|json)$/i, '') || 'selection'
  downloadBlob(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }), `${base}-筛选结果-${timestamp()}.csv`)
}

/** 导出原始完整行（仅保留了 rawLines 的小数据集可用） */
export function exportRawCsv(dataset: Dataset): boolean {
  if (!dataset.rawLines || dataset.rawLines.length === 0) return false
  const content = dataset.headers.map(csvCell).join(',') + '\n' + dataset.rawLines.join('\n')
  const base = dataset.sourceName.replace(/\.(csv|tsv|json)$/i, '') || 'data'
  downloadBlob(new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8' }), `${base}-原始数据-${timestamp()}.csv`)
  return true
}
