/**
 * 霓虹脉冲（Neon Pulse）—— 单指节奏光轨纯逻辑（无 DOM / 无引擎，可直接单测）。
 *
 * 坐标：纵向 y 归一化 0（顶）→1（底），音符由顶部下落，在固定判定线命中。
 * 全部为确定性纯函数；组件只负责 RAF 驱动、渲染与输入。
 */

export const LANES = 3
/** 判定线位置（距顶比例）。 */
export const HIT_Y = 0.82
/** 完美 / 良好判定半窗（归一化纵向距离）。 */
export const PERFECT_W = 0.05
export const GOOD_W = 0.1
/** 超过该 y 仍未命中记为 miss 并移除。 */
export const MISS_Y = HIT_Y + GOOD_W + 0.03
/** 累计 miss 达到即结束本局。 */
export const MAX_MISS = 3

export const PERFECT_SCORE = 100
export const GOOD_SCORE = 60
export const COMBO_BONUS = 2 // 每连击额外加分

export interface PulseNote {
  id: number
  lane: number
  y: number
}

export interface PulseState {
  notes: PulseNote[]
  score: number
  combo: number
  best: number
  misses: number
  over: boolean
  elapsed: number
  /** 下一次生成音符的时刻（秒）。 */
  nextSpawn: number
  nextId: number
  /** 上一生成轨道，避免连续重复过于单调。 */
  lastLane: number
}

export function newPulse(best = 0): PulseState {
  return {
    notes: [],
    score: 0,
    combo: 0,
    best,
    misses: 0,
    over: false,
    elapsed: 0,
    nextSpawn: 0.5,
    nextId: 1,
    lastLane: -1
  }
}

/** 下落速度（归一化/秒），随时间从 0.42 缓增到 0.9。 */
export function speedAt(elapsed: number): number {
  return Math.min(0.9, 0.42 + elapsed * 0.012)
}

/** 生成间隔（秒），随时间从 0.62 缩到 0.34。 */
export function intervalAt(elapsed: number): number {
  return Math.max(0.34, 0.62 - elapsed * 0.006)
}

function pickLane(state: PulseState): number {
  // 60% 概率换一条轨道，其余随机，避免太难也避免死板。
  let lane = Math.floor(Math.random() * LANES)
  if (lane === state.lastLane && Math.random() < 0.7) {
    lane = (lane + 1 + Math.floor(Math.random() * (LANES - 1))) % LANES
  }
  return lane
}

export interface UpdateResult {
  /** 本帧越过底线的漏击数。 */
  missed: number
  /** 本帧新生成的音符（用于在顶部播放轻微脉冲）。 */
  spawned: PulseNote[]
}

/** 推进一帧：生成、下落、漏击判定。结束后调用为 no-op。 */
export function update(state: PulseState, dt: number): UpdateResult {
  const res: UpdateResult = { missed: 0, spawned: [] }
  if (state.over || dt <= 0) return res
  state.elapsed += dt

  // 生成
  while (state.elapsed >= state.nextSpawn) {
    const lane = pickLane(state)
    const note: PulseNote = { id: state.nextId++, lane, y: -0.04 }
    state.notes.push(note)
    res.spawned.push(note)
    state.lastLane = lane
    state.nextSpawn += intervalAt(state.elapsed)
  }

  // 下落
  const v = speedAt(state.elapsed)
  const remain: PulseNote[] = []
  for (const n of state.notes) {
    n.y += v * dt
    if (n.y > MISS_Y) {
      res.missed++
    } else {
      remain.push(n)
    }
  }
  state.notes = remain
  if (res.missed > 0) {
    state.misses += res.missed
    state.combo = 0
    if (state.misses >= MAX_MISS) {
      state.over = true
      if (state.score > state.best) state.best = state.score
    }
  }
  return res
}

export type HitKind = 'perfect' | 'good' | 'empty'

export interface HitResult {
  kind: HitKind
  note?: PulseNote
  gained: number
}

/**
 * 击打某轨道：取该轨道内最靠近判定线且在 GOOD 窗内的音符。
 * 不惩罚空击（kind='empty'），避免移动端误触扣分。
 */
export function hitLane(state: PulseState, lane: number): HitResult {
  if (state.over) return { kind: 'empty', gained: 0 }
  let best: PulseNote | null = null
  let bestDist = Infinity
  for (const n of state.notes) {
    if (n.lane !== lane) continue
    const d = Math.abs(n.y - HIT_Y)
    if (d <= GOOD_W && d < bestDist) {
      best = n
      bestDist = d
    }
  }
  if (!best) return { kind: 'empty', gained: 0 }
  const perfect = bestDist <= PERFECT_W
  state.notes = state.notes.filter((n) => n.id !== best!.id)
  state.combo += 1
  const gained = (perfect ? PERFECT_SCORE : GOOD_SCORE) + (state.combo - 1) * COMBO_BONUS
  state.score += gained
  if (state.score > state.best) state.best = state.score
  return { kind: perfect ? 'perfect' : 'good', note: best, gained }
}
