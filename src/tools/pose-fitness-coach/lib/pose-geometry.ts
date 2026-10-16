/**
 * 姿态几何纯函数：关键点读取、角度、距离、可见度门控、EMA 平滑、左右侧选择、
 * 身体直线关系。全部无副作用、无 DOM，可直接用合成/录制关键点序列做单测。
 */
import { LM, type Landmark, type Pose, type Side } from './types'

export const VIS_THRESHOLD = 0.5

export function get(pose: Pose | null | undefined, i: number): Landmark | null {
  if (!pose) return null
  const p = pose[i]
  return p ?? null
}

export function vis(p: Landmark | null): number {
  return p && typeof p.visibility === 'number' && Number.isFinite(p.visibility) ? p.visibility : p ? 1 : 0
}

export function ok(p: Landmark | null, threshold = VIS_THRESHOLD): p is Landmark {
  return !!p && vis(p) >= threshold && Number.isFinite(p.x) && Number.isFinite(p.y)
}

export function dist(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function midpoint(a: Landmark, b: Landmark): Landmark {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2, visibility: Math.min(vis(a), vis(b)) }
}

/** 顶点 b 处的夹角（度数，0..180），用 x/y 平面 */
export function angle(a: Landmark, b: Landmark, c: Landmark): number {
  const v1x = a.x - b.x
  const v1y = a.y - b.y
  const v2x = c.x - b.x
  const v2y = c.y - b.y
  const dot = v1x * v2x + v1y * v2y
  const m1 = Math.hypot(v1x, v1y)
  const m2 = Math.hypot(v2x, v2y)
  if (m1 < 1e-6 || m2 < 1e-6) return 0
  const cos = Math.max(-1, Math.min(1, dot / (m1 * m2)))
  return (Math.acos(cos) * 180) / Math.PI
}

/** 点 p 到直线 a→b 的垂直距离（归一化坐标） */
export function pointLineDistance(p: Landmark, a: Landmark, b: Landmark): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) return dist(p, a)
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len
}

const CORE_CHAIN: ReadonlyArray<readonly [number, number]> = [
  [LM.L_SHOULDER, LM.R_SHOULDER],
  [LM.L_HIP, LM.R_HIP],
  [LM.L_KNEE, LM.R_KNEE],
  [LM.L_ANKLE, LM.R_ANKLE]
]

/** 判定画面里是否有人：核心链关键点平均可见度达标 */
export function personPresent(pose: Pose | null | undefined, threshold = VIS_THRESHOLD): boolean {
  if (!pose || pose.length === 0) return false
  let sum = 0
  for (const [l, r] of CORE_CHAIN) {
    sum += Math.max(vis(get(pose, l)), vis(get(pose, r)))
  }
  return sum / CORE_CHAIN.length >= threshold
}

/** 选择可见度更高的一侧（侧面跟练时另一侧常被遮挡） */
export function pickSide(pose: Pose, threshold = VIS_THRESHOLD): Side | null {
  const left = [LM.L_SHOULDER, LM.L_HIP, LM.L_KNEE, LM.L_ANKLE]
  const right = [LM.R_SHOULDER, LM.R_HIP, LM.R_KNEE, LM.R_ANKLE]
  const sl = left.reduce((s, i) => s + vis(get(pose, i)), 0) / left.length
  const sr = right.reduce((s, i) => s + vis(get(pose, i)), 0) / right.length
  const best = Math.max(sl, sr)
  if (best < threshold) return null
  return sl >= sr ? 'left' : 'right'
}

/** 取某一侧的肩/肘/腕/髋/膝/踝索引 */
export function sideJoints(side: Side) {
  return side === 'left'
    ? { shoulder: LM.L_SHOULDER, elbow: LM.L_ELBOW, wrist: LM.L_WRIST, hip: LM.L_HIP, knee: LM.L_KNEE, ankle: LM.L_ANKLE }
    : { shoulder: LM.R_SHOULDER, elbow: LM.R_ELBOW, wrist: LM.R_WRIST, hip: LM.R_HIP, knee: LM.R_KNEE, ankle: LM.R_ANKLE }
}

/**
 * EMA 关键点平滑器。低可见点沿用上一帧并标记 invalid，避免抖动把状态机带偏。
 */
export class PoseSmoother {
  private prev: Pose | null = null
  constructor(private alpha = 0.5) {}

  reset(): void {
    this.prev = null
  }

  smooth(pose: Pose): { out: Pose; valid: boolean[] } {
    const valid: boolean[] = new Array(pose.length).fill(false)
    if (!this.prev) {
      this.prev = pose.map((p) => ({ ...p }))
      pose.forEach((p, i) => (valid[i] = vis(p) >= VIS_THRESHOLD))
      return { out: this.prev.map((p) => ({ ...p })), valid }
    }
    const out: Pose = pose.map((cur, i) => {
      const pv = this.prev![i]!
      const good = vis(cur) >= VIS_THRESHOLD && Number.isFinite(cur.x)
      valid[i] = good
      if (!good) return { ...pv }
      return {
        x: pv.x + (cur.x - pv.x) * this.alpha,
        y: pv.y + (cur.y - pv.y) * this.alpha,
        z: pv.z + (cur.z - pv.z) * this.alpha,
        visibility: cur.visibility
      }
    })
    this.prev = out.map((p) => ({ ...p }))
    return { out, valid }
  }
}

/** 两膝间距 / 两踝间距比，用于膝内扣（valgus）检测；比值过小提示膝内扣 */
export function kneeValgusRatio(pose: Pose): number | null {
  const lk = get(pose, LM.L_KNEE)
  const rk = get(pose, LM.R_KNEE)
  const la = get(pose, LM.L_ANKLE)
  const ra = get(pose, LM.R_ANKLE)
  if (!ok(lk) || !ok(rk) || !ok(la) || !ok(ra)) return null
  const ankleW = dist(la, ra)
  if (ankleW < 1e-6) return null
  return dist(lk, rk) / ankleW
}
