import { test } from 'node:test'
import assert from 'node:assert/strict'

import { renderMarkdown } from '../src/core/markdown'

test('同源绝对路径图片渲染为 md-img，且先于链接规则（不被吃成文字链接）', () => {
  const html = renderMarkdown('![图鉴](/guides/merge-planet-codex.png)')
  assert.match(html, /<img class="md-img" loading="lazy" alt="图鉴" src="\/guides\/merge-planet-codex\.png">/)
  // 图片不应被链接规则包成 <a>
  assert.doesNotMatch(html, /<a [^>]*>!\[图鉴\]/)
})

test('相对路径（./ ../ 裸文件名）图片允许渲染', () => {
  for (const u of ['./a.png', '../b.webp', 'c.jpg']) {
    const html = renderMarkdown(`![t](${u})`)
    assert.match(html, new RegExp(`<img class="md-img"[^>]*src="${u.replace(/\./g, '\\.')}"`), u)
  }
})

test('图片 alt 做属性转义，不注入 onerror/引号', () => {
  const html = renderMarkdown('![<img src=x onerror=alert(1)>](/a.png)')
  assert.match(html, /<img class="md-img"[^>]*alt="&lt;img src=x onerror=alert\(1\)&gt;"/)
  assert.doesNotMatch(html, /onerror=alert\(1\)["']?\s*onerror/i)
  assert.doesNotMatch(html, /<img src=x onerror/)
})

test('javascript: / data: / http(s) 外链 / //协议相对 一律不渲染为 img，降级为 alt 文本', () => {
  const cases = [
    '![x](javascript:alert(1))',
    '![x](data:image/png;base64,AAAA)',
    '![x](https://evil.com/a.png)',
    '![x](http://evil.com/a.png)',
    '![x](//evil.com/a.png)'
  ]
  for (const md of cases) {
    const html = renderMarkdown(md)
    assert.doesNotMatch(html, /<img/i, md)
    assert.doesNotMatch(html, /javascript:alert|data:image|evil\.com|\/\/evil\.com/i, md)
    assert.match(html, /x/, md) // 保留 alt 文本
  }
})

test('非图片扩展名（/a.txt）不渲染为 img', () => {
  const html = renderMarkdown('![x](/a.txt)')
  assert.doesNotMatch(html, /<img/i)
})

test('既有语法不回归：普通链接、标题、粗体', () => {
  const html = renderMarkdown('# 标题\n\n**加粗**\n\n[官网](https://example.com)')
  assert.match(html, /<h1[^>]*>标题<\/h1>/)
  assert.match(html, /<strong>加粗<\/strong>/)
  assert.match(
    html,
    /<a href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer">官网<\/a>/
  )
})
