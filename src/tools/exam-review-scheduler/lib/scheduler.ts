/**
 * scheduler.ts —— SM-2 变体间隔重复调度引擎（纯函数，不碰 Vue / DOM，可单测）。
 *
 * 基准间隔序列（艾宾浩斯）：[1, 2, 4, 7, 15] 天；
 * 自评三键：记得=5 / 模糊=3 / 已忘=1。
 *  - grade < 3（已忘）：连续答对次数归零，间隔回到第 1 天，难度系数 -0.2（下限 1.3）。
 *  - grade >= 3：连续答对 +1，按 reps 落到基准间隔表；reps>=5 后用上一次间隔 * 难度系数
 *    （记得再 *1.3，模糊 *1.0）滚动增长；难度系数记得 +0.15、模糊 -0.1（下限 1.3）。
 * 下次复习日 = 本地日历日 today + 整数间隔天数（避免时区漂移）。
 */
import { addDays, type Grade } from './models'

/** 艾宾浩斯基准间隔（天） */
export const STEPS = [1, 2, 4, 7, 15] as const

export const MIN_EASE = 1.3
export const START_EASE = 2.5

export interface Schedulable {
  ease: number
  intervalDays: number
  reps: number
}

export interface ScheduleResult extends Schedulable {
  /** 下次复习日 YYYY-MM-DD（本地日历日） */
  nextReview: string
}

/** 新建错题的初始调度状态（首次明天到期，间隔 1 天起步）。 */
export function initialSchedule(todayStr: string): Schedulable & { nextReview: string } {
  return { ease: START_EASE, intervalDays: STEPS[0]!, reps: 0, nextReview: addDays(todayStr, STEPS[0]!) }
}

/**
 * 根据自评成绩计算新的调度状态。纯函数：不修改入参，返回新对象。
 * @param q     当前调度状态（ease / intervalDays / reps）
 * @param grade 5=记得 / 3=模糊 / 1=已忘
 * @param todayStr 本地今天 YYYY-MM-DD
 */
export function scheduleNext(q: Schedulable, grade: Grade, todayStr: string): ScheduleResult {
  let ease = q.ease
  let reps = q.reps
  let intervalDays: number

  if (grade < 3) {
    // 已忘：重置回第 1 天
    reps = 0
    intervalDays = STEPS[0]!
    ease = Math.max(MIN_EASE, ease - 0.2)
  } else {
    reps += 1
    if (reps === 1) intervalDays = STEPS[0]!
    else if (reps === 2) intervalDays = STEPS[1]!
    else if (reps === 3) intervalDays = STEPS[2]!
    else if (reps === 4) intervalDays = STEPS[3]!
    else {
      // reps >= 5：基准 15 天起，之后滚动用上一次间隔 * 难度系数
      const base = reps === 5 ? STEPS[4]! : q.intervalDays
      intervalDays = Math.max(1, Math.round(base * ease * (grade === 5 ? 1.3 : 1.0)))
    }
    ease = Math.max(MIN_EASE, ease + (grade === 5 ? 0.15 : -0.1))
  }

  return { ease, intervalDays, reps, nextReview: addDays(todayStr, intervalDays) }
}
