import { angle, get, ok, pickSide, sideJoints } from '../pose-geometry'
import type { Pose } from '../types'
import { makeRepExercise } from './rep-exercise'

/** 弓步蹲（侧面，取更可见一侧=前腿）：前腿髋-膝-踝夹角，下到约 90°，站直约 170° */
export function createLunge() {
  return makeRepExercise({
    id: 'lunge',
    name: '弓步蹲',
    free: false,
    halfCode: 'lunge-half',
    halfText: '前腿再屈，大腿接近水平',
    measure: (pose: Pose) => {
      const side = pickSide(pose)
      if (!side) return null
      const j = sideJoints(side)
      const hip = get(pose, j.hip), knee = get(pose, j.knee), ankle = get(pose, j.ankle)
      if (!ok(hip) || !ok(knee) || !ok(ankle)) return null
      const a = angle(hip, knee, ankle)
      return {
        angle: Math.round(a),
        deep: a < 115,
        depthGood: a <= 100,
        home: a > 150,
        quality: a >= 80 && a <= 105 ? 1 : 0.85
      }
    }
  })
}
