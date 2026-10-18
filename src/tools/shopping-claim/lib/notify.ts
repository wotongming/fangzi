/**
 * 提醒：打开应用即算临期/逾期（应用内待办为主）；可选浏览器通知；导出 .ics 兜底。
 * 移动 PWA 后台通知不可靠，因此以应用内倒计时为准，文案如实。
 */
import { addDays } from './models'
import type { WindowStatus } from './deadline-engine'

function icsDate(date: string): string {
  return date.replace(/-/g, '')
}

function escapeIcs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

export interface ReminderEvent {
  /** 提醒日期 YYYY-MM-DD */
  date: string
  summary: string
  description: string
}

/** 根据窗口生成「到期当天」与「提前 2 天」两条提醒（仅未过期窗口）。 */
export function buildReminders(windows: WindowStatus[], product: string): ReminderEvent[] {
  const evs: ReminderEvent[] = []
  for (const w of windows) {
    if (w.end === '—' || w.daysLeft < 0 || !Number.isFinite(w.daysLeft)) continue
    evs.push({
      date: w.end,
      summary: `「${product}」${w.label} 今天到期`,
      description: w.action
    })
    const ahead = addDays(w.end, -2)
    if (w.daysLeft > 2) {
      evs.push({ date: ahead, summary: `「${product}」${w.label} 还剩 2 天`, description: w.action })
    }
  }
  return evs
}

export function buildIcs(events: ReminderEvent[]): string {
  const body = events
    .map((e, i) =>
      [
        'BEGIN:VEVENT',
        `UID:shopping-claim-${i}-${icsDate(e.date)}@fangzi`,
        `DTSTART;VALUE=DATE:${icsDate(e.date)}`,
        `DTEND;VALUE=DATE:${icsDate(e.date)}`,
        `SUMMARY:${escapeIcs(e.summary)}`,
        `DESCRIPTION:${escapeIcs(e.description)}`,
        'BEGIN:VALARM',
        'TRIGGER:PT0S',
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeIcs(e.summary)}`,
        'END:VALARM',
        'END:VEVENT'
      ].join('\r\n')
    )
    .join('\r\n')
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//fangzi//shopping-claim//CN', 'CALSCALE:GREGORIAN', body, 'END:VCALENDAR'].join('\r\n')
}

export function downloadIcs(ics: string, filename = 'fangzi-维权提醒.ics'): void {
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

export async function ensureNotifyPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  try {
    return (await Notification.requestPermission()) === 'granted'
  } catch {
    return false
  }
}
