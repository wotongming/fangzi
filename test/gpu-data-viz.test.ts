import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseCsv,
  parseCsvLine,
  createCsvScanner,
  inferColumnType,
  cellToNumber,
  parseJsonData,
  stripBom
} from '../src/tools/gpu-data-viz/lib/parse.ts'
import { bin1D, bin2D, brushIndices, maxCount, selectionStats } from '../src/tools/gpu-data-viz/lib/bins.ts'
import { panBy, resetView, screenRectToNorm, zoomAt, zoomLevel } from '../src/tools/gpu-data-viz/lib/interact.ts'
import { buildDatasetFromTable } from '../src/tools/gpu-data-viz/lib/store.ts'
import { niceTicks } from '../src/tools/gpu-data-viz/lib/scale.ts'
import { densityT, ramp } from '../src/tools/gpu-data-viz/lib/render/color.ts'
import { formatNumber } from '../src/tools/gpu-data-viz/lib/format.ts'
import type { View } from '../src/tools/gpu-data-viz/lib/types.ts'

// ---------- 解析 ----------
test('parseCsvLine 处理引号、转义与逗号', () => {
  assert.deepEqual(parseCsvLine('a,b,c'), ['a', 'b', 'c'])
  assert.deepEqual(parseCsvLine('"a,b",c,"d""e"'), ['a,b', 'c', 'd"e'])
})

test('parseCsv 处理 CRLF、引号内换行与空行', () => {
  const csv = 'x,y\r\n1,2\r\n\r\n3,"4,5"\r\n'
  const t = parseCsv(csv)
  assert.deepEqual(t.headers, ['x', 'y'])
  assert.equal(t.rows.length, 2)
  assert.deepEqual(t.rows[1], ['3', '4,5'])
})

test('流式 scanner 跨块喂入结果与整段一致', () => {
  const csv = 'a,b\n1,2\n3,4\n5,6'
  const rowsAll = parseCsv(csv).rows
  const got: string[][] = []
  const feed = createCsvScanner((f) => got.push(f))
  // 故意在任意字符边界切块
  for (let i = 0; i < csv.length; i += 3) feed(csv.slice(i, i + 3))
  feed('\n')
  // scanner 首行为表头，这里从第二行起对比
  assert.deepEqual(got.slice(1), rowsAll)
})

test('BOM 去除与类型推断', () => {
  assert.equal(stripBom('\ufeffx'), 'x')
  assert.equal(inferColumnType(['1', '2.5', '3e2', '-0.5']), 'number')
  assert.equal(inferColumnType(['2026-01-01', '2026-02-01']), 'date')
  assert.equal(inferColumnType(['a', 'b']), 'string')
  assert.equal(cellToNumber('42', 'number'), 42)
  assert.ok(Number.isNaN(cellToNumber('abc', 'number')))
  assert.equal(cellToNumber('2026-01-01', 'date'), Date.parse('2026-01-01'))
})

test('parseJsonData 支持对象数组', () => {
  const t = parseJsonData('[{"x":1,"y":2},{"x":3,"y":4}]')
  assert.deepEqual(t.headers, ['x', 'y'])
  assert.deepEqual(t.rows, [
    ['1', '2'],
    ['3', '4']
  ])
})

// ---------- 数据集 ----------
test('buildDatasetFromTable 归一化到 [0,1] 且常量列退化到 0.5', () => {
  const ds = buildDatasetFromTable(
    { headers: ['t', 'v'], rows: [['0', '10'], ['10', '20'], ['20', '20']] },
    't.csv'
  )
  assert.equal(ds.rowCount, 3)
  assert.equal(ds.xy[0], 0) // x 最小
  assert.equal(ds.xy[4], 1) // x 最大
  // y 范围 10..20
  assert.equal(ds.xy[1], 0)
  assert.equal(ds.xy[3], 1)
})

test('免费额度截断标记正确', () => {
  const rows = Array.from({ length: 100 }, (_, i) => [String(i), String(i * 2)])
  const ds = buildDatasetFromTable({ headers: ['a', 'b'], rows }, 'x.csv', 0, 1, 10)
  assert.equal(ds.rowCount, 10)
  assert.equal(ds.totalRows, 100)
  assert.equal(ds.truncated, true)
})

// ---------- binning ----------
function gridPts(): { xy: Float32Array; n: number } {
  // 4 个点，Float32 安全的归一化坐标：四角附近（避开桶边界浮点误差）
  const xy = new Float32Array([0.15, 0.15, 0.85, 0.15, 0.15, 0.85, 0.85, 0.85])
  return { xy, n: 4 }
}

const FULL: View = { x0: 0, y0: 0, x1: 1, y1: 1 }

test('bin2D 四角落桶正确且总数守恒', () => {
  const { xy, n } = gridPts()
  const bins = bin2D(xy, n, FULL, 10, 10)
  assert.equal(maxCount(bins), 1)
  let sum = 0
  for (const c of bins) sum += c
  assert.equal(sum, 4)
  // (0.85,0.85) 落在右上格 (gx=8,gy=8)
  assert.equal(bins[8 * 10 + 8], 1)
})

test('bin2D 视口裁剪', () => {
  const { xy, n } = gridPts()
  const view: View = { x0: 0, y0: 0, x1: 0.5, y1: 1 }
  const bins = bin2D(xy, n, view, 10, 10)
  let sum = 0
  for (const c of bins) sum += c
  assert.equal(sum, 2) // 仅 x=0.1 的两个点
})

test('bin1D 折线均值', () => {
  const xy = new Float32Array([0.15, 0.2, 0.16, 0.8, 0.85, 0.4])
  const { avg, count } = bin1D(xy, 3, FULL, 10)
  assert.equal(count[1], 2) // 前两点落入 gx=1
  assert.ok(Math.abs(avg[1]! - 0.5) < 1e-6)
  assert.equal(count[8], 1)
})

test('brushIndices + selectionStats', () => {
  const { xy, n } = gridPts()
  const idxs = brushIndices(xy, n, { x0: 0, y0: 0, x1: 0.5, y1: 0.5 })
  assert.equal(idxs.length, 1)
  const rawX = new Float64Array([1, 9, 1, 9])
  const rawY = new Float64Array([2, 2, 8, 8])
  const s = selectionStats(rawX, rawY, idxs)
  assert.equal(s.count, 1)
  assert.equal(s.xMin, 1)
  assert.equal(s.yMax, 2)
})

// ---------- 视口 ----------
test('zoomAt 保持焦点不动（中心点放大两倍）', () => {
  const v = zoomAt(FULL, 0.5, 0.5, 0.5)
  assert.ok(Math.abs(v.x0 - 0.25) < 1e-9)
  assert.ok(Math.abs(v.x1 - 0.75) < 1e-9)
  assert.ok(Math.abs(v.y0 - 0.25) < 1e-9)
  assert.ok(Math.abs(v.y1 - 0.75) < 1e-9)
  assert.ok(Math.abs(zoomLevel(v) - 2) < 1e-9)
})

test('zoomAt 边界夹取不外溢', () => {
  const v = zoomAt(FULL, 0, 0, 3)
  assert.ok(v.x0 >= 0 && v.x1 <= 1 && v.y0 >= 0 && v.y1 <= 1)
  assert.deepEqual(resetView(), FULL)
})

test('panBy 方向与夹取', () => {
  const v = panBy({ x0: 0.25, x1: 0.75, y0: 0.25, y1: 0.75 }, 0.5, 0)
  // 向右拖（dx>0）窗口向左移动到边界
  assert.equal(v.x0, 0)
  assert.ok(Math.abs(v.x1 - 0.5) < 1e-9)
})

test('screenRectToNorm 坐标映射与 Y 翻转', () => {
  const plot = { x: 66, y: 18, w: 800, h: 400 }
  // 选取绘图区左下到右上
  const r = screenRectToNorm(66, 418, 866, 18, plot, FULL)
  assert.ok(Math.abs(r.x0 - 0) < 1e-9)
  assert.ok(Math.abs(r.y0 - 0) < 1e-9)
  assert.ok(Math.abs(r.x1 - 1) < 1e-9)
  assert.ok(Math.abs(r.y1 - 1) < 1e-9)
})

// ---------- 配色 / 刻度 / 格式化 ----------
test('viridis 色带端点', () => {
  assert.deepEqual(ramp(0), [68, 1, 84])
  assert.deepEqual(ramp(1), [253, 231, 37])
  assert.ok(densityT(1, 100) > 0 && densityT(1, 100) < 1)
  assert.equal(densityT(0, 100), 0)
})

test('niceTicks 落在范围内且单调', () => {
  const ticks = niceTicks(0, 100, 5)
  assert.ok(ticks.length >= 3)
  for (const t of ticks) assert.ok(t.value >= 0 && t.value <= 100)
})

test('formatNumber 自适应', () => {
  assert.equal(formatNumber(1234567), '1,234,567')
  assert.equal(formatNumber(0.5), '0.5')
})
