/**
 * 007-M2 炫光新游戏毫秒级纯逻辑单测（不依赖 DOM/别名，node --import tsx --test 直跑）：
 *  - 霓虹脉冲 neon-pulse：完美/良好/空击判定、连击加分、漏击 3 次结束、速度单调
 *  - 星轨穿梭 orbit-surge：横向跟随、目标钳制、碰撞结束、越界回收、生存计分
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  GOOD_SCORE,
  HIT_Y,
  MAX_MISS,
  PERFECT_SCORE,
  hitLane,
  newPulse,
  speedAt,
  update,
  type PulseState
} from '../src/tools/mini-games/gpu-games/neon-pulse/logic'
import {
  MAX_SPEED,
  OBSTACLE_R,
  PLAYER_Y,
  SCORE_PER_SEC,
  newSurge,
  setTarget,
  update as surgeUpdate
} from '../src/tools/mini-games/gpu-games/orbit-surge/logic'

// —— 霓虹脉冲 ——
test('脉冲：判定线正中为完美，得分 100、连击+1、音符移除', () => {
  const s = newPulse(0)
  s.notes.push({ id: 1, lane: 1, y: HIT_Y })
  const r = hitLane(s, 1)
  assert.equal(r.kind, 'perfect')
  assert.equal(r.gained, PERFECT_SCORE)
  assert.equal(s.score, PERFECT_SCORE)
  assert.equal(s.combo, 1)
  assert.equal(s.notes.length, 0)
})

test('脉冲：良好窗内（非正中）为 good=60，窗外空击不扣分', () => {
  const s = newPulse(0)
  s.notes.push({ id: 1, lane: 0, y: HIT_Y + 0.08 })
  const r = hitLane(s, 0)
  assert.equal(r.kind, 'good')
  assert.equal(r.gained, GOOD_SCORE)

  const s2 = newPulse(0)
  const empty = hitLane(s2, 2)
  assert.equal(empty.kind, 'empty')
  assert.equal(s2.score, 0)
  assert.equal(s2.combo, 0)
})

test('脉冲：连击带来递增加分，且只取本轨道最接近的音符', () => {
  const s = newPulse(0)
  s.notes.push({ id: 1, lane: 0, y: HIT_Y })
  hitLane(s, 0)
  s.notes.push({ id: 2, lane: 0, y: HIT_Y })
  const r2 = hitLane(s, 0)
  assert.equal(s.combo, 2)
  assert.equal(r2.gained, PERFECT_SCORE + 2) // 第二击 +连击奖励
})

test('脉冲：越过底线记漏击、清零连击；累计 MAX_MISS 结束', () => {
  const s: PulseState = newPulse(0)
  s.score = 120
  s.combo = 4
  s.misses = MAX_MISS - 1
  s.notes.push({ id: 9, lane: 0, y: HIT_Y + 0.2 }) // 本帧下落即越过 MISS_Y
  const res = update(s, 0.05)
  assert.ok(res.missed >= 1)
  assert.equal(s.misses, MAX_MISS)
  assert.equal(s.combo, 0)
  assert.equal(s.over, true)
  assert.equal(s.best, 120) // 结束时同步最佳
})

test('脉冲：速度随时间递增并被钳制在上限', () => {
  assert.ok(speedAt(0) < speedAt(10))
  assert.equal(speedAt(100000), 0.9)
})

// —— 星轨穿梭 ——
test('星轨：目标被钳制在 0..1，光体平滑跟随', () => {
  const s = newSurge(0)
  setTarget(s, 5)
  assert.equal(s.target, 1)
  setTarget(s, -2)
  assert.equal(s.target, 0)
  setTarget(s, 0.9)
  surgeUpdate(s, 1) // FOLLOW_SPEED*1=2.4 > 距离0.4，应一步到位
  assert.ok(Math.abs(s.px - 0.9) < 1e-9)
})

test('星轨：生存按秒计分并更新最佳，速度有上限', () => {
  const s = newSurge(0)
  surgeUpdate(s, 1)
  assert.equal(s.score, SCORE_PER_SEC)
  assert.equal(s.best, SCORE_PER_SEC)
  // 巨大步长也不超过速度上限（用多帧近似）
  for (let i = 0; i < 1000; i++) surgeUpdate(s, 0.05)
  assert.ok(s.speed <= MAX_SPEED + 1e-9)
})

test('星轨：撞到障碍即结束并爆发（crashed），障碍被移除', () => {
  const s = newSurge(0)
  s.obs.push({ id: 1, x: s.px, y: PLAYER_Y })
  const before = s.obs.length
  const res = surgeUpdate(s, 0.016)
  assert.ok(res.crashed)
  assert.equal(s.over, true)
  assert.equal(s.obs.length, before - 1)
})

test('星轨：障碍越过底部被记为躲过并回收，不撞玩家', () => {
  const s = newSurge(0)
  // 放在远离玩家的另一侧、且接近底部，下帧越过 1+R
  s.obs.push({ id: 1, x: 0.02, y: 1 + OBSTACLE_R - 0.001 })
  const res = surgeUpdate(s, 0.05)
  assert.equal(res.crashed, false)
  assert.ok(res.dodged.includes(1))
  assert.equal(s.obs.length, 0)
})

test('星轨：结束后 update 为 no-op', () => {
  const s = newSurge(0)
  s.over = true
  const score = s.score
  const res = surgeUpdate(s, 0.5)
  assert.equal(res.crashed, false)
  assert.equal(s.score, score)
})
