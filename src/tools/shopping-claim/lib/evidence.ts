/**
 * 证据处理：选图/拍照 → Canvas 压缩（去元数据、限长边）→ 连续编号、固化录入时刻。
 * 复用仓库通用模块 image-redraw（MIT，商用友好）。
 * 说明：截图/聊天记录多无 EXIF，且压缩重绘会去除元数据；证据可追溯性主要靠
 * 「案件内连续编号 + 原始文件名 + 录入时刻」三者保证，时间线见 capturedAt。
 */
import { redrawImage } from '../../../../reusable-module/image-redraw/image-redraw'
import { createId, fmtDateTime, type Evidence, type EvidenceKind } from './models'

export const EVIDENCE_MAX_EDGE = 1600
export const EVIDENCE_QUALITY = 0.72

export const EVIDENCE_KIND_LABELS: Record<EvidenceKind, string> = {
  order: '订单截图',
  chat: '聊天记录',
  logistics: '物流签收',
  product: '商品/瑕疵照片',
  payment: '支付凭证',
  other: '其它'
}

export const EVIDENCE_KIND_ORDER: EvidenceKind[] = ['order', 'payment', 'chat', 'logistics', 'product', 'other']

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export async function compressImage(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const res = await redrawImage(file, { outType: 'image/jpeg', quality: EVIDENCE_QUALITY, maxEdge: EVIDENCE_MAX_EDGE })
  return { blob: res.blob, width: res.width, height: res.height }
}

export async function buildEvidence(
  file: { name: string; blob: Blob },
  caseId: string,
  seq: number,
  kind: EvidenceKind,
  note?: string
): Promise<Evidence> {
  const { blob, width, height } = await compressImage(file.blob)
  const now = Date.now()
  return {
    id: createId('ev'),
    caseId,
    seq,
    kind,
    originalName: file.name || `image-${seq}.jpg`,
    note: note?.trim() || undefined,
    mime: 'image/jpeg',
    width,
    height,
    bytes: blob.size,
    blob,
    capturedAt: now,
    createdAt: now
  }
}

/** 证据在 ZIP 内的文件名：序号_类型_时间戳.jpg（时间戳取录入时刻，保证唯一与可追溯）。 */
export function evidenceFileName(e: Evidence): string {
  const pad = String(e.seq).padStart(2, '0')
  const d = new Date(e.capturedAt)
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  return `${pad}_${e.kind}_${stamp}.jpg`
}

export function totalEvidenceBytes(list: Evidence[]): number {
  return list.reduce((s, e) => s + (e.bytes || 0), 0)
}

export { fmtDateTime }
