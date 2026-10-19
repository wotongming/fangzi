/**
 * 007 炫光系列（mini-games 升级）毫秒级单测：
 *  - 粒子系统/震屏纯逻辑守恒与生命回收
 *  - 设备分级与运行时降档顺序
 *  - 炫光连消判定（复用 match3-core）：合法交换得分、非相邻无效、可走步判定
 *  - 旧存储数据向后兼容（无 settings 回退默认、部分设置、非法粒子档回退、旧 best 不丢）
 *
 * 这些模块全部不依赖 DOM / 路径别名，可用 node --import tsx --test 直接跑。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ParticleSystem, ShakeState } from '../src/tools/mini-games/engine/fx'
import { applyManual, isFloor, pickQuality, stepDown } from '../src/tools/mini-games/engine/quality'
import { hasPossibleMove, newBoard, tryMove } from '../src/tools/mini-games/gpu-games/glow-match/logic'
import { COLS, ROWS, cloneGrid, hasMatch, swap } from '../src/tools/mini-games/lib/match3-core'
import { normalizeState } from '../src/tools/mini-games/lib/normalize-state'

// —— 粒子系统 ——
test('粒子爆发数量守恒且受容量约束', () => {
  const ps = new ParticleSystem(10)
  assert.equal(ps.burst(0, 0, { count: 5 }), 5)
  assert.equal(ps.aliveCount, 5)
  // 只剩 5 个位置，请求 8 个只加入 5，绝不越界
  assert.equal(ps.burst(10, 10, { count: 8 }), 5)
  assert.equal(ps.aliveCount, 10)
  ps.burst(0, 0, { count: 3 })
  assert.equal(ps.aliveCount, 10)
})

test('粒子推进后到期粒子被回收且最终清空', () => {
  const ps = new ParticleSystem(50)
  ps.burst(0, 0, { count: 30, life: 0.1 })
  ps.burst(0, 0, { count: 10, life: 1 })
  assert.equal(ps.aliveCount, 40)
  for (let i = 0; i < 8; i++) ps.step(0.05)
  assert.equal(ps.aliveCount, 10) // 0.1s 寿命的 30 个已消失
  ps.step(5)
  assert.equal(ps.aliveCount, 0)
})

test('setCap 收缩时就地截断', () => {
  const ps = new ParticleSystem(100)
  ps.burst(0, 0, { count: 60 })
  ps.setCap(20)
  assert.equal(ps.aliveCount, 20)
})

// —— 震屏 ——
test('震幅叠加有上限且随时间回落到 0', () => {
  const s = new ShakeState(18)
  s.add(30)
  assert.ok(s.mag <= 18)
  assert.notDeepEqual(s.offset(), { x: 0, y: 0 })
  s.update(2)
  assert.equal(s.mag, 0)
  assert.deepEqual(s.offset(), { x: 0, y: 0 })
})

// —— 设备分级与降档 ——
test('pickQuality 按后端与设备给档', () => {
  assert.equal(pickQuality({ backend: 'canvas2d', dpr: 3 }).particleCap, 220)
  assert.equal(pickQuality({ backend: 'canvas2d', dpr: 3 }).dprCap, 1.5) // canvas2d 锁低 DPR
  const hi = pickQuality({ backend: 'webgl2', cores: 8, memory: 8, dpr: 2 })
  assert.ok(hi.particleCap >= 1400)
  assert.equal(hi.bloomPasses, 2)
  const lo = pickQuality({ backend: 'webgl2', cores: 2, dpr: 2 })
  assert.ok(lo.particleCap < hi.particleCap)
})

test('stepDown 依次牺牲 辉光→DPR→粒子，且不低于地板', () => {
  let q = pickQuality({ backend: 'webgl2', cores: 8, memory: 8, dpr: 2 })
  const bloom0 = q.bloomPasses
  q = stepDown(q)
  assert.equal(q.bloomPasses, bloom0 - 1) // 先降辉光
  q = stepDown(q)
  assert.equal(q.bloomPasses, 0)
  const dprBefore = q.dprCap
  q = stepDown(q)
  assert.ok(q.dprCap < dprBefore) // 再降 DPR
  // 连降到底
  for (let i = 0; i < 12; i++) q = stepDown(q)
  assert.ok(isFloor(q))
})

test('applyManual low 关辉光、锁 DPR=1、压粒子；high 放开', () => {
  const base = pickQuality({ backend: 'webgl2', cores: 8, memory: 8, dpr: 2 })
  const low = applyManual(base, 'low')
  assert.equal(low.bloomPasses, 0)
  assert.equal(low.dprCap, 1)
  assert.ok(low.particleCap <= 260)
  const high = applyManual(base, 'high')
  assert.ok(high.particleCap >= base.particleCap)
  assert.ok(high.bloomPasses >= 2)
})

// —— 炫光连消判定 ——
function findProductiveMove(g: number[][]) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const candidates: Array<[number, number]> = []
      if (c + 1 < COLS) candidates.push([r, c + 1])
      if (r + 1 < ROWS) candidates.push([r + 1, c])
      for (const b of candidates) {
        const t = cloneGrid(g)
        swap(t, [r, c], b)
        if (hasMatch(t)) return { a: [r, c] as [number, number], b }
      }
    }
  }
  return null
}

test('新棋盘生成时无三连且（几乎）必有可走步', () => {
  for (let seed = 0; seed < 20; seed++) {
    const g = newBoard()
    assert.equal(hasMatch(g), false)
    assert.ok(hasPossibleMove(g), `seed ${seed} 应存在可消交换`)
  }
})

test('合法交换：得分=消除数*20、首波格位带色相、棋盘更新', () => {
  let g = newBoard()
  let mv = findProductiveMove(g)
  let guard = 0
  while (!mv && guard++ < 10) {
    g = newBoard()
    mv = findProductiveMove(g)
  }
  assert.ok(mv, '应能找到一个合法可消交换')
  if (!mv) return
  const res = tryMove(g, mv.a, mv.b)
  assert.equal(res.ok, true)
  assert.ok(res.gained > 0)
  assert.equal(res.gained % 20, 0)
  assert.ok(res.cells.length >= 3)
  assert.ok(res.cells.every((cell) => cell.hue >= 0 && cell.hue <= 360))
  assert.equal(hasMatch(res.grid), false) // 结算稳定后无残留连珠
})

test('非相邻交换判定为无效且不改分', () => {
  const g = newBoard()
  const res = tryMove(g, [0, 0], [2, 2])
  assert.equal(res.ok, false)
  assert.equal(res.gained, 0)
  assert.equal(res.cells.length, 0)
})

// —— 存储向后兼容 ——
test('旧数据（仅 best、无 settings）归一化回退默认且不丢分', () => {
  const s = normalizeState({ best: { '2048:classic': 1234, 'match3:normal': 88 } })
  assert.equal(s.best['2048:classic'], 1234)
  assert.equal(s.best['match3:normal'], 88)
  assert.deepEqual(s.settings, { muted: false, vibrate: true, particle: 'auto' })
})

test('部分/非法设置正确合并与回退', () => {
  const s = normalizeState({ best: {}, settings: { muted: true, particle: 'bogus' as 'auto' } })
  assert.equal(s.settings.muted, true)
  assert.equal(s.settings.vibrate, true) // 缺失回退默认
  assert.equal(s.settings.particle, 'auto') // 非法值回退默认
})

test('空/undefined 输入安全回退到空 best', () => {
  const s = normalizeState(undefined)
  assert.deepEqual(s.best, {})
  assert.equal(s.settings.vibrate, true)
})
