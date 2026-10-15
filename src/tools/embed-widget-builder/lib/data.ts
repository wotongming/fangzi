import type { WidgetConfig, WidgetSubmission } from './types'
import { widgetTag } from './gen'

/**
 * 数据说明（架构现实）：组件真正嵌入第三方站点后运行在该站点域，
 * 提交数据落在「宿主站点的 localStorage」或配置的 data-endpoint，
 * 无法跨域回流到方子生成器。生成器侧本地保存：组件配置实例 + 预览测试提交。
 */

const INSTANCE_KEY = 'fz-embed-widget:instances'
const PREVIEW_SUB_KEY = 'fz-embed-widget:preview-submissions'

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 存储不可用时静默降级 */
  }
}

/* ---------- 组件实例（我的组件） ---------- */

export function listInstances(): WidgetConfig[] {
  return read<WidgetConfig[]>(INSTANCE_KEY, [])
}

export function getInstance(id: string): WidgetConfig | undefined {
  return listInstances().find((c) => c.id === id)
}

export function saveInstance(cfg: WidgetConfig): WidgetConfig[] {
  const all = listInstances()
  const i = all.findIndex((c) => c.id === cfg.id)
  if (i >= 0) all[i] = cfg
  else all.unshift(cfg)
  write(INSTANCE_KEY, all)
  return all
}

export function deleteInstance(id: string): WidgetConfig[] {
  const all = listInstances().filter((c) => c.id !== id)
  write(INSTANCE_KEY, all)
  return all
}

/* ---------- 预览测试提交 ---------- */

export function listPreviewSubmissions(id?: string): WidgetSubmission[] {
  const all = read<WidgetSubmission[]>(PREVIEW_SUB_KEY, [])
  return id ? all.filter((s) => String(s.key) === id || String(s.id) === id) : all
}

export function addPreviewSubmission(data: WidgetSubmission): WidgetSubmission[] {
  const all = read<WidgetSubmission[]>(PREVIEW_SUB_KEY, [])
  all.unshift(data)
  write(PREVIEW_SUB_KEY, all.slice(0, 500))
  return all
}

export function clearPreviewSubmissions(id?: string): void {
  if (!id) {
    write(PREVIEW_SUB_KEY, [])
    return
  }
  const rest = read<WidgetSubmission[]>(PREVIEW_SUB_KEY, []).filter(
    (s) => String(s.key) !== id && String(s.id) !== id
  )
  write(PREVIEW_SUB_KEY, rest)
}

/* ---------- CSV 导出（通用，供宿主侧记录/预览数据共用） ---------- */

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

export function toCSV(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return ''
  const cols: string[] = []
  rows.forEach((r) => Object.keys(r).forEach((k) => cols.includes(k) || cols.push(k)))
  const head = cols.map(csvCell).join(',')
  const body = rows.map((r) => cols.map((c) => csvCell(r[c])).join(',')).join('\n')
  // BOM 让 Excel 正确识别 UTF-8 中文
  return '﻿' + head + '\n' + body
}

export function downloadText(filename: string, content: string, mime = 'text/plain'): void {
  const blob = new Blob([content], { type: mime + ';charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function submissionFileName(cfg: WidgetConfig, ext: string): string {
  return widgetTag(cfg) + '-' + new Date().toISOString().slice(0, 10) + '.' + ext
}
