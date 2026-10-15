/**
 * 上新分包与命名：纯字符串/打包逻辑（可单测）。
 * - 文件名模板变量：{base} 原名(去扩展名) / {product} 商品名 / {color} 颜色 / {platform} 平台键 / {index} 序号
 * - ZIP 内按平台分目录：{platform}/{文件名}.{ext}
 * - 另生成 manifest.csv（原名 → 输出路径 / 规格 / 字节）
 */
import { zipSync } from 'fflate'
import type { NameVars } from './types'

/** 净化单个路径段中的文件系统非法字符（保留中文） */
export function sanitizeSegment(seg: string): string {
  return (seg ?? '')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'untitled'
}

/** 零填充序号 */
export function padIndex(i: number, total: number): string {
  const width = Math.max(2, String(Math.max(1, total)).length)
  return String(i).padStart(width, '0')
}

/** 渲染文件名模板（不含目录、不含扩展名） */
export function renderName(tpl: string, vars: NameVars): string {
  const map: Record<string, string> = {
    base: vars.base,
    product: vars.product,
    color: vars.color,
    platform: vars.platform,
    index: String(vars.index)
  }
  const out = (tpl || '{base}').replace(/\{(\w+)\}/g, (_, k: string) => (k in map ? map[k]! : `{${k}}`))
  return sanitizeSegment(out)
}

/** 生成 ZIP 内完整相对路径：平台目录/文件名.扩展名 */
export function buildEntryPath(platformKey: string, fileName: string, ext: string): string {
  return `${sanitizeSegment(platformKey)}/${sanitizeSegment(fileName)}.${ext}`
}

export interface ManifestRow {
  source: string
  output: string
  specLabel: string
  width: number
  height: number
  bytes: number
}

/** CSV 字段转义（含逗号/引号/换行时加双引号，内部引号翻倍） */
export function csvCell(v: string | number): string {
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function buildManifestCsv(rows: ManifestRow[]): string {
  const header = ['源文件', '输出路径', '规格', '宽', '高', '字节'].join(',')
  const lines = rows.map((r) =>
    [r.source, r.output, r.specLabel, r.width, r.height, r.bytes].map(csvCell).join(',')
  )
  // 加 UTF-8 BOM，避免 Excel 打开中文乱码
  return '﻿' + [header, ...lines].join('\r\n')
}

export interface ZipEntry {
  path: string
  blob: Blob
}

/** 打包：图片条目 + manifest.csv；重名路径自动加 -2/-3 后缀，绝不覆盖 */
export async function packZip(entries: ZipEntry[], manifest: string): Promise<Blob> {
  const seen = new Set<string>()
  const files: Record<string, Uint8Array> = {}
  const put = (path: string, bytes: Uint8Array) => {
    let finalPath = path
    let n = 2
    while (seen.has(finalPath)) {
      const dot = path.lastIndexOf('.')
      finalPath = dot > 0 ? `${path.slice(0, dot)}-${n}${path.slice(dot)}` : `${path}-${n}`
      n++
    }
    seen.add(finalPath)
    files[finalPath] = bytes
  }
  for (const e of entries) {
    put(e.path, new Uint8Array(await e.blob.arrayBuffer()))
  }
  put('manifest.csv', new TextEncoder().encode(manifest))
  return new Blob([zipSync(files, { level: 6 })], { type: 'application/zip' })
}
