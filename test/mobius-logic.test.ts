import { test } from 'node:test'
import assert from 'node:assert/strict'

import { mulberry32 } from '../src/tools/mobius-runner/game/rng.ts'
import {
  frameAt,
  pointOn,
  normalAt,
  twistAngleAt,
  inTwistZone,
  gateForbiddenByTwist,
  RIBBON_WIDTH,
  TWIST_PERIOD,
  FIRST_TWIST_AT
} from '../src/tools/mobius-runner/game/geometry.ts'
import { speedAt, TUTORIAL_DIST } from '../src/tools/mobius-runner/game/difficulty.ts'
import {
  createRun,
  startRun,
  step,
  flip,
  revive,
  displayScore,
  STEP,
  MULTI_CAP
} from '../src/tools/mobius-runner/game/logic.ts'
import { resolveSettings, DEFAULT_SETTINGS } from '../src/tools/mobius-runner/game/storage.ts'
import type { GameState } from '../src/tools/mobius-runner/game/types.ts'

function runTo(s: GameState, until: (d: number) => boolean, maxSteps = 200000): void {
  let n = 0
  while (!until(s.distance) && s.status === 'running' && n++ < maxSteps) step(s, STEP)
}

test('rng: 同种子序列完全可复现', () => {
  const a = mulberry32(12345)
  const b = mulberry32(12345)
  const sa = Array.from({ length: 50 }, a)
  const sb = Array.from({ length: 50 }, b)
  assert.deepEqual(sa, sb)
  assert.notDeepEqual(Array.from({ length: 10 }, mulberry32(1)), Array.from({ length: 10 }, mulberry32(2)))
  assert.ok(sa.every((x) => x >= 0 && x < 1))
})

test('几何: 半扭转角 0→π→0，教学段前无扭转', () => {
  assert.equal(twistAngleAt(0), 0)
  assert.equal(twistAngleAt(FIRST_TWIST_AT - 1), 0)
  assert.equal(inTwistZone(100), false)
  const mid = FIRST_TWIST_AT + 9
  assert.ok(Math.abs(twistAngleAt(mid) - Math.PI / 2) < 0.05)
  const end = FIRST_TWIST_AT + 18
  assert.ok(Math.abs(twistAngleAt(end) - Math.PI) < 1e-6)
  assert.equal(inTwistZone(end + 1), false)
  assert.equal(twistAngleAt(end + 10), 0)
})

test('几何: 标架单位正交，两面分居法线两侧', () => {
  for (const u of [0, 80, 159, 200, 1000]) {
    const f = frameAt(u)
    const len = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z)
    assert.ok(Math.abs(len(f.tangent) - 1) < 1e-6)
    assert.ok(Math.abs(len(f.across) - 1) < 1e-6)
    assert.ok(Math.abs(len(f.normal) - 1) < 1e-6)
    assert.ok(Math.abs(f.tangent.x * f.across.x + f.tangent.y * f.across.y + f.tangent.z * f.across.z) < 1e-6)
  }
  const u = 120
  const f = frameAt(u)
  const n = normalAt(u)
  const p0 = pointOn(u, 0)
  const p1 = pointOn(u, 1)
  const d = { x: p1.x - p0.x, y: p1.y - p0.y, z: p1.z - p0.z }
  // 两面是沿 across 的两条车道：连线应沿 -across，与带面法向近似垂直
  const dotA = d.x * f.across.x + d.y * f.across.y + d.z * f.across.z
  const dotN = d.x * n.x + d.y * n.y + d.z * n.z
  assert.ok(dotA < 0, 'face1 应在 across 反侧车道')
  assert.ok(Math.abs(dotN) < 1e-5, '两车道同处一个带面，连线不应沿法向')
  assert.ok(Math.abs(Math.hypot(d.x, d.y, d.z) - RIBBON_WIDTH / 2) < 1e-5, '两车道中心间距=半带宽')
})

test('几何: 闸门禁放区覆盖每个扭转区及安全边距', () => {
  const clear = 5
  assert.equal(gateForbiddenByTwist(100, clear), false)
  assert.equal(gateForbiddenByTwist(FIRST_TWIST_AT + 1, clear), true)
  assert.equal(gateForbiddenByTwist(FIRST_TWIST_AT + 9, clear), true)
  assert.equal(gateForbiddenByTwist(FIRST_TWIST_AT - 1, clear), true)
  assert.equal(gateForbiddenByTwist(FIRST_TWIST_AT + 18 + 1, clear), true)
  assert.equal(gateForbiddenByTwist(FIRST_TWIST_AT + 18 + 20, clear), false)
  // 第二个周期同样成立
  const s2 = FIRST_TWIST_AT + TWIST_PERIOD
  assert.equal(gateForbiddenByTwist(s2 + 4, clear), true)
})

test('难度: 教学段速度平缓，整体单调且有上界', () => {
  let prev = speedAt(0)
  for (let d = 1; d <= 3000; d += 5) {
    const v = speedAt(d)
    assert.ok(v >= prev - 1e-9, `速度应单调不减 @${d}`)
    assert.ok(v <= 18.0001, `速度不超过上限 @${d}`)
    prev = v
  }
  assert.ok(speedAt(0) < speedAt(TUTORIAL_DIST + 10))
  assert.equal(speedAt(100000), 18)
})

function controlledRun(startDistance: number): GameState {
  const s = createRun({ seed: 7, startDistance })
  startRun(s)
  // 受控测试：清掉预生成闸门并阻止自动补门，仅保留测试手动放入的闸门
  s.gates = []
  s.nextGateU = 999999
  return s
}

test('逻辑: 不翻转撞上同面墙即死亡', () => {
  const s = controlledRun(60) // 教学段，无半扭转
  s.gates.push({ u: 80, wallFace: 0, kind: 'solid', passed: false })
  runTo(s, (d) => d >= 80)
  assert.equal(s.status, 'dead')
  assert.ok(s.deathAt !== null && Math.abs(s.deathAt - 80) < 0.8)
  assert.ok(s.events.includes('death'))
})

test('逻辑: 及时翻到缺口面可穿过并得分（完美/擦过/普通其一）', () => {
  const s = controlledRun(60)
  s.gates.push({ u: 80, wallFace: 0, kind: 'solid', passed: false })
  let flipped = false
  let n = 0
  while (s.distance < 84 && n++ < 100000) {
    if (!flipped && s.distance >= 79.2) {
      flip(s)
      flipped = true
    }
    step(s, STEP)
    if (s.status === 'dead') break
  }
  assert.equal(s.status, 'running', '应安全穿门')
  assert.equal(flipped, true)
  assert.equal(s.gates[0].passed, true)
  assert.ok(displayScore(s) > 0)
})

test('逻辑: 穿过半个莫比乌斯扭转区后两面真正对调', () => {
  const s = controlledRun(140)
  assert.equal(s.face, 0)
  runTo(s, (d) => d >= FIRST_TWIST_AT + 22) // 越过第一个扭转区并进入其后平直段
  assert.equal(s.status, 'running')
  assert.equal(s.face, 1, '半扭转完成后两面应对调')
  assert.equal(s.inTwist, false)
})

test('逻辑: 连续有风格通过提升倍率且不超过上限', () => {
  const s = controlledRun(60)
  // 教学段内、间距 4m 连续 20 道墙均在 face1（玩家保持 face0 走缺口面），无需翻转
  for (let i = 0; i < 20; i++) {
    s.gates.push({ u: 68 + i * 4, wallFace: 1, kind: 'solid', passed: false })
  }
  runTo(s, (d) => d >= 68 + 19 * 4 + 2)
  assert.equal(s.status, 'running', `应全程存活，死亡于 ${s.deathAt}`)
  assert.ok(s.multiplier <= MULTI_CAP)
  assert.equal(s.multiplier, MULTI_CAP)
  assert.ok(s.combo >= 20)
})

test('逻辑: 续命每局限一次，未拥有者不可续命，续命后短暂无敌', () => {
  const s = controlledRun(60)
  s.gates.push({ u: 80, wallFace: 0, kind: 'solid', passed: false })
  runTo(s, (d) => d >= 80)
  assert.equal(s.status, 'dead')
  assert.equal(revive(s, false), false, '未拥有专业版不可续命')
  assert.equal(revive(s, true), true)
  assert.equal(s.status, 'running')
  assert.equal(s.reviveUsed, true)
  assert.ok(s.invincible > 0)
  assert.ok(s.events.includes('revive'))
  // 再次死亡不能续命（放在教学段更远处，避开扭转）
  s.gates.push({ u: s.distance + 3, wallFace: s.face, kind: 'solid', passed: false })
  s.invincible = 0
  runTo(s, (d) => d >= s.distance + 3)
  assert.equal(s.status, 'dead')
  assert.equal(revive(s, true), false, '每局限一次')
})

test('逻辑: 非running状态step不推进，pause/resume 正确', () => {
  const s = controlledRun(300)
  const before = s.distance
  // 直接构造 paused
  s.status = 'paused'
  step(s, STEP)
  assert.equal(s.distance, before)
  s.status = 'running'
  step(s, STEP)
  assert.ok(s.distance > before)
})

test('存档: resolveSettings 对缺字段/非法值回退默认', () => {
  assert.deepEqual(resolveSettings(null), DEFAULT_SETTINGS)
  assert.deepEqual(resolveSettings({ id: 'state' }), DEFAULT_SETTINGS)
  const r = resolveSettings({ id: 'state', settings: { muted: true, fx: 'weird' as never } })
  assert.equal(r.muted, true)
  assert.equal(r.fx, 'auto', '非法 fx 回退 auto')
  assert.equal(r.vibrate, true)
})
