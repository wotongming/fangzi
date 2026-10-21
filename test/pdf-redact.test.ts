import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  rectsOverlap,
  clampRectToPage,
  rectHitsItem,
  normalizeMasks,
  scrubMetadata,
  PRIVATE_META_FIELDS
} from '../src/tools/pdf-redact/lib/geometry.ts'

test('矩形相交：重叠为真、相离/相切边界正确、空矩形不相交', () => {
  assert.equal(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }), true)
  assert.equal(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 20, w: 5, h: 5 }), false)
  // 恰好相切（边贴边）不算重叠（避免误删相邻行）
  assert.equal(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 10 }), false)
  assert.equal(rectsOverlap({ x: 0, y: 0, w: 0, h: 10 }, { x: 0, y: 0, w: 5, h: 5 }), false)
})

test('页内裁剪：越界矩形被裁回页内，完全越界返回 null', () => {
  assert.deepEqual(clampRectToPage({ x: -5, y: -5, w: 20, h: 20 }, 100, 100), { x: 0, y: 0, w: 15, h: 15 })
  assert.deepEqual(clampRectToPage({ x: 90, y: 90, w: 20, h: 20 }, 100, 100), { x: 90, y: 90, w: 10, h: 10 })
  assert.equal(clampRectToPage({ x: 200, y: 200, w: 10, h: 10 }, 100, 100), null)
  assert.equal(clampRectToPage({ x: 0, y: 0, w: -5, h: 10 }, 100, 100), null)
})

test('遮罩命中文字项：命中即真删', () => {
  const mask = { x: 100, y: 100, w: 80, h: 14 }
  assert.equal(rectHitsItem(mask, { x: 110, y: 102, w: 50, h: 10 }), true)
  assert.equal(rectHitsItem(mask, { x: 0, y: 0, w: 20, h: 10 }), false)
})

test('归一化遮罩：裁剪+去空', () => {
  const out = normalizeMasks([{ x: -10, y: 0, w: 30, h: 20 }, { x: 0, y: 0, w: 0, h: 5 }], 100, 100)
  assert.equal(out.length, 1)
  assert.deepEqual(out[0], { x: 0, y: 0, w: 20, h: 20 })
})

test('元数据清洗：所有隐私字段置空，字段口径完整', () => {
  const m = scrubMetadata({ Author: '张三', Title: '秘密合同' })
  for (const f of PRIVATE_META_FIELDS) assert.equal(m[f], '')
  assert.ok(Object.keys(m).length >= 6)
})
