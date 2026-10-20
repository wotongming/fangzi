import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  TIERS,
  TIER_COUNT,
  FINAL_TIER,
  COMBO_WINDOW_MS,
  DROP_COOLDOWN_MS,
  DEATH_LINE_MS,
  MAX_SPAWN_TIER,
  sameTier,
  nextTierIndex,
  isFinal,
  mergeScore,
  rollSpawnTier,
  canDrop,
  createOverline,
  updateOverline,
  clampAim,
  planAimRange,
  rectsOverlap,
  AIM_HUD_GAP,
  recordBest,
  type Rect2
} from '../src/tools/mini-games/gpu-games/merge-planet/game/logic.ts'

test('进化链：11 级，半径与基础分严格递增，终极为黑洞', () => {
  assert.equal(TIER_COUNT, 11)
  assert.equal(FINAL_TIER, 10)
  for (let i = 1; i < TIER_COUNT; i++) {
    assert.ok(TIERS[i]!.radius > TIERS[i - 1]!.radius, `level ${i} 半径应更大`)
    assert.ok(TIERS[i]!.baseScore > TIERS[i - 1]!.baseScore, `level ${i} 基础分应更高`)
  }
  assert.equal(TIERS[0]!.id, 'meteorite')
  assert.equal(TIERS[FINAL_TIER]!.id, 'blackhole')
  assert.equal(TIERS[FINAL_TIER]!.name, '黑洞')
})

test('同级判定：相等且合法才为真，越界为假', () => {
  assert.equal(sameTier(3, 3), true)
  assert.equal(sameTier(0, 0), true)
  assert.equal(sameTier(3, 4), false)
  assert.equal(sameTier(-1, -1), false)
  assert.equal(sameTier(11, 11), false)
})

test('升级链：逐级 +1 到黑洞，黑洞与越界不可再升', () => {
  let cur = 0
  const seq: number[] = []
  while (cur !== null) {
    seq.push(cur)
    cur = nextTierIndex(cur)
  }
  assert.deepEqual(seq, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  assert.equal(nextTierIndex(FINAL_TIER), null)
  assert.equal(nextTierIndex(-2), null)
  assert.equal(isFinal(FINAL_TIER), true)
  assert.equal(isFinal(9), false)
})

test('计分：连击 1 取基础分，连击递增 ×1.3，非法层级/连击归零或按 1', () => {
  assert.equal(mergeScore(4, 1), TIERS[4]!.baseScore)
  assert.equal(mergeScore(4, 2), Math.round(TIERS[4]!.baseScore * 1.3))
  const s1 = mergeScore(7, 1)
  const s3 = mergeScore(7, 3)
  assert.ok(s3 > s1)
  assert.equal(mergeScore(99, 1), 0)
  assert.equal(mergeScore(5, 0), TIERS[5]!.baseScore) // 非法 combo 按 1
  assert.equal(mergeScore(5, NaN), TIERS[5]!.baseScore)
})

test('投放随机：只在前 4 级，注入 rng 可复现且低级更常见', () => {
  const out = new Set<number>()
  let calls = 0
  const rng = () => {
    // 确定性轮转，覆盖权重区间
    const seq = [0.1, 0.5, 0.7, 0.95, 0.3, 0.62]
    return seq[calls++ % seq.length]!
  }
  for (let i = 0; i < 400; i++) {
    const t = rollSpawnTier(rng)
    out.add(t)
    assert.ok(t >= 0 && t <= MAX_SPAWN_TIER)
  }
  // 0.1→陨石(0)、0.5 落在月球/水星区间、0.95→火星(3)，集合至少覆盖 0/2/3
  assert.ok(out.has(0))
  assert.ok(out.has(3))
  // 同一 rng 序列两次结果一致
  const a = rollSpawnTier(() => 0.05)
  const b = rollSpawnTier(() => 0.05)
  assert.equal(a, b)
})

test('投放闸门：下落占用中/冷却未到不可投，到点放行（含边界）', () => {
  const t0 = 1000
  assert.equal(canDrop(t0, t0, true), false) // 占用中
  assert.equal(canDrop(t0, t0, false), false) // 冷却 0ms
  assert.equal(canDrop(t0 + DROP_COOLDOWN_MS - 1, t0, false), false)
  assert.equal(canDrop(t0 + DROP_COOLDOWN_MS, t0, false), true) // 边界放行
  assert.equal(canDrop(t0 + 9999, t0, false), true)
})

test('越顶计时：瞬时擦过清零不死；持续到阈值判负，过半进入警告', () => {
  const st = createOverline()
  // 先短暂越过 100ms 就离开
  let r = updateOverline(st, true, 100)
  assert.equal(r.dead, false)
  r = updateOverline(st, false, 16)
  assert.equal(r.dead, false)
  assert.equal(st.timer, 0)
  // 持续越过，中途先 warning 后 dead
  let warningSeen = false
  for (let i = 0; i < 200; i++) {
    r = updateOverline(st, true, 50)
    if (r.warning && !r.dead) warningSeen = true
    if (r.dead) break
  }
  assert.equal(r.dead, true)
  assert.ok(warningSeen, '应在判负前出现警告态')
  // dead 后保持 dead
  assert.equal(updateOverline(st, false, 50).dead, true)
})

test('越顶阈值可注入：默认 1750ms，改小则更快判负', () => {
  const st = createOverline()
  let r = updateOverline(st, true, 500, 300)
  assert.equal(r.dead, true)
})

test('瞄准夹取：越界收敛、NaN 归中、min>max 归中', () => {
  assert.equal(clampAim(-50, 40, 360), 40)
  assert.equal(clampAim(999, 40, 360), 360)
  assert.equal(clampAim(200, 40, 360), 200)
  assert.equal(clampAim(NaN, 40, 360), 200)
  assert.equal(clampAim(10, 300, 100), 200)
})

test('避让区间：无 HUD 时退回纯墙内区间', () => {
  const p = planAimRange({ width: 375, radius: 16, glow: 14, wallPad: 26, bandY: 0, bandH: 76 })
  assert.equal(p.min, 26 + 30)
  assert.equal(p.max, 375 - 26 - 30)
})

test('避让区间：右侧胶囊把右界内缩，球贴 max 右缘不相交', () => {
  const reach = 16 + 14
  const capsule: Rect2 = { x: 300, y: 8, w: 62, h: 34 }
  const p = planAimRange({ width: 375, radius: 16, glow: 14, wallPad: 26, bandY: 0, bandH: 76, avoid: [capsule] })
  // max = capsule.x - reach - GAP
  assert.equal(p.max, 300 - reach - AIM_HUD_GAP)
  // 球包围盒（含发光）贴 max 时与胶囊无交集
  const ball: Rect2 = { x: p.max - reach, y: 0, w: reach * 2, h: 76 }
  assert.equal(rectsOverlap(ball, capsule), false)
  // 左界不受右侧胶囊影响，仍是墙内左界
  assert.equal(p.min, 26 + reach)
})

test('避让区间：左侧分数 HUD 把左界内缩，球贴 min 左缘不相交', () => {
  const reach = 16 + 14
  const scoreHud: Rect2 = { x: 0, y: 10, w: 46, h: 38 }
  const p = planAimRange({ width: 375, radius: 16, glow: 14, wallPad: 26, bandY: 0, bandH: 76, avoid: [scoreHud] })
  assert.equal(p.min, scoreHud.x + scoreHud.w + reach + AIM_HUD_GAP)
  const ball: Rect2 = { x: p.min - reach, y: 0, w: reach * 2, h: 76 }
  assert.equal(rectsOverlap(ball, scoreHud), false)
})

test('避让区间：胶囊随长文案变宽自动进一步内缩（依据实际包围盒，非写死常数）', () => {
  const reach = 16 + 14
  const shortCap: Rect2 = { x: 313, y: 8, w: 49, h: 34 } // 短名
  const longCap: Rect2 = { x: 286, y: 8, w: 76, h: 34 } // 长星球名更宽
  const a = planAimRange({ width: 375, radius: 16, glow: 14, wallPad: 26, bandY: 0, bandH: 76, avoid: [shortCap] })
  const b = planAimRange({ width: 375, radius: 16, glow: 14, wallPad: 26, bandY: 0, bandH: 76, avoid: [longCap] })
  assert.ok(b.max < a.max, '更宽胶囊应把右界压得更左')
  // 两档右界均对应各自胶囊左缘
  assert.equal(a.max, shortCap.x - reach - AIM_HUD_GAP)
  assert.equal(b.max, longCap.x - reach - AIM_HUD_GAP)
})

test('避让区间：HUD 在滑轨带垂直之外时不做水平避让', () => {
  const farHud: Rect2 = { x: 300, y: 400, w: 60, h: 34 }
  const p = planAimRange({ width: 375, radius: 16, glow: 14, wallPad: 26, bandY: 0, bandH: 76, avoid: [farHud] })
  assert.equal(p.max, 375 - 26 - 30)
})

test('避让区间：左右 HUD 同时避让后仍保留可投区间（min<max）', () => {
  const reach = 16 + 14
  const left: Rect2 = { x: 0, y: 10, w: 46, h: 38 }
  const right: Rect2 = { x: 300, y: 8, w: 62, h: 34 }
  const p = planAimRange({ width: 375, radius: 16, glow: 14, wallPad: 26, bandY: 0, bandH: 76, avoid: [left, right] })
  assert.ok(p.min < p.max)
  for (const c of [p.min, (p.min + p.max) / 2, p.max]) {
    const ball: Rect2 = { x: c - reach, y: 0, w: reach * 2, h: 76 }
    assert.equal(rectsOverlap(ball, left), false)
    assert.equal(rectsOverlap(ball, right), false)
  }
})

test('避让区间：窄屏+超宽 HUD 压没时回退居中，保证至少一个可投点', () => {
  const huge: Rect2 = { x: 0, y: 8, w: 375, h: 34 }
  const p = planAimRange({ width: 375, radius: 16, glow: 14, wallPad: 26, bandY: 0, bandH: 76, avoid: [huge] })
  assert.equal(p.min, p.max)
  assert.ok(Number.isFinite(p.min))
  assert.equal(p.min, 375 / 2)
})

test('最高分：刷新/保留/平局非新纪录，非法输入兜底 0', () => {
  assert.deepEqual(recordBest(120, 300), { best: 300, isNewBest: true })
  assert.deepEqual(recordBest(300, 120), { best: 300, isNewBest: false })
  assert.deepEqual(recordBest(300, 300), { best: 300, isNewBest: false })
  assert.deepEqual(recordBest(undefined as unknown as number, 50), { best: 50, isNewBest: true })
  assert.deepEqual(recordBest(100, NaN), { best: 100, isNewBest: false })
})

test('常量口径：连击窗口/冷却/死亡线为正且冷却小于窗口', () => {
  assert.ok(COMBO_WINDOW_MS > DROP_COOLDOWN_MS)
  assert.ok(DEATH_LINE_MS >= 1000)
  assert.equal(MAX_SPAWN_TIER, 3)
})
