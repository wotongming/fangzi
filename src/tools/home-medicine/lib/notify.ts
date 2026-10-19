/**
 * home-medicine —— 服药提醒：导出系统日历（.ics，每日重复 30 天，到期应重新确认）。
 * 手机后台可能杀通知，.ics 导入系统日历是可靠兜底；具体服药时间以医嘱为准。
 */
import { SLOT_ORDER, type Med, type SlotKey } from './models'
import { isTakingOn } from './schedule'

function escapeIcs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

/** 各时段参考时刻（HHmm），与 schedule.SLOT_CLOCK 对应 */
const CLOCK_HHMM: Record<SlotKey, string> = {
  morning: '080000',
  noon: '120000',
  evening: '180000',
  bedtime: '213000'
}
const SLOT_TEXT: Record<SlotKey, string> = { morning: '早', noon: '中', evening: '晚', bedtime: '睡前' }

const REMIND_DAYS = 30

export function buildMedIcs(meds: Med[], today: string): string {
  const taking = meds.filter((m) => isTakingOn(m, today))
  const dt = today.replace(/-/g, '')
  let i = 0
  const events: string[] = []
  for (const slot of SLOT_ORDER) {
    for (const m of taking) {
      if (!m.slots.includes(slot)) continue
      const dose = m.doseText ? `（每次 ${m.doseText}）` : ''
      const summary = `服药提醒：${m.name} ${SLOT_TEXT[slot]}${dose}`
      events.push(
        [
          'BEGIN:VEVENT',
          `UID:home-medicine-${m.id}-${slot}-${dt}@fangzi`,
          `DTSTART:${dt}T${CLOCK_HHMM[slot]}`,
          `DTEND:${dt}T${CLOCK_HHMM[slot]}`,
          `RRULE:FREQ=DAILY;COUNT=${REMIND_DAYS}`,
          `SUMMARY:${escapeIcs(summary)}`,
          'DESCRIPTION:' + escapeIcs('请按医嘱服药；本提醒仅为时间辅助，药品与剂量以医生/药师嘱咐为准。30 天后请在方子中重新导出。'),
          'BEGIN:VALARM',
          'TRIGGER:-PT10M',
          'ACTION:DISPLAY',
          `DESCRIPTION:${escapeIcs(summary)}`,
          'END:VALARM',
          'END:VEVENT'
        ].join('\r\n')
      )
      i++
    }
  }
  void i
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//fangzi//home-medicine//CN', 'CALSCALE:GREGORIAN', events.join('\r\n'), 'END:VCALENDAR'].join('\r\n')
}

export function downloadIcs(ics: string, filename = 'fangzi-服药提醒.ics'): void {
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
