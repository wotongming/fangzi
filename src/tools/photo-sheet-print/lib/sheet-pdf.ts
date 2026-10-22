/**
 * photo-sheet-print —— 成册 PDF 导出：
 * 每页离屏 canvas（150 DPI）绘制 → JPEG → pdf-lib 排版 A4（无需内嵌中文字体，包体小）。
 * 浏览器打印走 window.print（在 index.vue 的打印预览区用 CSS 分页），与本模块互补。
 */
import { PDFDocument } from 'pdf-lib'
import {
  fitInto,
  gridCells,
  groupPages,
  headerHeight,
  mmToPt,
  paperSize,
  rotateDims,
  type SheetConfig
} from './layout'
import type { PhotoItem } from './models'

const DPI = 150
const SCALE = DPI / 72

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片加载失败'))
    }
    img.src = url
  })
}

function drawPhoto(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  photo: PhotoItem,
  cell: { x: number; y: number; w: number; h: number },
  headerOffset: number
): void {
  const rotated = rotateDims(photo.width, photo.height, photo.rotation)
  const fit = fitInto(rotated.w, rotated.h, cell.w, cell.h)
  const cx = cell.x + cell.w / 2
  const cy = cell.y + headerOffset + cell.h / 2
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate((photo.rotation * Math.PI) / 180)
  ctx.drawImage(img, -fit.w / 2, -fit.h / 2, fit.w, fit.h)
  ctx.restore()
}

async function renderPage(photos: PhotoItem[], cfg: SheetConfig, pageIndex: number): Promise<Blob> {
  const paper = paperSize(cfg.orientation)
  const headerH = headerHeight(cfg.header)
  const usablePaper = { w: paper.w, h: paper.h - headerH }
  const cells = gridCells(usablePaper, { ...cfg, marginMm: cfg.marginMm })

  const w = Math.round(paper.w * SCALE)
  const h = Math.round(paper.h * SCALE)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)

  if (cfg.header.trim()) {
    ctx.fillStyle = '#111827'
    ctx.font = `bold ${13 * SCALE}px "PingFang SC", "Microsoft YaHei", sans-serif`
    ctx.textBaseline = 'top'
    ctx.fillText(cfg.header.trim(), mmToPt(cfg.marginMm) * SCALE, mmToPt(cfg.marginMm) * SCALE)
    ctx.fillStyle = '#9ca3af'
    ctx.font = `${9 * SCALE}px "PingFang SC", "Microsoft YaHei", sans-serif`
    ctx.fillText(`第 ${pageIndex + 1} 页`, (paper.w - mmToPt(cfg.marginMm)) * SCALE, mmToPt(cfg.marginMm) * SCALE)
  }

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i]!
    const cell = cells[i]
    if (!cell) break
    const img = await loadImage(photo.blob)
    drawPhoto(ctx, img, photo, cell, headerH)
  }

  return await new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.92))
}

/** 生成成册 PDF；无照片时抛错由上层提示。 */
export async function buildSheetPdf(photos: PhotoItem[], cfg: SheetConfig): Promise<Blob> {
  if (photos.length === 0) throw new Error('还没有照片，先导入再导出')
  const per = cfg.cols * cfg.rows
  const pages = groupPages(photos, per)
  const doc = await PDFDocument.create()
  doc.setTitle('作业照片成册')
  doc.setProducer('fangzi photo-sheet-print')
  const paper = paperSize(cfg.orientation)
  for (let i = 0; i < pages.length; i++) {
    const page = doc.addPage([paper.w, paper.h])
    const blob = await renderPage(pages[i]!, cfg, i)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const img = await doc.embedJpg(bytes)
    page.drawImage(img, { x: 0, y: 0, width: paper.w, height: paper.h })
  }
  const out = await doc.save()
  return new Blob([out.buffer as ArrayBuffer], { type: 'application/pdf' })
}

export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
