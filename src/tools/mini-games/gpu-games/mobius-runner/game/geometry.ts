/**
 * 莫比乌斯环带参数化几何（纯数值，不依赖 three）。
 *
 * 一条沿 +x 无限延伸、在水平面与竖直面做轻柔起伏的中心线 C(u)，
 * 在其 Frenet 标架上叠加「周期性半扭转」：每个周期 P 内，
 * 带面法向量在长度 TWIST_LEN 区间内由 N 平滑旋转到 -N（θ:0→π），
 * 随后保持 -N 直到下一周期——这正是莫比乌斯带「每前进一圈、两面对调」的关键。
 *
 * 逻辑层只用法向量符号区分两面；渲染层用同一套 frameAt 取点建网格，保证「看到的」与「判定的」完全一致。
 */
import type { Face, Frame, Vec3 } from './types'

/** 带宽（米），两面之间的横向全宽 */
export const RIBBON_WIDTH = 2.4
/** 车道中心相对带宽中线的横向偏移（两面各占半幅，车道中心在半幅中央） */
export const LANE_OFFSET = RIBBON_WIDTH * 0.25
/** 玩家/物体在带面法向上的站立抬高（贴在表面上） */
export const STAND_OFF = 0.12
/** 半扭转作用长度（米） */
export const TWIST_LEN = 18
/** 两次扭转区间之间的平直间隔（米） */
export const TWIST_GAP = 62
/** 扭转周期长度（米）：一段扭转 + 一段平直 */
export const TWIST_PERIOD = TWIST_LEN + TWIST_GAP
/** 第一个扭转区起点（米）：此前为教学段，不出现半扭转（与 difficulty.TUTORIAL_DIST 对齐） */
export const FIRST_TWIST_AT = 150

/** 把绝对弧长换算成相对扭转调度的相位；教学段之前返回负值（无扭转） */
function twistPhase(u: number): number {
  return u - FIRST_TWIST_AT
}

// 中心线起伏参数（轻柔、不晕）
const AMP_Y = 1.1 // 竖直起伏幅度
const WAVE_Y = 70 // 竖直起伏波长相关
const AMP_Z = 2.0 // 水平摆动幅度
const WAVE_Z = 110

function center(u: number): Vec3 {
  return {
    x: u,
    y: AMP_Y * Math.sin(u / WAVE_Y),
    z: AMP_Z * Math.sin(u / WAVE_Z + 0.7)
  }
}

function dCenter(u: number): Vec3 {
  return {
    x: 1,
    y: (AMP_Y / WAVE_Y) * Math.cos(u / WAVE_Y),
    z: (AMP_Z / WAVE_Z) * Math.cos(u / WAVE_Z + 0.7)
  }
}

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z) || 1
  return { x: v.x / l, y: v.y / l, z: v.z / l }
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  }
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

const WORLD_UP: Vec3 = { x: 0, y: 1, z: 0 }

function addScaled(a: Vec3, b: Vec3, s: number): Vec3 {
  return { x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s }
}

function smooth01(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

/**
 * 当前弧长处的累计扭转角（弧度）。
 * 在每个周期前 TWIST_LEN 内 0→π，其余区间为 0（平直但已是「另一面」）。
 */
export function twistAngleAt(u: number): number {
  const ph = twistPhase(u)
  if (ph < 0) return 0
  const phase = ph % TWIST_PERIOD
  return phase <= TWIST_LEN ? Math.PI * smooth01(phase / TWIST_LEN) : 0
}

/** 是否正处于平滑扭转区间内（含结束点；教学段前一律否） */
export function inTwistZone(u: number): boolean {
  const ph = twistPhase(u)
  if (ph < 0) return false
  return ph % TWIST_PERIOD <= TWIST_LEN
}

/** 扭转区结束点（半扭转完成、两面对调的位置）所在弧长；教学段前返回无穷大哨兵 */
export function twistEndAtOrAfter(u: number): number {
  const ph = twistPhase(u)
  const k = ph < 0 ? -1 : Math.floor(ph / TWIST_PERIOD)
  return FIRST_TWIST_AT + k * TWIST_PERIOD + TWIST_LEN
}

/** 下一个扭转区起点弧长（lookahead 内无则 null） */
export function nextTwistStart(u: number, lookahead = 60): number | null {
  if (u < FIRST_TWIST_AT) {
    return FIRST_TWIST_AT - u <= lookahead ? FIRST_TWIST_AT : null
  }
  const k = Math.floor((u - FIRST_TWIST_AT) / TWIST_PERIOD)
  for (let kk = k; kk <= k + 2; kk++) {
    const s = FIRST_TWIST_AT + kk * TWIST_PERIOD
    if (s >= u - 1e-6 && s - u <= lookahead) return s
  }
  return null
}

/**
 * 闸门禁放判定：候选弧长若落在某个扭转区内，或距扭转区边界不足 clear 米，则不允许放闸门
 * （避免「几何换面」与「穿门翻转」在同一瞬间抢输入）。教学段前无扭转。
 */
export function gateForbiddenByTwist(u: number, clear: number): boolean {
  // 只需覆盖 u 邻近的少数周期
  const firstK = Math.floor((u - FIRST_TWIST_AT) / TWIST_PERIOD) - 1
  const lastK = Math.ceil((u - FIRST_TWIST_AT) / TWIST_PERIOD) + 1
  for (let k = Math.max(-1, firstK); k <= lastK; k++) {
    const s = FIRST_TWIST_AT + k * TWIST_PERIOD
    const e = s + TWIST_LEN
    if (u >= s - clear && u <= e + clear) return true
  }
  return false
}

/** 计算弧长 u 处的局部 Frenet 标架（已叠加半扭转） */
export function frameAt(u: number): Frame {
  const c = center(u)
  const tangent = normalize(dCenter(u))

  // 以世界上方向为参考构造初始 across/normal，避免 Frenet 翻转抖动
  let across = cross(WORLD_UP, tangent)
  if (Math.hypot(across.x, across.y, across.z) < 1e-4) {
    across = { x: 0, y: 0, z: 1 }
  }
  across = normalize(across)
  let normal = normalize(cross(tangent, across))
  // 统一法向量初相：让 u=0 时 normal 朝上（y 分量为正）
  if (normal.y < 0) {
    normal = { x: -normal.x, y: -normal.y, z: -normal.z }
    across = { x: -across.x, y: -across.y, z: -across.z }
  }

  const theta = twistAngleAt(u)
  if (theta !== 0) {
    // 绕 tangent 把 (across, normal) 旋转 θ
    const cos = Math.cos(theta)
    const sin = Math.sin(theta)
    const a = across
    const n = normal
    across = normalize({
      x: cos * a.x + sin * n.x,
      y: cos * a.y + sin * n.y,
      z: cos * a.z + sin * n.z
    })
    normal = normalize({
      x: cos * n.x - sin * a.x,
      y: cos * n.y - sin * a.y,
      z: cos * n.z - sin * a.z
    })
  }

  return { center: c, tangent, across, normal, twist: theta }
}

/** 面 → 车道横向偏移（米）：两面是沿带宽 across 的两条车道。
 * face0 在 +across 半幅，face1 在 -across 半幅；半扭转后 across 随标架翻转，两面自然对调。 */
export function faceOffset(face: Face): number {
  return face === 0 ? LANE_OFFSET : -LANE_OFFSET
}

/** 取带上某点世界坐标：弧长 u + 面 face（玩家/物体沿该面车道中心、贴在带面上 STAND_OFF） */
export function pointOn(u: number, face: Face): Vec3 {
  const f = frameAt(u)
  let p = addScaled(f.center, f.across, faceOffset(face))
  p = addScaled(p, f.normal, STAND_OFF)
  return p
}

/** 取带面上某点世界坐标：沿带宽 across 的有符号偏移（建网格时遍历整条带宽） */
export function pointAtOffset(u: number, signedOffset: number): Vec3 {
  const f = frameAt(u)
  return addScaled(f.center, f.across, signedOffset)
}

/** 单位法向（便捷导出） */
export function normalAt(u: number): Vec3 {
  return frameAt(u).normal
}

export { dot }
