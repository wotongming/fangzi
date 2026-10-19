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
  CONTACT_PX,
  PLAYER_RADIUS_PX,
  ENEMY_RADIUS_PX,
  PLAYER_Y,
  SCORE_PER_SEC,
  newSurge,
  setTarget,
  update as surgeUpdate
} from '../src/tools/mini-games/gpu-games/orbit-surge/logic'

// 手机竖屏游戏场（CSS 像素）：用于把归一化坐标换算成像素做碰撞回归。
const PHONE = { w: 375, h: 667 }
const PC = { w: 1280, h: 720 }

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
  surgeUpdate(s, 1, PHONE) // FOLLOW_SPEED*1=2.4 > 距离0.4，应一步到位
  assert.ok(Math.abs(s.px - 0.9) < 1e-9)
})

test('星轨：生存按秒计分并更新最佳，速度有上限', () => {
  const s = newSurge(0)
  surgeUpdate(s, 1, PHONE)
  assert.equal(s.score, SCORE_PER_SEC)
  assert.equal(s.best, SCORE_PER_SEC)
  // 巨大步长也不超过速度上限（用多帧近似）
  for (let i = 0; i < 1000; i++) surgeUpdate(s, 0.05, PHONE)
  assert.ok(s.speed <= MAX_SPEED + 1e-9)
})

test('星轨：碰撞按真实像素圆距判定——手机竖屏纵向不再被高宽比放大', () => {
  // 回归旧 bug：旧逻辑在归一化空间用同一半径判横纵，竖屏纵向阈值≈0.097，
  // 换算 667 高约 64.7px（两圆接触实际只需 35px），导致障碍离玩家头顶很远处就误判。
  const s = newSurge(0)
  // 横向完全对齐；纵向像素距离 40px > CONTACT_PX(35)，归一化 dy=40/667≈0.060。
  // 旧 AABB：0.060 <= 0.097 会误撞；新圆距：40 > 35 应安全。
  const dyNorm = 40 / PHONE.h
  s.obs.push({ id: 1, x: s.px, y: PLAYER_Y + dyNorm })
  const res = surgeUpdate(s, 0.001, PHONE)
  assert.equal(res.crashed, false, '纵向 40px 间隙不应判死')
})

test('星轨：纵向像素距离 <= 接触半径才撞（贴脸命中），且为圆形而非方形', () => {
  // 纵向在接触半径内：33px（本帧移动约 0.2px 后仍 < CONTACT_PX 35）应判撞。
  const s1 = newSurge(0)
  s1.obs.push({ id: 1, x: s1.px, y: PLAYER_Y + 33 / PHONE.h })
  assert.ok(surgeUpdate(s1, 0.001, PHONE).crashed, '纵向 33px（接触半径内）应撞')

  // 圆形判定：横、纵各 30px（距 42.43px > 35）。旧 AABB 因 |dx|,|dy| 都≤接触阈值会误撞，圆距应安全。
  const s2 = newSurge(0)
  s2.obs.push({
    id: 2,
    x: s2.px + 30 / PHONE.w,
    y: PLAYER_Y + 30 / PHONE.h
  })
  assert.equal(surgeUpdate(s2, 0.001, PHONE).crashed, false, '对角线各 30px（距 42.4px）圆形判定应安全')
})

test('星轨：碰撞阈值与 DOM 光球半径常量一致（玩家18 + 障碍17 = 35px）', () => {
  assert.equal(PLAYER_RADIUS_PX, 18)
  assert.equal(ENEMY_RADIUS_PX, 17)
  assert.equal(CONTACT_PX, 35)
})

test('星轨：未提供有效视口尺寸时本帧跳过（不崩溃、不误判）', () => {
  const s = newSurge(0)
  s.obs.push({ id: 1, x: s.px, y: PLAYER_Y })
  const res = surgeUpdate(s, 0.016, { w: 0, h: 0 })
  assert.equal(res.crashed, false)
  assert.equal(s.over, false)
})

test('星轨：撞到障碍即结束并爆发（crashed），障碍被移除', () => {
  const s = newSurge(0)
  s.obs.push({ id: 1, x: s.px, y: PLAYER_Y })
  const before = s.obs.length
  const res = surgeUpdate(s, 0.016, PHONE)
  assert.ok(res.crashed)
  assert.equal(s.over, true)
  assert.equal(s.obs.length, before - 1)
})

test('星轨：障碍越过底部被记为躲过并回收，不撞玩家', () => {
  const s = newSurge(0)
  // 放在远离玩家的另一侧、且接近底部，下帧越过 1+R
  s.obs.push({ id: 1, x: 0.02, y: 1 + OBSTACLE_R - 0.001 })
  const res = surgeUpdate(s, 0.05, PHONE)
  assert.equal(res.crashed, false)
  assert.ok(res.dodged.includes(1))
  assert.equal(s.obs.length, 0)
})

test('星轨：结束后 update 为 no-op', () => {
  const s = newSurge(0)
  s.over = true
  const score = s.score
  const res = surgeUpdate(s, 0.5, PHONE)
  assert.equal(res.crashed, false)
  assert.equal(s.score, score)
})
