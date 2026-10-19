/**
 * 难度曲线：随已前进弧长（米）平滑、单调、有界地提升速度与闸门密度。
 * 教学段（前 TUTORIAL_DIST 米）不出现半扭转，且闸门稀疏、速度平缓。
 */
import { gateForbiddenByTwist } from './geometry'

/** 教学段长度（米）：无扭转、慢速、稀疏闸门 */
export const TUTORIAL_DIST = 150

const START_SPEED = 9 // 米/秒
const MAX_SPEED = 18
const SPEED_RAMP_DIST = 1600 // 到该距离爬满速度

const GAP_EARLY = 30 // 早期闸门间距（米）
const GAP_LATE = 16 // 后期闸门间距
const GAP_RAMP_START = 200
const GAP_RAMP_END = 1800

/** 闸门与扭转区前后保留的安全间距（米），避免「几何换面」与「穿门」同一瞬间冲突 */
export const GATE_TWIST_CLEAR = 5

export function twistEnabledAt(distance: number): boolean {
  return distance >= TUTORIAL_DIST
}

/** 当前前进速度（米/秒），单调递增且有上界 */
export function speedAt(distance: number): number {
  if (distance < TUTORIAL_DIST) {
    // 教学段从 START_SPEED 微微提到 START_SPEED+1
    return START_SPEED + (distance / TUTORIAL_DIST) * 1
  }
  const t = Math.min(1, (distance - TUTORIAL_DIST) / (SPEED_RAMP_DIST - TUTORIAL_DIST))
  const eased = t * t * (3 - 2 * t)
  return START_SPEED + 1 + (MAX_SPEED - (START_SPEED + 1)) * eased
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * 下一个闸门间距（米），jitter01∈[0,1) 提供确定性抖动。
 * 后期更密，但始终保留可反应时间（16m / 18m/s ≈0.9s）。
 */
export function gateGapAt(distance: number, jitter01: number): number {
  const t =
    distance < GAP_RAMP_START
      ? 0
      : Math.min(1, (distance - GAP_RAMP_START) / (GAP_RAMP_END - GAP_RAMP_START))
  const base = lerp(GAP_EARLY, GAP_LATE, t)
  return base + (jitter01 - 0.5) * 4
}

/** 候选闸门位置是否落在禁止区（扭转区内或距扭转区边界过近），唯一真相取自 geometry */
export function gateNearTwist(u: number): boolean {
  return gateForbiddenByTwist(u, GATE_TWIST_CLEAR)
}

/** 把候选闸门位置推出扭转禁区，返回安全弧长（几何换面之后再放门） */
export function nudgeAwayFromTwist(u: number): number {
  let guard = 0
  let cand = u
  while (gateNearTwist(cand) && guard++ < 64) cand += 1
  return cand
}
