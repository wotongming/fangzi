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
  /** 谱面模式下该音符对应的 MIDI 音高（命中即奏响）；随机模式为空。 */
  midi?: number | null
}

/** 谱面事件：在 spawnAt 时刻于顶部生成，预计在 arrival 时刻抵达判定线。 */
export interface ChartEvent {
  spawnAt: number
  arrival: number
  lane: number
  midi: number | null
}

export interface PulseState {
  notes: PulseNote[]
  score: number
  combo: number
  best: number
  misses: number
  over: boolean
  /** 是否因完整演奏完曲目而结束（true=通关，false=漏击失败）。 */
  win: boolean
  elapsed: number
  /** 下一次生成音符的时刻（秒）——随机模式使用。 */
  nextSpawn: number
  nextId: number
  /** 上一生成轨道，避免连续重复过于单调。 */
  lastLane: number
  /** random=原随机模式；song=按经典旋律谱面驱动。 */
  mode: 'random' | 'song'
  songName?: string
  /** 谱面模式：待生成的事件序列（已按 spawnAt 排序）。 */
  chart?: ChartEvent[]
  chartPos?: number
  /** 谱面模式恒定下落速度（归一化/秒）。 */
  fallV?: number
  /** 谱面事件是否已全部生成。 */
  spawnDone?: boolean
  /** 谱面全部音符离开判定区后判定通关的时刻。 */
  songEndAt?: number
}

export function newPulse(best = 0): PulseState {
  return {
    notes: [],
    score: 0,
    combo: 0,
    best,
    misses: 0,
    over: false,
    win: false,
    elapsed: 0,
    nextSpawn: 0.5,
    nextId: 1,
    lastLane: -1,
    mode: 'random'
  }
}

/** 音符从顶部生成到抵达判定线的固定旅行时间（秒），保证谱面节奏公平。 */
export const CHART_TRAVEL = 1.6
/** 曲目开始前的准备时间（秒）。 */
export const CHART_LEAD = 1.8
/** 最后一个音符到达后多久判定整曲结束（秒）。 */
export const CHART_TAIL = 1.4

/**
 * 将一首公有领域旋律编译成三轨下落谱面：
 * 音高按整首音域三等分映射到 3 条轨道（音越高轨道编号越大），休止符只空拍不生成音符。
 */
export function buildChart(
  seq: Array<[number | null, number]>,
  beatSec: number
): { events: ChartEvent[] } {
  const sounded = seq.filter((n): n is [number, number] => n[0] != null).map((n) => n[0] as number)
  const lo = Math.min(...sounded)
  const hi = Math.max(...sounded)
  const span = hi - lo
  const laneOf = (midi: number): number => {
    if (span <= 0) return 1
    const lane = Math.floor(((midi - lo) / (span + 1)) * LANES)
    return Math.max(0, Math.min(LANES - 1, lane))
  }
  const events: ChartEvent[] = []
  let t = CHART_LEAD
  for (const [midi, beats] of seq) {
    const dur = Math.max(0.08, beats * beatSec)
    if (midi != null) {
      events.push({ spawnAt: t - CHART_TRAVEL, arrival: t, lane: laneOf(midi), midi })
    }
    t += dur
  }
  return { events }
}

/** 以某首经典旋律开始一局谱面模式。 */
export function newPulseFromSong(
  best: number,
  songName: string,
  seq: Array<[number | null, number]>,
  beatSec: number
): PulseState {
  const s = newPulse(best)
  s.mode = 'song'
  s.songName = songName
  const { events } = buildChart(seq, beatSec)
  s.chart = events
  s.chartPos = 0
  s.fallV = (HIT_Y + 0.04) / CHART_TRAVEL
  s.spawnDone = false
  s.songEndAt = events.length
    ? events[events.length - 1]!.arrival + CHART_TAIL
    : CHART_LEAD + CHART_TAIL
  return s
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

  let v: number
  if (state.mode === 'song') {
    v = state.fallV ?? (HIT_Y + 0.04) / CHART_TRAVEL
    // 按谱面事件时间点生成
    const chart = state.chart ?? []
    while ((state.chartPos ?? 0) < chart.length && chart[state.chartPos!]!.spawnAt <= state.elapsed) {
      const ev = chart[state.chartPos!]!
      const note: PulseNote = { id: state.nextId++, lane: ev.lane, y: -0.04, midi: ev.midi }
      state.notes.push(note)
      res.spawned.push(note)
      state.lastLane = ev.lane
      state.chartPos = (state.chartPos ?? 0) + 1
    }
    if ((state.chartPos ?? 0) >= chart.length) state.spawnDone = true
  } else {
    // 随机模式生成
    while (state.elapsed >= state.nextSpawn) {
      const lane = pickLane(state)
      const note: PulseNote = { id: state.nextId++, lane, y: -0.04 }
      state.notes.push(note)
      res.spawned.push(note)
      state.lastLane = lane
      state.nextSpawn += intervalAt(state.elapsed)
    }
    v = speedAt(state.elapsed)
  }

  // 下落
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
    // 随机模式漏满即结束；谱面模式允许带着少量漏击演奏完整首曲目（不因失误中途打断）。
    if (state.mode === 'random' && state.misses >= MAX_MISS) {
      state.over = true
      if (state.score > state.best) state.best = state.score
    }
  }

  // 谱面模式：全部音符处理完且过了尾音 → 通关
  if (state.mode === 'song' && state.spawnDone && state.notes.length === 0 &&
      state.elapsed >= (state.songEndAt ?? state.elapsed)) {
    state.over = true
    state.win = true
    if (state.score > state.best) state.best = state.score
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
