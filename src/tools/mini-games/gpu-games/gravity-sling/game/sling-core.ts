/**
 * 《挽星弓》（gravity-sling）—— 单文件自包含内核。
 *
 * 纯逻辑（引力积分 / 预测轨迹 / 碰撞 / combo / 通关判定 / 快照序列化校验 / 离线求解）
 * 全部导出为无 DOM 纯函数，供 node:test 直接引用；运行时 mount/destroy 只负责 Canvas2D
 * 渲染、Pointer 输入、音频映射与自动快照。不引入任何第三方运行时库、图片或音频素材。
 *
 * 物理：惯性 + 多行星反平方引力（软化半径防奇点 + 净加速度上限），固定时间步 +
 * dt clamp + 子步进。关卡模型、难度映射与种子生成见 `level-design.ts`。
 */
import { NeonAudio, haptic } from '../../../audio/synth'
import {
  WORLD_W,
  WORLD_H,
  SHIP_R,
  V_MAX,
  MAX_PULL,
  GRAVITY_G,
  SOFT,
  ASSIST_EXTRA,
  FIXED_DT,
  MAX_FRAME_STEPS,
  COMBO_WINDOW_S,
  COMBO_MAX_MULT,
  PREDICT_STEPS,
  AUTO_SAVE_KEY,
  PROGRESS_KEY,
  SAVE_VERSION,
  TOOL_ID,
  CHAIN_ID,
  LEGACY_CHAIN_ID,
  LEVEL_COUNT,
  ANCHOR,
  MAX_ACCEL,
  MIN_ANGLE_WINDOW_DEG,
  MIN_CLEARANCE,
  MAX_BODIES,
  type Phase,
  type Body,
  type BodyKind,
  type Orbit,
  type LevelConfig,
  type Ship,
  type SlingState,
  type FrameEvent,
  type SolveEvidence
} from './level-design'
import { LEVELS, SOLUTIONS } from './levels.generated'

export {
  WORLD_W,
  WORLD_H,
  SHIP_R,
  V_MAX,
  MAX_PULL,
  GRAVITY_G,
  SOFT,
  ASSIST_EXTRA,
  FIXED_DT,
  MAX_FRAME_STEPS,
  COMBO_WINDOW_S,
  COMBO_MAX_MULT,
  PREDICT_STEPS,
  AUTO_SAVE_KEY,
  PROGRESS_KEY,
  SAVE_VERSION,
  TOOL_ID,
  CHAIN_ID,
  LEGACY_CHAIN_ID,
  LEVEL_COUNT,
  MAX_ACCEL,
  MIN_ANGLE_WINDOW_DEG,
  MIN_CLEARANCE,
  MAX_BODIES,
  type Phase,
  type Body,
  type BodyKind,
  type Orbit,
  type LevelConfig,
  type Ship,
  type SlingState,
  type FrameEvent,
  type SolveEvidence
}

export { LEVELS, SOLUTIONS }

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

/**
 * 引力/推斥/黑洞加速度。本函数天然遍历全部力体做矢量叠加：
 * `ax += ...; ay += ...`；黑洞质量 ×3，推斥 sign=-1。多体近场叠加后做净加速度上限，
 * 防止高密度后期关数值爆炸；预测轨迹与离线求解器都复用本函数，不存在第二套物理。
 */
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
  const mag = Math.hypot(ax, ay)
  if (mag > MAX_ACCEL) {
    ax *= MAX_ACCEL / mag
    ay *= MAX_ACCEL / mag
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

/** 数值积分预演预测轨迹点列；命中星门/实体/出界即停。复用 gravityAccel 合力函数。 */
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
    const a = gravityAccel(level.bodies, ship.x, ship.y, 0, level.gravityScale ?? GRAVITY_G, SOFT)
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

  const a = gravityAccel(level.bodies, state.ship.x, state.ship.y, state.elapsed, level.gravityScale ?? GRAVITY_G, SOFT)
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

// —— 离线求解器：复用 createInitialState/stepFrame/gravityAccel，不另写物理 ——

interface SimResult {
  hit: boolean
  steps: number
  clearance: number
}

function simulateLaunch(level: LevelConfig, angleDeg: number, power: number, maxSteps: number): SimResult {
  const st = createInitialState(level)
  st.phase = 'fly'
  st.ship.launched = true
  st.ship.x = level.anchor.x
  st.ship.y = level.anchor.y
  st.elapsed = 0
  st.shotsLeft = level.shots < 0 ? -1 : 1
  st.timeLeft = level.timeLimit
  st.attempt = 1
  const rad = (angleDeg * Math.PI) / 180
  st.ship.vx = Math.cos(rad) * power * V_MAX
  st.ship.vy = Math.sin(rad) * power * V_MAX

  const portal = level.bodies.find((b) => b.kind === 'portal' || b.kind === 'moving')
  for (let step = 1; step <= maxSteps; step += 1) {
    st.elapsed += FIXED_DT
    const ev = stepFrame(st, level, FIXED_DT, st.elapsed)
    if (ev.some((e) => e.type === 'portal')) {
      const p = portal ? bodyPos(portal, st.elapsed) : { x: st.ship.x, y: st.ship.y }
      const dist = Math.hypot(p.x - st.ship.x, p.y - st.ship.y)
      return { hit: true, steps: step, clearance: portal ? portal.r + SHIP_R - dist : MIN_CLEARANCE }
    }
    if (ev.some((e) => e.type === 'crash' || e.type === 'blackhole' || e.type === 'out' || e.type === 'timeout')) {
      return { hit: false, steps: step, clearance: 0 }
    }
  }
  return { hit: false, steps: maxSteps, clearance: 0 }
}

/** 供单测/证据复核：用与运行时相同的 stepFrame 复放一条给定弹道。 */
export function simulateSolution(level: LevelConfig, angleDeg: number, power: number, maxSteps = 1200): SimResult {
  return simulateLaunch(level, angleDeg, power, maxSteps)
}

/** 在角度 ×力度网格上搜索可解弹道；返回命中解、角度窗口与门体净空，失败返回 null。 */
export function solveLevel(level: LevelConfig, opts?: { maxSteps?: number; timeoutMs?: number }): SolveEvidence | null {
  const maxSteps = opts?.maxSteps ?? Math.max(600, Math.ceil((level.timeLimit > 0 ? level.timeLimit : 12) * 120))
  const started = Date.now()
  const portal = level.bodies.find((b) => b.kind === 'portal' || b.kind === 'moving')
  const bodyCount = level.bodies.filter((b) => b.kind !== 'collect').length
  const candidates: { angleDeg: number; power: number; result: SimResult }[] = []

  const angles = Array.from({ length: 21 }, (_, i) => -130 + i * 4)
  const powers = Array.from({ length: 14 }, (_, i) => 0.35 + i * 0.05)

  for (const angleDeg of angles) {
    for (const power of powers) {
      if (opts?.timeoutMs && Date.now() - started > opts.timeoutMs) return null
      const result = simulateLaunch(level, angleDeg, power, maxSteps)
      if (result.hit) candidates.push({ angleDeg, power, result })
    }
  }
  if (!candidates.length) return null

  candidates.sort((a, b) => b.result.clearance - a.result.clearance || a.result.steps - b.result.steps)
  let best = candidates[0]!

  // 局部细化：角度 ±4°、力度 ±0.08。
  for (let angle = best.angleDeg - 4; angle <= best.angleDeg + 4; angle += 1) {
    for (let power = Math.max(0.35, best.power - 0.08); power <= Math.min(1, best.power + 0.08); power += 0.02) {
      if (opts?.timeoutMs && Date.now() - started > opts.timeoutMs) break
      const result = simulateLaunch(level, angle, power, maxSteps)
      if (result.hit && (result.clearance > best.result.clearance || (result.clearance === best.result.clearance && result.steps < best.result.steps))) {
        best = { angleDeg: angle, power, result }
      }
    }
  }

  // 角度窗口：固定最佳力度，统计最佳解附近连续可命中角度宽度。
  let windowCount = 0
  for (let angle = best.angleDeg - 10; angle <= best.angleDeg + 10; angle += 1) {
    const result = simulateLaunch(level, angle, best.power, maxSteps)
    if (result.hit) windowCount += 1
  }
  const angleWindowDeg = windowCount

  return {
    index: level.index,
    seed: level.index * 1_000_003 + 7,
    retries: 0,
    angleDeg: Math.round(best.angleDeg * 10) / 10,
    power: Math.round(best.power * 1000) / 1000,
    steps: best.result.steps,
    angleWindowDeg,
    clearance: Math.round(best.result.clearance * 10) / 10,
    bodyCount,
    portalKind: portal?.kind ?? 'portal'
  }
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
  migrated: boolean
}

export function validateSave(raw: unknown): ValidateResult {
  const fail: ValidateResult = { ok: false, payload: null, dropped: 0, migrated: false }
  if (!raw || typeof raw !== 'object') return fail
  const r = raw as Record<string, unknown>
  const legacy = r.version === 1 && r.tool === TOOL_ID && r.chain === LEGACY_CHAIN_ID
  const current = r.version === SAVE_VERSION && r.tool === TOOL_ID && r.chain === CHAIN_ID
  if (!legacy && !current) return fail
  if (!isFiniteNum(r.savedAt) || r.savedAt <= 0) return fail
  const rawLevel = Number.isInteger(r.level) && (r.level as number) >= 0 ? Math.floor(r.level as number) : 0
  const level = Math.min(LEVELS.length - 1, rawLevel)
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
    migrated: legacy,
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

// —— 关卡进度（独立 localStorage 键；只存最大已解锁关卡与本机最高分，不进合集高分库）——

export interface ProgressPayload {
  version: number
  tool: string
  maxReached: number
  bestScore: number
}

export function readProgress(storage?: StorageLike | null): ProgressPayload {
  const fallback: ProgressPayload = { version: 1, tool: TOOL_ID, maxReached: 0, bestScore: 0 }
  const s = storage ?? defaultStorage()
  if (!s) return fallback
  try {
    const raw = s.getItem(PROGRESS_KEY)
    if (!raw) return fallback
    const r = JSON.parse(raw) as Record<string, unknown>
    if (r.tool !== TOOL_ID) return fallback
    return {
      version: 1,
      tool: TOOL_ID,
      maxReached: Math.max(0, Math.min(LEVEL_COUNT - 1, Math.floor(isFiniteNum(r.maxReached) ? (r.maxReached as number) : 0))),
      bestScore: Math.max(0, Math.floor(isFiniteNum(r.bestScore) ? (r.bestScore as number) : 0))
    }
  } catch {
    return fallback
  }
}

export function writeProgress(p: ProgressPayload, storage?: StorageLike | null): boolean {
  return writeSaveRaw(PROGRESS_KEY, JSON.stringify(p), storage)
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
  forceSave(): void
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
    predictions(): { x: number; y: number }[]
    openLevels(): void
    nextPage(): void
    levelButtons(): { id: string; label: string; locked?: boolean; x: number; y: number; w: number; h: number }[]
    fps(): number
    layout(): { scale: number; ox: number; oy: number; cssW: number; cssH: number }
    progress(): ProgressPayload
  }
}

export function createInitialState(level: LevelConfig | number, score = 0, collected = 0): SlingState {
  const levelCfg = typeof level === 'number' ? levelByIdx(level) : level
  const levelIndex = typeof level === 'number' ? level : level.index
  return {
    level: levelIndex,
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
  let progress = readProgress()
  let state: SlingState = saved ? restoreState(saved) : createInitialState(0)
  if (saved) state.phase = 'resume'
  else state.phase = 'intro'

  let level = levelByIdx(state.level)
  let paused = false
  let dragging = false
  let drag = { x: level.anchor.x, y: level.anchor.y }
  let predicted: { x: number; y: number }[] = []
  let predictKey = ''
  let fpsWindow: number[] = []
  let particles: { x: number; y: number; vx: number; vy: number; life: number; max: number; hue: number }[] = []
  let buttons: { id: string; x: number; y: number; w: number; h: number; label: string; locked?: boolean }[] = []
  let levelPage = 0
  const PAGE_SIZE = 6
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

  function persistProgress(): void {
    writeProgress(progress)
  }

  function unlockLevel(i: number): void {
    progress.maxReached = Math.max(progress.maxReached, Math.min(LEVEL_COUNT - 1, i))
    persistProgress()
  }

  function startLevel(i: number): void {
    const target = Math.max(0, Math.min(LEVEL_COUNT - 1, Math.floor(i)))
    state = createInitialState(target, 0, 0)
    syncLevel()
    unlockLevel(target)
    clearSave(AUTO_SAVE_KEY)
    dragging = false
    predicted = []
    predictKey = ''
    drag = { x: level.anchor.x, y: level.anchor.y }
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
    const key = `${state.level}|${Math.round(drag.x)}|${Math.round(drag.y)}|${power.toFixed(3)}|${Math.floor(state.elapsed)}`
    if (key === predictKey) return
    predictKey = key
    predicted = power > 0.12 ? predictTrajectory(level, v, power) : []
  }

  function burst(x: number, y: number, hue: number, count = 26): void {
    const dense = level.bodies.length > 9
    const n = dense ? Math.round(count * 0.6) : count
    for (let i = 0; i < n; i += 1) {
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
          progress.maxReached = Math.max(progress.maxReached, Math.min(LEVEL_COUNT - 1, state.level + 1))
          progress.bestScore = Math.max(progress.bestScore, state.score)
          persistProgress()
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
      predictKey = ''
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
    predictKey = ''
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
    if (state.level === LEVEL_COUNT - 1) {
      state = createInitialState(0, 0, 0)
    } else {
      state = createInitialState(state.level + 1, state.score, state.collected)
    }
    syncLevel()
    unlockLevel(state.level)
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

  function openLevelSelect(): void {
    levelPage = Math.floor(Math.min(progress.maxReached, LEVEL_COUNT - 1) / PAGE_SIZE)
    state.phase = 'levels'
    dragging = false
    predicted = []
    predictKey = ''
  }

  function onPointerDown(e: PointerEvent): void {
    e.preventDefault()
    audio.ensure()
    const p = toWorld(e.clientX, e.clientY)
    if (state.phase === 'levels') {
      const b = buttons.find((x) => hit(x, p))
      if (!b) return
      if (b.id === 'page-prev') levelPage = Math.max(0, levelPage - 1)
      else if (b.id === 'page-next') levelPage = Math.min(Math.floor((LEVEL_COUNT - 1) / PAGE_SIZE), levelPage + 1)
      else if (b.id === 'levels-back') state.phase = saved ? 'resume' : 'intro'
      else if (b.id.startsWith('level:')) {
        const target = Number(b.id.slice(6))
        if (target <= progress.maxReached) startLevel(target)
      }
      return
    }
    if (state.phase === 'resume') {
      const b = buttons.find((x) => hit(x, p))
      if (b?.id === 'resume') resumeAuto()
      else if (b?.id === 'new') discardAuto()
      else if (b?.id === 'levels') openLevelSelect()
      return
    }
    if (state.phase === 'win' || state.phase === 'lose') {
      const b = buttons.find((x) => hit(x, p))
      if (b?.id === 'retry') retryLevel()
      else if (b?.id === 'next') nextLevel()
      else if (b?.id === 'levels') openLevelSelect()
      return
    }
    if (state.phase === 'intro') {
      const b = buttons.find((x) => hit(x, p))
      if (b?.id === 'start') {
        state.phase = 'aim'
        return
      }
      if (b?.id === 'levels') {
        openLevelSelect()
        return
      }
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
    for (let i = 0; i < 90; i += 1) {
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
        // 叠加场用 lighter 混合：两颗引力井靠近时交叠区域更亮，玩家可直观看出合力叠加。
        ctx.globalCompositeOperation = 'lighter'
        const halo = ctx.createRadialGradient(s.x, s.y, r * 0.4, s.x, s.y, r * 2.2)
        halo.addColorStop(0, 'rgba(57,168,255,0.18)')
        halo.addColorStop(1, 'rgba(57,168,255,0)')
        ctx.fillStyle = halo
        ctx.beginPath(); ctx.arc(s.x, s.y, r * 2.2, 0, Math.PI * 2); ctx.fill()
        ctx.globalCompositeOperation = 'source-over'
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
        for (let k = 0; k < 4; k += 1) {
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
      // 预测虚线
      ctx.fillStyle = 'rgba(120,220,255,0.7)'
      for (const pt of predicted) {
        const sp = screen(pt.x, pt.y)
        ctx.beginPath(); ctx.arc(sp.x, sp.y, 3, 0, Math.PI * 2); ctx.fill()
      }
      // 力度条（贴在锚点上方，避免被底部安全区/橡皮筋遮挡）
      const v = aimVector(level.anchor, drag)
      const power = powerFromPull(v.len)
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
    ctx.textAlign = 'center'
    ctx.fillStyle = 'rgba(234,242,255,0.92)'
    ctx.font = '700 20px system-ui, sans-serif'
    ctx.fillText(`第 ${state.level + 1}/${LEVEL_COUNT} 关 · ${level.title}`, cssW / 2, 34)
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
    const h = 150 + actions.length * 54 + 24
    const x = (cssW - w) / 2
    const y = Math.max(20, (cssH - h) / 2)
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

  function drawLevelSelect(): void {
    ctx.fillStyle = 'rgba(5,6,13,0.86)'
    ctx.fillRect(0, 0, cssW, cssH)
    ctx.textAlign = 'center'
    ctx.fillStyle = '#eaf2ff'
    ctx.font = '700 22px system-ui, sans-serif'
    ctx.fillText('选择关卡', cssW / 2, 80)
    ctx.font = '15px system-ui, sans-serif'
    ctx.fillStyle = '#9fb4d8'
    ctx.fillText(`已解锁 ${progress.maxReached + 1}/${LEVEL_COUNT} · 第 ${levelPage + 1} 页`, cssW / 2, 112)

    buttons = []
    const cols = 2
    const bw = 380
    const bh = 120
    const gapX = 40
    const gapY = 34
    const x0 = (WORLD_W - cols * bw - gapX) / 2
    const y0 = 190
    const start = levelPage * PAGE_SIZE
    for (let i = 0; i < PAGE_SIZE; i += 1) {
      const idx = start + i
      if (idx >= LEVEL_COUNT) break
      const col = i % cols
      const row = Math.floor(i / cols)
      const x = x0 + col * (bw + gapX)
      const y = y0 + row * (bh + gapY)
      const unlocked = idx <= progress.maxReached
      buttons.push({ id: `level:${idx}`, x, y, w: bw, h: bh, label: `${idx + 1}`, locked: !unlocked })
      const sp = screen(x, y)
      ctx.fillStyle = unlocked ? 'rgba(90,140,255,0.35)' : 'rgba(80,88,110,0.35)'
      ctx.beginPath(); ctx.roundRect(sp.x, sp.y, bw * scale, bh * scale, 16)
      ctx.fill()
      ctx.fillStyle = unlocked ? '#eaf2ff' : '#6b7389'
      ctx.font = '700 22px system-ui, sans-serif'
      ctx.fillText(unlocked ? `${idx + 1}` : `🔒 ${idx + 1}`, sp.x + (bw * scale) / 2, sp.y + (bh * scale) / 2 + 8)
    }

    const nav = [
      { id: 'page-prev', label: '上一页', x: 100, y: 780, w: 280, h: 118 },
      { id: 'page-next', label: '下一页', x: 620, y: 780, w: 280, h: 118 },
      { id: 'levels-back', label: '返回', x: 360, y: 950, w: 280, h: 118 }
    ]
    for (const b of nav) {
      buttons.push({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h, label: b.label })
      const sp = screen(b.x, b.y)
      ctx.fillStyle = 'rgba(90,140,255,0.30)'
      ctx.beginPath(); ctx.roundRect(sp.x, sp.y, b.w * scale, b.h * scale, 14)
      ctx.fill()
      ctx.fillStyle = '#eaf2ff'
      ctx.font = '16px system-ui, sans-serif'
      ctx.fillText(b.label, sp.x + (b.w * scale) / 2, sp.y + (b.h * scale) / 2 + 8)
    }
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
    if (state.phase !== 'levels') {
      for (const b of level.bodies) drawBody(b)
      if (state.phase === 'aim' || state.phase === 'fly') drawShip()
      if (state.phase === 'aim') drawAim()
      drawParticles(dt)
      drawHud()
    }

    if (state.phase === 'intro') {
      panel('挽星弓', ['按住锚点向后拖拽，松手发射', '借恒星引力飞向星门'], [
        { id: 'start', label: '开始游戏' },
        { id: 'levels', label: '选择关卡' }
      ])
    } else if (state.phase === 'resume') {
      const meta = readSaveMeta(AUTO_SAVE_KEY)
      panel('继续上一局', [meta ? `存档于 ${meta.label}` : '上次对局未完成', `第 ${state.level + 1} 关 · 分数 ${state.score}`], [
        { id: 'resume', label: '继续上一局' },
        { id: 'new', label: '开始新局' },
        { id: 'levels', label: '选择关卡' }
      ])
    } else if (state.phase === 'levels') {
      drawLevelSelect()
    } else if (state.phase === 'win') {
      const last = state.level === LEVEL_COUNT - 1
      panel(last ? '通关终局星系！' : '命中星门！', [`得分 ${state.score} · 连击峰值 ×${comboDisplayMult(state.bestCombo)}`, `收集星尘 ${state.collected}`], [
        { id: 'next', label: last ? '再来一轮' : '下一关' },
        { id: 'retry', label: '重试本关' },
        { id: 'levels', label: '选择关卡' }
      ])
    } else if (state.phase === 'lose') {
      panel('星箭失落了', [`得分 ${state.score}`, '调整角度与力度再试一次'], [
        { id: 'retry', label: '重试本关' },
        { id: 'levels', label: '选择关卡' }
      ])
    }
  }

  function loop(now: number): void {
    if (!alive) return
    if (!last) last = now
    const frameDt = now - last
    if (frameDt > 0 && frameDt < 500) {
      fpsWindow.push(1000 / frameDt)
      if (fpsWindow.length > 120) fpsWindow.shift()
    }
    const dt = Math.min(frameDt / 1000, 0.05)
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
    forceSave: () => persistSave(serializeSave(state), AUTO_SAVE_KEY),
    clearAutoSave: () => clearSave(AUTO_SAVE_KEY),
    state: () => state,
    debug: {
      getLevel: () => level,
      setLevel(i: number): void {
        startLevel(i)
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
      predictions: () => predicted,
      openLevels: () => { openLevelSelect(); drawLevelSelect() },
      nextPage: () => {
        levelPage = Math.min(Math.floor((LEVEL_COUNT - 1) / PAGE_SIZE), levelPage + 1)
        drawLevelSelect()
      },
      levelButtons: () => buttons.map((b) => ({ ...b })),
      fps: () => fpsWindow.length ? fpsWindow.reduce((sum, value) => sum + value, 0) / fpsWindow.length : 0,
      layout: () => ({ scale, ox, oy, cssW, cssH }),
      progress: () => progress
    }
  }
}
