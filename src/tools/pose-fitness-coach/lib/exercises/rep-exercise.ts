import type { FsmFrame, Pose } from '../types'
import { personPresent } from '../pose-geometry'
import { RepFsm, type RepSample } from './common'
import type { ExerciseDef } from './types'

export interface Measure {
  (pose: Pose, valid: boolean[]): Omit<RepSample, 'present'> | null
}

/** 用 RepFsm 快速构造一个“往返计数型”动作 */
export function makeRepExercise(opts: {
  id: string
  name: string
  free: boolean
  measure: Measure
  /** 进入目标位角度等阈值由 measure 直接产出 deep/home/depthGood */
  halfText: string
  halfCode: string
}): ExerciseDef {
  const fsm = new RepFsm({
    isDeep: (s) => s.deep,
    isHome: (s) => s.home,
    halfIssue: { code: opts.halfCode, level: 'warn', text: opts.halfText }
  })
  return {
    id: opts.id,
    name: opts.name,
    free: opts.free,
    reset: () => fsm.reset(),
    evaluate: (pose: Pose, valid: boolean[], tMs: number): FsmFrame => {
      const present = personPresent(pose)
      if (!present) return fsm.update({ present: false, angle: null, deep: false, home: false, depthGood: false }, tMs)
      const m = opts.measure(pose, valid)
      if (!m) return fsm.update({ present: true, angle: null, deep: false, home: false, depthGood: false }, tMs)
      return fsm.update({ present: true, ...m }, tMs)
    }
  }
}
