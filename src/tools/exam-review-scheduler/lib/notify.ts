/**
 * notify.ts —— 提醒三层兜底（页面角标在 index.vue 渲染）。
 * 无后端，不做 Web Push；移动 PWA 关闭后浏览器不保证后台通知。
 * 长期可靠兜底 = 导出标准 .ics 到系统日历（提前 1 天 9 点 VALARM）。
 */
import type { Question } from './models'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** 以「浮动 UTC」表达本地日期 09:00，规避时区歧义。 */
function icsLocalAt9(date: string): string {
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

function shortStem(q: Question): string {
  return q.stem.replace(/\s+/g, ' ').slice(0, 40)
}

/** 为全部「今天到期 / 已逾期」题目生成 .ics（单日 09:00，提前 1 天提醒）。 */
export function buildReviewIcs(dues: Question[], projectName: string): string {
  const events = dues.map((q) => {
    const summary = `【备考复习】${projectName} 复习错题：${shortStem(q)}`
    const desc = `考点：${q.pointPath.subject} / ${q.pointPath.chapter} / ${q.pointPath.point}。打开方子「备考错题调度」完成自评。`
    return [
      'BEGIN:VEVENT',
      `UID:exam-${q.id}@fangzi`,
      `DTSTAMP:${icsNow()}`,
      `DTSTART:${icsLocalAt9(q.nextReview)}`,
      `DTEND:${icsLocalAt9(q.nextReview)}`,
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
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//fangzi//exam-review//CN',
    'CALSCALE:GREGORIAN',
    events.join('\r\n'),
    'END:VCALENDAR'
  ].join('\r\n')
}

export function downloadIcs(ics: string, filename = 'fangzi-exam-review.ics'): void {
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

/** 页面打开期间，对最久逾期的一道题弹一次会话通知（仅打开时有效）。 */
export function notifyDueSoon(dueCount: number, firstStem: string): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  if (dueCount <= 0) return
  try {
    new Notification(`【备考复习】今天有 ${dueCount} 道错题要复习`, {
      body: `最久的一道：${firstStem.slice(0, 40)}。打开方子按「记得/模糊/已忘」自评即可。`,
      tag: 'exam-review-due'
    })
  } catch {
    /* 会话内提醒失败可忽略 */
  }
}
