/**
 * 证据包导出：ZIP（图片 + 证据清单 + 可选维权文书）。fflate（MIT，已在依赖）。
 */
import { strToU8, zipSync } from 'fflate'
import { fmtYuan, fmtDateTime, type ClaimCase, type Evidence } from './models'
import { EVIDENCE_KIND_LABELS } from './evidence'
import { evidenceFileName } from './evidence'
import { CATEGORY_RULES, DISCLAIMER, RULE_VERSION } from './rules-cn'
import { computeWindows } from './deadline-engine'
import { STATUS_LABELS } from './case-state'

async function blobToU8(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

function buildManifest(c: ClaimCase, list: Evidence[]): string {
  const lines: string[] = []
  lines.push('网购退换货维权 · 证据清单')
  lines.push('（由方子 shopping-claim 在本机生成）')
  lines.push('')
  lines.push(`商品名称：${c.product || '（未填）'}`)
  lines.push(`购买渠道：${c.channel || '（未填）'}`)
  lines.push(`订单编号：${c.orderNo || '（未填）'}`)
  if (c.amountCents != null) lines.push(`成交金额：${fmtYuan(c.amountCents)}`)
  lines.push(`签收日期：${c.receivedDate}`)
  lines.push(`商品类别：${CATEGORY_RULES[c.category].label}`)
  lines.push(`当前进度：${STATUS_LABELS[c.status]}`)
  lines.push('')
  lines.push('时效窗口（以生成当天计算）：')
  for (const w of computeWindows(c)) {
    const left = Number.isFinite(w.daysLeft)
      ? w.daysLeft < 0
        ? `已过期 ${-w.daysLeft} 天`
        : `剩余 ${w.daysLeft} 天（截止 ${w.end}）`
      : '不适用'
    lines.push(`- ${w.label}：${left}`)
  }
  lines.push('')
  lines.push(`证据共 ${list.length} 项：`)
  lines.push('序号 | 类型 | 录入(固化)时间 | 原文件名 | 备注')
  for (const e of [...list].sort((a, b) => a.seq - b.seq)) {
    lines.push(
      `${String(e.seq).padStart(2, '0')} | ${EVIDENCE_KIND_LABELS[e.kind]} | ${fmtDateTime(e.capturedAt)} | ${e.originalName} | ${e.note || ''}`
    )
  }
  lines.push('')
  lines.push(`规则版本：${RULE_VERSION}`)
  lines.push(DISCLAIMER)
  return lines.join('\n')
}

export async function buildEvidenceZip(c: ClaimCase, list: Evidence[], letter?: { name: string; text: string }): Promise<Blob> {
  const files: Record<string, Uint8Array> = {}
  for (const e of [...list].sort((a, b) => a.seq - b.seq)) {
    files[`evidence/${evidenceFileName(e)}`] = await blobToU8(e.blob)
  }
  files['证据清单.txt'] = strToU8(buildManifest(c, list))
  if (letter && letter.text) files[`维权文书_${letter.name}.txt`] = strToU8(letter.text)
  const zipped = zipSync(files, { level: 6 })
  return new Blob([zipped], { type: 'application/zip' })
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
