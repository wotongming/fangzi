import { angle, dist, get, ok, pickSide, sideJoints } from '../pose-geometry'
import type { Issue, Pose } from '../types'
import { makeRepExercise } from './rep-exercise'

/** 俯卧撑（侧面）：肩-肘-腕夹角；撑起约 170°，下放约 70-90°；另查塌腰/撅臀 */
export function createPushup() {
  return makeRepExercise({
    id: 'pushup',
    name: '俯卧撑',
    free: true,
    halfCode: 'pushup-half',
    halfText: '再下放一点，胸部接近地面',
    measure: (pose: Pose) => {
      const side = pickSide(pose)
      if (!side) return null
      const j = sideJoints(side)
      const shoulder = get(pose, j.shoulder), elbow = get(pose, j.elbow), wrist = get(pose, j.wrist)
      const hip = get(pose, j.hip), ankle = get(pose, j.ankle)
      if (!ok(shoulder) || !ok(elbow) || !ok(wrist) || !ok(hip) || !ok(ankle)) return null
      const elbowAngle = angle(shoulder, elbow, wrist)
      const issues: Issue[] = []
      // 髋部相对 肩-踝 直线的偏离：明显偏高=撅臀，明显偏低=塌腰
      const ref = Math.max(1e-6, dist(shoulder, ankle))
      const hipY = hip.y
      const lineY = shoulder.y + ((ankle.y - shoulder.y) * (hip.x - shoulder.x)) / Math.max(1e-6, ankle.x - shoulder.x)
      const devNorm = (hipY - lineY) / ref
      if (elbowAngle < 130) {
        if (devNorm < -0.12) issues.push({ code: 'hip-pike', level: 'warn', text: '别撅臀，髋部放下来' })
        if (devNorm > 0.14) issues.push({ code: 'hip-sag', level: 'critical', text: '别塌腰，核心收紧' })
      }
      const deep = elbowAngle < 115
      const depthGood = elbowAngle <= 95
      const home = elbowAngle > 150
      return {
        angle: Math.round(elbowAngle),
        deep,
        home,
        depthGood,
        quality: elbowAngle >= 70 && elbowAngle <= 100 ? 1 : 0.85,
        issues
      }
    }
  })
}
