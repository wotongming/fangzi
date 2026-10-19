/**
 * tax-deduction —— 年度节点提醒：上年 12 月确认、次年 3–6 月汇算；.ics 导入系统日历兜底。
 */

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

/** 为某纳税年度生成 12 月确认、次年汇算开始/截止三个提醒。 */
export function buildTimelineEvents(year: number): IcsEvent[] {
  return [
    {
      date: `${year}-12-01`,
      summary: `确认 ${year + 1} 年度个税专项附加扣除信息`,
      description: '在个税 App 核对次年七项专项附加扣除信息（子女毕业、房贷/租金变更等），规则参考请以税务机关口径为准。'
    },
    {
      date: `${year + 1}-03-01`,
      summary: `${year} 年度个税综合所得汇算开始`,
      description: '可办理上一年度综合所得汇算清缴，核对专项附加扣除与预扣预缴，多退少补。'
    },
    {
      date: `${year + 1}-06-30`,
      summary: `${year} 年度个税汇算今日截止`,
      description: '年度汇算 6 月 30 日截止，请及时在个税 App 完成申报补退税，逾期可能产生滞纳金并影响信用。'
    }
  ]
}

export function buildIcs(events: IcsEvent[]): string {
  const body = events
    .map((e, i) =>
      [
        'BEGIN:VEVENT',
        `UID:tax-deduction-${i}-${icsDate(e.date)}@fangzi`,
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
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//fangzi//tax-deduction//CN', 'CALSCALE:GREGORIAN', body, 'END:VCALENDAR'].join('\r\n')
}

export function downloadIcs(ics: string, filename = 'fangzi-个税节点提醒.ics'): void {
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
