/**
 * 《挽星弓》50 关难度模型、确定性种子布局与类型定义。
 *
 * 本模块只放无 DOM、无音频、无渲染的纯逻辑；离线生成脚本用同一模块产出
 * `levels.generated.ts`，运行时不重复执行随机生成。求解器在 `sling-core.ts` 中
 * 复用 `stepFrame/gravityAccel`，避免预测/求解另写一套物理。
 */

// —— 世界与物理常数（与已验证 13 关版本保持同一舒适带）——
export const WORLD_W = 1000
export const WORLD_H = 1500
export const SHIP_R = 16
export const V_MAX = 940
export const MAX_PULL = 280
export const GRAVITY_G = 1_600_000
export const SOFT = 52
export const ASSIST_EXTRA = 96
export const FIXED_DT = 1 / 120
export const MAX_FRAME_STEPS = 4
export const COMBO_WINDOW_S = 1.5
export const COMBO_MAX_MULT = 4
export const PREDICT_STEPS = 150
export const AUTO_SAVE_KEY = 'fangzi:gravity-sling:auto-save:v1'
export const PROGRESS_KEY = 'fangzi:gravity-sling:progress:v1'
export const SAVE_VERSION = 2
export const TOOL_ID = 'gravity-sling'
export const CHAIN_ID = 'gravity-sling:levels:50:v2'
export const LEGACY_CHAIN_ID = 'gravity-sling:levels:13:v1'
export const LEVEL_COUNT = 50

export const ANCHOR = { x: 500, y: 1380 }
/** 多体叠加后的净加速度上限（世界像素/s²），高密度后期关防止近场数值爆炸。 */
export const MAX_ACCEL = 15_000
/** 求解器最小可容忍角度窗口（度）与门体净空（世界像素）。6px 约为窄门边缘外的最小安全余量。 */
export const MIN_ANGLE_WINDOW_DEG = 4
export const MIN_CLEARANCE = 6
/** 渲染与预测性能硬上限：单关参与物理/渲染的非星尘天体总数。 */
export const MAX_BODIES = 12

export type Phase = 'intro' | 'aim' | 'fly' | 'win' | 'lose' | 'resume' | 'levels'
export type BodyKind =
  | 'gravity'
  | 'repel'
  | 'blackhole'
  | 'asteroid'
  | 'collect'
  | 'portal'
  | 'moving'

export interface Orbit {
  cx: number
  cy: number
  rx: number
  ry: number
  speed: number
  phase: number
}

export interface Body {
  id: number
  kind: BodyKind
  x: number
  y: number
  r: number
  mass?: number
  orbit?: Orbit
  period?: { period: number; on: number }
}

export interface LevelConfig {
  index: number
  title: string
  hint: string
  /** -1 表示不限发射次数 */
  shots: number
  /** 0 表示不限时，单位秒 */
  timeLimit: number
  predictAlways: boolean
  anchor: { x: number; y: number }
  bodies: Body[]
  /** 本关引力强度系数；只在已验证舒适带内小幅浮动，不随难度指数膨胀。 */
  gravityScale?: number
}

export interface Ship {
  x: number
  y: number
  vx: number
  vy: number
  angle: number
  trail: { x: number; y: number }[]
  launched: boolean
}

export interface SlingState {
  level: number
  score: number
  combo: number
  /** 历史峰值连续借力次数（0 = 无借力；展示倍率经 comboDisplayMult 换算，不改存储语义） */
  bestCombo: number
  comboAt: number
  collected: number
  collectedIds: number[]
  shotsLeft: number
  timeLeft: number
  phase: Phase
  ship: Ship
  assists: number
  /** 本尝试内已触发借力/拾取的天体 id（防止重复触发） */
  assisted: number[]
  elapsed: number
  attempt: number
}

export interface FrameEvent {
  type: 'assist' | 'collect' | 'crash' | 'blackhole' | 'portal' | 'out' | 'timeout' | 'shots'
  bodyId?: number
}

export interface SolveEvidence {
  index: number
  seed: number
  retries: number
  relaxed?: boolean
  angleDeg: number
  power: number
  steps: number
  angleWindowDeg: number
  clearance: number
  bodyCount: number
  portalKind: BodyKind
}

// —— 难度模型：D(n)=1.1^(n-1)，再经饱和函数映射到各旋钮 ——
export interface DifficultyModel {
  n: number
  rawD: number
  saturation: number
  stage: 'tutorial' | 'rise' | 'hard' | 'late'
  gravity: number
  asteroids: number
  repel: number
  blackhole: number
  moving: boolean
  periodic: boolean
  portalRadius: number
  shots: number
  timeLimit: number
  gravityScale: number
}

export function difficultyModel(index0: number): DifficultyModel {
  const n = Math.max(1, Math.min(LEVEL_COUNT, index0 + 1))
  const rawD = Math.pow(1.1, n - 1)
  // 饱和：D 越大越接近 1，但不会让参数按 1.1^49 指数爆炸。
  const saturation = Math.min(1, rawD / (rawD + 6))
  const stage: DifficultyModel['stage'] =
    index0 < 4 ? 'tutorial' : index0 < 18 ? 'rise' : index0 < 35 ? 'hard' : 'late'

  const gravity =
    stage === 'tutorial'
      ? index0 === 2
        ? 1
        : 0
      : Math.min(4, Math.round(1 + 3 * saturation))
  const asteroids =
    stage === 'tutorial' ? (index0 === 3 ? 2 : 0) : Math.min(6, Math.round(6 * saturation))
  const repel = index0 < 18 ? 0 : Math.min(2, Math.round(2 * saturation))
  const blackhole = index0 < 30 ? 0 : Math.min(2, Math.round(2 * saturation))
  const moving = index0 >= 25
  const periodic = index0 >= 15 && index0 < 25 ? true : index0 >= 35 ? index0 % 2 === 0 : false
  const portalRadius = Math.round(72 - (72 - 44) * saturation)
  const shots = index0 < 4 ? -1 : Math.max(2, Math.round(4 - 2 * saturation))
  const timeLimit = index0 < 12 ? 0 : Math.max(22, Math.round(40 - 18 * saturation))
  // G 只在 ±5% 舒适带内浮动，避免高密度近场失控。
  const gravityScale = GRAVITY_G * (1 + 0.1 * (saturation - 0.5))

  return {
    n,
    rawD,
    saturation,
    stage,
    gravity,
    asteroids,
    repel,
    blackhole,
    moving,
    periodic,
    portalRadius,
    shots,
    timeLimit,
    gravityScale
  }
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function rand(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min)
}

function portal(id: number, x: number, y: number, r: number, period?: { period: number; on: number }): Body {
  return { id, kind: 'portal', x, y, r, period }
}

function movingPortal(id: number, orbit: Orbit, r: number): Body {
  return { id, kind: 'moving', x: orbit.cx, y: orbit.cy, r, orbit }
}

function gravity(id: number, x: number, y: number, r: number, mass = 1): Body {
  return { id, kind: 'gravity', x, y, r, mass }
}

function repel(id: number, x: number, y: number, r: number): Body {
  return { id, kind: 'repel', x, y, r, mass: 1 }
}

function blackhole(id: number, x: number, y: number, r: number): Body {
  return { id, kind: 'blackhole', x, y, r, mass: 1 }
}

function asteroid(id: number, x: number, y: number, r: number): Body {
  return { id, kind: 'asteroid', x, y, r }
}

function collect(id: number, x: number, y: number, r = 26): Body {
  return { id, kind: 'collect', x, y, r }
}

function titleFor(index0: number): string {
  if (index0 === 0) return '启程直瞄'
  if (index0 === 1) return '沿途收星'
  if (index0 === 2) return '引力偏折'
  if (index0 === 3) return '单星绕弯借力'
  const names = ['双星接力', '三连借力链', '陨石回廊', '推斥暗流', '周期星门', '动目标预判', '黑洞边缘', '密集星区']
  return `${names[index0 % names.length]} · ${index0 + 1}`
}

function hintFor(d: DifficultyModel): string {
  if (d.stage === 'tutorial') return '按住锚点向后拖拽，松手把星箭射向星门'
  if (d.blackhole > 0) return '黑洞会吞噬星箭，借恒星引力绕过危险区'
  if (d.repel > 0) return '红色推斥星会推开星箭，顺势改向切入星门'
  if (d.moving) return '星门沿椭圆移动，提前量要算在前面'
  if (d.periodic) return '星门周期性开合，等窗口亮起再发射'
  if (d.gravity > 0) return '多颗恒星叠加引力会改变轨迹，借预测虚线微调角度'
  return '穿过陨石带，稳定命中星门'
}

function pointSegmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 <= 1e-6) return Math.hypot(px - ax, py - ay)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function clearForPlacement(
  bodies: Body[],
  candidate: Body,
  portalBody: Body,
  anchor: { x: number; y: number }
): boolean {
  const da = Math.hypot(candidate.x - anchor.x, candidate.y - anchor.y)
  if (da < 320) return false
  const portalCenter = portalBody.orbit ? { x: portalBody.orbit.cx, y: portalBody.orbit.cy } : portalBody
  const dp = Math.hypot(candidate.x - portalCenter.x, candidate.y - portalCenter.y)
  if (dp < portalBody.r + candidate.r + 30) return false
  // 保留一条从锚点到星门的可解走廊：实体障碍不得压在直线走廊上；引力星可贴走廊侧边。
  const corridor = pointSegmentDistance(candidate.x, candidate.y, anchor.x, anchor.y, portalCenter.x, portalCenter.y)
  const corridorMargin = candidate.kind === 'gravity' ? 80 : 125
  if (corridor < corridorMargin) return false
  for (const b of bodies) {
    if (b.kind === 'collect') continue
    if (Math.hypot(candidate.x - b.x, candidate.y - b.y) < candidate.r + b.r + 22) return false
  }
  return true
}

/** 确定性生成单关；`relaxed=true` 用于求解器重试时压缩障碍数量。 */
export function generateLevel(index0: number, seed = index0 * 1_000_003 + 7, relaxed = false): LevelConfig {
  const d = difficultyModel(index0)

  // 前 4 关保留已试玩验证的平缓教学布局，后续关由种子模型生成。
  if (index0 === 0) {
    return {
      index: 0,
      title: '启程直瞄',
      hint: '按住锚点向后拖拽，松手把星箭射向星门',
      shots: -1,
      timeLimit: 0,
      predictAlways: true,
      anchor: ANCHOR,
      bodies: [portal(1, 500, 300, d.portalRadius)],
      gravityScale: d.gravityScale
    }
  }
  if (index0 === 1) {
    return {
      index: 1,
      title: '沿途收星',
      hint: '沿直线微调角度，顺手拾取沿途星尘',
      shots: -1,
      timeLimit: 0,
      predictAlways: true,
      anchor: ANCHOR,
      bodies: [collect(2, 500, 1080), collect(3, 500, 800), collect(4, 500, 560), portal(1, 500, 300, d.portalRadius)],
      gravityScale: d.gravityScale
    }
  }
  if (index0 === 2) {
    return {
      index: 2,
      title: '引力偏折',
      hint: '恒星会把轨迹压弯，瞄得比星门略偏',
      shots: -1,
      timeLimit: 0,
      predictAlways: true,
      anchor: ANCHOR,
      bodies: [gravity(2, 260, 760, 46), collect(3, 520, 560), portal(1, 740, 380, 70)],
      gravityScale: d.gravityScale
    }
  }
  if (index0 === 3) {
    return {
      index: 3,
      title: '单星绕弯借力',
      hint: '贴近恒星半圈再切出，绕过陨石抵达星门',
      shots: -1,
      timeLimit: 0,
      predictAlways: false,
      anchor: ANCHOR,
      bodies: [
        gravity(2, 260, 720, 48),
        asteroid(3, 340, 520, 36),
        asteroid(4, 660, 520, 36),
        portal(1, 500, 300, d.portalRadius)
      ],
      gravityScale: d.gravityScale
    }
  }

  const rng = mulberry32(seed)
  const portalX = rand(rng, 260, 740)
  const portalY = rand(rng, 230, 410)
  const period = d.periodic ? { period: 6, on: 4 } : undefined
  const portalBody: Body = d.moving
    ? movingPortal(
        1,
        { cx: portalX, cy: portalY, rx: rand(rng, 100, 210), ry: rand(rng, 35, 65), speed: rand(rng, 0.45, 0.8), phase: rand(rng, 0, Math.PI * 2) },
        d.portalRadius
      )
    : portal(1, portalX, portalY, d.portalRadius, period)

  const bodies: Body[] = [portalBody]
  let nextId = 2
  const scale = relaxed ? 0.55 : 1

  const place = (kind: 'gravity' | 'repel' | 'blackhole' | 'asteroid', count: number, radius: [number, number]): void => {
    let placed = 0
    for (let attempt = 0; attempt < 80 && placed < count; attempt++) {
      const x = rand(rng, 180, 820)
      const y = rand(rng, 520, 1060)
      const r = rand(rng, radius[0], radius[1])
      const candidate: Body =
        kind === 'gravity'
          ? gravity(nextId, x, y, r, 1)
          : kind === 'repel'
            ? repel(nextId, x, y, r)
            : kind === 'blackhole'
              ? blackhole(nextId, x, y, r)
              : asteroid(nextId, x, y, r)
      if (!clearForPlacement(bodies, candidate, portalBody, ANCHOR)) continue
      bodies.push(candidate)
      nextId += 1
      placed += 1
    }
  }

  place('gravity', Math.round(d.gravity * scale), [42, 54])
  place('repel', Math.round(d.repel * scale), [42, 48])
  place('blackhole', Math.round(d.blackhole * scale), [34, 40])
  place('asteroid', Math.round(d.asteroids * scale), [28, 38])

  // 星尘只作加分点缀，不挡求解走廊。
  const collectCount = index0 % 3 === 0 ? 2 : 1
  for (let i = 0; i < collectCount; i += 1) {
    bodies.push(collect(nextId, rand(rng, 220, 780), rand(rng, 620, 980)))
    nextId += 1
  }

  return {
    index: index0,
    title: titleFor(index0),
    hint: hintFor(d),
    shots: d.shots,
    timeLimit: d.timeLimit,
    predictAlways: false,
    anchor: ANCHOR,
    bodies,
    gravityScale: d.gravityScale
  }
}
