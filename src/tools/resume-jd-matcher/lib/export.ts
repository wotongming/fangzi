/** 导出：Markdown / 文本下载、浏览器打印为 PDF、看板 CSV（含逗号/引号转义）。全部本地完成。 */

function triggerDownload(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadText(filename: string, content: string): void {
  triggerDownload(filename, content, 'text/plain')
}

export function downloadMarkdown(filename: string, content: string): void {
  triggerDownload(filename, content, 'text/markdown')
}

/** 打开打印窗口（用户在打印对话框选“另存为 PDF”） */
export function printHtml(title: string, bodyHtml: string): void {
  const w = window.open('', '_blank', 'noopener')
  if (!w) throw new Error('浏览器拦截了打印窗口，请允许弹出窗口后重试。')
  w.document.write(`<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>${title}</title>
  <style>
    body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:760px;margin:32px auto;padding:0 20px;color:#1a1a1a;line-height:1.7;}
    h1{font-size:22px;} h2{font-size:17px;margin-top:24px;border-bottom:1px solid #eee;padding-bottom:4px;}
    pre{white-space:pre-wrap;word-break:break-word;font-family:inherit;}
    @media print{body{margin:0;}}
  </style></head><body><pre style="white-space:pre-wrap;font-family:inherit">${bodyHtml
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')}</pre>
  <script>window.onload=function(){window.focus();window.print();};<\/script>
  </body></html>`)
  w.document.close()
}

function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function applicationsToCsv(rows: Array<Record<string, string | number | null>>): string {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0]!)
  const lines = [headers.join(',')]
  for (const r of rows) lines.push(headers.map((h) => csvCell(r[h])).join(','))
  // 加 BOM，Excel 打开中文不乱码
  return '﻿' + lines.join('\r\n')
}
