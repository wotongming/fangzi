import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  TIERS,
  TIER_COUNT,
  FINAL_TIER,
  COMBO_WINDOW_MS,
  DROP_COOLDOWN_MS,
  DEATH_LINE_MS,
  SPAWN_MAX_BY_REACH,
  maxSpawnForReach,
  spawnWeightsForReach,
  clampReach,
  sameTier,
  nextTierIndex,
  isFinal,
  mergeScore,
  rollSpawnTier,
  canDrop,
  createOverline,
  updateOverline,
  clampAim,
  wallAimRange,
  ballRadius,
  maxDiameterRatio,
  gammaToGravityX,
  lerpGravityX,
  GRAVITY_DEADZONE_DEG,
  GRAVITY_MAX_TILT,
  planMerges,
  contactsForMerge,
  SPAWN_GRACE_MS,
  recordBest,
  type MergeNode
} from '../src/tools/mini-games/gpu-games/merge-planet/game/logic.ts'
import {
  SAVE_KEY,
  AUTO_SAVE_KEY,
  SAVE_VERSION,
  CHAIN_ID,
  serializeSave,
  validateSave,
  loadSave,
  persistSave,
  readSaveRaw,
  clearSave,
  formatSaveTime,
  type SaveBounds,
  type StorageLike
} from '../src/tools/mini-games/gpu-games/merge-planet/game/save.ts'

test('进化链：19 级，id/顺序正确，半径与基础分严格递增，终极为宇宙', () => {
  assert.equal(TIER_COUNT, 19)
  assert.equal(FINAL_TIER, 18)
  const ids = TIERS.map((t) => t.id)
  assert.deepEqual(ids, [
    'meteorite', 'moon', 'mercury', 'mars', 'earth', 'neptune', 'uranus', 'saturn',
    'jupiter', 'sun', 'redgiant', 'whitedwarf', 'neutronstar', 'blackhole',
    'globular', 'galaxy', 'galaxycluster', 'supercluster', 'cosmos'
  ])
  for (let i = 1; i < TIER_COUNT; i++) {
    assert.ok(TIERS[i]!.radius > TIERS[i - 1]!.radius, `level ${i} 半径应更大`)
    assert.ok(TIERS[i]!.baseScore > TIERS[i - 1]!.baseScore, `level ${i} 基础分应更高`)
  }
  assert.equal(TIERS[0]!.id, 'meteorite')
  assert.equal(TIERS[FINAL_TIER]!.id, 'cosmos')
  assert.equal(TIERS[FINAL_TIER]!.name, '宇宙')
  // 黑洞由旧顶级下移为 14
  assert.equal(TIERS[13]!.id, 'blackhole')
  assert.equal(TIERS[13]!.name, '黑洞')
})

test('升级链：从 0 逐级 +1 可合到 18 宇宙，18 触发终局且无 next', () => {
  let cur = 0
  const seq: number[] = []
  while (cur !== null) {
    seq.push(cur)
    cur = nextTierIndex(cur)
  }
  assert.equal(seq.length, 19)
  assert.equal(seq[0], 0)
  assert.equal(seq[18], FINAL_TIER)
  assert.equal(nextTierIndex(FINAL_TIER), null)
  assert.equal(isFinal(FINAL_TIER), true)
  assert.equal(isFinal(17), false)
})

test('动态投放池：maxReached→[0,hi] 区间随进度上移，开局只出低级', () => {
  // 开局 maxReached=0：只掉陨石(0)
  assert.equal(maxSpawnForReach(0), 0)
  assert.deepEqual(spawnWeightsForReach(0), [1])
  // 进度推进后上沿单调不减、不越过最终级
  let prev = -1
  for (let R = 0; R <= FINAL_TIER; R++) {
    const hi = maxSpawnForReach(R)
    assert.ok(hi >= 0 && hi <= FINAL_TIER - 1, `R=${R} hi=${hi} 越界`)
    assert.ok(hi >= prev - 1, `R=${R} 上沿不应倒退过多`)
    prev = hi
  }
  // 权重长度 = hi+1、全为正
  for (const R of [0, 4, 9, 13, 17]) {
    const w = spawnWeightsForReach(R)
    assert.equal(w.length, maxSpawnForReach(R) + 1)
    assert.ok(w.every((x) => x > 0))
  }
  // clampReach：非法/越界入参安全归正
  assert.equal(clampReach(NaN), 0)
  assert.equal(clampReach(-5), 0)
  assert.equal(clampReach(99), FINAL_TIER)
})

test('布局半径：三视口短边内最大球直径 ≤ 0.34，半径单调且不越界', () => {
  for (const shortEdge of [812, 1112, 860, 375]) {
    assert.ok(maxDiameterRatio(shortEdge) <= 0.34, `短边 ${shortEdge} 最大直径占比超限`)
    let prev = -1
    for (let t = 0; t < TIER_COUNT; t++) {
      const r = ballRadius(t, shortEdge)
      assert.ok(r > 0 && Number.isFinite(r))
      assert.ok(r > prev, `tier ${t} 半径应递增`)
      prev = r
    }
  }
})

test('同级判定：相等且合法才为真，越界为假', () => {
  assert.equal(sameTier(3, 3), true)
  assert.equal(sameTier(0, 0), true)
  assert.equal(sameTier(13, 13), true) // 黑洞(13)合法同级
  assert.equal(sameTier(3, 4), false)
  assert.equal(sameTier(-1, -1), false)
  assert.equal(sameTier(19, 19), false) // 越界（终级为 18）
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
  // 高级跃迁分差更大（指数曲线）
  assert.ok(TIERS[18]!.baseScore > TIERS[9]!.baseScore * 20)
})

test('动态投放随机：注入 rng 可复现，绝不投出超过当前进度上沿的球', () => {
  for (const R of [0, 4, 9, 13, 17]) {
    const hi = maxSpawnForReach(R)
    const out = new Set<number>()
    let calls = 0
    const rng = () => {
      const seq = [0.1, 0.5, 0.7, 0.95, 0.3, 0.62]
      return seq[calls++ % seq.length]!
    }
    for (let i = 0; i < 400; i++) {
      const t = rollSpawnTier(R, rng)
      out.add(t)
      assert.ok(t >= 0 && t <= hi, `R=${R} 投出越界球 tier=${t} hi=${hi}`)
    }
  }
  // 低级权重为正、高级上沿权重也为正（低级保留 + 上沿可出）
  for (const R of [0, 4, 9, 17]) {
    const w = spawnWeightsForReach(R)
    assert.ok(w[0]! > 0 && w[w.length - 1]! > 0)
  }
  // R=0 开局只出陨石
  for (let k = 0; k < 100; k++) assert.equal(rollSpawnTier(0, () => k / 100), 0)
  // 同一 rng 两次结果一致
  assert.equal(rollSpawnTier(9, () => 0.05), rollSpawnTier(9, () => 0.05))
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

test('全宽可投：墙内区间只受球半径+极小边距约束，不被 HUD 缩减', () => {
  const p = wallAimRange(375, 16, 3)
  assert.equal(p.min, 3 + 16)
  assert.equal(p.max, 375 - 3 - 16)
  // PC 宽屏左右都能贴边
  const pc = wallAimRange(1280, 20, 3)
  assert.equal(pc.min, 23)
  assert.equal(pc.max, 1280 - 23)
  // 过窄回退居中，不抛错
  const n = wallAimRange(10, 30, 3)
  assert.equal(n.min, n.max)
})

// —— 重力感应：gamma → gravity.x 映射 / 死区 / clamp / lerp ——

test('重力映射：死区内归 0，正/负倾角映射并 clamp 到 ±max，NaN 回退 0', () => {
  assert.equal(gammaToGravityX(0), 0)
  assert.equal(gammaToGravityX(3), 0) // 小于死区 5°
  assert.ok(gammaToGravityX(30) > 0)
  assert.equal(gammaToGravityX(30), GRAVITY_MAX_TILT) // 满偏 30° 到上限
  assert.equal(gammaToGravityX(-30), -GRAVITY_MAX_TILT)
  assert.equal(gammaToGravityX(90), GRAVITY_MAX_TILT) // 超幅 clamp
  assert.equal(gammaToGravityX(NaN), 0)
  assert.equal(gammaToGravityX(-90), -GRAVITY_MAX_TILT)
})

test('重力死区可注入：改小死区则小倾角不再归 0', () => {
  assert.equal(gammaToGravityX(0.5, { deadzoneDeg: 1 }), 0) // 0.5<1 仍归 0
  assert.ok(gammaToGravityX(2, { deadzoneDeg: 1 }) > 0) // 2>1 不归零
})

test('重力平滑：lerp 朝目标逼近且不跳变，静止目标收敛', () => {
  let g = 0
  for (let i = 0; i < 60; i++) g = lerpGravityX(g, 0.6)
  assert.ok(Math.abs(g - 0.6) < 0.01)
  // 首步只走 alpha，不直接跳到目标
  const step = lerpGravityX(0, 0.6, 0.12)
  assert.ok(step < 0.6 && step > 0)
  // 非法当前值兜底为 0 后仍朝目标平滑，结果有限且非 NaN
  const bad = lerpGravityX(NaN, 0.5)
  assert.ok(Number.isFinite(bad) && bad > 0 && bad < 0.5)
})

// —— 同级合并：首次接触即合（去整体相对速度门槛），四种接触形态都合 ——

const NOW = 100_000
function node(id: number, tier: number, x: number, y: number, r = 16, bornAt = NOW - 1000, vx = 0, vy = 0): MergeNode {
  return { id, tier, bornAt, x, y, r, vx, vy }
}

test('合并①垂直正碰：同级接触即升级', () => {
  const a = node(1, 0, 100, 84)
  const b = node(2, 0, 100, 116)
  assert.equal(contactsForMerge(a, b, NOW), true)
  const pairs = planMerges([a, b], NOW)
  assert.equal(pairs.length, 1)
  assert.equal(pairs[0]!.produced, 1)
})

test('合并②斜向非正碰：即使连线不垂直也合并，不要求正对', () => {
  const a = node(1, 2, 100, 100)
  const b = node(2, 2, 124, 120) // 斜向相切
  assert.equal(contactsForMerge(a, b, NOW), true)
  assert.equal(planMerges([a, b], NOW).length, 1)
})

test('合并③带切向速度擦碰：高切向速度不再阻止合并（旧整体速度门槛已去除）', () => {
  const a = node(1, 1, 100, 100, 16, NOW - 1000, 8, 0) // 横向高速滑动
  const b = node(2, 1, 131, 100, 16, NOW - 1000, 8, 0)
  assert.equal(contactsForMerge(a, b, NOW), true)
  assert.equal(planMerges([a, b], NOW).length, 1)
})

test('合并④保持贴合不分离：持续接触下一帧仍能合（持续接触兜底）', () => {
  const a = node(1, 0, 100, 100)
  const b = node(2, 0, 131, 100)
  // 连续两帧都判定可合（planMerges 每帧独立，贴合不分离就不会漏）
  assert.equal(contactsForMerge(a, b, NOW), true)
  assert.equal(contactsForMerge(a, b, NOW + 16), true)
})

test('合并：不同级永不合；保护期内新球不误合', () => {
  const a = node(1, 0, 100, 100)
  const b = node(2, 1, 131, 100) // 不同级
  assert.equal(contactsForMerge(a, b, NOW), false)
  assert.equal(planMerges([a, b], NOW).length, 0)
  // 刚出生（保护期内）的球不误合
  const fresh = node(3, 0, 100, 100, 16, NOW - 50)
  const old = node(4, 0, 131, 100, 16, NOW - 1000)
  assert.equal(contactsForMerge(fresh, old, NOW), false)
  assert.equal(planMerges([fresh, old], NOW).length, 0)
})

test('合并：一帧双同级只合法合并一对（去重，一球只合一个，确定性取先到）', () => {
  const a = node(1, 0, 100, 100)
  const b = node(2, 0, 131, 100)
  const c = node(3, 0, 162, 100)
  const pairs = planMerges([a, b, c], NOW)
  assert.equal(pairs.length, 1)
  // a 与 b 先合，c 本帧保留
  assert.deepEqual([pairs[0]!.a, pairs[0]!.b].sort(), [1, 2])
})

test('19 级表：高级同级斜向首碰即合（黑洞13 对 → 球状星团14），不同级不合', () => {
  const a = node(1, 13, 100, 100, 40)
  const b = node(2, 13, 150, 128, 40) // 斜向切向接触
  assert.equal(contactsForMerge(a, b, NOW), true)
  const pairs = planMerges([a, b], NOW)
  assert.equal(pairs.length, 1)
  assert.equal(pairs[0]!.produced, 14)
  // 黑洞13 与 宇宙18 不同级永不合
  const c = node(3, 18, 300, 100, 50)
  assert.equal(planMerges([a, c], NOW).length, 0)
})

test('最高分：刷新/保留/平局非新纪录，非法输入兜底 0', () => {
  assert.deepEqual(recordBest(120, 300), { best: 300, isNewBest: true })
  assert.deepEqual(recordBest(300, 120), { best: 300, isNewBest: false })
  assert.deepEqual(recordBest(300, 300), { best: 300, isNewBest: false })
  assert.deepEqual(recordBest(undefined as unknown as number, 50), { best: 50, isNewBest: true })
  assert.deepEqual(recordBest(100, NaN), { best: 100, isNewBest: false })
})

test('常量口径：连击窗口/冷却/死亡线为正且冷却小于窗口；动态投放表覆盖全部进度', () => {
  assert.ok(COMBO_WINDOW_MS > DROP_COOLDOWN_MS)
  assert.ok(DEATH_LINE_MS >= 1000)
  assert.equal(SPAWN_MAX_BY_REACH.length, FINAL_TIER) // R=0..17（R=18 即通关）
  // 早期开局只掉低级：R=0..1 上沿 ≤1
  assert.ok(maxSpawnForReach(0) === 0 && maxSpawnForReach(1) <= 1)
})

test('平衡仿真：理想合并模型下通关步数落在目标区间（折真实 ~25–30 分钟）', () => {
  // 与 scripts/merge-planet-balance-sim.mjs 同一模型：每投必合（最优放置），从低到高成对合并到宇宙
  function once(seed: number): number {
    let s = seed >>> 0
    const rng = () => {
      s = (s * 1103515245 + 12345) % 2147483648
      return s / 2147483648
    }
    const counts = new Array(TIER_COUNT).fill(0)
    let maxR = 0
    let steps = 0
    while (maxR < FINAL_TIER) {
      counts[rollSpawnTier(maxR, rng)!]++
      steps++
      for (let t = 0; t < TIER_COUNT - 1; t++) {
        while (counts[t] >= 2) {
          counts[t] -= 2
          counts[t + 1]++
        }
      }
      for (let t = TIER_COUNT - 1; t >= 0; t--) {
        if (counts[t] > 0) {
          if (t > maxR) maxR = t
          break
        }
      }
    }
    return steps
  }
  const out: number[] = []
  for (let k = 0; k < 300; k++) out.push(once(k * 7919 + 13))
  out.sort((a, b) => a - b)
  const median = out[150]!
  // 折算真实分钟 = 理想步数 ×1.6（错放开销）×5.5s/步 /60；目标中枢 25–30、可接受 20–35
  const estMin = (median * 1.6 * 5.5) / 60
  assert.ok(median >= 120 && median <= 260, `理想通关步数中位数=${median} 越界`)
  assert.ok(estMin >= 20 && estMin <= 35, `估算通关=${estMin.toFixed(1)}min 越界 20–35`)
})

test('旧最高分兼容：key 不变，读到旧数值即保留、不清档', () => {
  // 旧版本打出的高分作为 prev 直接保留，不因扩链重置
  assert.deepEqual(recordBest(9876, 120), { best: 9876, isNewBest: false })
  assert.deepEqual(recordBest(100, 50000), { best: 50000, isNewBest: true })
})

// —— 手动存档 / 读档（localStorage 单槽，与最高分隔离）——

const SAVE_BOUNDS: SaveBounds = { minX: 20, maxX: 1260, minY: 80, maxY: 860 }

function fakeStorage(seed: Record<string, string> = {}): StorageLike & { map: Map<string, string> } {
  const map = new Map(Object.entries(seed))
  return {
    map,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => map.set(k, v),
    removeItem: (k: string) => map.delete(k)
  }
}

test('存档①多球（含 tier0 与 tier18）序列化→校验往返：tier/位置/角度/速度/角速度/score/combo/待投一致', () => {
  const payload = serializeSave(
    {
      score: 12345,
      combo: 3,
      currentTier: 4,
      balls: [
        { tier: 0, x: 120.5, y: 700, angle: 0.4, vx: 1.2, vy: -0.6, av: 0.1 },
        { tier: 18, x: 900, y: 500, angle: 2.1, vx: -0.3, vy: 0.2, av: -0.05 }
      ]
    },
    1700000000000
  )
  const v = validateSave(payload, TIER_COUNT, SAVE_BOUNDS)
  assert.equal(v.ok, true)
  assert.equal(v.dropped, 0)
  const p = v.payload!
  assert.equal(p.score, 12345)
  assert.equal(p.combo, 3)
  assert.equal(p.currentTier, 4)
  assert.equal(p.balls.length, 2)
  const b0 = p.balls[0]!
  assert.equal(b0.tier, 0)
  assert.equal(b0.x, 120.5)
  assert.equal(b0.y, 700)
  assert.equal(b0.angle, 0.4)
  assert.equal(b0.vx, 1.2)
  assert.equal(b0.vy, -0.6)
  assert.equal(b0.av, 0.1)
  const b18 = p.balls[1]!
  assert.equal(b18.tier, 18)
  assert.equal(b18.x, 900)
  assert.equal(b18.angle, 2.1)
  // 连击窗口计时（lastMergeAt）不进存档：恢复时由组件重置为未触发
  assert.equal('lastMergeAt' in p, false)
  // dangerTimer 不进存档：恢复归零，不处在判负边缘
  assert.equal('dangerTimer' in p, false)
})

test('存档②损坏 JSON / 版本不符 / chain 不符 / tier 越界 / 位置越界(先clamp后丢球) / 负分 各自安全处理不抛错', () => {
  const st = fakeStorage()
  // 损坏 JSON
  st.setItem(SAVE_KEY, '{not-json')
  assert.equal(loadSave(SAVE_KEY, TIER_COUNT, SAVE_BOUNDS, st), null)

  // 版本不符
  st.setItem(SAVE_KEY, JSON.stringify({ ...serializeSave({ score: 1, combo: 1, currentTier: 0, balls: [] }), version: 99 }))
  assert.equal(loadSave(SAVE_KEY, TIER_COUNT, SAVE_BOUNDS, st), null)

  // chain 不符（进化表改版后旧档被安全忽略）
  st.setItem(SAVE_KEY, JSON.stringify({ ...serializeSave({ score: 1, combo: 1, currentTier: 0, balls: [] }), chain: 'old' }))
  assert.equal(loadSave(SAVE_KEY, TIER_COUNT, SAVE_BOUNDS, st), null)

  // tier 越界（19 级表外）→ 丢球，整体仍 ok（其余合法）
  const mixed = serializeSave({
    score: 100,
    combo: 1,
    currentTier: 2,
    balls: [
      { tier: 0, x: 100, y: 700, angle: 0, vx: 0, vy: 0, av: 0 },
      { tier: 99, x: 100, y: 700, angle: 0, vx: 0, vy: 0, av: 0 }
    ]
  })
  const v = validateSave(mixed, TIER_COUNT, SAVE_BOUNDS)
  assert.equal(v.ok, true)
  assert.equal(v.dropped, 1)
  assert.equal(v.payload!.balls.length, 1)
  assert.equal(v.payload!.balls[0]!.tier, 0)

  // 位置越界先 clamp 到场地内；非有限位置丢球（直接喂原始对象，绕过序列化预过滤）
  const raw = {
    version: SAVE_VERSION,
    tool: 'merge-planet',
    chain: CHAIN_ID,
    savedAt: 1000,
    score: 100,
    combo: 1,
    currentTier: 2,
    balls: [
      { tier: 1, x: -5000, y: 99999, angle: 0, vx: 0, vy: 0, av: 0 },
      { tier: 2, x: NaN, y: 100, angle: 0, vx: 0, vy: 0, av: 0 }
    ]
  }
  const v2 = validateSave(raw, TIER_COUNT, SAVE_BOUNDS)
  assert.equal(v2.ok, true)
  assert.equal(v2.dropped, 1) // NaN 球丢弃
  assert.equal(v2.payload!.balls.length, 1)
  assert.equal(v2.payload!.balls[0]!.x, SAVE_BOUNDS.minX)
  assert.equal(v2.payload!.balls[0]!.y, SAVE_BOUNDS.maxY)

  // 负分 → 回退 0，不抛错
  const neg = serializeSave({ score: -50, combo: 0, currentTier: 3, balls: [] })
  const v3 = validateSave(neg, TIER_COUNT, SAVE_BOUNDS)
  assert.equal(v3.ok, true)
  assert.equal(v3.payload!.score, 0)
  assert.equal(v3.payload!.combo, 1)
})

test('存档③覆盖存档（后写覆盖旧档）；重新开始不清存档；读写档不影响最高分 key', () => {
  const st = fakeStorage()
  const bestKey = 'fz-mini-games-best-placeholder'
  st.setItem(bestKey, '{"merge-planet:classic":8888}')

  const first = serializeSave({ score: 100, combo: 1, currentTier: 0, balls: [{ tier: 0, x: 100, y: 700, angle: 0, vx: 0, vy: 0, av: 0 }] }, 1000)
  persistSave(first, SAVE_KEY, st)
  const second = serializeSave({ score: 500, combo: 2, currentTier: 4, balls: [] }, 2000)
  persistSave(second, SAVE_KEY, st)
  const loaded = loadSave(SAVE_KEY, TIER_COUNT, SAVE_BOUNDS, st)
  assert.equal(loaded!.score, 500) // 后写覆盖
  assert.equal(loaded!.combo, 2)
  assert.equal(loaded!.currentTier, 4)

  // 「重新开始」只清当前局，绝不调用 clearSave：存档仍在
  assert.ok(readSaveRaw(SAVE_KEY, st))
  // 最高分 key 内容原样未动
  assert.equal(st.getItem(bestKey), '{"merge-planet:classic":8888}')

  // 仅显式清除才删除存档
  clearSave(SAVE_KEY, st)
  assert.equal(loadSave(SAVE_KEY, TIER_COUNT, SAVE_BOUNDS, st), null)
  // 显式清档也不动最高分
  assert.equal(st.getItem(bestKey), '{"merge-planet:classic":8888}')
})

test('存档④时间格式化 MM-DD HH:mm；无存档/非法时间返回空串；常量口径', () => {
  assert.match(formatSaveTime(1700000000000), /^\d{2}-\d{2} \d{2}:\d{2}$/)
  assert.equal(formatSaveTime(NaN), '')
  assert.equal(formatSaveTime(0), '')
  assert.equal(SAVE_VERSION, 1)
  assert.equal(CHAIN_ID, 'merge-planet:tiers:19:v1')
})

test('自动快照：独立键 + maxReached 往返 + 与手动存档互不覆盖', () => {
  const st: StorageLike = { store: new Map(),
    getItem(k: string) { return this.store.get(k) ?? null },
    setItem(k: string, v: string) { this.store.set(k, v) },
    removeItem(k: string) { this.store.delete(k) } }
  // 手动档先写一个
  const manual = serializeSave({ score: 12, combo: 2, currentTier: 3, maxReached: 5, balls: [{ tier: 3, x: 100, y: 200, angle: 0, vx: 0, vy: 0, av: 0 }] })
  persistSave(manual, SAVE_KEY, st)
  // 自动快照写另一个局面
  const auto = serializeSave({ score: 99, combo: 1, currentTier: 7, maxReached: 11, balls: [{ tier: 7, x: 300, y: 400, angle: 0, vx: 0.1, vy: -0.2, av: 0 }] })
  persistSave(auto, AUTO_SAVE_KEY, st)
  // 两键并存
  assert.ok(readSaveRaw(SAVE_KEY, st))
  assert.ok(readSaveRaw(AUTO_SAVE_KEY, st))
  // 自动快照往返字段完整（含 maxReached）
  const back = loadSave(AUTO_SAVE_KEY, TIER_COUNT, SAVE_BOUNDS, st)
  assert.ok(back)
  assert.equal(back!.score, 99)
  assert.equal(back!.currentTier, 7)
  assert.equal(back!.maxReached, 11)
  assert.equal(back!.balls.length, 1)
  assert.equal(back!.balls[0]!.tier, 7)
  // 手动档未被自动快照污染
  const m = loadSave(SAVE_KEY, TIER_COUNT, SAVE_BOUNDS, st)
  assert.equal(m!.score, 12)
  assert.equal(m!.maxReached, 5)
  // 清自动快照不动手动档
  clearSave(AUTO_SAVE_KEY, st)
  assert.equal(loadSave(AUTO_SAVE_KEY, TIER_COUNT, SAVE_BOUNDS, st), null)
  assert.ok(loadSave(SAVE_KEY, TIER_COUNT, SAVE_BOUNDS, st))
})

test('自动快照：maxReached 缺省/越界安全归正，损坏 JSON 当无快照', () => {
  const st: StorageLike = { store: new Map(),
    getItem(k: string) { return this.store.get(k) ?? null },
    setItem(k: string, v: string) { this.store.set(k, v) },
    removeItem(k: string) { this.store.delete(k) } }
  // 旧档无 maxReached 字段 → 兜底取 currentTier
  const legacy = serializeSave({ score: 5, combo: 1, currentTier: 4, balls: [] })
  const stripped = { ...legacy } as Record<string, unknown>
  delete stripped.maxReached
  persistSave(stripped as never, AUTO_SAVE_KEY, st)
  const back = loadSave(AUTO_SAVE_KEY, TIER_COUNT, SAVE_BOUNDS, st)
  assert.equal(back!.maxReached, 4)
  // 越界 maxReached → 兜底取 currentTier(4)，不崩
  st.setItem(AUTO_SAVE_KEY, JSON.stringify({ ...legacy, maxReached: 999 }))
  const bad = loadSave(AUTO_SAVE_KEY, TIER_COUNT, SAVE_BOUNDS, st)
  assert.equal(bad!.maxReached, 4)
  // 损坏 JSON → null
  st.setItem(AUTO_SAVE_KEY, '{{oops')
  assert.equal(loadSave(AUTO_SAVE_KEY, TIER_COUNT, SAVE_BOUNDS, st), null)
})
