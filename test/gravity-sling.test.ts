/**
 * 007《挽星弓》gravity-sling 纯逻辑单测（node --import tsx --test 直跑，不依赖 DOM）：
 *  - 13 关配置完整性（唯一星门、界内坐标、次数/时限合法、id 唯一）
 *  - 引力加速度方向 / 推斥反向 / 软化防奇点 / 空天体零加速度
 *  - 瞄准向量、力度二次曲线与钳制
 *  - 预测轨迹有限且朝目标推进
 *  - 固定步长推进：直瞄命中星门、沿途收星、撞恒星、坠入黑洞、限时超时
 *  - combo 窗口连击 / 过期归零 / 倍率封顶
 *  - 星门周期开合、动目标轨道位置
 *  - 快照 serialize↔validate 往返；损坏 JSON / 版本 / tool / chain 不符安全回退 null
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  LEVELS,
  levelByIdx,
  bodyPos,
  isPortalOpen,
  gravityAccel,
  aimVector,
  powerFromPull,
  predictTrajectory,
  resolveCombo,
  comboDisplayMult,
  stepFrame,
  serializeSave,
  validateSave,
  loadSave,
  persistSave,
  clearSave,
  createInitialState,
  WORLD_W,
  WORLD_H,
  V_MAX,
  FIXED_DT,
  AUTO_SAVE_KEY,
  SAVE_VERSION,
  TOOL_ID,
  CHAIN_ID,
  type LevelConfig,
  type SlingState,
  type FrameEvent
} from '../src/tools/mini-games/gpu-games/gravity-sling/game/sling-core'

function flyState(level: LevelConfig, vx: number, vy: number): SlingState {
  const s = createInitialState(level.index)
  s.phase = 'fly'
  s.ship.launched = true
  s.ship.vx = vx
  s.ship.vy = vy
  return s
}

function runUntil(state: SlingState, level: LevelConfig, predicate: (ev: FrameEvent[]) => boolean, maxSteps = 4000): FrameEvent[] {
  let all: FrameEvent[] = []
  for (let i = 0; i < maxSteps; i++) {
    state.elapsed += FIXED_DT
    const ev = stepFrame(state, level, FIXED_DT, state.elapsed)
    all = all.concat(ev)
    if (predicate(ev)) return all
    if (ev.some((e) => e.type === 'crash' || e.type === 'blackhole' || e.type === 'out' || e.type === 'timeout')) return all
  }
  return all
}

test('13 关配置完整：唯一星门、坐标界内、次数/时限合法、id 唯一', () => {
  assert.equal(LEVELS.length, 13)
  for (const lv of LEVELS) {
    const gates = lv.bodies.filter((b) => b.kind === 'portal' || b.kind === 'moving')
    assert.equal(gates.length, 1, `第 ${lv.index + 1} 关星门唯一`)
    assert.ok(lv.shots === -1 || lv.shots >= 0, `第 ${lv.index + 1} 关次数合法`)
    assert.ok(lv.timeLimit >= 0, `第 ${lv.index + 1} 关时限合法`)
    assert.ok(lv.anchor.x >= 0 && lv.anchor.x <= WORLD_W && lv.anchor.y >= 0 && lv.anchor.y <= WORLD_H)
    const ids = lv.bodies.map((b) => b.id)
    assert.equal(new Set(ids).size, ids.length, `第 ${lv.index + 1} 关 id 唯一`)
    for (const b of lv.bodies) {
      assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y) && b.r > 0)
      assert.ok(b.x >= -200 && b.x <= WORLD_W + 200 && b.y >= -200 && b.y <= WORLD_H + 200)
    }
  }
  assert.equal(levelByIdx(-3).index, 0)
  assert.equal(levelByIdx(99).index, 12)
})

test('引力：恒星把星箭拉向自身；推斥星反向推开；空天体零加速度；中心处不出现 NaN', () => {
  const star = LEVELS[2].bodies.find((b) => b.kind === 'gravity')!
  const up = gravityAccel([star], star.x, star.y + 300, 0)
  assert.ok(up.ay < 0, '位于恒星下方时加速度向上')
  const repel = LEVELS[10].bodies.find((b) => b.kind === 'repel')!
  const away = gravityAccel([repel], repel.x, repel.y + 300, 0)
  assert.ok(away.ay > 0, '位于推斥星下方时加速度向下（被推开）')
  assert.deepEqual(gravityAccel([], 500, 500, 0), { ax: 0, ay: 0 })
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

test('撞入恒星半径触发 crash；坠入黑洞触发 blackhole', () => {
  const lv3 = LEVELS[3]
  const star = lv3.bodies.find((b) => b.kind === 'gravity')!
  const s3 = flyState(lv3, 0, 0)
  s3.ship.x = star.x
  s3.ship.y = star.y
  const ev3 = stepFrame(s3, lv3, FIXED_DT, 0.1)
  assert.ok(ev3.some((x) => x.type === 'crash' && x.bodyId === star.id))

  const lv11 = LEVELS[11]
  const hole = lv11.bodies.find((b) => b.kind === 'blackhole')!
  const s11 = flyState(lv11, 0, 0)
  s11.ship.x = hole.x
  s11.ship.y = hole.y
  const ev11 = stepFrame(s11, lv11, FIXED_DT, 0.1)
  assert.ok(ev11.some((x) => x.type === 'blackhole' && x.bodyId === hole.id))
})

test('限时关卡：时间耗尽触发 timeout 事件', () => {
  const lv = LEVELS[8]
  const s = flyState(lv, 0, -V_MAX)
  s.timeLeft = 0.01
  const ev = stepFrame(s, lv, 0.1, 0.1)
  assert.ok(ev.some((x) => x.type === 'timeout'))
  assert.equal(s.timeLeft, 0)
})

test('combo：窗口内连击累加，过期归零，倍率封顶 4', () => {
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

test('星门周期开合：窗口内开、窗口外关；动目标轨道位置随时间变化', () => {
  const gate = LEVELS[8].bodies.find((b) => b.kind === 'portal')!
  assert.ok(isPortalOpen(gate, 1))
  assert.ok(!isPortalOpen(gate, 4))
  const moving = LEVELS[9].bodies.find((b) => b.kind === 'moving')!
  const p0 = bodyPos(moving, 0)
  const p1 = bodyPos(moving, 4)
  assert.ok(Math.hypot(p1.x - p0.x, p1.y - p0.y) > 1)
})

test('快照：serialize↔validate 往返字段一致；损坏/版本/tool/chain 不符回退 null', () => {
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
  assert.equal(CHAIN_ID, 'gravity-sling:levels:13:v1')
})
