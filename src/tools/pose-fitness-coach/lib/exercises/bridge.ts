import { angle, get, ok, pickSide, sideJoints } from '../pose-geometry'
import type { Pose } from '../types'
import { makeRepExercise } from './rep-exercise'

/** 臀桥（侧面）：肩-髋-膝夹角；顶部髋顶起、身体接近直线（约 170°+），底部髋屈曲（约 140° 以下） */
export function createBridge() {
  return makeRepExercise({
    id: 'bridge',
    name: '臀桥',
    free: false,
    halfCode: 'bridge-half',
    halfText: '再把髋顶高一点，夹紧臀部',
    measure: (pose: Pose) => {
      const side = pickSide(pose)
      if (!side) return null
      const j = sideJoints(side)
      const shoulder = get(pose, j.shoulder), hip = get(pose, j.hip), knee = get(pose, j.knee)
      if (!ok(shoulder) || !ok(hip) || !ok(knee)) return null
      const a = angle(shoulder, hip, knee)
      return {
        angle: Math.round(a),
        deep: a > 160,
        depthGood: a >= 168,
        home: a < 145,
        quality: a >= 168 ? 1 : 0.85
      }
    }
  })
}
