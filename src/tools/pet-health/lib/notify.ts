/**
 * notify.ts —— 照护提醒：应用内待办为主；.ics 导出系统日历做长期可靠兜底。
 * 无服务器，不做 Web Push；移动 PWA 关闭后浏览器无法保证后台通知，能力边界在 UI 如实说明。
 */
import { PLAN_TEMPLATES } from './models'
import type { DueItem } from './schedule'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** 以「浮动 UTC」表达本地日期 09:00，规避时区歧义。 */
function icsLocalDateAt9(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const ms = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 9, 0, 0)
  const x = new Date(ms)
  return `${x.getUTCFullYear()}${pad(x.getUTCMonth() + 1)}${pad(x.getUTCDate())}T090000`
}

function icsNow(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
}

function escapeIcs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

function labelOf(planKey: string): string {
  return PLAN_TEMPLATES.find((t) => t.key === planKey)?.label ?? planKey
}

function uidFor(d: DueItem): string {
  return `${d.plan.id}-${d.dueDate}@fangzi-pet`
}

/** 为全部待办生成 .ics（单日 09:00 事件，提前 1 天 9 点弹窗）。 */
export function buildIcs(dues: DueItem[], petName: (petId: string) => string): string {
  const events = dues.map((d) => {
    const [y, m, dd] = d.dueDate.split('-').map(Number)
    const start = Date.UTC(y ?? 1970, (m ?? 1) - 1, dd ?? 1, 9, 0, 0)
    const end = start + 1800000
    const summary = `【宠物照护】${petName(d.plan.petId)} 该做：${labelOf(d.plan.planKey)}`
    const desc = `上次记录/起始：${d.basis}。请按兽医建议安排。`
    return [
      'BEGIN:VEVENT',
      `UID:${uidFor(d)}`,
      `DTSTAMP:${icsNow()}`,
      `DTSTART:${icsLocalDateAt9(d.dueDate)}`,
      `DTEND:${(() => { const e = new Date(end); return `${e.getUTCFullYear()}${pad(e.getUTCMonth() + 1)}${pad(e.getUTCDate())}T093000` })()}`,
      `SUMMARY:${escapeIcs(summary)}`,
      `DESCRIPTION:${escapeIcs(desc)}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeIcs(summary)}`,
      'TRIGGER:-PT24H',
      'END:VALARM',
      'END:VEVENT'
    ].join('\r\n')
  })
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//fangzi//pet-health//CN', 'CALSCALE:GREGORIAN', events.join('\r\n'), 'END:VCALENDAR'].join('\r\n')
}

export function downloadIcs(ics: string, filename = 'fangzi-pet-care.ics'): void {
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 请求通知权限；返回是否已授权。 */
export async function ensureNotifyPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  return (await Notification.requestPermission()) === 'granted'
}

/** 页面打开期间，对最近一个「今天/逾期/未来 7 天内」待办弹一次会话通知（仅打开时有效）。 */
export function notifyDueSoon(dues: DueItem[], petName: (petId: string) => string): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const hit = dues.filter((d) => d.daysLeft <= 7).sort((a, b) => a.daysLeft - b.daysLeft)[0]
  if (!hit) return
  const word = hit.overdue ? `已逾期 ${-hit.daysLeft} 天` : hit.today ? '今天到期' : `还有 ${hit.daysLeft} 天`
  try {
    new Notification(`【宠物照护】${petName(hit.plan.petId)} ${labelOf(hit.plan.planKey)}`, {
      body: `${word}（应在 ${hit.dueDate} 前完成）。以兽医建议为准。`,
      tag: `pet-${hit.plan.id}-${hit.dueDate}`
    })
  } catch {
    /* 某些环境需 SW.showNotification，忽略会话内提醒失败 */
  }
}
