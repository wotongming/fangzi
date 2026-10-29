/**
 * 《星脉》（starvein）—— 单文件自包含内核。
 *
 * 玩法：单指在程序化生的星辰网络上拖出光脉，赶在从核心蔓延的黑暗潮汐之前点亮星星；
 * 在节点脉冲（BPM 节拍）瞬间穿过 = PERFECT（粒子 + 五声音阶音符 + combo），窗外 = GOOD。
 * 可随时把光脉引到出口门收线，得分 ×1.5。
 *
 * 纯逻辑（星图生成 / 节拍判定 / combo / 潮汐蔓延 / 收线 / 评级 / 快照序列化校验）全部
 * 导出为无 DOM 纯函数，供 node:test 直接断言；mount/destroy 只负责 Canvas2D 渲染、
 * Pointer 输入、音频映射与自动快照。零图片 / 零音频文件 / 零第三方运行时依赖。
 */
import { NeonAudio, haptic } from '../../../audio/synth'

// —— 常量（存储键红线：独立，不串任何其它游戏）——
export const TOOL_ID = 'starvein'
export const AUTO_SAVE_KEY = 'fangzi:starvein:auto-save:v1'
export const SAVE_VERSION = 1
export const CHAIN_ID = 'starvein:run:v1'

export const WORLD_W = 1000
export const WORLD_H = 1500
export const MAX_ENERGY = 5
export const NODE_R = 26
export const LATHER_R = 46 // 光脉扫过判定半径
export const EXIT_R = 52
export const COMBO_SCORE_STEP = 0.1 // 每级 combo 增 10%
export const EXIT_MULT = 1.5

export type Phase = 'intro' | 'resume' | 'play' | 'result'
export type NodeRole = 'core' | 'exit' | 'star'
export type Grade = 'S' | 'A' | 'B' | 'C'

export interface VeinNode {
  id: number
  x: number
  y: number
  role: NodeRole
}
export interface StarMap {
  seed: number
  nodes: VeinNode[]
  edges: [number, number][]
  core: number
  exit: number
}

export interface StageSpec {
  stage: number
  nodeCount: number
  bpm: number
  windowMs: number
  tideSpeed: number // 节点/秒
}

/** 难度曲线：局数段 → 节点数 / BPM / PERFECT 窗口 / 潮汐速度。 */
export function stageForRun(run: number): StageSpec {
  if (run <= 2) return { stage: 1, nodeCount: 12, bpm: 100, windowMs: 180, tideSpeed: 0.55 }
  if (run <= 5) return { stage: 2, nodeCount: 20, bpm: 110, windowMs: 150, tideSpeed: 0.8 }
  return { stage: 3, nodeCount: 28, bpm: 120, windowMs: 120, tideSpeed: 1.1 }
}

// —— 确定性 PRNG ——
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 两点间距离。 */
export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by)
}

/** 点到线段最短距离。 */
export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return dist(px, py, ax, ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return dist(px, py, ax + t * dx, ay + t * dy)
}

/**
 * 确定性生成星图：核心在底部、出口在顶部，先强制铺一条核心→出口通路（BFS 可证明），
 * 再在邻近节点间补边形成稀疏网络。保证“永远存在一条可走的下限路线”。
 */
export function generateStarMap(seed: number, stage: number): StarMap {
  const spec = stageForRun(Math.max(1, stage))
  const rand = mulberry32(seed)
  const nodes: VeinNode[] = []
  const core: VeinNode = { id: 0, x: WORLD_W / 2, y: 1380, role: 'core' }
  const exit: VeinNode = { id: 1, x: WORLD_W / 2, y: 120, role: 'exit' }
  nodes.push(core, exit)

  const stars: VeinNode[] = []
  let guard = 0
  while (stars.length < spec.nodeCount - 2 && guard < 2000) {
    guard++
    const x = 130 + rand() * (WORLD_W - 260)
    const y = 240 + rand() * 1040
    if (stars.every((s) => dist(x, y, s.x, s.y) > 128)) stars.push({ id: nodes.length + stars.length, x, y, role: 'star' })
  }
  nodes.push(...stars)

  // 强制通路：从核心出发，贪心跳选“更靠近出口方向”的未用星，直到出口。
  const used = new Set<number>([0, 1])
  const path: number[] = [0]
  let cx = core.x
  let cy = core.y
  for (;;) {
    const candidates = stars.filter((s) => !used.has(s.id))
    if (!candidates.length) break
    candidates.sort(
      (a, b) =>
        dist(a.x, a.y, exit.x, exit.y) - dist(cx, cy, a.x, a.y) * 0.3 -
        (dist(b.x, b.y, exit.x, exit.y) - dist(cx, cy, b.x, b.y) * 0.3)
    )
    const next = candidates[0]!
    // 通路节点必须大致向上（y 递减），避免环路
    if (next.y > cy - 60 && path.length > 1) break
    used.add(next.id)
    path.push(next.id)
    cx = next.x
    cy = next.y
  }
  path.push(1)

  const edgeSet = new Set<string>()
  const edges: [number, number][] = []
  const addEdge = (a: number, b: number) => {
    const k = a < b ? `${a}-${b}` : `${b}-${a}`
    if (a === b || edgeSet.has(k)) return
    edgeSet.add(k)
    edges.push([a, b])
  }
  for (let i = 0; i < path.length - 1; i++) addEdge(path[i]!, path[i + 1]!)

  // 邻近补边（稀疏网络，度数 ≤4）
  const deg = new Map<number, number>()
  for (const a of nodes) {
    for (const b of nodes) {
      if (a.id >= b.id) continue
      if (dist(a.x, a.y, b.x, b.y) < 300 && (deg.get(a.id) ?? 0) < 4 && (deg.get(b.id) ?? 0) < 4) {
        addEdge(a.id, b.id)
        deg.set(a.id, (deg.get(a.id) ?? 0) + 1)
        deg.set(b.id, (deg.get(b.id) ?? 0) + 1)
      }
    }
  }

  const map: StarMap = { seed, nodes, edges, core: 0, exit: 1 }
  // 不变量自检：生成结果必须可 BFS 通到出口，否则换 seed（调用方保证）
  if (!bfsPath(map)) {
    return generateStarMap(seed + 101, stage)
  }
  return map
}

/** BFS：核心→出口的最短（按边数）通路；不可达返回 null。 */
export function bfsPath(map: StarMap): number[] | null {
  const adj = new Map<number, number[]>()
  for (const [a, b] of map.edges) {
    adj.set(a, [...(adj.get(a) ?? []), b])
    adj.set(b, [...(adj.get(b) ?? []), a])
  }
  const prev = new Map<number, number>()
  const q: number[] = [map.core]
  const seen = new Set<number>([map.core])
  while (q.length) {
    const cur = q.shift()!
    if (cur === map.exit) {
      const path = [cur]
      let p = prev.get(cur)
      while (p !== undefined) {
        path.unshift(p)
        p = prev.get(p)
      }
      return path
    }
    for (const n of adj.get(cur) ?? []) {
      if (!seen.has(n)) {
        seen.add(n)
        prev.set(n, cur)
        q.push(n)
      }
    }
  }
  return null
}

/** 运行时钟 nowSec 到最近一个节拍中心的偏移（毫秒，非负）。 */
export function nearestBeatOffsetMs(nowSec: number, bpm: number): number {
  const period = 60 / bpm
  const t = ((nowSec % period) + period) % period
  const off = Math.min(t, period - t)
  return off * 1000
}

/** 节拍判定：窗口内 = PERFECT，否则 GOOD。 */
export function judge(nowSec: number, bpm: number, windowMs: number): 'perfect' | 'good' {
  return nearestBeatOffsetMs(nowSec, bpm) <= windowMs ? 'perfect' : 'good'
}

/** 潮汐前沿（沿图距已吞掉的“层级”）。boostUntilSec 之前 +30%（犹豫惩罚）。 */
export function tideFront(nowSec: number, spec: StageSpec, boostUntilSec: number): number {
  const speed = spec.tideSpeed * (nowSec < boostUntilSec ? 1.3 : 1)
  return Math.max(0, nowSec) * speed
}

/** 评级：点亮率 × PERFECT 率。 */
export function gradeOf(litRatio: number, perfectRate: number): Grade {
  if (litRatio >= 0.8 && perfectRate >= 0.6) return 'S'
  if (litRatio >= 0.6 && perfectRate >= 0.4) return 'A'
  if (litRatio >= 0.35) return 'B'
  return 'C'
}

/** 单个节点得分：基础分 × combo 倍率；PERFECT 额外 +50。返回新 combo。 */
export function addNodeScore(
  score: number,
  combo: number,
  isPerfect: boolean
): { score: number; combo: number } {
  const nextCombo = isPerfect ? combo + 1 : combo
  const mult = 1 + COMBO_SCORE_STEP * nextCombo
  const gain = (100 + (isPerfect ? 50 : 0)) * mult
  return { score: score + gain, combo: nextCombo }
}

// —— 快照（独立键，损坏/版本不符安全回退）——
export interface SavePayload {
  version: number
  tool: string
  chain: string
  seed: number
  stage: number
  run: number
  t: number
  score: number
  combo: number
  maxCombo: number
  energy: number
  lit: Record<number, 'perfect' | 'good'>
  swallowed: Record<number, boolean>
  savedAt: number
}

export function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

export function serializeSave(state: {
  seed: number
  stage: number
  run: number
  t: number
  score: number
  combo: number
  maxCombo: number
  energy: number
  lit: Record<number, 'perfect' | 'good'>
  swallowed: Record<number, boolean>
}, savedAt: number = Date.now()): SavePayload {
  return {
    version: SAVE_VERSION,
    tool: TOOL_ID,
    chain: CHAIN_ID,
    seed: state.seed,
    stage: state.stage,
    run: state.run,
    t: state.t,
    score: state.score,
    combo: state.combo,
    maxCombo: state.maxCombo,
    energy: state.energy,
    lit: state.lit,
    swallowed: state.swallowed,
    savedAt
  }
}

export function validateSave(raw: unknown): SavePayload | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.version !== SAVE_VERSION || r.tool !== TOOL_ID || r.chain !== CHAIN_ID) return null
  if (!isFiniteNum(r.seed) || !isFiniteNum(r.stage) || !isFiniteNum(r.run)) return null
  if (!isFiniteNum(r.t) || !isFiniteNum(r.score) || !isFiniteNum(r.energy)) return null
  const lit = r.lit
  const swallowed = r.swallowed
  if (typeof lit !== 'object' || lit === null || typeof swallowed !== 'object' || swallowed === null) return null
  return r as unknown as SavePayload
}

// —— mount（渲染 / 输入 / 音频 / 自动快照）——

export interface MountOptions {
  onScore?: (v: number) => void
  onCombo?: (v: number) => void
  onGameover?: () => void
  muted?: boolean
  vibrate?: boolean
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  color: string
}

interface RunState {
  seed: number
  stage: number
  run: number
  t: number
  score: number
  combo: number
  maxCombo: number
  energy: number
  lit: Record<number, 'perfect' | 'good'>
  swallowed: Record<number, boolean>
  vein: { x: number; y: number }[]
  drawing: boolean
  boostUntil: number
  finished: boolean
  resultGrade: Grade
  particles: Particle[]
}

export interface VeinHandle {
  setPaused: (p: boolean) => void
  setMuted: (m: boolean) => void
  destroy: () => void
  clearAutoSave: () => void
  reset: () => void
  autoSaveNow: () => void
  resumeAuto: () => void
  discardAuto: () => void
  forceSave: () => void
  debug: {
    phase: () => Phase
    state: () => Record<string, number | string>
    getMap: () => StarMap
    coreScreen: () => { x: number; y: number }
    nodeScreen: (id: number) => { x: number; y: number }
    fps: () => number
    forceExit: () => void
    setStage: (n: number) => void
  }
}

function freshRun(seed: number, stage: number, run: number, saved?: Partial<RunState>): RunState {
  return {
    seed,
    stage,
    run,
    t: 0,
    score: 0,
    combo: 0,
    maxCombo: 0,
    energy: MAX_ENERGY,
    lit: {},
    swallowed: {},
    vein: [],
    drawing: false,
    boostUntil: -1,
    finished: false,
    resultGrade: 'C',
    particles: [],
    ...saved
  }
}

export function mount(canvas: HTMLCanvasElement, opts: MountOptions = {}): VeinHandle {
  const maybeCtx = canvas.getContext('2d')
  if (!maybeCtx) throw new Error('no 2d context')
  const ctx: CanvasRenderingContext2D = maybeCtx
  const audio = new NeonAudio()
  audio.setMuted(!!opts.muted)

  let phase: Phase = 'intro'
  let map: StarMap = generateStarMap(1, 1)
  let s: RunState = freshRun(1, 1, 1)
  let paused = false
  let raf = 0
  let lastTs = 0
  let fps = 60
  let fpsCount = 0
  let fpsTime = 0
  let saved: SavePayload | null = null

  // 视图变换
  let cw = 0
  let ch = 0
  let dpr = 1
  let scale = 1
  let ox = 0
  let oy = 0

  function resize(): void {
    dpr = Math.min(2, window.devicePixelRatio || 1)
    cw = canvas.clientWidth
    ch = canvas.clientHeight
    canvas.width = Math.max(1, Math.round(cw * dpr))
    canvas.height = Math.max(1, Math.round(ch * dpr))
    scale = Math.min(cw / WORLD_W, ch / WORLD_H)
    ox = (cw - WORLD_W * scale) / 2
    oy = (ch - WORLD_H * scale) / 2
  }
  resize()
  const ro = new ResizeObserver(resize)
  ro.observe(canvas)

  function toScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: ox + wx * scale, y: oy + wy * scale }
  }
  function toWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - ox) / scale, y: (sy - oy) / scale }
  }

  // —— 快照 ——
  function persist(): void {
    try {
      const p = serializeSave(s)
      localStorage.setItem(AUTO_SAVE_KEY, JSON.stringify(p))
    } catch {
      /* ignore */
    }
  }
  function clearSave(): void {
    try {
      localStorage.removeItem(AUTO_SAVE_KEY)
    } catch {
      /* ignore */
    }
  }
  function tryLoad(): void {
    try {
      const raw = localStorage.getItem(AUTO_SAVE_KEY)
      if (!raw) return
      saved = validateSave(JSON.parse(raw))
      if (saved) phase = 'resume'
    } catch {
      saved = null
    }
  }
  tryLoad()

  function startRun(stage: number, run?: number): void {
    const r = run ?? Math.min(3, s.run)
    const seed = (Date.now() % 100000) + stage * 7919
    map = generateStarMap(seed, stage)
    s = freshRun(seed, stage, r)
    phase = 'play'
  }
  function resumeRun(): void {
    if (!saved) return
    map = generateStarMap(saved.seed, saved.stage)
    s = freshRun(saved.seed, saved.stage, saved.run, {
      t: saved.t,
      score: saved.score,
      combo: saved.combo,
      maxCombo: saved.maxCombo,
      energy: saved.energy,
      lit: saved.lit,
      swallowed: saved.swallowed
    })
    phase = 'play'
  }

  function finishRun(): void {
    if (s.finished) return
    // 收线 ×1.5
    s.score = Math.round(s.score * EXIT_MULT)
    const litCount = Object.keys(s.lit).length
    const perfectCount = Object.values(s.lit).filter((v) => v === 'perfect').length
    const litRatio = litCount / (map.nodes.length - 2)
    const perfectRate = litCount ? perfectCount / litCount : 0
    s.resultGrade = gradeOf(litRatio, perfectRate)
    s.finished = true
    phase = 'result'
    audio.explode(1)
    opts.onScore?.(s.score)
    opts.onGameover?.()
    clearSave()
  }

  // —— 潮汐：BFS 深度 ≤ 前沿 → 吞掉未点亮节点 ——
  function stepTide(): void {
    const spec = stageForRun(s.run)
    const front = tideFront(s.t, spec, s.boostUntil)
    const adj = new Map<number, number[]>()
    for (const [a, b] of map.edges) {
      adj.set(a, [...(adj.get(a) ?? []), b])
      adj.set(b, [...(adj.get(b) ?? []), a])
    }
    const depth = new Map<number, number>([[map.core, 0]])
    const q = [map.core]
    while (q.length) {
      const cur = q.shift()!
      for (const n of adj.get(cur) ?? []) {
        if (depth.has(n)) continue
        if (s.lit[n] || s.swallowed[n]) continue
        depth.set(n, (depth.get(cur) ?? 0) + 1)
        q.push(n)
      }
    }
    for (const node of map.nodes) {
      if (node.role === 'core' || s.lit[node.id] || s.swallowed[node.id]) continue
      const d = depth.get(node.id) ?? Infinity
      if (d <= front && !s.swallowed[node.id]) {
        s.swallowed[node.id] = true
        s.energy -= 1
        audio.hit(false)
        if (s.energy <= 0) {
          s.energy = 0
          finishRun()
          return
        }
      }
    }
  }

  // —— 点亮判定：光脉折线扫过未点亮节点 ——
  function checkLight(wx: number, wy: number): void {
    if (s.finished) return
    const spec = stageForRun(s.run)
    // 到达出口 → 收线
    if (dist(wx, wy, map.nodes[map.exit]!.x, map.nodes[map.exit]!.y) < EXIT_R) {
      finishRun()
      return
    }
    for (const node of map.nodes) {
      if (node.role === 'core' || s.lit[node.id] || s.swallowed[node.id]) continue
      const last = s.vein[s.vein.length - 2]
      const cur = s.vein[s.vein.length - 1]
      if (!last || !cur) continue
      if (distToSegment(node.x, node.y, last.x, last.y, cur.x, cur.y) > LATHER_R) continue
      const j = judge(s.t, spec.bpm, spec.windowMs)
      const isPerfect = j === 'perfect'
      const before = s.score
      const r = addNodeScore(before, s.combo, isPerfect)
      s.score = Math.round(r.score)
      s.combo = r.combo
      s.maxCombo = Math.max(s.maxCombo, s.combo)
      s.lit[node.id] = isPerfect ? 'perfect' : 'good'
      if (isPerfect) {
        const penta = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51]
        audio.tone(penta[Math.min(penta.length - 1, s.combo - 1)]!, true)
        haptic(24, opts.vibrate ?? true)
        burst(node.x, node.y, '#5ef2ff')
      }
      opts.onScore?.(s.score)
      opts.onCombo?.(s.combo)
    }
  }

  function burst(x: number, y: number, color: string): void {
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = 40 + Math.random() * 160
      s.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 1,
        color
      })
    }
  }

  // —— 输入 ——
  function ptrPos(e: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  function onDown(e: PointerEvent): void {
    e.preventDefault()
    audio.ensure()
    if (phase === 'intro') {
      startRun(1, 1)
      return
    }
    if (phase === 'resume') {
      resumeRun()
      return
    }
    if (phase === 'result') {
      startRun(Math.min(3, s.stage), s.run + 1)
      return
    }
    if (paused || s.finished) return
    // 从最近已点亮节点起笔
    const p = ptrPos(e)
    const w = toWorld(p.x, p.y)
    let startId = map.core
    let best = Infinity
    for (const node of map.nodes) {
      if (!s.lit[node.id] && node.role !== 'core') continue
      const d = dist(w.x, w.y, node.x, node.y)
      if (d < best) {
        best = d
        startId = node.id
      }
    }
    s.vein = [{ x: map.nodes[startId]!.x, y: map.nodes[startId]!.y }, w]
    s.drawing = true
  }
  function onMove(e: PointerEvent): void {
    if (!s.drawing || paused || s.finished) return
    e.preventDefault()
    const p = ptrPos(e)
    const w = toWorld(p.x, p.y)
    const last = s.vein[s.vein.length - 1]
    if (last && dist(w.x, w.y, last.x, last.y) < 6) return
    s.vein.push(w)
    checkLight(w.x, w.y)
  }
  function onUp(): void {
    if (!s.drawing) return
    s.drawing = false
    s.combo = 0 // 抬手断 combo（节奏不连续）
    s.boostUntil = s.t + 1.5 // 犹豫惩罚：潮汐短暂加速
  }
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onUp)

  // hidden / pagehide 自动快照
  function onHide(): void {
    if (phase === 'play' && !s.finished) persist()
  }
  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('pagehide', onHide)
  let saveTimer = window.setInterval(() => {
    if (phase === 'play' && !s.finished) persist()
  }, 15000)

  // —— 渲染 ——
  function draw(): void {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    // 背景
    const bg = ctx.createLinearGradient(0, 0, 0, ch)
    bg.addColorStop(0, '#070a1a')
    bg.addColorStop(1, '#0d1030')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, cw, ch)

    // 星尘
    const rand = mulberry32(map.seed)
    ctx.fillStyle = 'rgba(180,210,255,0.5)'
    for (let i = 0; i < 60; i++) {
      const x = rand() * cw
      const y = rand() * ch
      ctx.fillRect(x, y, 1.5, 1.5)
    }

    if (phase === 'intro') {
      drawTitle('星脉', '按住拖动，画亮星星\n在它跳动的瞬间穿过 —— 更亮')
      return
    }
    if (phase === 'resume') {
      drawTitle('继续上一局？', '点屏幕继续　·　再点一下从新局开始')
      return
    }

    // 边
    ctx.lineWidth = 1.5
    for (const [a, b] of map.edges) {
      const na = map.nodes[a]!
      const nb = map.nodes[b]!
      const pa = toScreen(na.x, na.y)
      const pb = toScreen(nb.x, nb.y)
      ctx.strokeStyle = 'rgba(120,150,220,0.18)'
      ctx.beginPath()
      ctx.moveTo(pa.x, pa.y)
      ctx.lineTo(pb.x, pb.y)
      ctx.stroke()
    }

    const spec = stageForRun(s.run)
    // 节点
    for (const node of map.nodes) {
      const p = toScreen(node.x, node.y)
      const r = NODE_R * scale
      const isCore = node.role === 'core'
      const isExit = node.role === 'exit'
      const isLit = !!s.lit[node.id]
      const isSw = !!s.swallowed[node.id]
      if (isSw) {
        ctx.fillStyle = 'rgba(120,40,60,0.9)'
        ctx.beginPath()
        ctx.arc(p.x, p.y, r * 0.8, 0, Math.PI * 2)
        ctx.fill()
        continue
      }
      // 脉冲环（星星按节拍）
      if (node.role === 'star') {
        const off = nearestBeatOffsetMs(s.t, spec.bpm) / spec.windowMs
        const pulse = Math.max(0, 1 - off)
        ctx.strokeStyle = `rgba(94,242,255,${0.25 + pulse * 0.5})`
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(p.x, p.y, r + pulse * 14 * scale, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.shadowBlur = isLit ? 18 : 6
      ctx.shadowColor = isExit ? '#7dffb0' : isCore ? '#5ef2ff' : isLit ? (s.lit[node.id] === 'perfect' ? '#5ef2ff' : '#9fb4ff') : '#3a4a7a'
      ctx.fillStyle = isExit ? '#7dffb0' : isCore ? '#5ef2ff' : isLit ? '#cfefff' : '#2a3560'
      ctx.beginPath()
      ctx.arc(p.x, p.y, isExit ? r * 1.2 : r, 0, Math.PI * 2)
      ctx.fill()
      ctx.shadowBlur = 0
      if (isExit) {
        ctx.strokeStyle = 'rgba(125,255,176,0.8)'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(p.x, p.y, r * 1.5, 0, Math.PI * 2)
        ctx.stroke()
      }
    }

    // 光脉
    if (s.vein.length > 1) {
      ctx.strokeStyle = '#7df9ff'
      ctx.lineWidth = 4 * scale
      ctx.lineJoin = 'round'
      ctx.shadowBlur = 14
      ctx.shadowColor = '#5ef2ff'
      ctx.beginPath()
      const p0 = toScreen(s.vein[0]!.x, s.vein[0]!.y)
      ctx.moveTo(p0.x, p0.y)
      for (const v of s.vein.slice(1)) {
        const p = toScreen(v.x, v.y)
        ctx.lineTo(p.x, p.y)
      }
      ctx.stroke()
      ctx.shadowBlur = 0
    }

    // 粒子
    for (const pt of s.particles) {
      const p = toScreen(pt.x, pt.y)
      ctx.fillStyle = pt.color
      ctx.globalAlpha = Math.max(0, pt.life)
      ctx.beginPath()
      ctx.arc(p.x, p.y, 3 * scale, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1

    // HUD
    ctx.fillStyle = '#cfe6ff'
    ctx.font = `${Math.round(22 * scale + 10)}px system-ui`
    ctx.textBaseline = 'top'
    ctx.fillText(`分数 ${Math.round(s.score)}`, 16, 14)
    // 能量格
    for (let i = 0; i < MAX_ENERGY; i++) {
      ctx.fillStyle = i < s.energy ? '#5ef2ff' : 'rgba(90,110,160,0.4)'
      ctx.beginPath()
      ctx.arc(cw - 24 - i * 22, 26, 8, 0, Math.PI * 2)
      ctx.fill()
    }
    if (s.combo > 1) {
      ctx.fillStyle = '#ffd166'
      ctx.font = `bold ${Math.round(26 * scale + 12)}px system-ui`
      ctx.textAlign = 'center'
      ctx.fillText(`${s.combo} 连击`, cw / 2, 18)
      ctx.textAlign = 'left'
    }

    if (phase === 'result') {
      ctx.fillStyle = 'rgba(7,10,26,0.78)'
      ctx.fillRect(0, 0, cw, ch)
      ctx.fillStyle = '#7df9ff'
      ctx.textAlign = 'center'
      ctx.font = `bold ${Math.round(40 * scale + 18)}px system-ui`
      ctx.fillText(`${s.resultGrade} 级`, cw / 2, ch * 0.32)
      ctx.fillStyle = '#cfe6ff'
      ctx.font = `${Math.round(18 * scale + 8)}px system-ui`
      const litCount = Object.keys(s.lit).length
      ctx.fillText(`点亮 ${litCount} / ${map.nodes.length - 2}`, cw / 2, ch * 0.44)
      ctx.fillText(`最高分连击 ${s.maxCombo}　得分 ${Math.round(s.score)}`, cw / 2, ch * 0.5)
      ctx.fillStyle = 'rgba(160,200,255,0.8)'
      ctx.fillText('点屏幕再来一局', cw / 2, ch * 0.62)
      ctx.textAlign = 'left'
    }
  }

  function drawTitle(title: string, sub: string): void {
    ctx.fillStyle = '#7df9ff'
    ctx.textAlign = 'center'
    ctx.font = `bold ${Math.round(46 * scale + 20)}px system-ui`
    ctx.fillText(title, cw / 2, ch * 0.38)
    ctx.fillStyle = 'rgba(190,220,255,0.85)'
    ctx.font = `${Math.round(16 * scale + 8)}px system-ui`
    sub.split('\n').forEach((line, i) => ctx.fillText(line, cw / 2, ch * 0.48 + i * 30))
    ctx.fillStyle = 'rgba(125,249,255,0.7)'
    ctx.fillText('点屏幕开始', cw / 2, ch * 0.7)
    ctx.textAlign = 'left'
  }

  function loop(ts: number): void {
    raf = requestAnimationFrame(loop)
    const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0
    lastTs = ts
    fpsCount++
    fpsTime += dt
    if (fpsTime >= 0.5) {
      fps = fpsCount / fpsTime
      fpsCount = 0
      fpsTime = 0
    }
    if (!paused && phase === 'play' && !s.finished) {
      s.t += dt
      stepTide()
      // 粒子推进
      for (const p of s.particles) {
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.life -= dt * 1.6
      }
      s.particles = s.particles.filter((p) => p.life > 0)
    }
    draw()
  }
  raf = requestAnimationFrame(loop)

  return {
    setPaused: (p) => {
      paused = p
      if (p) audio.suspend()
      else audio.ensure()
    },
    setMuted: (m) => audio.setMuted(m),
    destroy: () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.clearInterval(saveTimer)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onHide)
      audio.close()
    },
    clearAutoSave: clearSave,
    reset: () => startRun(1, 1),
    autoSaveNow: persist,
    resumeAuto: resumeRun,
    discardAuto: () => {
      clearSave()
      startRun(1, s.run + 1)
    },
    forceSave: persist,
    debug: {
      phase: () => phase,
      state: () => ({
        score: Math.round(s.score),
        combo: s.combo,
        maxCombo: s.maxCombo,
        energy: s.energy,
        lit: Object.keys(s.lit).length,
        total: map.nodes.length - 2,
        stage: s.stage,
        grade: s.resultGrade,
        t: Number(s.t.toFixed(2))
      }),
      getMap: () => map,
      coreScreen: () => toScreen(map.nodes[map.core]!.x, map.nodes[map.core]!.y),
      nodeScreen: (id: number) => {
        const n = map.nodes[id]
        return n ? toScreen(n.x, n.y) : { x: 0, y: 0 }
      },
      fps: () => fps,
      forceExit: finishRun,
      setStage: (n) => startRun(n, n)
    }
  }
}
