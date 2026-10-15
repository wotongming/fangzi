/**
 * image-converter 电商上新模式（002）单元测试：
 * - presets 几何（cover 裁剪 / contain 留白 / 画布尺寸 / clamp）
 * - pack 命名模板、非法字符净化、平台分目录、CSV、ZIP 打包与重名去重
 * - watermark 九宫格锚点与平铺边界（纯函数，不碰 Canvas）
 * - templates 模板归一化与损坏回退
 * 不导入 compose.ts（其依赖 DOM Canvas / onnxruntime），像素处理在浏览器 E2E 覆盖。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { unzipSync } from 'fflate'

class MemoryStorage {
  private m = new Map<string, string>()
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null
  }
  setItem(k: string, v: string) {
    this.m.set(k, v)
  }
  removeItem(k: string) {
    this.m.delete(k)
  }
  clear() {
    this.m.clear()
  }
}
;(globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage() as unknown as Storage

import {
  PLATFORM_PRESETS,
  seedToSpec,
  getSeed,
  resolveSpec,
  computeGeometry,
  kbToBytes,
  clamp01
} from '../src/tools/image-converter/ecom/presets.ts'
import {
  sanitizeSegment,
  padIndex,
  renderName,
  buildEntryPath,
  csvCell,
  buildManifestCsv,
  packZip,
  type ManifestRow
} from '../src/tools/image-converter/ecom/pack.ts'
import { anchorOf, computeAnchors } from '../src/tools/image-converter/ecom/watermark.ts'
import { defaultWatermark, normalizeTemplate, loadTemplate, saveTemplate, TEMPLATE_STORAGE_KEY } from '../src/tools/image-converter/ecom/templates.ts'

// ---------- presets ----------
test('内置规格 key 唯一且都能转 spec', () => {
  const keys = PLATFORM_PRESETS.map((p) => p.key)
  assert.equal(new Set(keys).size, keys.length)
  for (const seed of PLATFORM_PRESETS) {
    const spec = seedToSpec(seed)
    assert.equal(spec.key, seed.key)
    assert.ok(spec.longEdge >= 120)
    assert.ok(['cover', 'contain'].includes(spec.fit))
  }
  assert.ok(getSeed('taobao-1x1-800'))
  assert.equal(getSeed('not-exist'), undefined)
})

test('resolveSpec 应用覆盖并 clamp', () => {
  const seed = getSeed('taobao-1x1-800')!
  const s = resolveSpec(seed, { format: 'image/webp', quality: 99, targetBytes: 307200, fit: 'cover', bgMode: 'color', longEdge: 999999 })
  assert.equal(s.format, 'image/webp')
  assert.equal(s.quality, clamp01(99)) // 被 clamp 到 1
  assert.equal(s.quality, 1)
  assert.equal(s.targetBytes, 307200)
  assert.equal(s.fit, 'cover')
  assert.equal(s.bg.mode, 'color')
  assert.equal(s.longEdge, 4096) // 被 clamp
  assert.equal(kbToBytes(300), 307200)
})

test('computeGeometry: 1:1 contain 完整留白居中', () => {
  const g = computeGeometry(2000, 1000, 1, 800, 'contain')
  assert.equal(g.cw, 800)
  assert.equal(g.ch, 800)
  // 宽图缩放到贴满宽度，高度 400，垂直居中
  assert.equal(g.dw, 800)
  assert.equal(g.dh, 400)
  assert.equal(g.dx, 0)
  assert.equal(g.dy, 200)
  assert.equal(g.sx, 0) // contain 不裁源
})

test('computeGeometry: 3:4 cover 居中裁剪并铺满', () => {
  // 源 1000x1000，目标竖图 0.75
  const g = computeGeometry(1000, 1000, 3 / 4, 1080, 'cover')
  assert.equal(g.cw, 810)
  assert.equal(g.ch, 1080)
  // 源更宽 → 左右裁：采样宽 = 1000*0.75=750
  assert.equal(Math.round(g.sw), 750)
  assert.equal(g.sh, 1000)
  assert.equal(Math.round(g.sx), 125)
  assert.equal(g.dx, 0) // cover 铺满
  assert.equal(g.dy, 0)
  assert.equal(g.dw, 810)
  assert.equal(g.dh, 1080)
})

test('computeGeometry: 横图规格长边作用于宽', () => {
  const g = computeGeometry(400, 300, 4 / 3, 1200, 'cover')
  assert.equal(g.cw, 1200)
  assert.equal(g.ch, 900)
})

// ---------- pack ----------
test('sanitizeSegment 净化非法字符并兜底', () => {
  assert.equal(sanitizeSegment('a/b:c*d?e'), 'a_b_c_d_e')
  assert.equal(sanitizeSegment('   '), 'untitled')
  assert.equal(sanitizeSegment('商品 图.jpg'), '商品 图.jpg')
})

test('padIndex 按总数补齐', () => {
  assert.equal(padIndex(1, 3), '01')
  assert.equal(padIndex(12, 100), '012')
  assert.equal(padIndex(5, 999), '005')
})

test('renderName 替换变量并净化', () => {
  const out = renderName('{product}_{color}_{platform}_{index}', {
    base: 'IMG_001',
    product: '茶杯',
    color: 'red',
    platform: 'taobao',
    index: 3,
    ext: 'jpg'
  })
  assert.equal(out, '茶杯_red_taobao_3')
  // 未知变量保留，product 留空回退原名由调用方保证；这里 index 为数字
  const out2 = renderName('{base}-{index}', { base: 'a/b', product: '', color: '', platform: 'p', index: 1, ext: 'jpg' })
  assert.equal(out2, 'a_b-1')
})

test('buildEntryPath 平台目录 + 文件名 + 扩展名', () => {
  assert.equal(buildEntryPath('taobao-1x1-800', '茶杯_01', 'jpg'), 'taobao-1x1-800/茶杯_01.jpg')
})

test('csvCell 与 manifest（BOM + 转义）', () => {
  assert.equal(csvCell('普通'), '普通')
  assert.equal(csvCell('a,b'), '"a,b"')
  assert.equal(csvCell('他说"好"'), '"他说""好"""')
  const rows: ManifestRow[] = [
    { source: 'a.jpg', output: 'taobao/a.jpg', specLabel: '淘宝 主图 1:1 · 800', width: 800, height: 800, bytes: 12345 }
  ]
  const csv = buildManifestCsv(rows)
  assert.ok(csv.startsWith('﻿')) // UTF-8 BOM
  assert.ok(csv.includes('"淘宝 主图 1:1 · 800"') === false) // 该 label 无逗号不加引号
  assert.ok(csv.includes('800,800,12345'))
})

test('packZip 去重路径并含 manifest.csv', async () => {
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' })
  const zip = await packZip(
    [
      { path: 'taobao/a.jpg', blob },
      { path: 'taobao/a.jpg', blob },
      { path: 'jd/b.jpg', blob }
    ],
    '﻿header\r\nrow'
  )
  const entries = unzipSync(new Uint8Array(await zip.arrayBuffer()))
  const names = Object.keys(entries).sort()
  assert.ok(names.includes('taobao/a.jpg'))
  assert.ok(names.some((n) => n === 'taobao/a-2.jpg'))
  assert.ok(names.includes('jd/b.jpg'))
  assert.ok(names.includes('manifest.csv'))
})

// ---------- watermark ----------
test('anchorOf 九宫格定位带内缩', () => {
  const tl = anchorOf('tl', 1000, 800, 40)
  assert.equal(tl.x, 40)
  assert.equal(tl.y, 40)
  const br = anchorOf('br', 1000, 800, 40)
  assert.equal(br.x, 960)
  assert.equal(br.y, 760)
  const mc = anchorOf('mc', 1000, 800, 40)
  assert.equal(mc.x, 500)
  assert.equal(mc.y, 400)
})

test('computeAnchors 单点=1，平铺多点且都在画布内', () => {
  const single = computeAnchors({ ...defaultWatermark(), tile: false, position: 'br' }, 800, 800)
  assert.equal(single.length, 1)
  const tiled = computeAnchors({ ...defaultWatermark(), tile: true, tileGap: 0.25 }, 800, 800)
  assert.ok(tiled.length > 1)
  for (const a of tiled) {
    assert.ok(a.x >= 0 && a.x <= 800)
    assert.ok(a.y >= 0 && a.y <= 800)
  }
})

// ---------- templates ----------
test('normalizeTemplate 合法通过、非法返回 null', () => {
  const ok = normalizeTemplate({
    version: 1,
    name: 't',
    specKeys: ['taobao-1x1-800', 'jd-1x1-800'],
    watermark: { enabled: true, text: '店' },
    nameTpl: '{base}'
  })
  assert.ok(ok)
  assert.equal(ok!.watermark.enabled, true)
  assert.equal(ok!.watermark.text, '店')
  assert.equal(normalizeTemplate(null), null)
  assert.equal(normalizeTemplate({ version: 2 }), null)
  assert.equal(normalizeTemplate({ version: 1, specKeys: [] }), null)
})

test('load/saveTemplate 往返；损坏 JSON 回退默认', () => {
  const t = normalizeTemplate({ version: 1, specKeys: ['jd-1x1-800'], product: '杯' })!
  assert.equal(saveTemplate(t), true)
  const loaded = loadTemplate()
  assert.deepEqual(loaded.specKeys, ['jd-1x1-800'])
  assert.equal(loaded.product, '杯')
  // 写入损坏内容
  ;(globalThis as unknown as { localStorage: Storage }).localStorage.setItem(TEMPLATE_STORAGE_KEY, '{bad json')
  const fallback = loadTemplate()
  assert.equal(fallback.version, 1)
  assert.ok(fallback.specKeys.length > 0)
})
