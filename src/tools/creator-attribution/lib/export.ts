/**
 * export.ts —— 浏览器下载触发（Markdown / CSV）。
 */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadMarkdown(filename: string, md: string): void {
  const blob = new Blob(['﻿' + md], { type: 'text/markdown;charset=utf-8' })
  triggerDownload(blob, filename)
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  triggerDownload(blob, filename)
}
