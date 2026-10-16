import { dist, get, ok, pickSide, sideJoints } from '../pose-geometry'
import type { FsmFrame, Issue, Pose } from '../types'
import type { ExerciseDef } from './types'

/**
 * 平板支撑（计时型）：侧面看 肩-髋-踝 接近一条直线且躯干近似水平即计时。
 * reps 语义为“已坚持秒数”；avgScore 为姿态合格帧占比。
 */
export function createPlank(): ExerciseDef {
  let lastT = 0
  let heldMs = 0
  let goodFrames = 0
  let totalFrames = 0

  function reset() {
    lastT = 0
    heldMs = 0
    goodFrames = 0
    totalFrames = 0
  }

  return {
    id: 'plank',
    name: '平板支撑',
    free: false,
    isTimed: true,
    reset,
    evaluate: (pose: Pose, _valid: boolean[], tMs: number): FsmFrame => {
      const issues: Issue[] = []
      const side = pickSide(pose)
      const j = side ? sideJoints(side) : null
      const shoulder = j && get(pose, j.shoulder)
      const hip = j && get(pose, j.hip)
      const ankle = j && get(pose, j.ankle)
      const present = !!(shoulder && hip && ankle && ok(shoulder) && ok(hip) && ok(ankle))

      let good = false
      if (present && shoulder && hip && ankle) {
        const span = Math.max(1e-6, dist(shoulder, ankle))
        const lineY = shoulder.y + ((ankle.y - shoulder.y) * (hip.x - shoulder.x)) / Math.max(1e-6, ankle.x - shoulder.x)
        const dev = (hip.y - lineY) / span
        // 躯干近似水平：肩-踝 连线斜率较小
        const slope = Math.abs(ankle.y - shoulder.y) / Math.max(1e-6, Math.abs(ankle.x - shoulder.x))
        const horiz = slope < 0.45
        good = horiz && Math.abs(dev) <= 0.1
        if (!good) {
          if (dev < -0.1) issues.push({ code: 'plank-hip-high', level: 'warn', text: '髋部太高，身体压成一条直线' })
          else if (dev > 0.1) issues.push({ code: 'plank-hip-low', level: 'critical', text: '别塌腰，把髋撑起来' })
        }
      }

      if (lastT && tMs > lastT && good) heldMs += Math.min(500, tMs - lastT)
      lastT = tMs
      totalFrames += 1
      if (good) goodFrames += 1
      void _valid

      return {
        present,
        phase: good ? 'down' : 'up',
        reps: Math.floor(heldMs / 1000),
        issues,
        lastScore: totalFrames ? Math.round((goodFrames / totalFrames) * 100) : null,
        angle: null
      }
    },
    tally: () => ({
      reps: Math.floor(heldMs / 1000),
      goodReps: Math.floor(heldMs / 1000),
      avgScore: totalFrames ? Math.round((goodFrames / totalFrames) * 100) : 0
    })
  }
}
