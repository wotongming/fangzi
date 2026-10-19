/**
 * 莫比环权威玩法逻辑（纯函数、可在 node 单测）。
 * - 固定步长 STEP=1/120；渲染层在此基础上插值，保证不同帧率判定一致。
 * - 碰撞只在一维「弧长 u + 所在面」上判定，不使用任何 3D 物理引擎。
 * - 半扭转：离开平滑扭转区的瞬间两面对调（face ^= 1），与 geometry 的几何换面严格同步。
 */
import { mulberry32, type Rng } from './rng'
import { inTwistZone, nextTwistStart, TWIST_PERIOD } from './geometry'
import {
  gateGapAt,
  nudgeAwayFromTwist,
  speedAt,
  twistEnabledAt,
  TUTORIAL_DIST
} from './difficulty'
import type { Face, GameEvent, GameState, Gate, RunOptions, Shard } from './types'

export const STEP = 1 / 120
const LOOKAHEAD = 150 // 前方预生成距离（米）
const RECYCLE_BEHIND = 14 // 身后多远回收
const GATE_HALF = 0.7 // 闸门碰撞半厚（米）；18m/s÷120=0.15m/步，远小于此，不会漏判
const PICKUP_HALF = 0.9
const PERFECT_WIN = 0.55 // 过门距上次翻转 ≤此距离：完美
const NEAR_WIN = 1.1 // ≤此：贴边擦过（near-miss）
const MULTI_CAP = 8
export const REVIVE_INVINCIBLE = 1.2

const FIRST_GATE_U = 42
const FIRST_SHARD_U = 24

// 每个 run 独立、持续的确定性随机源（不入状态序列化；存档只存 best/settings）
const rngMap = new WeakMap<GameState, Rng>()
function rngOf(s: GameState): Rng {
  let r = rngMap.get(s)
  if (!r) {
    r = mulberry32(s.seed >>> 0)
    rngMap.set(s, r)
  }
  return r
}

function otherFace(f: Face): Face {
  return f === 0 ? 1 : 0
}

export function createRun(opts: RunOptions = {}): GameState {
  const seed = (opts.seed ?? ((Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0)) >>> 0
  const startDistance = Math.max(0, opts.startDistance ?? 0)
  const s: GameState = {
    seed,
    status: 'ready',
    distance: startDistance,
    speed: speedAt(startDistance),
    face: 0,
    gates: [],
    shards: [],
    nextGateU: FIRST_GATE_U,
    nextShardU: FIRST_SHARD_U,
    score: 0,
    combo: 0,
    multiplier: 1,
    shardsRun: 0,
    lastFlipU: -999,
    inTwist: false,
    invincible: 0,
    reviveUsed: false,
    events: [],
    twistAhead: null,
    deathAt: null
  }
  if (startDistance > 0) {
    s.nextGateU = startDistance + 24
    s.nextShardU = startDistance + 12
  }
  // 预生成前方内容，ready 态背景也能呈现环带
  ensureGenerated(s, startDistance + LOOKAHEAD)
  s.twistAhead = twistAheadOf(s)
  return s
}

export function startRun(s: GameState): GameState {
  if (s.status === 'ready' || s.status === 'dead') s.status = 'running'
  return s
}

export function pauseRun(s: GameState): GameState {
  if (s.status === 'running') s.status = 'paused'
  return s
}

export function resumeRun(s: GameState): GameState {
  if (s.status === 'paused') s.status = 'running'
  return s
}

/** 单键翻转（只在奔跑中生效） */
export function flip(s: GameState): GameState {
  if (s.status !== 'running') return s
  s.face = otherFace(s.face)
  s.lastFlipU = s.distance
  pushEvent(s, 'flip')
  return s
}

/**
 * 专业版续命：每局限一次，清除致死闸门并给短暂无敌。
 * 返回是否续命成功（调用方先做权益判定，owned=false 直接失败）。
 */
export function revive(s: GameState, owned: boolean): boolean {
  if (s.status !== 'dead' || s.reviveUsed || !owned) return false
  s.reviveUsed = true
  s.invincible = REVIVE_INVINCIBLE
  s.status = 'running'
  s.deathAt = null
  // 移除身前一小段闸门（含撞死那扇），给玩家反应窗口
  for (const g of s.gates) {
    if (!g.passed && g.u >= s.distance - 2 && g.u <= s.distance + 4) g.passed = true
  }
  pushEvent(s, 'revive')
  return true
}

function pushEvent(s: GameState, e: GameEvent): void {
  if (!s.events.includes(e)) s.events.push(e)
}

function multiplierFor(combo: number): number {
  return Math.min(MULTI_CAP, 1 + Math.floor(combo / 2))
}

function ensureGenerated(s: GameState, untilU: number): void {
  const r = rngOf(s)
  while (s.nextGateU < untilU) {
    let u = s.nextGateU
    if (twistEnabledAt(u)) u = nudgeAwayFromTwist(u)
    const wallFace: Face = r() < 0.5 ? 0 : 1
    const gate: Gate = { u, wallFace, kind: 'solid', passed: false }
    s.gates.push(gate)
    const gap = gateGapAt(u, r())
    s.nextGateU = u + Math.max(14, gap)
  }
  while (s.nextShardU < untilU) {
    let u = s.nextShardU
    // 光屑也避开平滑扭转区，避免换面瞬间对错面歧义
    if (twistEnabledAt(u) && inTwistZone(u)) {
      const k = Math.floor((u - 150) / TWIST_PERIOD)
      u = 150 + k * TWIST_PERIOD + 18 + 2
    }
    const face: Face = r() < 0.5 ? 0 : 1
    const shard: Shard = { u, face, taken: false, passed: false }
    s.shards.push(shard)
    s.nextShardU = u + 8 + r() * 6
  }
}

function twistAheadOf(s: GameState): number | null {
  if (!twistEnabledAt(s.distance) && s.distance < TUTORIAL_DIST) {
    return 150 - s.distance <= 45 ? 150 - s.distance : null
  }
  const start = nextTwistStart(s.distance, 45)
  return start === null ? null : start - s.distance
}

/**
 * 推进固定步长。直接就地更新 s 并返回（引擎 120Hz 调用；测试可断言返回值）。
 * 非 running 状态不推进。
 */
export function step(s: GameState, dt: number = STEP): GameState {
  if (s.status !== 'running') {
    s.events = []
    return s
  }
  s.events = []
  const prevD = s.distance
  const d = prevD + s.speed * dt
  if (s.invincible > 0) s.invincible = Math.max(0, s.invincible - dt)
  s.distance = d
  s.speed = speedAt(d)

  // —— 半扭转：进入/离开平滑扭转区，离开瞬间两面真正对调 ——
  const twistOn = twistEnabledAt(d)
  const wasIn = s.inTwist
  const nowIn = twistOn && inTwistZone(d)
  if (!wasIn && nowIn) pushEvent(s, 'twist-in')
  if (wasIn && !nowIn) {
    s.face = otherFace(s.face)
    pushEvent(s, 'twist-out')
  }
  s.inTwist = nowIn

  // —— 闸门碰撞 / 穿门评分 ——
  for (const g of s.gates) {
    if (g.passed) continue
    if (Math.abs(g.u - d) <= GATE_HALF) {
      if (s.face === g.wallFace) {
        if (s.invincible > 0) {
          g.passed = true // 续命无敌期安全穿过
          continue
        }
        // 撞墙死亡
        g.passed = true
        s.status = 'dead'
        s.deathAt = d
        s.combo = 0
        s.multiplier = 1
        pushEvent(s, 'death')
        recycle(s, d)
        return s
      }
      // 正确面穿过：按翻转时机给风格判定
      g.passed = true
      const gap = g.u - s.lastFlipU
      let gained: number
      if (gap >= 0 && gap <= PERFECT_WIN) {
        s.combo += 3
        pushEvent(s, 'perfect')
        gained = 40
      } else if (gap >= 0 && gap <= NEAR_WIN) {
        s.combo += 2
        pushEvent(s, 'near')
        gained = 20
      } else {
        s.combo += 1
        pushEvent(s, 'gate')
        gained = 10
      }
      s.multiplier = multiplierFor(s.combo)
      s.score += gained * s.multiplier
    } else if (g.u < d - GATE_HALF) {
      g.passed = true // 越过但未在窗口（理论上被上面兜住，保险）
    }
  }

  // —— 光屑收集 ——
  for (const sh of s.shards) {
    if (sh.passed) continue
    if (Math.abs(sh.u - d) <= PICKUP_HALF) {
      if (!sh.taken && s.face === sh.face) {
        sh.taken = true
        s.shardsRun += 1
        s.score += 5 * s.multiplier
        pushEvent(s, 'collect')
      }
    } else if (sh.u < d - PICKUP_HALF) {
      sh.passed = true
    }
  }

  // —— 里程分 ——
  s.score += s.speed * dt * 0.2

  recycle(s, d)
  ensureGenerated(s, d + LOOKAHEAD)
  s.twistAhead = twistAheadOf(s)
  return s
}

function recycle(s: GameState, d: number): void {
  if (s.gates.some((g) => !g.passed && g.u < d - RECYCLE_BEHIND)) {
    s.gates = s.gates.filter((g) => g.u > d - RECYCLE_BEHIND)
  } else {
    s.gates = s.gates.filter((g) => g.u > d - RECYCLE_BEHIND)
  }
  s.shards = s.shards.filter((sh) => sh.u > d - RECYCLE_BEHIND)
}

/** 引擎/测试用：当前整数分 */
export function displayScore(s: GameState): number {
  return Math.floor(s.score)
}

export { MULTI_CAP, GATE_HALF, PERFECT_WIN, NEAR_WIN, LOOKAHEAD }
