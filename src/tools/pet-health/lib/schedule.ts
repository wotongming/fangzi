/**
 * schedule.ts —— 周期照护计划与下次到期计算（纯函数，可单测）。
 * 应用内待办为主路径；浏览器后台通知不可靠，长期提醒用导出 .ics 兜底（见 notify.ts）。
 */
import { dayMs } from './models'
import type { CarePlan, HealthEvent } from './models'

export const DAY_MS = 86400000

export interface DueItem {
  plan: CarePlan
  label: string
  /** 下次应做日期 YYYY-MM-DD */
  dueDate: string
  /** 距今天的天数：负数=已逾期 */
  daysLeft: number
  /** 是否逾期 */
  overdue: boolean
  /** 是否今天到期 */
  today: boolean
  /** 依据：上次记录日期或起始日期 */
  basis: string
}

function toDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * 计算单个计划的下次到期日。
 * 规则：取该宠物该 planKey 最近一次记录日期；没有记录则用 startDate；加上 intervalDays。
 */
export function nextDueDate(plan: CarePlan, events: HealthEvent[], todayMs: number): DueItem | null {
  if (!plan.enabled) return null
  const mine = events
    .filter((e) => e.petId === plan.petId && e.planKey === plan.planKey)
    .sort((a, b) => dayMs(b.date) - dayMs(a.date))
  const last = mine[0]
  const basis = last ? last.date : plan.startDate
  const dueMs = dayMs(basis) + plan.intervalDays * DAY_MS
  const todayStart = new Date(todayMs)
  todayStart.setHours(0, 0, 0, 0)
  const daysLeft = Math.round((dueMs - todayStart.getTime()) / DAY_MS)
  return {
    plan,
    label: plan.planKey,
    dueDate: toDate(dueMs),
    daysLeft,
    overdue: daysLeft < 0,
    today: daysLeft === 0,
    basis
  }
}

/** 计算某只宠物全部启用计划的待办，按到期升序（逾期最前）。 */
export function duesForPet(
  plans: CarePlan[],
  events: HealthEvent[],
  petId: string,
  now: number = Date.now()
): DueItem[] {
  return plans
    .filter((p) => p.petId === petId)
    .map((p) => nextDueDate(p, events, now))
    .filter((d): d is DueItem => d !== null)
    .sort((a, b) => a.daysLeft - b.daysLeft)
}

/** 全部宠物的待办（看板用）。 */
export function allDues(plans: CarePlan[], events: HealthEvent[], now: number = Date.now()): DueItem[] {
  const petIds = new Set(plans.filter((p) => p.enabled).map((p) => p.petId))
  const out: DueItem[] = []
  for (const pid of petIds) out.push(...duesForPet(plans, events, pid, now))
  return out.sort((a, b) => a.daysLeft - b.daysLeft)
}
