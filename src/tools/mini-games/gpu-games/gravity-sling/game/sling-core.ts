/**
 * 《挽星弓》（gravity-sling）—— 单文件自包含内核。
 *
 * 纯逻辑（引力积分 / 预测轨迹 / 碰撞 / combo / 通关判定 / 快照序列化校验）全部导出为
 * 无 DOM 纯函数，供 node:test 直接引用；运行时 mount/destroy 只负责 Canvas2D 渲染、
 * Pointer 输入、音频映射与自动快照。不引入任何第三方运行时库、图片或音频素材。
 *
 * 物理：惯性 + 多行星反平方引力（软化半径防奇点），固定时间步 + dt clamp + 子步进。
 */
import { NeonAudio, haptic } from '../../../audio/synth'

// —— 世界与物理常数（量级与调参依据见 postmortem_007）——
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
export const SAVE_VERSION = 1
export const TOOL_ID = 'gravity-sling'
export const CHAIN_ID = 'gravity-sling:levels:13:v1'

export type Phase = 'intro' | 'aim' | 'fly' | 'win' | 'lose' | 'resume'
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

// —— 13 关配置（世界坐标 1000×1500，锚点统一底部中央）——
const ANCHOR = { x: 500, y: 1380 }

function portal(id: number, x: number, y: number, r = 72, period?: { period: number; on: number }): Body {
  return { id, kind: 'portal', x, y, r, period }
}
function movingPortal(id: number, orbit: Orbit, r = 72): Body {
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

export const LEVELS: LevelConfig[] = [
  {
    index: 0,
    title: '启程直瞄',
    hint: '按住锚点向后拖拽，松手把星箭射向星门',
    shots: -1,
    timeLimit: 0,
    predictAlways: true,
    anchor: ANCHOR,
    bodies: [portal(1, 500, 300)]
  },
  {
    index: 1,
    title: '沿途收星',
    hint: '沿直线微调角度，顺手拾取沿途星尘',
    shots: -1,
    timeLimit: 0,
    predictAlways: true,
    anchor: ANCHOR,
    bodies: [collect(2, 500, 1080), collect(3, 500, 800), collect(4, 500, 560), portal(1, 500, 300)]
  },
  {
    index: 2,
    title: '引力偏折',
    hint: '恒星会把轨迹压弯，瞄得比星门略偏',
    shots: -1,
    timeLimit: 0,
    predictAlways: true,
    anchor: ANCHOR,
    bodies: [gravity(2, 260, 760, 46), collect(3, 520, 560), portal(1, 740, 380, 70)]
  },
  {
    index: 3,
    title: '单星绕弯借力',
    hint: '贴近恒星半圈再切出，绕过陨石抵达星门',
    shots: -1,
    timeLimit: 0,
    predictAlways: false,
    anchor: ANCHOR,
    bodies: [
      gravity(2, 500, 620, 54),
      asteroid(3, 380, 520, 40),
      asteroid(4, 620, 520, 40),
      portal(1, 500, 300)
    ]
  },
  {
    index: 4,
    title: '反向抬升借力',
    hint: '借上方恒星的引力把轨迹托举过障碍',
    shots: -1,
    timeLimit: 0,
    predictAlways: false,
    anchor: ANCHOR,
    bodies: [
      gravity(2, 300, 600, 50),
      asteroid(3, 500, 720, 46),
      asteroid(4, 500, 600, 40),
      portal(1, 500, 280)
    ]
  },
  {
    index: 5,
    title: '双星接力',
    hint: '先借 A 星转向，再借 B 星加速切入星门',
    shots: 3,
    timeLimit: 0,
    predictAlways: false,
    anchor: ANCHOR,
    bodies: [gravity(2, 300, 800, 48), gravity(3, 700, 520, 48), portal(1, 500, 280)]
  },
  {
    index: 6,
    title: '三连借力链',
    hint: '三颗天体连续接力，combo 越高得分越多',
    shots: 3,
    timeLimit: 0,
    predictAlways: false,
    anchor: ANCHOR,
    bodies: [
      gravity(2, 260, 880, 46),
      gravity(3, 500, 640, 46),
      gravity(4, 740, 420, 46),
      portal(1, 500, 260)
    ]
  },
  {
    index: 7,
    title: '限次数挑战',
    hint: '本关仅 3 发，弹尽即失败，先想清楚再松手',
    shots: 3,
    timeLimit: 0,
    predictAlways: false,
    anchor: ANCHOR,
    bodies: [
      asteroid(2, 360, 900, 42),
      asteroid(3, 640, 760, 42),
      asteroid(4, 420, 560, 38),
      portal(1, 500, 300)
    ]
  },
  {
    index: 8,
    title: '限时窗口',
    hint: '星门周期性开合，等窗口亮起再发射',
    shots: 3,
    timeLimit: 25,
    predictAlways: false,
    anchor: ANCHOR,
    bodies: [portal(1, 500, 300, 72, { period: 6, on: 3 })]
  },
  {
    index: 9,
    title: '动目标预判',
    hint: '星门沿椭圆缓慢移动，提前量要算在前面',
    shots: 3,
    timeLimit: 0,
    predictAlways: false,
    anchor: ANCHOR,
    bodies: [movingPortal(1, { cx: 500, cy: 320, rx: 220, ry: 60, speed: 0.5, phase: 0 })]
  },
  {
    index: 10,
    title: '推斥天体登场',
    hint: '红色反重力星会推开星箭，顺势借力改向',
    shots: 3,
    timeLimit: 0,
    predictAlways: false,
    anchor: ANCHOR,
    bodies: [repel(2, 300, 700, 48), repel(3, 700, 700, 48), portal(1, 500, 300)]
  },
  {
    index: 11,
    title: '黑洞与小行星带',
    hint: '黑洞近距吞噬，陨石带需穿行避让',
    shots: 3,
    timeLimit: 30,
    predictAlways: false,
    anchor: ANCHOR,
    bodies: [
      blackhole(2, 500, 760, 40),
      asteroid(3, 280, 640, 36),
      asteroid(4, 720, 640, 36),
      asteroid(5, 360, 500, 32),
      asteroid(6, 640, 500, 32),
      portal(1, 500, 280)
    ]
  },
  {
    index: 12,
    title: '终局星系',
    hint: '限时 + 动目标 + 星尘混合，三星收官',
    shots: 3,
    timeLimit: 30,
    predictAlways: false,
    anchor: ANCHOR,
    bodies: [
      movingPortal(1, { cx: 500, cy: 300, rx: 180, ry: 70, speed: 0.7, phase: 1 }),
      repel(2, 260, 820, 44),
      blackhole(3, 720, 620, 36),
      collect(4, 380, 560),
      collect(5, 620, 560),
      collect(6, 500, 420)
    ]
  }
]

// —— 纯函数 ——

export function levelByIdx(i: number): LevelConfig {
  const n = Math.max(0, Math.min(LEVELS.length - 1, Math.floor(i)))
  return LEVELS[n] ?? LEVELS[0]!
}

export function bodyPos(b: Body, t: number): { x: number; y: number } {
  if (b.orbit) {
    const a = b.orbit.phase + t * b.orbit.speed
    return { x: b.orbit.cx + Math.cos(a) * b.orbit.rx, y: b.orbit.cy + Math.sin(a) * b.orbit.ry }
  }
  return { x: b.x, y: b.y }
}

export function isPortalOpen(b: Body, t: number): boolean {
  if (!b.period) return true
  const m = ((t % b.period.period) + b.period.period) % b.period.period
  return m < b.period.on
}

/** 引力/推斥/黑洞加速度（反平方 + 软化半径）。 */
export function gravityAccel(
  bodies: Body[],
  x: number,
  y: number,
  t: number,
  g: number = GRAVITY_G,
  soft: number = SOFT
): { ax: number; ay: number } {
  let ax = 0
  let ay = 0
  for (const b of bodies) {
    if (b.kind !== 'gravity' && b.kind !== 'repel' && b.kind !== 'blackhole') continue
    const p = bodyPos(b, t)
    const dx = p.x - x
    const dy = p.y - y
    const d = Math.hypot(dx, dy) || 1e-6
    let m = b.mass ?? 1
    if (b.kind === 'blackhole') m *= 3
    const mag = (g * m) / (d * d + soft * soft)
    const sign = b.kind === 'repel' ? -1 : 1
    ax += sign * (dx / d) * mag
    ay += sign * (dy / d) * mag
  }
  return { ax, ay }
}

export function aimVector(anchor: { x: number; y: number }, drag: { x: number; y: number }) {
  const dx = anchor.x - drag.x
  const dy = anchor.y - drag.y
  const len = Math.hypot(dx, dy)
  const nx = len > 1e-6 ? dx / len : 0
  const ny = len > 1e-6 ? dy / len : -1
  return { dx, dy, len, nx, ny }
}

export function powerFromPull(len: number, maxPull: number = MAX_PULL): number {
  const p = Math.max(0, Math.min(1, len / maxPull))
  return p * p
}

function portalHit(level: LevelConfig, x: number, y: number, t: number): boolean {
  for (const b of level.bodies) {
    if (b.kind !== 'portal' && b.kind !== 'moving') continue
    if (!isPortalOpen(b, t)) continue
    const p = bodyPos(b, t)
    if (Math.hypot(p.x - x, p.y - y) <= b.r + SHIP_R) return true
  }
  return false
}

function solidCrash(level: LevelConfig, x: number, y: number): boolean {
  for (const b of level.bodies) {
    if (b.kind !== 'gravity' && b.kind !== 'blackhole' && b.kind !== 'asteroid') continue
    const p = bodyPos(b, 0)
    if (Math.hypot(p.x - x, p.y - y) <= b.r + SHIP_R) return true
  }
  return false
}

function outOfBounds(x: number, y: number): boolean {
  return x < 0 || x > WORLD_W || y < 0 || y > WORLD_H
}

/** 数值积分预演预测轨迹点列；命中星门/实体/出界即停。 */
export function predictTrajectory(
  level: LevelConfig,
  dir: { nx: number; ny: number },
  power: number,
  steps: number = PREDICT_STEPS
): { x: number; y: number }[] {
  const ship = {
    x: level.anchor.x,
    y: level.anchor.y,
    vx: dir.nx * power * V_MAX,
    vy: dir.ny * power * V_MAX
  }
  const pts: { x: number; y: number }[] = []
  for (let s = 0; s < steps; s++) {
    const a = gravityAccel(level.bodies, ship.x, ship.y, 0)
    ship.vx += a.ax * FIXED_DT
    ship.vy += a.ay * FIXED_DT
    ship.x += ship.vx * FIXED_DT
    ship.y += ship.vy * FIXED_DT
    if (s % 2 === 0) pts.push({ x: ship.x, y: ship.y })
    if (portalHit(level, ship.x, ship.y, 0) || solidCrash(level, ship.x, ship.y) || outOfBounds(ship.x, ship.y)) break
  }
  return pts
}

/** combo 窗口判定：窗口内连击 +1，否则归零；倍率封顶 COMBO_MAX_MULT。 */
export function resolveCombo(
  combo: number,
  now: number,
  lastAt: number,
  window: number = COMBO_WINDOW_S
): { combo: number; mult: number } {
  const next = now - lastAt <= window ? combo + 1 : 1
  return { combo: next, mult: Math.min(next, COMBO_MAX_MULT) }
}

/**
 * 仅展示层换算：`bestCombo` 存储的是「连续借力次数」（0 = 本局未触发借力，不是倍率），
 * 计分倍率由 `resolveCombo` 给出 `min(次数, COMBO_MAX_MULT)`。结算面板需要显示倍率基线：
 * 无借力(0) 显示 ×1；有借力按次数换算并封顶 ×4。存储字段、快照 schema 与计分逻辑均不改。
 */
export function comboDisplayMult(bestCombo: number): number {
  if (!isFiniteNum(bestCombo) || bestCombo <= 0) return 1
  return Math.min(Math.max(1, Math.floor(bestCombo)), COMBO_MAX_MULT)
}

/** 推进一固定步；直接修改 state，返回本步触发的事件（与 orbit-surge 纯逻辑同构）。 */
export function stepFrame(state: SlingState, level: LevelConfig, dt: number, now: number): FrameEvent[] {
  const events: FrameEvent[] = []
  if (state.phase !== 'fly') return events

  if (state.combo > 0 && now - state.comboAt > COMBO_WINDOW_S) {
    state.combo = 0
    state.assists = 0
  }
  if (level.timeLimit > 0) {
    state.timeLeft -= dt
    if (state.timeLeft <= 0) {
      state.timeLeft = 0
      events.push({ type: 'timeout' })
      return events
    }
  }

  const a = gravityAccel(level.bodies, state.ship.x, state.ship.y, state.elapsed)
  state.ship.vx += a.ax * dt
  state.ship.vy += a.ay * dt
  state.ship.x += state.ship.vx * dt
  state.ship.y += state.ship.vy * dt
  state.ship.angle = Math.atan2(state.ship.vy, state.ship.vx)
  state.ship.trail.push({ x: state.ship.x, y: state.ship.y })
  if (state.ship.trail.length > 60) state.ship.trail.shift()

  for (const b of level.bodies) {
    const p = bodyPos(b, state.elapsed)
    const d = Math.hypot(p.x - state.ship.x, p.y - state.ship.y)
    switch (b.kind) {
      case 'collect': {
        if (!state.collectedIds.includes(b.id) && d <= b.r + SHIP_R) {
          state.collectedIds.push(b.id)
          state.collected += 1
          events.push({ type: 'collect', bodyId: b.id })
        }
        break
      }
      case 'gravity':
      case 'blackhole': {
        if (d <= b.r + SHIP_R) {
          events.push({ type: b.kind === 'blackhole' ? 'blackhole' : 'crash', bodyId: b.id })
          return events
        }
        if (d <= b.r + ASSIST_EXTRA && !state.assisted.includes(b.id)) {
          state.assisted.push(b.id)
          events.push({ type: 'assist', bodyId: b.id })
        }
        break
      }
      case 'asteroid': {
        if (d <= b.r + SHIP_R) {
          events.push({ type: 'crash', bodyId: b.id })
          return events
        }
        break
      }
      case 'portal':
      case 'moving': {
        if (isPortalOpen(b, state.elapsed) && d <= b.r + SHIP_R) {
          events.push({ type: 'portal', bodyId: b.id })
          return events
        }
        break
      }
      case 'repel':
        break
    }
  }

  if (outOfBounds(state.ship.x, state.ship.y)) events.push({ type: 'out' })
  return events
}

// —— 快照（独立键，与 merge-planet 及合集高分库物理隔离）——

export interface SavePayload {
  version: number
  tool: string
  chain: string
  savedAt: number
  level: number
  score: number
  combo: number
  bestCombo: number
  collected: number
  collectedIds: number[]
  shotsLeft: number
  timeLeft: number
  assists: number
  elapsed: number
  ship: { x: number; y: number; vx: number; vy: number; angle: number }
}

export function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

export function serializeSave(state: SlingState, savedAt: number = Date.now()): SavePayload {
  return {
    version: SAVE_VERSION,
    tool: TOOL_ID,
    chain: CHAIN_ID,
    savedAt: isFiniteNum(savedAt) && savedAt > 0 ? Math.floor(savedAt) : Date.now(),
    level: Math.max(0, Math.min(LEVELS.length - 1, Math.floor(state.level))),
    score: isFiniteNum(state.score) && state.score >= 0 ? Math.floor(state.score) : 0,
    combo: Math.max(0, Math.floor(state.combo)),
    bestCombo: Math.max(0, Math.floor(state.bestCombo)),
    collected: Math.max(0, Math.floor(state.collected)),
    collectedIds: state.collectedIds.filter((id) => Number.isInteger(id)).map((id) => Math.floor(id)),
    shotsLeft: Number.isInteger(state.shotsLeft) ? Math.floor(state.shotsLeft) : -1,
    timeLeft: isFiniteNum(state.timeLeft) ? Math.max(0, state.timeLeft) : 0,
    assists: Math.max(0, Math.floor(state.assists)),
    elapsed: isFiniteNum(state.elapsed) && state.elapsed >= 0 ? state.elapsed : 0,
    ship: {
      x: isFiniteNum(state.ship.x) ? state.ship.x : ANCHOR.x,
      y: isFiniteNum(state.ship.y) ? state.ship.y : ANCHOR.y,
      vx: isFiniteNum(state.ship.vx) ? state.ship.vx : 0,
      vy: isFiniteNum(state.ship.vy) ? state.ship.vy : 0,
      angle: isFiniteNum(state.ship.angle) ? state.ship.angle : -Math.PI / 2
    }
  }
}

export interface ValidateResult {
  ok: boolean
  payload: SavePayload | null
  dropped: number
}

export function validateSave(raw: unknown): ValidateResult {
  const fail: ValidateResult = { ok: false, payload: null, dropped: 0 }
  if (!raw || typeof raw !== 'object') return fail
  const r = raw as Record<string, unknown>
  if (r.version !== SAVE_VERSION) return fail
  if (r.tool !== TOOL_ID) return fail
  if (r.chain !== CHAIN_ID) return fail
  if (!isFiniteNum(r.savedAt) || r.savedAt <= 0) return fail
  const level = Number.isInteger(r.level) && (r.level as number) >= 0 && (r.level as number) < LEVELS.length
    ? Math.floor(r.level as number)
    : 0
  const shipRaw = (r.ship ?? {}) as Record<string, unknown>
  const ship = {
    x: isFiniteNum(shipRaw.x) ? (shipRaw.x as number) : ANCHOR.x,
    y: isFiniteNum(shipRaw.y) ? (shipRaw.y as number) : ANCHOR.y,
    vx: isFiniteNum(shipRaw.vx) ? (shipRaw.vx as number) : 0,
    vy: isFiniteNum(shipRaw.vy) ? (shipRaw.vy as number) : 0,
    angle: isFiniteNum(shipRaw.angle) ? (shipRaw.angle as number) : -Math.PI / 2
  }
  const collectedIds = Array.isArray(r.collectedIds)
    ? r.collectedIds.filter((id) => Number.isInteger(id)).map((id) => Math.floor(id as number))
    : []
  return {
    ok: true,
    dropped: 0,
    payload: {
      version: SAVE_VERSION,
      tool: TOOL_ID,
      chain: CHAIN_ID,
      savedAt: Math.floor(r.savedAt as number),
      level,
      score: isFiniteNum(r.score) && (r.score as number) >= 0 ? Math.floor(r.score as number) : 0,
      combo: Math.max(0, Math.floor(isFiniteNum(r.combo) ? (r.combo as number) : 0)),
      bestCombo: Math.max(0, Math.floor(isFiniteNum(r.bestCombo) ? (r.bestCombo as number) : 0)),
      collected: Math.max(0, Math.floor(isFiniteNum(r.collected) ? (r.collected as number) : 0)),
      collectedIds,
      shotsLeft: Number.isInteger(r.shotsLeft) ? Math.floor(r.shotsLeft as number) : -1,
      timeLeft: isFiniteNum(r.timeLeft) ? Math.max(0, r.timeLeft as number) : 0,
      assists: Math.max(0, Math.floor(isFiniteNum(r.assists) ? (r.assists as number) : 0)),
      elapsed: isFiniteNum(r.elapsed) && (r.elapsed as number) >= 0 ? (r.elapsed as number) : 0,
      ship
    }
  }
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function defaultStorage(): StorageLike | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch {
    return null
  }
  return null
}

export function readSaveRaw(key: string, storage?: StorageLike | null): string | null {
  const s = storage ?? defaultStorage()
  if (!s) return null
  try {
    return s.getItem(key)
  } catch {
    return null
  }
}

export function writeSaveRaw(key: string, value: string, storage?: StorageLike | null): boolean {
  const s = storage ?? defaultStorage()
  if (!s) return false
  try {
    s.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function clearSave(key: string, storage?: StorageLike | null): void {
  const s = storage ?? defaultStorage()
  if (!s) return
  try {
    s.removeItem(key)
  } catch {
    /* ignore */
  }
}

export function loadSave(key: string, storage?: StorageLike | null): SavePayload | null {
  const raw = readSaveRaw(key, storage)
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const v = validateSave(parsed)
  return v.ok ? v.payload : null
}

export function readSaveMeta(key: string, storage?: StorageLike | null): { savedAt: number; label: string } | null {
  const p = loadSave(key, storage)
  if (!p) return null
  const d = new Date(p.savedAt)
  const label = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return { savedAt: p.savedAt, label }
}

export function persistSave(payload: SavePayload, key: string, storage?: StorageLike | null): boolean {
  return writeSaveRaw(key, JSON.stringify(payload), storage)
}

// —— 运行时挂载 ——

export interface MountOptions {
  onScore(score: number): void
  onCombo(combo: number): void
  onGameover(): void
  muted: boolean
  vibrate: boolean
  particle?: 'auto' | 'high' | 'low'
}

export interface SlingHandle {
  destroy(): void
  setPaused(p: boolean): void
  setMuted(m: boolean): void
  reset(): void
  nextLevel(): void
  resumeAuto(): void
  discardAuto(): void
  autoSaveNow(): void
  clearAutoSave(): void
  state(): SlingState
  debug: {
    getLevel(): LevelConfig
    setLevel(i: number): void
    forcePortal(): void
    launch(angleDeg: number, power: number): void
    phase(): Phase
    isPaused(): boolean
    anchorScreen(): { x: number; y: number }
    layout(): { scale: number; ox: number; oy: number; cssW: number; cssH: number }
  }
}

export function createInitialState(level: number, score = 0, collected = 0): SlingState {
  const levelCfg = levelByIdx(level)
  return {
    level,
    score,
    combo: 0,
    bestCombo: 0,
    comboAt: 0,
    collected,
    collectedIds: [],
    shotsLeft: levelCfg.shots,
    timeLeft: levelCfg.timeLimit,
    phase: 'aim',
    ship: { x: levelCfg.anchor.x, y: levelCfg.anchor.y, vx: 0, vy: 0, angle: -Math.PI / 2, trail: [], launched: false },
    assists: 0,
    assisted: [],
    elapsed: 0,
    attempt: 0
  }
}

export function mount(canvas: HTMLCanvasElement, opts: MountOptions): SlingHandle {
  const context = canvas.getContext('2d')
  if (!context) throw new Error('gravity-sling: 2d context unavailable')
  const ctx: CanvasRenderingContext2D = context

  const audio = new NeonAudio()
  audio.setMuted(opts.muted)
  let vibrate = opts.vibrate

  let saved: SavePayload | null = loadSave(AUTO_SAVE_KEY)
  let state: SlingState = saved ? restoreState(saved) : createInitialState(0)
  if (saved) state.phase = 'resume'
  else state.phase = 'intro'

  let level = levelByIdx(state.level)
  let paused = false
  let dragging = false
  let drag = { x: level.anchor.x, y: level.anchor.y }
  let predicted: { x: number; y: number }[] = []
  let particles: { x: number; y: number; vx: number; vy: number; life: number; max: number; hue: number }[] = []
  let buttons: { id: string; x: number; y: number; w: number; h: number; label: string }[] = []
  let raf = 0
  let last = 0
  let acc = 0
  let ro: ResizeObserver | null = null
  let cssW = 1
  let cssH = 1
  let scale = 1
  let ox = 0
  let oy = 0
  let alive = true
  let predictTimer = 0

  function restoreState(p: SavePayload): SlingState {
    const s = createInitialState(p.level, p.score, p.collected)
    s.combo = p.combo
    s.bestCombo = p.bestCombo
    s.collectedIds = p.collectedIds
    s.shotsLeft = p.shotsLeft
    s.timeLeft = p.timeLeft
    s.assists = p.assists
    s.elapsed = p.elapsed
    s.ship = { x: p.ship.x, y: p.ship.y, vx: p.ship.vx, vy: p.ship.vy, angle: p.ship.angle, trail: [], launched: true }
    return s
  }

  function syncLevel(): void {
    level = levelByIdx(state.level)
  }

  function resize(): void {
    const parent = canvas.parentElement
    const rect = parent ? parent.getBoundingClientRect() : canvas.getBoundingClientRect()
    cssW = Math.max(1, rect.width)
    cssH = Math.max(1, rect.height)
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(cssW * dpr)
    canvas.height = Math.round(cssH * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    scale = Math.min(cssW / WORLD_W, cssH / WORLD_H)
    ox = (cssW - WORLD_W * scale) / 2
    oy = (cssH - WORLD_H * scale) / 2
  }

  function toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect()
    return { x: (clientX - rect.left - ox) / scale, y: (clientY - rect.top - oy) / scale }
  }

  function screen(x: number, y: number): { x: number; y: number } {
    return { x: ox + x * scale, y: oy + y * scale }
  }

  function recomputePredict(): void {
    if (state.phase !== 'aim') return
    const v = aimVector(level.anchor, drag)
    const power = powerFromPull(v.len)
    predicted = power > 0.12 ? predictTrajectory(level, v, power) : []
  }

  function burst(x: number, y: number, hue: number, count = 26): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = 60 + Math.random() * 220
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.7 + Math.random() * 0.5, max: 1.2, hue })
    }
  }

  function handleEvents(events: FrameEvent[]): void {
    for (const ev of events) {
      switch (ev.type) {
        case 'assist': {
          const { combo, mult } = resolveCombo(state.combo, state.elapsed, state.comboAt)
          state.combo = combo
          state.comboAt = state.elapsed
          state.assists += 1
          state.bestCombo = Math.max(state.bestCombo, combo)
          state.score += 60 * mult
          opts.onScore(state.score)
          opts.onCombo(combo)
          audio.blip(combo)
          break
        }
        case 'collect': {
          const mult = Math.max(1, Math.min(state.combo, COMBO_MAX_MULT))
          state.score += 100 * mult
          opts.onScore(state.score)
          audio.hit(true)
          break
        }
        case 'crash':
        case 'blackhole':
        case 'out':
          state.phase = 'lose'
          audio.explode(2)
          haptic([40, 60, 40], vibrate)
          clearSave(AUTO_SAVE_KEY)
          opts.onGameover()
          break
        case 'timeout':
          state.phase = 'lose'
          audio.tone(110, false)
          clearSave(AUTO_SAVE_KEY)
          opts.onGameover()
          break
        case 'portal': {
          const bonus = 300 + Math.round(state.timeLeft * 10) + Math.max(0, state.shotsLeft) * 50
          state.score += bonus
          opts.onScore(state.score)
          state.phase = 'win'
          burst(state.ship.x, state.ship.y, 190, 40)
          audio.tone(523, true)
          setTimeout(() => audio.tone(659, true), 120)
          setTimeout(() => audio.tone(784, true), 240)
          clearSave(AUTO_SAVE_KEY)
          opts.onGameover()
          break
        }
        case 'shots':
          state.phase = 'lose'
          clearSave(AUTO_SAVE_KEY)
          opts.onGameover()
          break
      }
    }
  }

  function launch(): void {
    const v = aimVector(level.anchor, drag)
    const power = powerFromPull(v.len)
    if (power < 0.12) {
      dragging = false
      predicted = []
      return
    }
    if (level.shots >= 0 && state.shotsLeft <= 0) return
    audio.ensure()
    state.ship.vx = v.nx * power * V_MAX
    state.ship.vy = v.ny * power * V_MAX
    state.ship.launched = true
    state.phase = 'fly'
    state.attempt += 1
    if (level.shots >= 0) state.shotsLeft -= 1
    predicted = []
    dragging = false
    audio.explode(0.4)
    audio.tone(220 + power * 220, true)
    haptic([12, 30, 12], vibrate)
  }

  function retryLevel(): void {
    state = createInitialState(state.level, state.score, 0)
    syncLevel()
    clearSave(AUTO_SAVE_KEY)
  }

  function nextLevel(): void {
    const next = Math.min(LEVELS.length - 1, state.level + 1)
    state = createInitialState(next, state.score, state.collected)
    syncLevel()
    clearSave(AUTO_SAVE_KEY)
  }

  function persistIfNonEmpty(): void {
    const nonEmpty = state.score > 0 || state.collected > 0 || state.ship.launched || state.assisted.length > 0
    if (!nonEmpty || (state.phase !== 'aim' && state.phase !== 'fly')) return
    persistSave(serializeSave(state), AUTO_SAVE_KEY)
  }

  function resumeAuto(): void {
    if (saved) {
      state = restoreState(saved)
      state.phase = 'aim'
      syncLevel()
    }
  }

  function discardAuto(): void {
    clearSave(AUTO_SAVE_KEY)
    state = createInitialState(0, 0, 0)
    syncLevel()
  }

  function onPointerDown(e: PointerEvent): void {
    e.preventDefault()
    audio.ensure()
    const p = toWorld(e.clientX, e.clientY)
    if (state.phase === 'resume') {
      const b = buttons.find((x) => hit(x, p))
      if (b?.id === 'resume') resumeAuto()
      if (b?.id === 'new') discardAuto()
      return
    }
    if (state.phase === 'win' || state.phase === 'lose') {
      const b = buttons.find((x) => hit(x, p))
      if (b?.id === 'retry') retryLevel()
      if (b?.id === 'next') nextLevel()
      return
    }
    if (state.phase === 'intro') {
      state.phase = 'aim'
      return
    }
    if (state.phase !== 'aim') return
    const d = Math.hypot(p.x - level.anchor.x, p.y - level.anchor.y)
    if (d <= 110) {
      dragging = true
      drag = p
      ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
      recomputePredict()
    }
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragging || state.phase !== 'aim') return
    const p = toWorld(e.clientX, e.clientY)
    drag = p
    const now = performance.now()
    if (now - predictTimer > 16) {
      predictTimer = now
      recomputePredict()
      const v = aimVector(level.anchor, drag)
      audio.tone(180 + powerFromPull(v.len) * 320, false)
    }
  }

  function onPointerUp(): void {
    if (!dragging) return
    launch()
  }

  function hit(b: { x: number; y: number; w: number; h: number }, p: { x: number; y: number }): boolean {
    return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h
  }

  // —— 渲染 ——
  function drawBackground(): void {
    const g = ctx.createLinearGradient(0, 0, 0, cssH)
    g.addColorStop(0, '#0a0e24')
    g.addColorStop(1, '#1a1030')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, cssW, cssH)
    ctx.fillStyle = 'rgba(200,220,255,0.5)'
    let seed = state.level * 977 + 13
    for (let i = 0; i < 90; i++) {
      seed = (seed * 137 + 91) % 997
      const sx = (seed % 1000) / 1000 * cssW
      const sy = ((seed >> 3) % 1000) / 1000 * cssH
      const r = (seed % 3) * 0.4 + 0.4
      ctx.globalAlpha = 0.25 + (seed % 5) * 0.1
      ctx.beginPath()
      ctx.arc(sx, sy, r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  function drawBody(b: Body): void {
    const p = bodyPos(b, state.elapsed)
    const s = screen(p.x, p.y)
    const r = b.r * scale
    switch (b.kind) {
      case 'gravity': {
        const g = ctx.createRadialGradient(s.x, s.y, r * 0.2, s.x, s.y, r)
        g.addColorStop(0, '#bfe9ff')
        g.addColorStop(0.55, '#39a8ff')
        g.addColorStop(1, '#1b4cff')
        ctx.fillStyle = g
        ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = 'rgba(120,190,255,0.25)'
        ctx.setLineDash([6, 8])
        ctx.beginPath(); ctx.arc(s.x, s.y, (b.r + ASSIST_EXTRA) * scale, 0, Math.PI * 2); ctx.stroke()
        ctx.setLineDash([])
        break
      }
      case 'repel': {
        const g = ctx.createRadialGradient(s.x, s.y, r * 0.2, s.x, s.y, r)
        g.addColorStop(0, '#ffe9f2')
        g.addColorStop(0.55, '#ff5fb0')
        g.addColorStop(1, '#b026ff')
        ctx.fillStyle = g
        ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.fill()
        break
      }
      case 'blackhole': {
        ctx.fillStyle = '#000'
        ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = 'rgba(255,150,60,0.8)'
        ctx.lineWidth = 3
        ctx.beginPath(); ctx.arc(s.x, s.y, r + 6 * scale, 0, Math.PI * 2); ctx.stroke()
        ctx.lineWidth = 1
        break
      }
      case 'asteroid': {
        ctx.fillStyle = '#8a8f9e'
        ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = 'rgba(0,0,0,0.25)'
        ctx.beginPath(); ctx.arc(s.x - r * 0.3, s.y - r * 0.3, r * 0.4, 0, Math.PI * 2); ctx.fill()
        break
      }
      case 'collect': {
        const collected = state.collectedIds.includes(b.id)
        ctx.globalAlpha = collected ? 0.25 : 1
        ctx.fillStyle = '#ffd76a'
        ctx.save()
        ctx.translate(s.x, s.y)
        ctx.rotate(state.elapsed * 2)
        for (let k = 0; k < 4; k++) {
          ctx.rotate(Math.PI / 2)
          ctx.fillRect(-r * 0.12, -r * 0.9, r * 0.24, r * 1.8)
        }
        ctx.restore()
        ctx.globalAlpha = 1
        break
      }
      case 'portal':
      case 'moving': {
        const open = isPortalOpen(b, state.elapsed)
        ctx.globalAlpha = open ? 1 : 0.25
        const pulse = 1 + Math.sin(state.elapsed * 4) * 0.08
        ctx.strokeStyle = '#5ef0c8'
        ctx.lineWidth = 4
        ctx.shadowColor = 'rgba(94,240,200,0.8)'
        ctx.shadowBlur = 18
        ctx.beginPath(); ctx.arc(s.x, s.y, r * pulse, 0, Math.PI * 2); ctx.stroke()
        ctx.shadowBlur = 0
        ctx.globalAlpha = 1
        if (b.orbit) {
          ctx.strokeStyle = 'rgba(150,180,255,0.18)'
          ctx.beginPath()
          ctx.ellipse(ox + b.orbit.cx * scale, oy + b.orbit.cy * scale, b.orbit.rx * scale, b.orbit.ry * scale, 0, 0, Math.PI * 2)
          ctx.stroke()
        }
        break
      }
    }
  }

  function drawShip(): void {
    if (state.ship.trail.length > 1) {
      ctx.strokeStyle = 'rgba(120,200,255,0.4)'
      ctx.lineWidth = 3
      ctx.beginPath()
      state.ship.trail.forEach((p, i) => {
        const sp = screen(p.x, p.y)
        if (i === 0) ctx.moveTo(sp.x, sp.y)
        else ctx.lineTo(sp.x, sp.y)
      })
      ctx.stroke()
    }
    const s = screen(state.ship.x, state.ship.y)
    ctx.shadowColor = 'rgba(120,210,255,0.95)'
    ctx.shadowBlur = 16
    ctx.fillStyle = '#eafaff'
    ctx.beginPath(); ctx.arc(s.x, s.y, SHIP_R * scale, 0, Math.PI * 2); ctx.fill()
    ctx.shadowBlur = 0
  }

  function drawAim(): void {
    const a = screen(level.anchor.x, level.anchor.y)
    ctx.fillStyle = 'rgba(220,230,255,0.85)'
    ctx.beginPath(); ctx.arc(a.x, a.y, 10 * scale, 0, Math.PI * 2); ctx.fill()
    if (dragging) {
      const dp = screen(drag.x, drag.y)
      ctx.strokeStyle = 'rgba(255,120,140,0.85)'
      ctx.lineWidth = 3
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(dp.x, dp.y); ctx.stroke()
      const v = aimVector(level.anchor, drag)
      const power = powerFromPull(v.len)
      // 预测虚线
      ctx.fillStyle = 'rgba(120,220,255,0.7)'
      for (const pt of predicted) {
        const sp = screen(pt.x, pt.y)
        ctx.beginPath(); ctx.arc(sp.x, sp.y, 3, 0, Math.PI * 2); ctx.fill()
      }
      // 力度条（贴在锚点上方，避免被底部安全区/橡皮筋遮挡）
      const barW = 180
      const bx = cssW / 2 - barW / 2
      const by = a.y - 84
      ctx.fillStyle = 'rgba(255,255,255,0.15)'
      ctx.fillRect(bx, by, barW, 10)
      const hue = power < 0.5 ? '#2bbf8a' : power < 0.8 ? '#ffd76a' : '#ff6b6b'
      ctx.fillStyle = hue
      ctx.fillRect(bx, by, barW * power, 10)
    }
  }

  function drawHud(): void {
    // 分数与连击由宿主 FocusStage 的 DOM HUD 负责（左上分数/连击、右上暂停），
    // 本画布不再重复绘制分数；关卡标题与提示居中于顶部第二行，避开两侧宿主控件。
    ctx.textAlign = 'center'
    ctx.fillStyle = 'rgba(234,242,255,0.92)'
    ctx.font = '700 20px system-ui, sans-serif'
    ctx.fillText(`第 ${state.level + 1}/13 关 · ${level.title}`, cssW / 2, 34)
    ctx.font = '15px system-ui, sans-serif'
    ctx.fillStyle = '#9fb4d8'
    ctx.fillText(level.hint, cssW / 2, 60)
    ctx.textAlign = 'left'
    ctx.font = '15px system-ui, sans-serif'
    ctx.fillStyle = '#9fb4d8'
    const shotsText = level.shots < 0 ? '不限次数' : `剩余 ${state.shotsLeft} 发`
    const timeText = level.timeLimit > 0 ? ` · 限时 ${Math.ceil(state.timeLeft)}s` : ''
    ctx.fillText(`${shotsText}${timeText}`, 18, cssH - 24)
  }

  function panel(title: string, lines: string[], actions: { id: string; label: string }[]): void {
    ctx.fillStyle = 'rgba(5,6,13,0.78)'
    ctx.fillRect(0, 0, cssW, cssH)
    const w = Math.min(320, cssW - 40)
    const h = 240
    const x = (cssW - w) / 2
    const y = (cssH - h) / 2
    ctx.fillStyle = 'rgba(14,19,36,0.92)'
    ctx.strokeStyle = 'rgba(140,180,255,0.25)'
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, 18)
    ctx.fill(); ctx.stroke()
    ctx.fillStyle = '#eaf2ff'
    ctx.textAlign = 'center'
    ctx.font = '700 22px system-ui, sans-serif'
    ctx.fillText(title, cssW / 2, y + 46)
    ctx.font = '15px system-ui, sans-serif'
    ctx.fillStyle = '#9fb4d8'
    lines.forEach((line, i) => ctx.fillText(line, cssW / 2, y + 84 + i * 26))
    buttons = []
    actions.forEach((a, i) => {
      const bw = 220
      const bx = (cssW - bw) / 2
      const by = y + 150 + i * 54
      buttons.push({ id: a.id, x: (bx - ox) / scale, y: (by - oy) / scale, w: bw / scale, h: 44 / scale, label: a.label })
      ctx.fillStyle = 'rgba(90,140,255,0.35)'
      ctx.beginPath(); ctx.roundRect(bx, by, bw, 44, 12)
      ctx.fill()
      ctx.fillStyle = '#eaf2ff'
      ctx.font = '16px system-ui, sans-serif'
      ctx.fillText(a.label, cssW / 2, by + 28)
    })
  }

  function drawParticles(dt: number): void {
    particles = particles.filter((p) => p.life > 0)
    for (const p of particles) {
      p.life -= dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      const s = screen(p.x, p.y)
      ctx.globalAlpha = Math.max(0, p.life / p.max)
      ctx.fillStyle = `hsl(${p.hue} 90% 70%)`
      ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, Math.PI * 2); ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  function render(dt: number): void {
    buttons = []
    drawBackground()
    for (const b of level.bodies) drawBody(b)
    if (state.phase === 'aim' || state.phase === 'fly') drawShip()
    if (state.phase === 'aim') drawAim()
    drawParticles(dt)
    drawHud()

    if (state.phase === 'intro') {
      panel('挽星弓', ['按住锚点向后拖拽，松手发射', '借恒星引力飞向星门，点屏幕继续'], [{ id: 'skip', label: '开始游戏' }])
    } else if (state.phase === 'resume') {
      const meta = readSaveMeta(AUTO_SAVE_KEY)
      panel('继续上一局', [meta ? `存档于 ${meta.label}` : '上次对局未完成', `第 ${state.level + 1} 关 · 分数 ${state.score}`], [
        { id: 'resume', label: '继续上一局' },
        { id: 'new', label: '开始新局' }
      ])
    } else if (state.phase === 'win') {
      const last = state.level === LEVELS.length - 1
      panel(last ? '通关终局星系！' : '命中星门！', [`得分 ${state.score} · 连击峰值 ×${comboDisplayMult(state.bestCombo)}`, `收集星尘 ${state.collected}`], [
        { id: 'next', label: last ? '再来一轮' : '下一关' },
        { id: 'retry', label: '重试本关' }
      ])
    } else if (state.phase === 'lose') {
      panel('星箭失落了', [`得分 ${state.score}`, '调整角度与力度再试一次'], [{ id: 'retry', label: '重试本关' }])
    }
  }

  function loop(now: number): void {
    if (!alive) return
    if (!last) last = now
    const dt = Math.min((now - last) / 1000, 0.05)
    last = now
    if (!paused && state.phase === 'fly') {
      acc += dt
      let steps = 0
      while (acc >= FIXED_DT && steps < MAX_FRAME_STEPS) {
        state.elapsed += FIXED_DT
        handleEvents(stepFrame(state, level, FIXED_DT, state.elapsed))
        acc -= FIXED_DT
        steps += 1
      }
      if (steps === MAX_FRAME_STEPS) acc = 0
    } else if (state.phase !== 'fly') {
      acc = 0
    }
    render(dt)
    raf = requestAnimationFrame(loop)
  }

  resize()
  ro = new ResizeObserver(() => resize())
  if (canvas.parentElement) ro.observe(canvas.parentElement)

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)

  const autoTimer = setInterval(persistIfNonEmpty, 15000)
  const onHide = (): void => persistIfNonEmpty()
  const onPageHide = (): void => persistIfNonEmpty()
  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('pagehide', onPageHide)

  raf = requestAnimationFrame(loop)

  return {
    destroy(): void {
      alive = false
      cancelAnimationFrame(raf)
      clearInterval(autoTimer)
      ro?.disconnect()
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onPageHide)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      audio.close()
    },
    setPaused(p: boolean): void {
      paused = p
      if (p) audio.suspend()
      else {
        audio.ensure()
        last = 0
      }
    },
    setMuted(m: boolean): void {
      audio.setMuted(m)
    },
    reset(): void {
      state = createInitialState(0, 0, 0)
      syncLevel()
      clearSave(AUTO_SAVE_KEY)
    },
    nextLevel,
    resumeAuto,
    discardAuto,
    autoSaveNow: persistIfNonEmpty,
    clearAutoSave: () => clearSave(AUTO_SAVE_KEY),
    state: () => state,
    debug: {
      getLevel: () => level,
      setLevel(i: number): void {
        state = createInitialState(i, state.score, state.collected)
        syncLevel()
      },
      forcePortal(): void {
        const portalBody = level.bodies.find((b) => b.kind === 'portal' || b.kind === 'moving')
        if (!portalBody) return
        const p = bodyPos(portalBody, state.elapsed)
        state.ship.x = p.x
        state.ship.y = p.y
      },
      launch(angleDeg: number, power: number): void {
        const a = (angleDeg * Math.PI) / 180
        state.ship.vx = Math.cos(a) * power * V_MAX
        state.ship.vy = Math.sin(a) * power * V_MAX
        state.ship.launched = true
        state.phase = 'fly'
        state.attempt += 1
        if (level.shots >= 0) state.shotsLeft -= 1
      },
      phase: () => state.phase,
      isPaused: () => paused,
      anchorScreen: () => screen(level.anchor.x, level.anchor.y),
      layout: () => ({ scale, ox, oy, cssW, cssH })
    }
  }
}
