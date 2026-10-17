/**
 * remind.ts —— 续费提醒：生成 .ics（系统日历长期提醒）与页面会话内 Notification。
 * 不做后台 Web Push（无服务器），长期可靠提醒交给用户系统日历，能力边界在 UI 如实说明。
 */
import { fmtDate, type Subscription } from './subscriptions'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** 以“浮动 UTC”格式化 ICS 本地时间（YYYYMMDDTHHMMSS），规避时区换算歧义。 */
function icsLocal(ms: number): string {
  const d = new Date(ms)
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  )
}

function icsNowStamp(): string {
  return icsLocal(Date.now())
}

function escapeIcs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

function stableUid(s: Subscription): string {
  let h = 0
  const str = s.id
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i)
    h |= 0
  }
  return `sub-${Math.abs(h).toString(36)}@fangzi`
}

const RRULE: Record<string, string> = {
  monthly: 'FREQ=MONTHLY',
  quarterly: 'FREQ=MONTHLY;INTERVAL=3',
  semiannual: 'FREQ=MONTHLY;INTERVAL=6',
  yearly: 'FREQ=YEARLY'
}

/** 单个订阅：下次扣费前 1 天 09:00 提醒，按周期重复，提前 1 天弹窗（VALARM）。 */
export function buildIcs(subs: Subscription[]): string {
  const events = subs
    .filter((s) => !s.ignored)
    .map((s) => {
      const remindAt = s.nextAt - 86400000
      const d = new Date(remindAt)
      const at9 = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 9, 0, 0)
      const end = at9 + 1800000
      const summary = `【续费提醒】${s.displayName} 预计明天扣费`
      const desc = `预计下次扣费约 ¥${(s.priceCents / 100).toFixed(2)}（${s.cadenceLabel}）。如不再使用，请今天到对应 App 关闭自动续费。`
      return [
        'BEGIN:VEVENT',
        `UID:${stableUid(s)}`,
        `DTSTAMP:${icsNowStamp()}`,
        `DTSTART:${icsLocal(at9)}`,
        `DTEND:${icsLocal(end)}`,
        `SUMMARY:${escapeIcs(summary)}`,
        `DESCRIPTION:${escapeIcs(desc)}`,
        `RRULE:${RRULE[s.cadence]}`,
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeIcs(summary)}`,
        'TRIGGER:-PT24H',
        'END:VALARM',
        'END:VEVENT'
      ].join('\r\n')
    })
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//fangzi//subscription-audit//CN', 'CALSCALE:GREGORIAN', events.join('\r\n'), 'END:VCALENDAR'].join('\r\n')
}

/** 触发浏览器下载 .ics。 */
export function downloadIcs(subs: Subscription[], filename = 'fangzi-renew-reminders.ics'): void {
  const ics = buildIcs(subs)
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
  const r = await Notification.requestPermission()
  return r === 'granted'
}

/**
 * 安排“最近一次扣费”的会话内提醒（仅页面打开期间有效）。
 * 返回定时器句柄，便于卸载时清理；已过期/无授权返回 null。
 */
export function scheduleNearestReminder(subs: Subscription[]): ReturnType<typeof setTimeout> | null {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return null
  const now = Date.now()
  const upcoming = subs
    .filter((s) => !s.ignored && s.nextAt - 86400000 > now)
    .sort((a, b) => a.nextAt - b.nextAt)[0]
  if (!upcoming) return null
  const at = upcoming.nextAt - 86400000
  const delay = Math.min(at - now, 2147483000) // setTimeout 上限保护
  return setTimeout(() => {
    try {
      new Notification(`【续费提醒】${upcoming.displayName} 预计明天扣费`, {
        body: `约 ¥${(upcoming.priceCents / 100).toFixed(2)}（${upcoming.cadenceLabel}），不用请尽快关闭自动续费。`,
        tag: `sub-${upcoming.id}-${fmtDate(upcoming.nextAt)}`
      })
    } catch {
      /* 某些环境需用 ServiceWorkerRegistration.showNotification，此处忽略会话提醒失败 */
    }
  }, delay)
}
