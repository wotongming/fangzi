import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitSentences } from '../plugins-src/line-light-reader/lib/sentences.ts'
import { lineColor, clusterVisualLines } from '../plugins-src/line-light-reader/lib/gradient.ts'
import { verifyLicense } from '../plugins-src/line-light-reader/lib/license.ts'
import { normalizeExcerpt, toMarkdown } from '../plugins-src/line-light-reader/lib/excerpt.ts'

test('切句：英文两句正确断开', () => {
  const s = splitSentences('Hello world. This is second.')
  assert.equal(s.length, 2)
  assert.match(s[0], /Hello world\./)
})

test('切句：缩写 Mr. / e.g. 不误切', () => {
  const s = splitSentences('Mr. Smith likes tea. e.g. black tea.')
  assert.equal(s.length, 2)
})

test('切句：小数 3.14 不误切', () => {
  const s = splitSentences('The value is 3.14 today. Done.')
  assert.equal(s.length, 2)
  assert.match(s[0], /3\.14/)
})

test('切句：中文按句号断开', () => {
  const s = splitSentences('第一段话结束。第二段开始！第三段？')
  assert.equal(s.length, 3)
})

test('引导色：ratio 0 冷蓝 h210，ratio 1 暖橙 h28', () => {
  assert.equal(lineColor(0).h, 210)
  assert.equal(lineColor(1).h, 28)
  assert.match(lineColor(0.5).css, /hsl\(/)
})

test('引导色：ratio 越界归正', () => {
  assert.equal(lineColor(-1).h, 210)
  assert.equal(lineColor(2).h, 28)
})

test('视觉行聚类：按 y 归两行，行内按 x 排序', () => {
  const items = [
    { y: 10, height: 16, x: 80, text: 'b' },
    { y: 10, height: 16, x: 10, text: 'a' },
    { y: 40, height: 16, x: 20, text: 'c' }
  ]
  const lines = clusterVisualLines(items)
  assert.equal(lines.length, 2)
  assert.deepEqual(lines[0].items.map((i) => i.text), ['a', 'b'])
  assert.equal(lines[0].ratio, 0)
  assert.equal(lines[1].ratio, 1)
})

test('许可：beta 未配置公钥时返回 free，不阻断功能', async () => {
  const r = await verifyLicense('LLR-abc-def')
  assert.equal(r.ok, false)
  assert.equal(r.tier, 'free')
  assert.equal(r.reason, 'beta')
})

test('摘录：空文本归一化为 null', () => {
  assert.equal(normalizeExcerpt({ text: '   ' }), null)
})

test('摘录：默认标题与时间补齐，Markdown 含标题/引用/来源', () => {
  const it = normalizeExcerpt({ title: '', url: 'https://x.test/a', text: '重点句' })!
  assert.equal(it.title, '未命名页面')
  const md = toMarkdown([it])
  assert.match(md, /### 未命名页面/)
  assert.match(md, /> 重点句/)
  assert.match(md, /https:\/\/x\.test\/a/)
})
