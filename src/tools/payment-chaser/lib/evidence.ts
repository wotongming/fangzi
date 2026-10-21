/**
 * payment-chaser —— 证据包导出：
 *  - PDF：用 canvas 以系统字体绘制中文报告页 → JPEG → pdf-lib 排版（无需内嵌中文字体，包体小）。
 *  - CSV / JSON：结构化数据导出（含金额/客户/时间线，可程序校验）。
 */
import { PDFDocument } from 'pdf-lib'
import { centsToYuan, daysOverdue } from './aging'
import type { Invoice } from './models'

const PAGE_W = 595.28 // A4 pt
const PAGE_H = 841.89
const SCALE = 2 // 画布倍率让 PDF 清晰

function escapeCsv(s: string): string {
  const v = String(s ?? '')
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

export function toCsv(invoices: Invoice[]): string {
  const header = ['客户', '项目', '金额', '约定付款日', '状态', '逾期天数', '催收次数', '备注']
  const rows = invoices.map((inv) => [
    inv.clientName,
    inv.projectName,
    (inv.amountCents / 100).toFixed(2),
    inv.dueDate,
    inv.paid ? '已结清' : '未付',
    inv.paid ? '0' : String(daysOverdue(inv, todayStr())),
    String(inv.timeline.length),
    inv.note ?? ''
  ])
  return [header, ...rows].map((r) => r.map(escapeCsv).join(',')).join('\r\n')
}

export function toJson(invoices: Invoice[]): string {
  return JSON.stringify(
    { exportedAt: new Date().toISOString(), invoices },
    null,
    2
  )
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 在离屏 canvas 上绘制一页证据报告，返回 JPEG Blob。 */
async function renderReportPage(invoices: Invoice[], title: string): Promise<Blob> {
  const w = Math.round(PAGE_W * SCALE)
  const h = Math.round(PAGE_H * SCALE)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#111827'
  const pad = 36 * SCALE
  let y = pad
  ctx.font = `bold ${20 * SCALE}px "PingFang SC", "Microsoft YaHei", sans-serif`
  ctx.fillText(title, pad, y)
  y += 10 * SCALE
  ctx.fillStyle = '#6b7280'
  ctx.font = `${11 * SCALE}px "PingFang SC", "Microsoft YaHei", sans-serif`
  ctx.fillText(`导出日期：${todayStr()}　|　本文件由「方子·自由职业追款助手」本地生成，数据未上传`, pad, y)
  y += 24 * SCALE

  ctx.fillStyle = '#111827'
  ctx.font = `bold ${13 * SCALE}px "PingFang SC", "Microsoft YaHei", sans-serif`
  let outstanding = 0
  for (const inv of invoices) if (!inv.paid) outstanding += inv.amountCents
  ctx.fillText(`未结清合计：${centsToYuan(outstanding)}（共 ${invoices.filter((i) => !i.paid).length} 笔）`, pad, y)
  y += 22 * SCALE

  for (const inv of invoices) {
    const days = daysOverdue(inv, todayStr())
    ctx.font = `bold ${12 * SCALE}px "PingFang SC", "Microsoft YaHei", sans-serif`
    ctx.fillStyle = inv.paid ? '#6b7280' : '#b91c1c'
    ctx.fillText(
      `${inv.clientName}｜${inv.projectName}｜${centsToYuan(inv.amountCents)}｜应付 ${inv.dueDate}｜${inv.paid ? '已结清' : `逾期 ${days} 天`}`,
      pad,
      y
    )
    y += 16 * SCALE
    ctx.font = `${10.5 * SCALE}px "PingFang SC", "Microsoft YaHei", sans-serif`
    ctx.fillStyle = '#374151'
    if (inv.note) {
      ctx.fillText(`备注：${inv.note}`, pad + 8 * SCALE, y)
      y += 14 * SCALE
    }
    for (const t of inv.timeline) {
      ctx.fillText(`· ${t.date} ${t.method}：${t.note}${t.response ? `（对方：${t.response}）` : ''}`, pad + 8 * SCALE, y)
      y += 14 * SCALE
    }
    y += 6 * SCALE
    if (y > h - pad) break
  }

  ctx.fillStyle = '#9ca3af'
  ctx.font = `${9 * SCALE}px "PingFang SC", "Microsoft YaHei", sans-serif`
  ctx.fillText('投诉/起诉维权可参考：全国违约拖欠中小企业款项投诉平台 sme-dj.miit.gov.cn、12315。', pad, h - pad)

  return await new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.9))
}

export async function buildEvidencePdf(invoices: Invoice[]): Promise<Blob> {
  const doc = await PDFDocument.create()
  doc.setTitle('应收账款催收证据包')
  doc.setProducer('fangzi payment-chaser')
  const PAGE_PER = 8
  const chunks: Invoice[][] = []
  for (let i = 0; i < invoices.length; i += PAGE_PER) chunks.push(invoices.slice(i, i + PAGE_PER))
  if (chunks.length === 0) chunks.push([])
  for (let i = 0; i < chunks.length; i++) {
    const page = doc.addPage([PAGE_W, PAGE_H])
    const blob = await renderReportPage(chunks[i]!, i === 0 ? '应收账款催收证据包' : '应收账款催收证据包（续）')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const img = await doc.embedJpg(bytes)
    page.drawImage(img, { x: 0, y: 0, width: PAGE_W, height: PAGE_H })
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
