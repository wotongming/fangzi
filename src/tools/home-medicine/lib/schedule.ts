/**
 * home-medicine —— 当日服药时间表（纯函数）。
 * 仅按用户登记的时段与起止日期排布，不做剂量个体化建议。
 */
import { SLOT_LABEL, SLOT_ORDER, type Med, type SlotKey } from './models'

export function isTakingOn(med: Med, today: string): boolean {
  if (!med.active) return false
  if (med.startDate && today < med.startDate) return false
  if (med.stopDate && today > med.stopDate) return false
  return true
}

export interface PlanItem {
  med: Med
  doseText?: string
}
export interface SlotPlan {
  slot: SlotKey
  label: string
  clock: string
  items: PlanItem[]
}

/** 各时段建议的参考时刻（仅用于日历/展示，用户应以医嘱为准） */
export const SLOT_CLOCK: Record<SlotKey, string> = {
  morning: '08:00',
  noon: '12:00',
  evening: '18:00',
  bedtime: '21:30'
}

export function todayPlan(meds: Med[], today: string): SlotPlan[] {
  const taking = meds.filter((m) => isTakingOn(m, today))
  return SLOT_ORDER.map((slot) => ({
    slot,
    label: SLOT_LABEL[slot],
    clock: SLOT_CLOCK[slot],
    items: taking
      .filter((m) => m.slots.includes(slot))
      .map((m) => ({ med: m, doseText: m.doseText }))
  })).filter((p) => p.items.length > 0)
}

/** 漏服处理的说明书层面通用提示（不个体化） */
export const MISSED_DOSE_ADVICE =
  '漏服处理因药而异：多数药品若接近下一次服药时间，通常应跳过本次、按原计划继续，切勿自行加倍补服；具体请以该药品说明书或医生/药师嘱咐为准。'
