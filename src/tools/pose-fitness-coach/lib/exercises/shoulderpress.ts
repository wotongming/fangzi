import { angle, get, ok } from '../pose-geometry'
import { LM, type FsmFrame, type Issue, type Pose } from '../types'
import { RepFsm } from './common'
import type { ExerciseDef } from './types'

/** 站姿肩推（正面）：双肘从屈（约 80°）推到伸（约 170°），且手腕高于肩。做一上一下计一次 */
export function createShoulderPress(): ExerciseDef {
  const fsm = new RepFsm({
    isDeep: (s) => s.deep,
    isHome: (s) => s.home,
    halfIssue: { code: 'press-half', level: 'warn', text: '手臂再推直、举过头顶' }
  })
  const arm = (pose: Pose, s: 'l' | 'r') => {
    const sh = get(pose, s === 'l' ? LM.L_SHOULDER : LM.R_SHOULDER)
    const el = get(pose, s === 'l' ? LM.L_ELBOW : LM.R_ELBOW)
    const wr = get(pose, s === 'l' ? LM.L_WRIST : LM.R_WRIST)
    if (!ok(sh) || !ok(el) || !ok(wr)) return null
    return { elbow: angle(sh, el, wr), wristAbove: wr.y < sh.y - 0.03 }
  }
  return {
    id: 'shoulderpress',
    name: '站姿肩推',
    free: false,
    reset: () => fsm.reset(),
    evaluate: (pose: Pose, _valid: boolean[], tMs: number): FsmFrame => {
      const l = arm(pose, 'l')
      const r = arm(pose, 'r')
      const arms = [l, r].filter((a): a is { elbow: number; wristAbove: boolean } => !!a)
      if (arms.length === 0) {
        return fsm.update({ present: true, angle: null, deep: false, home: false, depthGood: false }, tMs)
      }
      const elbow = arms.reduce((s, a) => s + a.elbow, 0) / arms.length
      const above = arms.every((a) => a.wristAbove)
      const issues: Issue[] = []
      const deep = elbow > 150 && above
      const home = elbow < 110
      return fsm.update(
        {
          present: true,
          angle: Math.round(elbow),
          deep,
          home,
          depthGood: elbow > 162 && above,
          quality: elbow > 162 && above ? 1 : 0.85,
          issues
        },
        tMs
      )
    }
  }
}
