/**
 * 教练引擎：把 平滑 → 动作状态机 → 统计/纠错 串成与 DOM、摄像头解耦的纯逻辑。
 * 真机由 pose-runner 喂关键点；测试/E2E 可直接喂合成关键点序列（同一套计数/叠加/落库链路）。
 */
import { createExercise, type ExerciseDef } from './exercises'
import { Feedback } from './feedback'
import { PoseSmoother, personPresent } from './pose-geometry'
import type { CoachFrame, Issue, Pose } from './types'

export interface EngineStop {
  reps: number
  goodReps: number
  avgScore: number
  durationMs: number
  issueCounts: Record<string, number>
}

export class CoachEngine {
  readonly exercise: ExerciseDef
  private smoother = new PoseSmoother(0.5)
  private feedback = new Feedback(2500)
  private startT = 0
  private lastWall = 0
  private scores: number[] = []
  private prevReps = 0
  private issueCounts: Record<string, number> = {}
  private running = false

  constructor(exerciseId: string) {
    this.exercise = createExercise(exerciseId)
  }

  get isTimed(): boolean {
    return !!this.exercise.isTimed
  }

  setMuted(m: boolean): void {
    this.feedback.setMuted(m)
  }

  start(): void {
    this.exercise.reset()
    this.smoother.reset()
    this.scores = []
    this.prevReps = 0
    this.issueCounts = {}
    this.startT = performance.now()
    this.lastWall = this.startT
    this.running = true
  }

  isRunning(): boolean {
    return this.running
  }

  /** 喂一帧原始关键点（可为空）；返回供 HUD/叠加使用的结果 */
  onPose(raw: Pose | null, tMs?: number): CoachFrame {
    const now = tMs ?? performance.now()
    if (!this.running) {
      return { present: false, phase: 'idle', reps: this.prevReps, issues: [], lastScore: null, angle: null, smoothed: null, side: null }
    }
    if (!raw || !personPresent(raw)) {
      return { present: false, phase: 'idle', reps: this.prevReps, issues: [], lastScore: this.lastScoreOrNull(), angle: null, smoothed: null, side: null }
    }
    const { out, valid } = this.smoother.smooth(raw)
    const frame = this.exercise.evaluate(out, valid, now - this.startT)

    if (frame.reps > this.prevReps && frame.lastScore !== null) {
      this.scores.push(frame.lastScore)
    }
    this.prevReps = frame.reps

    const spoke = this.feedback.announce(frame.issues)
    if (spoke) {
      const top = frame.issues.find((i) => i.text === spoke)
      if (top) this.issueCounts[top.code] = (this.issueCounts[top.code] ?? 0) + 1
    }
    this.lastWall = now

    return {
      ...frame,
      smoothed: out,
      side: null,
      issues: dedup(frame.issues)
    }
  }

  private lastScoreOrNull(): number | null {
    return this.scores.length ? this.scores[this.scores.length - 1]! : null
  }

  stop(): EngineStop {
    this.running = false
    const durationMs = this.lastWall >= this.startT ? this.lastWall - this.startT : 0
    if (this.exercise.tally) {
      const t = this.exercise.tally()
      return {
        reps: t.reps,
        goodReps: t.goodReps,
        avgScore: t.avgScore,
        durationMs,
        issueCounts: { ...this.issueCounts }
      }
    }
    const reps = this.prevReps
    const goodReps = this.scores.filter((s) => s >= 70).length
    const avgScore = this.scores.length ? Math.round(this.scores.reduce((a, b) => a + b, 0) / this.scores.length) : 0
    return { reps, goodReps, avgScore, durationMs, issueCounts: { ...this.issueCounts } }
  }
}

function dedup(issues: Issue[]): Issue[] {
  const m = new Map<string, Issue>()
  for (const i of issues) if (!m.has(i.code)) m.set(i.code, i)
  return [...m.values()]
}
