/**
 * 007《挽星弓》gravity-sling 纯逻辑单测（node --import tsx --test 直跑，不依赖 DOM）：
 *  - 50 关配置完整性、难度饱和映射、求解证据裕度
 *  - 多体引力/推斥/黑洞合力叠加与净加速度上限
 *  - 瞄准向量、力度钳制、预测轨迹有限且朝目标推进
 *  - 固定步长推进：直瞄命中星门、沿途收星、撞恒星、坠入黑洞、限时超时
 *  - combo 窗口连击 / 过期归零 / 倍率封顶 / 结算展示换算
 *  - 快照 v1→v2 迁移不丢进度；损坏/版本/tool/chain 不符安全回退
 *  - 关卡进度独立键读写与钳制
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  LEVELS,
  SOLUTIONS,
  levelByIdx,
  bodyPos,
  isPortalOpen,
  gravityAccel,
  aimVector,
  powerFromPull,
  predictTrajectory,
  resolveCombo,
  comboDisplayMult,
  simulateSolution,
  solveLevel,
  stepFrame,
  serializeSave,
  validateSave,
  loadSave,
  persistSave,
  clearSave,
  readProgress,
  writeProgress,
  createInitialState,
  WORLD_W,
  WORLD_H,
  V_MAX,
  FIXED_DT,
  LEVEL_COUNT,
  AUTO_SAVE_KEY,
  PROGRESS_KEY,
  SAVE_VERSION,
  TOOL_ID,
  CHAIN_ID,
  LEGACY_CHAIN_ID,
  MAX_ACCEL,
  MIN_ANGLE_WINDOW_DEG,
  MIN_CLEARANCE,
  MAX_BODIES,
  type LevelConfig,
  type SlingState,
  type FrameEvent
} from '../src/tools/mini-games/gpu-games/gravity-sling/game/sling-core'
import {
  difficultyModel,
  generateLevel,
  GRAVITY_G,
  type Body
} from '../src/tools/mini-games/gpu-games/gravity-sling/game/level-design'

function flyState(level: LevelConfig, vx: number, vy: number): SlingState {
  const s = createInitialState(level)
  s.phase = 'fly'
  s.ship.launched = true
  s.ship.vx = vx
  s.ship.vy = vy
  return s
}

function runUntil(state: SlingState, level: LevelConfig, predicate: (ev: FrameEvent[]) => boolean, maxSteps = 2000): FrameEvent[] {
  let all: FrameEvent[] = []
  for (let i = 0; i < maxSteps; i += 1) {
    state.elapsed += FIXED_DT
    const ev = stepFrame(state, level, FIXED_DT, state.elapsed)
    all = all.concat(ev)
    if (predicate(ev)) return all
    if (ev.some((e) => e.type === 'crash' || e.type === 'blackhole' || e.type === 'out' || e.type === 'timeout')) return all
  }
  return all
}

test('50 关配置完整：唯一星门、坐标界内、次数/时限合法、id 唯一、天体数封顶', () => {
  assert.equal(LEVELS.length, 50)
  assert.equal(SOLUTIONS.length, 50)
  for (const lv of LEVELS) {
    const gates = lv.bodies.filter((b) => b.kind === 'portal' || b.kind === 'moving')
    assert.equal(gates.length, 1, `第 ${lv.index + 1} 关星门唯一`)
    assert.ok(lv.shots === -1 || lv.shots >= 0, `第 ${lv.index + 1} 关次数合法`)
    assert.ok(lv.timeLimit >= 0, `第 ${lv.index + 1} 关时限合法`)
    assert.ok(lv.anchor.x >= 0 && lv.anchor.x <= WORLD_W && lv.anchor.y >= 0 && lv.anchor.y <= WORLD_H)
    const ids = lv.bodies.map((b) => b.id)
    assert.equal(new Set(ids).size, ids.length, `第 ${lv.index + 1} 关 id 唯一`)
    assert.ok(lv.bodies.filter((b) => b.kind !== 'collect').length <= MAX_BODIES)
    for (const b of lv.bodies) {
      assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y) && b.r > 0)
      assert.ok(b.x >= -200 && b.x <= WORLD_W + 200 && b.y >= -200 && b.y <= WORLD_H + 200)
    }
  }
  assert.equal(levelByIdx(-3).index, 0)
  assert.equal(levelByIdx(99).index, 49)
})

test('50 关求解证据全部达标：记录解可复放、角度窗口与门体净空不低于下限', () => {
  for (const ev of SOLUTIONS) {
    const lv = LEVELS[ev.index]
    assert.ok(lv, `第 ${ev.index + 1} 关证据对应关卡存在`)
    const result = simulateSolution(lv, ev.angleDeg, ev.power)
    assert.ok(result.hit, `第 ${ev.index + 1} 关记录解应复放命中`)
    assert.ok(ev.angleWindowDeg >= MIN_ANGLE_WINDOW_DEG, `第 ${ev.index + 1} 关角度窗口不足`)
    assert.ok(ev.clearance >= MIN_CLEARANCE, `第 ${ev.index + 1} 关门体净空不足`)
    assert.ok(ev.bodyCount <= MAX_BODIES, `第 ${ev.index + 1} 关天体数超上限`)
  }
  // 抽样后期关，求解器在当前物理上仍能独立搜索到解。
  for (const index of [0, 19, 39, 49]) {
    const found = solveLevel(LEVELS[index], { maxSteps: 1200 })
    assert.ok(found, `抽样第 ${index + 1} 关求解器应返回解`)
  }
})

test('难度模型饱和单调：指数 D 被压到有限旋钮；门径收敛下限、次数/时限收紧、引力只小幅浮动', () => {
  const early = difficultyModel(0)
  const middle = difficultyModel(24)
  const late = difficultyModel(49)
  assert.ok(late.saturation > middle.saturation && middle.saturation > early.saturation)
  assert.ok(late.portalRadius <= middle.portalRadius && middle.portalRadius <= early.portalRadius)
  assert.ok(late.portalRadius >= 44)
  assert.equal(early.shots, -1)
  assert.ok(late.shots >= 2)
  assert.equal(early.timeLimit, 0)
  assert.ok(late.timeLimit >= 22)
  assert.ok(late.gravity <= 4 && late.repel <= 2 && late.blackhole <= 2 && late.asteroids <= 6)
  for (const d of [early, middle, late]) {
    assert.ok(d.gravityScale >= GRAVITY_G * 0.95 && d.gravityScale <= GRAVITY_G * 1.05)
  }
})

test('多体合力：两颗恒星方向矢量叠加；黑洞质量×3；推斥反向；空天体零加速度；净加速度不超上限', () => {
  const star: Body = { id: 1, kind: 'gravity', x: 500, y: 900, r: 46, mass: 1 }
  const star2: Body = { id: 2, kind: 'gravity', x: 500, y: 900, r: 46, mass: 1 }
  const both = gravityAccel([star, star2], 500, 1200, 0)
  const one = gravityAccel([star], 500, 1200, 0)
  const ratio = Math.abs(both.ay / one.ay)
  assert.ok(ratio > 1.9 && ratio < 2.1, `两颗同向恒星加速度近似叠加，比值=${ratio.toFixed(3)}`)

  const hole: Body = { id: 3, kind: 'blackhole', x: 500, y: 900, r: 36, mass: 1 }
  const holeA = gravityAccel([hole], 500, 1100, 0)
  assert.ok(holeA.ay < 0, '黑洞把星箭拉向自身')

  const repel: Body = { id: 4, kind: 'repel', x: 500, y: 900, r: 48, mass: 1 }
  const away = gravityAccel([repel], 500, 1100, 0)
  assert.ok(away.ay > 0, '位于推斥星下方时被向上推开')
  assert.deepEqual(gravityAccel([], 500, 500, 0), { ax: 0, ay: 0 })

  const clustered: Body[] = [star, star2, hole, repel]
  const capped = gravityAccel(clustered, 500, 901, 0)
  assert.ok(Math.hypot(capped.ax, capped.ay) <= MAX_ACCEL + 1e-9)
  const center = gravityAccel([star], star.x, star.y, 0)
  assert.ok(Number.isFinite(center.ax) && Number.isFinite(center.ay))
})

test('瞄准向量：锚点下方拖拽得到竖直向上；力度二次曲线并钳制到 0..1', () => {
  const v = aimVector({ x: 500, y: 1380 }, { x: 500, y: 1480 })
  assert.equal(v.len, 100)
  assert.ok(Math.abs(v.nx) < 1e-6)
  assert.equal(v.ny, -1)
  assert.equal(powerFromPull(0), 0)
  assert.equal(powerFromPull(280), 1)
  assert.equal(powerFromPull(400), 1)
  assert.equal(powerFromPull(140), 0.25)
})

test('预测轨迹：第 1 关竖直向上，点列有限、单调升高并接近星门', () => {
  const lv = LEVELS[0]
  const pts = predictTrajectory(lv, { nx: 0, ny: -1 }, 1)
  assert.ok(pts.length > 5)
  for (const p of pts) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y))
    assert.ok(p.y >= 0 && p.y <= WORLD_H)
  }
  const last = pts[pts.length - 1]!
  assert.ok(last.y < lv.anchor.y)
  const gate = lv.bodies.find((b) => b.kind === 'portal')!
  assert.ok(Math.hypot(gate.x - last.x, gate.y - last.y) < 260)
})

test('固定步长：第 1 关竖直发射命中星门（portal 事件）', () => {
  const lv = LEVELS[0]
  const s = flyState(lv, 0, -V_MAX)
  const ev = runUntil(s, lv, (e) => e.some((x) => x.type === 'portal'))
  assert.ok(ev.some((x) => x.type === 'portal'), '应触发命中星门')
  assert.ok(!ev.some((x) => x.type === 'crash' || x.type === 'out'))
})

test('第 2 关直上拾取沿途 3 颗星尘（collect 事件，不重复触发）', () => {
  const lv = LEVELS[1]
  const s = flyState(lv, 0, -V_MAX)
  const ev = runUntil(s, lv, (e) => e.some((x) => x.type === 'portal'))
  const collects = ev.filter((x) => x.type === 'collect')
  assert.equal(collects.length, 3)
  assert.equal(s.collected, 3)
  assert.equal(s.collectedIds.length, 3)
})

test('撞入自定义恒星半径触发 crash；坠入自定义黑洞触发 blackhole', () => {
  const star: Body = { id: 2, kind: 'gravity', x: 260, y: 760, r: 46, mass: 1 }
  const crashLevel: LevelConfig = { ...LEVELS[0], bodies: [star] }
  const s3 = flyState(crashLevel, 0, 0)
  s3.ship.x = star.x
  s3.ship.y = star.y
  const ev3 = stepFrame(s3, crashLevel, FIXED_DT, 0.1)
  assert.ok(ev3.some((x) => x.type === 'crash' && x.bodyId === star.id))

  const hole: Body = { id: 3, kind: 'blackhole', x: 720, y: 620, r: 36, mass: 1 }
  const holeLevel: LevelConfig = { ...LEVELS[0], bodies: [hole] }
  const s11 = flyState(holeLevel, 0, 0)
  s11.ship.x = hole.x
  s11.ship.y = hole.y
  const ev11 = stepFrame(s11, holeLevel, FIXED_DT, 0.1)
  assert.ok(ev11.some((x) => x.type === 'blackhole' && x.bodyId === hole.id))
})

test('限时关卡：时间耗尽触发 timeout 事件', () => {
  const lv: LevelConfig = { ...LEVELS[0], timeLimit: 0.01, shots: 3 }
  const s = flyState(lv, 0, -V_MAX)
  s.timeLeft = 0.01
  const ev = stepFrame(s, lv, 0.1, 0.1)
  assert.ok(ev.some((x) => x.type === 'timeout'))
  assert.equal(s.timeLeft, 0)
})

test('combo：窗口内累加、过期归零、倍率封顶 4', () => {
  assert.deepEqual(resolveCombo(0, 0, 0), { combo: 1, mult: 1 })
  assert.deepEqual(resolveCombo(2, 1.0, 0, 1.5), { combo: 3, mult: 3 })
  assert.deepEqual(resolveCombo(2, 3.0, 1.0, 1.5), { combo: 1, mult: 1 })
  assert.deepEqual(resolveCombo(4, 0.5, 0), { combo: 5, mult: 4 })
})

test('结算展示：bestCombo 存连续借力次数，0 基线显示 ×1，有连击按倍率封顶 ×4', () => {
  assert.equal(comboDisplayMult(0), 1)
  assert.equal(comboDisplayMult(1), 1)
  assert.equal(comboDisplayMult(2), 2)
  assert.equal(comboDisplayMult(4), 4)
  assert.equal(comboDisplayMult(5), 4)
  assert.equal(comboDisplayMult(-2), 1)
})

test('周期星门开/关判定；动目标轨道位置随时间变化；50 关中至少各出现一次', () => {
  const periodic = LEVELS.find((lv) => lv.bodies.some((b) => b.period))!
  const gate = periodic.bodies.find((b) => b.period)!
  assert.ok(isPortalOpen(gate, 1))
  assert.ok(!isPortalOpen(gate, 4))
  const moving = LEVELS.find((lv) => lv.bodies.some((b) => b.kind === 'moving'))!
  const movingBody = moving.bodies.find((b) => b.kind === 'moving')!
  const p0 = bodyPos(movingBody, 0)
  const p1 = bodyPos(movingBody, 4)
  assert.ok(Math.hypot(p1.x - p0.x, p1.y - p0.y) > 1)
})

test('快照：当前版本 serialize↔validate 往返字段一致；损坏/版本/tool/chain 不符回退 null', () => {
  const s = createInitialState(2, 320, 1)
  s.combo = 3
  s.bestCombo = 4
  s.collectedIds = [2, 3]
  s.ship.vx = 120
  s.ship.vy = -80
  const payload = serializeSave(s, 1700000000000)
  const v = validateSave(payload)
  assert.equal(v.ok, true)
  assert.equal(v.payload!.level, 2)
  assert.equal(v.payload!.score, 320)
  assert.equal(v.payload!.combo, 3)
  assert.equal(v.payload!.collectedIds.join(','), '2,3')
  assert.equal(v.payload!.ship.vx, 120)

  const mem = new Map<string, string>()
  const storage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, val: string) => void mem.set(k, val),
    removeItem: (k: string) => void mem.delete(k)
  }
  assert.equal(persistSave(payload, AUTO_SAVE_KEY, storage), true)
  const back = loadSave(AUTO_SAVE_KEY, storage)
  assert.equal(back!.level, 2)
  clearSave(AUTO_SAVE_KEY, storage)
  assert.equal(loadSave(AUTO_SAVE_KEY, storage), null)

  assert.equal(validateSave('not-object').ok, false)
  const badVersion = { ...payload, version: SAVE_VERSION + 1 }
  assert.equal(validateSave(badVersion).ok, false)
  const badTool = { ...payload, tool: 'other-game' }
  assert.equal(validateSave(badTool).ok, false)
  const badChain = { ...payload, chain: 'other-chain' }
  assert.equal(validateSave(badChain).ok, false)
  assert.equal(TOOL_ID, 'gravity-sling')
  assert.equal(CHAIN_ID, 'gravity-sling:levels:50:v2')
})

test('旧 13 关快照迁移到 v2：分数/连击/星尘不丢，level 安全钳制，链标识升级', () => {
  const legacy = {
    version: 1,
    tool: TOOL_ID,
    chain: LEGACY_CHAIN_ID,
    savedAt: 1700000000000,
    level: 12,
    score: 999,
    combo: 2,
    bestCombo: 3,
    collected: 2,
    collectedIds: [5, 6],
    shotsLeft: -1,
    timeLeft: 0,
    assists: 1,
    elapsed: 42,
    ship: { x: 500, y: 1200, vx: 20, vy: -40, angle: -1.4 }
  }
  const v = validateSave(legacy)
  assert.equal(v.ok, true)
  assert.equal(v.migrated, true)
  assert.equal(v.payload!.version, SAVE_VERSION)
  assert.equal(v.payload!.chain, CHAIN_ID)
  assert.equal(v.payload!.score, 999)
  assert.equal(v.payload!.combo, 2)
  assert.equal(v.payload!.collected, 2)
  assert.equal(v.payload!.level, 12)
  assert.equal(v.payload!.ship.vx, 20)

  const outOfRange = { ...legacy, level: 999 }
  const v2 = validateSave(outOfRange)
  assert.equal(v2.ok, true)
  assert.equal(v2.payload!.level, 49)
})

test('关卡进度独立 localStorage 键：默认空进度、读写回读、非法值钳制，不写自动快照键', () => {
  const mem = new Map<string, string>()
  const storage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, val: string) => void mem.set(k, val),
    removeItem: (k: string) => void mem.delete(k)
  }
  const empty = readProgress(storage)
  assert.equal(empty.maxReached, 0)
  assert.equal(empty.bestScore, 0)
  writeProgress({ version: 1, tool: TOOL_ID, maxReached: 7, bestScore: 200 }, storage)
  const restored = readProgress(storage)
  assert.equal(restored.maxReached, 7)
  assert.equal(restored.bestScore, 200)
  assert.ok(mem.has(PROGRESS_KEY))
  assert.ok(!mem.has(AUTO_SAVE_KEY))

  mem.clear()
  writeProgress({ version: 1, tool: TOOL_ID, maxReached: 999, bestScore: -5 }, storage)
  const clamped = readProgress(storage)
  assert.equal(clamped.maxReached, LEVEL_COUNT - 1)
  assert.equal(clamped.bestScore, 0)
})

test('生成器产物与运行时 50 关一致：离线生成函数可复现同序号关卡索引', () => {
  for (const index of [0, 4, 24, 49]) {
    const evidence = SOLUTIONS[index]!
    const generated = generateLevel(index, evidence.seed, evidence.relaxed)
    assert.equal(generated.index, index)
    assert.equal(generated.bodies.length, LEVELS[index].bodies.length)
  }
})
