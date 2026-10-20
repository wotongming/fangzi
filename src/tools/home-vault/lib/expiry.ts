/**
 * expiry.ts —— 到期抽象与系统日历 .ics 导出（纯函数，可单测）。
 * 聚合 assets.warrantyEnd（保修）+ 手动登记项（证件/保险/年检），
 * 分级：逾期红 / 7 天内橙 / 30 天内黄 / 正常。
 * .ics 每项双 VALARM：提前 30 天与 7 天（仿 home-medicine notify 手写）。
 */
import {
  SOON_30_DAYS,
  SOON_7_DAYS,
  daysBetween,
  type Asset,
  type ExpiryItem,
  type ExpiryLevel,
  type ExpiryRow
} from './models'

/** 距今天数 → 分级（days<0 逾期；≤7 橙；≤30 黄；其余正常） */
export function classifyExpiry(days: number | null): ExpiryLevel {
  if (days === null) return 'ok'
  if (days < 0) return 'expired'
  if (days <= SOON_7_DAYS) return 'soon7'
  if (days <= SOON_30_DAYS) return 'soon30'
  return 'ok'
}

const LEVEL_ORDER: Record<ExpiryLevel, number> = { expired: 0, soon7: 1, soon30: 2, ok: 3 }

/** 聚合资产保修截止 + 手动到期项为看板行，并按紧迫度排序。 */
export function buildExpiryRows(assets: Asset[], manual: ExpiryItem[], today: string): ExpiryRow[] {
  const rows: ExpiryRow[] = []
  for (const a of assets) {
    if (!a.warrantyEnd) continue
    const days = daysBetween(today, a.warrantyEnd)
    rows.push({
      id: `warranty:${a.id}`,
      title: `${a.name}（保修截止）`,
      dueDate: a.warrantyEnd,
      kind: 'warranty',
      assetId: a.id,
      level: classifyExpiry(days),
      days
    })
  }
  for (const m of manual) {
    const days = daysBetween(today, m.dueDate)
    rows.push({
      id: m.id,
      title: m.title,
      dueDate: m.dueDate,
      kind: m.kind,
      assetId: m.assetId,
      level: classifyExpiry(days),
      days
    })
  }
  return rows.sort((x, y) => {
    const lv = LEVEL_ORDER[x.level] - LEVEL_ORDER[y.level]
    if (lv !== 0) return lv
    return x.dueDate.localeCompare(y.dueDate)
  })
}

export const EXPIRY_LEVEL_LABELS: Record<ExpiryLevel, string> = {
  expired: '已逾期',
  soon7: '7 天内到期',
  soon30: '30 天内到期',
  ok: '正常'
}

function escapeIcs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

function toIcsDate(d: string): string {
  return d.replace(/-/g, '')
}

/**
 * 生成 .ics：每行一个 VEVENT，含提前 30 天与 7 天两条 VALARM。
 * 浮点本地时间（不带 TZID），由系统日历按本地时区解释。
 */
export function buildExpiryIcs(rows: ExpiryRow[], today: string): string {
  const stamp = today.replace(/-/g, '')
  const events: string[] = []
  for (const r of rows) {
    const dt = toIcsDate(r.dueDate)
    const summary = `到期提醒：${r.title}`
    events.push(
      [
        'BEGIN:VEVENT',
        `UID:home-vault-${r.id}-${stamp}@fangzi`,
        `DTSTAMP:${stamp}T090000`,
        `DTSTART:${dt}T090000`,
        `DTEND:${dt}T093000`,
        `SUMMARY:${escapeIcs(summary)}`,
        `DESCRIPTION:${escapeIcs(`到期日 ${r.dueDate}；由方子家庭资产档案库导出，提前 30 天与 7 天各提醒一次。`)}`,
        'BEGIN:VALARM',
        'TRIGGER:-P30D',
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeIcs(`${r.title} 将在 30 天内到期，请检查续期/报修`)}`,
        'END:VALARM',
        'BEGIN:VALARM',
        'TRIGGER:-P7D',
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeIcs(`${r.title} 将在 7 天内到期，请尽快处理`)}`,
        'END:VALARM',
        'END:VEVENT'
      ].join('\r\n')
    )
  }
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//fangzi//home-vault//CN',
    'CALSCALE:GREGORIAN',
    events.join('\r\n'),
    'END:VCALENDAR'
  ].join('\r\n')
}

export function downloadIcs(ics: string, filename = 'home-vault-到期提醒.ics'): void {
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
