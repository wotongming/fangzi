import type { FsmFrame, Pose } from '../types'

/** 一个动作的判定器：内部持有状态机/计时器，每次 evaluate 喂一帧关键点 */
export interface ExerciseDef {
  id: string
  name: string
  /** 是否免费动作 */
  free: boolean
  /** 计时型动作（平板）：reps 语义为秒数 */
  isTimed?: boolean
  reset: () => void
  evaluate: (pose: Pose, valid: boolean[], tMs: number) => FsmFrame
  /** 结束时汇总（计时型使用；缺省由调用方用末帧 reps 统计） */
  tally?: () => { reps: number; goodReps: number; avgScore: number }
}
