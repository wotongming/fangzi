import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canStartPull,
  pullOffset,
  pullProgress,
  decideRelease,
  pullHint,
  PULL_SEARCH_RATIO,
  PULL_DAMPING
} from '../reusable-module/use-pull-to-search/use-pull-to-search.ts'

const VH = 800

test('scrollTop=0 且垂直向下可开启；非顶部不触发', () => {
  assert.equal(canStartPull({ scrollTop: 0, dy: 60, dx: 0 }), true)
  assert.equal(canStartPull({ scrollTop: 12, dy: 60, dx: 0 }), false)
  assert.equal(canStartPull({ scrollTop: -0, dy: 0, dx: 0 }), false)
})

test('向上（dy<0）不触发', () => {
  assert.equal(canStartPull({ scrollTop: 0, dy: -40, dx: 0 }), false)
})

test('水平滑动不误触：纵向不占主导则不开启', () => {
  assert.equal(canStartPull({ scrollTop: 0, dy: 10, dx: 60 }), false)
  assert.equal(canStartPull({ scrollTop: 0, dy: 60, dx: 10 }), true)
})

test('阈值边界：0.24 视口高不触发，>=0.25 触发跳转', () => {
  const below = PULL_SEARCH_RATIO * VH * 0.96
  const at = PULL_SEARCH_RATIO * VH
  assert.equal(decideRelease(below, VH), 'bounce')
  assert.equal(decideRelease(at, VH), 'search')
  assert.equal(decideRelease(PULL_SEARCH_RATIO * VH + 1, VH), 'search')
})

test('阻尼：视觉位移小于原始位移且封顶，不超过阈值线过多', () => {
  const raw = PULL_SEARCH_RATIO * VH
  const off = pullOffset(raw, VH)
  assert.ok(off < raw)
  assert.ok(Math.abs(off - raw * PULL_DAMPING) < 1e-9)
  const capped = pullOffset(raw * 4, VH)
  assert.ok(capped <= PULL_SEARCH_RATIO * VH * 1.15 + 1e-9)
})

test('进度 clamp 在 0~1，负值/非法视口高归零', () => {
  assert.equal(pullProgress(-20, VH), 0)
  assert.equal(pullProgress(9999, VH), 1)
  assert.equal(pullProgress(100, 0), 0)
  assert.equal(pullOffset(-10, VH), 0)
})

test('松手判定：达标 search，否则 bounce；非法视口高安全回弹', () => {
  assert.equal(decideRelease(0, VH), 'bounce')
  assert.equal(decideRelease(300, 0), 'bounce')
})

test('提示文案随进度切换', () => {
  assert.equal(pullHint(pullProgress(10, VH)), '继续下拉找方子')
  assert.equal(pullHint(1), '松开搜索')
})
