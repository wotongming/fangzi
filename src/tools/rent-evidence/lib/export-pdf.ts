/**
 * export-pdf.ts —— 证据包 PDF：canvas 系统字体绘中文报告页 → JPEG → pdf-lib。
 * 复用 payment-chaser 已验证模式，无需内嵌中文字体，包体小。
 */
import { PDFDocument } from 'pdf-lib'
import type { EvidenceRow, PhotoSection } from './model'

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('照片加载失败'))
    img.src = dataUrl
  })
}

/** 渲染一张照片页：A4 白底、照片等比 contain、下方中文图注。 */
async function renderPhotoPage(sectionTitle: string, caption: string, photoDataUrl: string): Promise<Blob> {
  const w = Math.round(PAGE_W * SCALE)
  const h = Math.round(PAGE_H * SCALE)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  const pad = 40 * SCALE
  ctx.fillStyle = '#111827'
  ctx.font = `bold ${13 * SCALE}px ${FONT}`
  ctx.fillText(sectionTitle, pad, pad)
  const img = await loadImage(photoDataUrl)
  const top = pad + 16 * SCALE
  const bottom = h - pad - 26 * SCALE
  const boxW = w - pad * 2
  const boxH = bottom - top
  const scale = Math.min(boxW / img.width, boxH / img.height)
  const dw = img.width * scale
  const dh = img.height * scale
  const dx = (w - dw) / 2
  const dy = top + (boxH - dh) / 2
  ctx.fillStyle = '#f3f4f6'
  ctx.fillRect(pad, top, boxW, boxH)
  ctx.drawImage(img, dx, dy, dw, dh)
  ctx.strokeStyle = '#d1d5db'
  ctx.strokeRect(pad, top, boxW, boxH)
  ctx.fillStyle = '#374151'
  ctx.font = `${11 * SCALE}px ${FONT}`
  // 图注折行
  let rest = caption
  const maxWidth = w - pad * 2
  let cy = bottom + 20 * SCALE
  while (rest.length > 0) {
    let end = rest.length
    while (end > 1 && ctx.measureText(rest.slice(0, end)).width > maxWidth) end--
    ctx.fillText(rest.slice(0, end), pad, cy)
    rest = rest.slice(end)
    cy += 16 * SCALE
  }
  return await new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.9))
}

const PAGE_W = 595.28
const PAGE_H = 841.89
const SCALE = 2
const FONT = `"PingFang SC", "Microsoft YaHei", sans-serif`

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function renderPage(lines: string[], title: string, first: boolean): Promise<Blob> {
  const w = Math.round(PAGE_W * SCALE)
  const h = Math.round(PAGE_H * SCALE)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  const pad = 36 * SCALE
  let y = pad
  ctx.fillStyle = '#111827'
  ctx.font = `bold ${20 * SCALE}px ${FONT}`
  ctx.fillText(title, pad, y)
  y += 12 * SCALE
  ctx.fillStyle = '#6b7280'
  ctx.font = `${10.5 * SCALE}px ${FONT}`
  ctx.fillText(`导出日期：${todayStr()}　|　本文件由「方子·租赁证据链」本地生成，照片原件见应用内相册，数据未上传`, pad, y)
  y += 26 * SCALE
  ctx.fillStyle = '#111827'
  for (const line of lines) {
    ctx.font = `${11 * SCALE}px ${FONT}`
    // 简易折行
    const maxWidth = w - pad * 2
    let rest = line
    while (rest.length > 0) {
      let end = rest.length
      while (end > 1 && ctx.measureText(rest.slice(0, end)).width > maxWidth) end--
      ctx.fillText(rest.slice(0, end), pad, y)
      rest = rest.slice(end)
      y += 17 * SCALE
      if (y > h - pad - 20 * SCALE) break
    }
    if (y > h - pad - 20 * SCALE) break
  }
  if (first) {
    ctx.fillStyle = '#9ca3af'
    ctx.font = `${9 * SCALE}px ${FONT}`
    ctx.fillText('说明：照片均已在拍摄时烧入时间戳水印；押金/维修费台账可作调解/诉讼证据参考。', pad, h - pad)
  }
  return await new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.9))
}

export async function buildEvidencePdf(rows: EvidenceRow[], photoSections: PhotoSection[] = []): Promise<Blob> {
  const flat: string[] = []
  for (const r of rows) {
    flat.push(r.section)
    if (r.lines.length === 0) flat.push('（暂无记录）')
    for (const l of r.lines) flat.push('　' + l)
    flat.push('')
  }
  const PER = 26
  const chunks: string[][] = []
  for (let i = 0; i < flat.length; i += PER) chunks.push(flat.slice(i, i + PER))
  if (chunks.length === 0) chunks.push(['（暂无记录）'])
  const doc = await PDFDocument.create()
  doc.setTitle('租赁证据包')
  doc.setProducer('fangzi rent-evidence')
  for (let i = 0; i < chunks.length; i++) {
    const page = doc.addPage([PAGE_W, PAGE_H])
    const blob = await renderPage(chunks[i]!, '租赁证据包' + (i === 0 ? '' : '（续）'), i === 0)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const img = await doc.embedJpg(bytes)
    page.drawImage(img, { x: 0, y: 0, width: PAGE_W, height: PAGE_H })
  }
  // 照片页：每个分组标题页起按张渲染
  for (const section of photoSections) {
    for (const item of section.items) {
      const page = doc.addPage([PAGE_W, PAGE_H])
      const blob = await renderPhotoPage(section.title, item.caption, item.photo.dataUrl)
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const img = await doc.embedJpg(bytes)
      page.drawImage(img, { x: 0, y: 0, width: PAGE_W, height: PAGE_H })
    }
  }
  const out = await doc.save()
  return new Blob([out.buffer as ArrayBuffer], { type: 'application/pdf' })
}

/** 触发浏览器下载。 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
