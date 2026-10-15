/**
 * Freemium 每月免费转写时长额度（V1：免费 60 分钟/自然月，Pro 不限）。
 * 用 localStorage 记录每个自然月累计秒数；纯函数部分便于单测。
 */

export const FREE_SECONDS_PER_MONTH = 60 * 60 // 60 分钟
const KEY_PREFIX = 'fz-lt:used-sec:'

export function monthKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** 读取某月已用秒数（无 localStorage 时按 0，且不写） */
export function getUsedSeconds(key: string = monthKey()): number {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + key)
    const n = raw ? Number.parseInt(raw, 10) : 0
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

/** 累加某月已用秒数，返回累加后的值 */
export function addUsedSeconds(deltaSec: number, key: string = monthKey()): number {
  const next = getUsedSeconds(key) + Math.max(0, Math.round(deltaSec))
  try {
    localStorage.setItem(KEY_PREFIX + key, String(next))
  } catch {
    // 隐私模式等写入失败：额度统计不可用，但不阻断本地转写主流程
  }
  return next
}

export interface QuotaState {
  usedSec: number
  freeSec: number
  remainingSec: number
  /** 免费额度是否已用尽 */
  exhausted: boolean
}

export function quotaState(isPro: boolean, key: string = monthKey()): QuotaState {
  const usedSec = getUsedSeconds(key)
  const remainingSec = isPro ? Number.POSITIVE_INFINITY : Math.max(0, FREE_SECONDS_PER_MONTH - usedSec)
  return {
    usedSec,
    freeSec: FREE_SECONDS_PER_MONTH,
    remainingSec,
    exhausted: !isPro && usedSec >= FREE_SECONDS_PER_MONTH
  }
}
