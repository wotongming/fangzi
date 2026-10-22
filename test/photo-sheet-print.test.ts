import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  A4_PORTRAIT,
  fitInto,
  gridCells,
  groupPages,
  headerHeight,
  mmToPt,
  normalizeConfig,
  pageCount,
  paperSize,
  perPage,
  rotateDims
} from '../src/tools/photo-sheet-print/lib/layout.ts'

test('pageCount: 空输入为 0 页，按每页取整向上取整', () => {
  assert.equal(pageCount(0, 2), 0)
  assert.equal(pageCount(5, 2), 3)
  assert.equal(pageCount(4, 2), 2)
  assert.equal(pageCount(1, 1), 1)
  assert.equal(pageCount(6, 6), 1)
})

test('groupPages: 按页分组，空数组返回空', () => {
  assert.deepEqual(groupPages([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
  assert.deepEqual(groupPages([1, 2], 2), [[1, 2]])
  assert.deepEqual(groupPages([], 2), [])
})

test('perPage = 列 × 行', () => {
  const cfg = normalizeConfig({ cols: 2, rows: 3 })
  assert.equal(perPage(cfg), 6)
})

test('normalizeConfig: 行列钳到 1..6，缺省方向纵向，间距兜底', () => {
  const cfg = normalizeConfig({ cols: 99, rows: -3, marginMm: -1 })
  assert.equal(cfg.cols, 6)
  assert.equal(cfg.rows, 1)
  assert.equal(cfg.orientation, 'portrait')
  assert.equal(cfg.marginMm, 4)
  assert.ok(cfg.gapMm >= 0)
})

test('mmToPt: 25.4mm = 72pt', () => {
  assert.ok(Math.abs(mmToPt(25.4) - 72) < 1e-9)
  assert.equal(mmToPt(-5), 0)
})

test('paperSize: 纵向/横向尺寸互换', () => {
  assert.deepEqual(paperSize('portrait'), A4_PORTRAIT)
  const land = paperSize('landscape')
  assert.equal(land.w, A4_PORTRAIT.h)
  assert.equal(land.h, A4_PORTRAIT.w)
})

test('gridCells: 单元格数 = 列×行，全部落在纸面内并留出边距', () => {
  const cfg = normalizeConfig({ cols: 2, rows: 2, marginMm: 12, gapMm: 4 })
  const cells = gridCells(paperSize('portrait'), cfg)
  assert.equal(cells.length, 4)
  const m = mmToPt(12)
  for (const c of cells) {
    assert.ok(c.x >= m - 1e-6 && c.x + c.w <= A4_PORTRAIT.w - m + 1e-6)
    assert.ok(c.y >= m - 1e-6 && c.y + c.h <= A4_PORTRAIT.h - m + 1e-6)
    assert.ok(c.w > 0 && c.h > 0)
  }
})

test('rotateDims: 90/270 交换宽高，0/180 不变', () => {
  assert.deepEqual(rotateDims(100, 200, 90), { w: 200, h: 100 })
  assert.deepEqual(rotateDims(100, 200, 270), { w: 200, h: 100 })
  assert.deepEqual(rotateDims(100, 200, 0), { w: 100, h: 200 })
  assert.deepEqual(rotateDims(100, 200, 180), { w: 100, h: 200 })
})

test('fitInto: contain 不裁剪不变形，居中留白', () => {
  const f = fitInto(100, 200, 200, 200)
  assert.equal(f.h, 200)
  assert.ok(Math.abs(f.w - 100) < 1e-9)
  assert.ok(f.x > 0)
  const wide = fitInto(200, 100, 200, 200)
  assert.equal(wide.w, 200)
  assert.ok(wide.h < 200)
  assert.ok(wide.y > 0)
  assert.deepEqual(fitInto(0, 0, 100, 100), { w: 0, h: 0, x: 0, y: 0 })
})

test('headerHeight: 有标题占两行高度，空标题为 0', () => {
  assert.equal(headerHeight(''), 0)
  assert.ok(headerHeight('标题') > 0)
})
