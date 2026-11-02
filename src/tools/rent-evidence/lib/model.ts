/**
 * model.ts —— 租赁证据链纯逻辑层（无 DOM，可独立单测）。
 * 数据：入住带水印照片 / 报修工单 / 台账；导出证据摘要。
 */

export type PhotoKind = 'move-in' | 'repair' | 'move-out'

export interface PhotoRecord {
  id: string
  /** ISO 时间戳（拍摄时刻，由拍照时记录，不可事后篡改） */
  at: string
  kind: PhotoKind
  /** 位置/部位标签：客厅墙面 / 主卧地板 / 冰箱 ... */
  item: string
  note: string
  /** 压缩后的 JPEG dataURL（含水印） */
  dataUrl: string
}

export type Responsibility = 'landlord' | 'tenant' | 'unknown'

export interface RepairTicket {
  id: string
  at: string
  title: string
  description: string
  responsibility: Responsibility
  costCents: number
  photoIds: string[]
}

export type LedgerKind = 'deposit' | 'rent' | 'repair' | 'agency' | 'other'

export interface LedgerEntry {
  id: string
  at: string
  kind: LedgerKind
  amountCents: number
  note: string
}

export const LEDGER_LABEL: Record<LedgerKind, string> = {
  deposit: '押金',
  rent: '租金',
  repair: '维修费',
  agency: '中介费',
  other: '其它'
}

/** 交接清单项（预置） */
export const CHECKLIST_ITEMS = [
  '客厅墙面', '客厅地板', '卧室墙面', '卧室地板', '门窗', '卫生间',
  '厨房', '空调', '冰箱', '洗衣机', '热水器', '燃气灶',
  '钥匙/门禁卡', '水表读数', '电表读数', '燃气表读数'
] as const

/**
 * 责任初判：根据报修描述关键词给出倾向。
 * - 明确老化/自然损耗类词 → landlord（房东责任）
 * - 明确人为/使用不当类词 → tenant（租客责任）
 * - 都没有 → unknown（待双方协商/师傅到场判定）
 */
const LANDLORD_WORDS = ['老化', '自然', '生锈', '跳闸', '漏水', '堵塞', '老化', '管道', '线路', '漏电', '发霉', '开裂', '脱落', '故障', '突然']
const TENANT_WORDS = ['摔', '砸', '撞', '划痕', '钉孔', '涂鸦', '弄脏', '打碎', '砸坏', '进水', '泡水', '烟头', '掉漆', '折断', '撕']

export function classifyResponsibility(text: string): Responsibility {
  let l = 0
  let t = 0
  for (const w of LANDLORD_WORDS) if (text.includes(w)) l++
  for (const w of TENANT_WORDS) if (text.includes(w)) t++
  if (l === 0 && t === 0) return 'unknown'
  if (t > l) return 'tenant'
  if (l > t) return 'landlord'
  return 'unknown'
}

export const RESP_LABEL: Record<Responsibility, string> = {
  landlord: '疑似房东责任（自然老化）',
  tenant: '疑似租客责任（人为损坏）',
  unknown: '待定（需师傅到场/双方协商）'
}

/** 水印时间字符串：2026-11-02 14:30 */
export function formatStamp(atIso: string): string {
  const d = new Date(atIso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export interface EvidenceRow {
  section: string
  lines: string[]
}

/** 汇总证据包文字（供 PDF 导出）。 */
export function summarizeEvidence(
  photos: PhotoRecord[],
  tickets: RepairTicket[],
  ledger: LedgerEntry[]
): EvidenceRow[] {
  const rows: EvidenceRow[] = []
  const moves = photos.filter((p) => p.kind === 'move-in').sort((a, b) => a.at.localeCompare(b.at))
  const outs = photos.filter((p) => p.kind === 'move-out').sort((a, b) => a.at.localeCompare(b.at))
  rows.push({
    section: '一、入住交接照片（共 ' + moves.length + ' 条）',
    lines: moves.map((p) => `[${formatStamp(p.at)}] ${p.item}${p.note ? '：' + p.note : ''}`)
  })
  rows.push({
    section: '二、退租对比照片（共 ' + outs.length + ' 条）',
    lines: outs.map((p) => `[${formatStamp(p.at)}] ${p.item}${p.note ? '：' + p.note : ''}`)
  })
  rows.push({
    section: '三、租期报修工单（共 ' + tickets.length + ' 条）',
    lines: tickets
      .slice()
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((t) => `[${formatStamp(t.at)}] ${t.title}｜${RESP_LABEL[t.responsibility]}｜费用 ¥${(t.costCents / 100).toFixed(0)}｜${t.description}`)
  })
  rows.push({
    section: '四、押金/租金/维修台账（共 ' + ledger.length + ' 笔）',
    lines: ledger
      .slice()
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((e) => `[${formatStamp(e.at)}] ${LEDGER_LABEL[e.kind]} ¥${(e.amountCents / 100).toFixed(0)}${e.note ? '：' + e.note : ''}`)
  })
  return rows
}

export function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/** PDF 照片页分组（纯函数，无 DOM，可单测）。 */
export interface PhotoSection {
  /** 分组标题（中文） */
  title: string
  items: Array<{ photo: PhotoRecord; caption: string }>
}

/**
 * 按入住交接 / 退租复核 / 报修工单（按工单标题归组）分组水印照片，
 * 生成 PDF 照片页所需的标题+图注序列。
 */
export function groupPhotosForPdf(photos: PhotoRecord[], tickets: RepairTicket[]): PhotoSection[] {
  const caption = (p: PhotoRecord) => `[${formatStamp(p.at)}] ${p.item}${p.note ? '｜' + p.note : ''}`
  const sections: PhotoSection[] = []
  const moves = photos.filter((p) => p.kind === 'move-in').sort((a, b) => a.at.localeCompare(b.at))
  const outs = photos.filter((p) => p.kind === 'move-out').sort((a, b) => a.at.localeCompare(b.at))
  if (moves.length)
    sections.push({ title: `照片证据一、入住交接照（共 ${moves.length} 张）`, items: moves.map((photo) => ({ photo, caption: caption(photo) })) })
  if (outs.length)
    sections.push({ title: `照片证据二、退租复核照（共 ${outs.length} 张）`, items: outs.map((photo) => ({ photo, caption: caption(photo) })) })
  const byTicket = new Map<string, PhotoRecord[]>()
  const orphan: PhotoRecord[] = []
  for (const p of photos.filter((x) => x.kind === 'repair')) {
    const t = tickets.find((t) => t.photoIds.includes(p.id))
    if (t) {
      const arr = byTicket.get(t.id) ?? []
      arr.push(p)
      byTicket.set(t.id, arr)
    } else {
      orphan.push(p)
    }
  }
  for (const t of tickets) {
    const arr = byTicket.get(t.id)
    if (!arr || !arr.length) continue
    sections.push({
      title: `照片证据三、报修工单「${t.title}」（${formatStamp(t.at)}，${RESP_LABEL[t.responsibility]}）`,
      items: arr.sort((a, b) => a.at.localeCompare(b.at)).map((photo) => ({ photo, caption: caption(photo) }))
    })
  }
  if (orphan.length)
    sections.push({ title: '照片证据四、未关联工单的报修现场照', items: orphan.map((photo) => ({ photo, caption: caption(photo) })) })
  return sections
}
