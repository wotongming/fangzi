/**
 * 维权进度状态机（纯函数）。
 */
import { createId, type CaseStatus, type ClaimCase, type StatusLog } from './models'

export const STATUS_ORDER: CaseStatus[] = ['evidence', 'negotiate', 'platform', 'complain12315', 'done']

export const STATUS_LABELS: Record<CaseStatus, string> = {
  evidence: '① 待取证',
  negotiate: '② 与商家协商',
  platform: '③ 平台介入',
  complain12315: '④ 12315 / 投诉',
  done: '⑤ 完成'
}

export function statusIndex(s: CaseStatus): number {
  return STATUS_ORDER.indexOf(s)
}

export function nextStatus(s: CaseStatus): CaseStatus | null {
  const i = statusIndex(s)
  return i < STATUS_ORDER.length - 1 ? STATUS_ORDER[i + 1]! : null
}

export function prevStatus(s: CaseStatus): CaseStatus | null {
  const i = statusIndex(s)
  return i > 0 ? STATUS_ORDER[i - 1]! : null
}

/** 前进或回退状态，并追加日志（不原地改，返回新对象）。 */
export function moveStatus(c: ClaimCase, target: CaseStatus, note?: string): ClaimCase {
  const log: StatusLog = { status: target, at: Date.now() }
  if (note && note.trim()) log.note = note.trim()
  return { ...c, status: target, updatedAt: Date.now(), logs: [...(c.logs || []), log] }
}

export function newCase(partial: Omit<ClaimCase, 'id' | 'status' | 'logs' | 'createdAt' | 'updatedAt'>): ClaimCase {
  const now = Date.now()
  return {
    ...partial,
    id: createId('case'),
    status: 'evidence',
    logs: [{ status: 'evidence', at: now }],
    createdAt: now,
    updatedAt: now
  }
}
