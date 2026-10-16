/**
 * 通用“往返一次”动作计数状态机：home（起始位）→ deep（目标位）→ home 计 1 次。
 * 由各动作提供 deep/home 判定与“到位/质量”，状态机负责滞回防抖、半程不计、评分聚合。
 */
import type { FsmFrame, Issue, Phase, Pose } from '../types'

export interface RepSample {
  present: boolean
  /** 主角度（仅用于调试展示） */
  angle: number | null
  /** 是否已进入目标位（足够深/足够高/完全伸展） */
  deep: boolean
  /** 是否回到起始位 */
  home: boolean
  /** 本次在 deep 位是否达到“合格幅度”（半程判定） */
  depthGood: boolean
  /** 该帧质量 0..1（用于 rep 评分） */
  quality?: number
  /** 该帧实时问题 */
  issues?: Issue[]
}

export interface RepFsmHooks {
  isDeep: (s: RepSample) => boolean
  isHome: (s: RepSample) => boolean
  /** 未达幅度就回起始位时给出的半程提示 */
  halfIssue: Issue
}

export class RepFsm {
  private phase: Phase = 'up'
  private reps = 0
  private lastScore: number | null = null
  private inDeep = false
  private reachedDepth = false
  private qSum = 0
  private qN = 0
  private lastHalfAt = 0

  constructor(private hooks: RepFsmHooks) {}

  reset(): void {
    this.phase = 'up'
    this.reps = 0
    this.lastScore = null
    this.inDeep = false
    this.reachedDepth = false
    this.qSum = 0
    this.qN = 0
  }

  update(s: RepSample, tMs: number): FsmFrame {
    if (!s.present) {
      return { present: false, phase: this.phase, reps: this.reps, issues: [], lastScore: this.lastScore, angle: s.angle }
    }
    const issues = s.issues ?? []

    if (!this.inDeep) {
      if (this.hooks.isDeep(s)) {
        this.inDeep = true
        this.reachedDepth = false
        this.qSum = 0
        this.qN = 0
        this.phase = 'down'
      }
    }

    if (this.inDeep) {
      if (s.depthGood) this.reachedDepth = true
      const q = s.quality ?? 1
      this.qSum += q
      this.qN += 1
      if (this.hooks.isHome(s)) {
        this.phase = 'up'
        this.inDeep = false
        if (this.reachedDepth) {
          this.reps += 1
          const avg = this.qN > 0 ? this.qSum / this.qN : 1
          this.lastScore = Math.max(40, Math.min(100, Math.round(avg * 100)))
        } else if (tMs - this.lastHalfAt > 1200) {
          this.lastHalfAt = tMs
          issues.push(this.hooks.halfIssue)
        }
        this.qSum = 0
        this.qN = 0
      }
    }

    return { present: true, phase: this.phase, reps: this.reps, issues, lastScore: this.lastScore, angle: s.angle }
  }
}

/** 去重当前帧问题（按 code） */
export function dedupIssues(issues: Issue[]): Issue[] {
  const map = new Map<string, Issue>()
  for (const it of issues) if (!map.has(it.code)) map.set(it.code, it)
  return [...map.values()]
}

export type { Pose }
