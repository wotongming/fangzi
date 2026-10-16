import { angle, get, kneeValgusRatio, ok, pickSide, sideJoints } from '../pose-geometry'
import type { Issue, Pose } from '../types'
import { makeRepExercise } from './rep-exercise'

/** 深蹲（侧面为主）：髋-膝-踝夹角；站立约 170°，蹲到底约 70-90° */
export function createSquat() {
  return makeRepExercise({
    id: 'squat',
    name: '深蹲',
    free: true,
    halfCode: 'squat-half',
    halfText: '幅度不够，再蹲深一点',
    measure: (pose: Pose) => {
      const side = pickSide(pose)
      if (!side) return null
      const j = sideJoints(side)
      const hip = get(pose, j.hip), knee = get(pose, j.knee), ankle = get(pose, j.ankle)
      if (!ok(hip) || !ok(knee) || !ok(ankle)) return null
      const kneeAngle = angle(hip, knee, ankle)
      const issues: Issue[] = []
      // 正面膝内扣（侧面时两踝很近会失效，返回 null 自动跳过）
      const vr = kneeValgusRatio(pose)
      if (vr !== null && vr < 0.72) {
        issues.push({ code: 'knee-valgus', level: 'critical', text: '膝盖别内扣，朝脚尖方向打开' })
      }
      const deep = kneeAngle < 115
      const depthGood = kneeAngle <= 95
      const home = kneeAngle > 150
      return {
        angle: Math.round(kneeAngle),
        deep,
        home,
        depthGood,
        quality: qualityFromAngle(kneeAngle),
        issues
      }
    }
  })
}

/** 蹲到位（约 80-95°）给高分，过深或太浅略扣 */
function qualityFromAngle(a: number): number {
  if (a >= 75 && a <= 100) return 1
  if (a < 75) return 0.85
  return Math.max(0.6, 1 - (a - 100) / 120)
}
