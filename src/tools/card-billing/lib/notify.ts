/**
 * card-billing —— 提醒：应用内倒计时为主；可选浏览器通知；.ics 导入系统日历兜底。
 */
import type { DueEvent } from './timeline'
import { addDays } from './models'

function icsDate(date: string): string {
  return date.replace(/-/g, '')
}
function escapeIcs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

export interface IcsEvent {
  date: string
  summary: string
  description: string
}

/** 为每个未逾期、未还的还款日生成“当天”+“提前3天”提醒。 */
export function buildRepaymentReminders(events: DueEvent[], todayStr: string): IcsEvent[] {
  const out: IcsEvent[] = []
  for (const e of events) {
    if (e.paid || e.daysLeft < 0) continue
    const label = `${e.name}${e.last4 ? '(' + e.last4 + ')' : ''}`
    out.push({ date: e.due, summary: `${label} 信用卡今日还款`, description: '请前往银行官方渠道确认并还款（本工具不代还，金额以银行账单为准）。' })
    if (e.daysLeft > 3) {
      const ahead = addDays(e.due, -3)
      void todayStr
      out.push({ date: ahead, summary: `${label} 信用卡 3 天后还款`, description: '提前确认还款资金，避免逾期罚息与征信影响。' })
    }
  }
  return out
}

export function buildIcs(events: IcsEvent[]): string {
  const body = events
    .map((e, i) =>
      [
        'BEGIN:VEVENT',
        `UID:card-billing-${i}-${icsDate(e.date)}@fangzi`,
        `DTSTART;VALUE=DATE:${icsDate(e.date)}`,
        `DTEND;VALUE=DATE:${icsDate(e.date)}`,
        `SUMMARY:${escapeIcs(e.summary)}`,
        `DESCRIPTION:${escapeIcs(e.description)}`,
        'BEGIN:VALARM',
        'TRIGGER:PT9H',
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeIcs(e.summary)}`,
        'END:VALARM',
        'END:VEVENT'
      ].join('\r\n')
    )
    .join('\r\n')
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//fangzi//card-billing//CN', 'CALSCALE:GREGORIAN', body, 'END:VCALENDAR'].join('\r\n')
}

export function downloadIcs(ics: string, filename = 'fangzi-信用卡还款提醒.ics'): void {
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
