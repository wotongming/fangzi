/**
 * 姿态教练核心类型。几何/状态机层只依赖这些普通结构，完全脱离 DOM/摄像头，
 * 便于用录制或合成的关键点序列在 Node 下单测。
 */

/** MediaPipe 归一化关键点（坐标 0..1，y 向下） */
export interface Landmark {
  x: number
  y: number
  z: number
  /** 可见度/存在概率 0..1（部分模型可能缺省，按 1 处理） */
  visibility?: number
}

/** 一帧 33 关键点 */
export type Pose = Landmark[]

/** 33 点索引（MediaPipe PoseLandmarker 约定） */
export const LM = {
  NOSE: 0,
  L_EYE: 2, R_EYE: 5,
  L_EAR: 7, R_EAR: 8,
  L_SHOULDER: 11, R_SHOULDER: 12,
  L_ELBOW: 13, R_ELBOW: 14,
  L_WRIST: 15, R_WRIST: 16,
  L_HIP: 23, R_HIP: 24,
  L_KNEE: 25, R_KNEE: 26,
  L_ANKLE: 27, R_ANKLE: 28,
  L_HEEL: 29, R_HEEL: 30,
  L_FOOT: 31, R_FOOT: 32
} as const

export type Side = 'left' | 'right'

/** 单条纠错提示的级别 */
export type IssueLevel = 'info' | 'warn' | 'critical'

/** 纠错提示 */
export interface Issue {
  code: string
  level: IssueLevel
  text: string
}

/** 动作阶段 */
export type Phase = 'up' | 'down' | 'idle'

/** 状态机单帧输出 */
export interface FsmFrame {
  present: boolean
  phase: Phase
  /** 本动作累计有效次数 */
  reps: number
  /** 当前帧活跃的问题（去重后的 code 列表，供语音节流） */
  issues: Issue[]
  /** 最近一次有效 rep 的 0..100 分（无则 null） */
  lastScore: number | null
  /** 调试用关键角度（度数） */
  angle: number | null
}

/** 一次训练落库记录 */
export interface SessionRecord {
  id: string
  exerciseId: string
  reps: number
  goodReps: number
  avgScore: number
  durationMs: number
  /** 出现频次最高的问题 code → 次数 */
  issueCounts: Record<string, number>
  createdAt: number
}

/** 引擎对外的一帧结果（含平滑后的关键点，供叠加层绘制） */
export interface CoachFrame extends FsmFrame {
  smoothed: Pose | null
  side: Side | null
}
