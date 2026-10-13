import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tokenize, normalize, queryTokens } from '../src/core/search/bigram.ts'
import { buildIndex, scoreKeyword } from '../src/core/search/keyword.ts'
import { highlightSnippet, escapeHtml } from '../src/core/search/highlight.ts'
import { SearchEngine } from '../src/core/search/search-engine.ts'
import type { SearchDocument } from '../src/core/types'

test('normalize：全角转半角、小写、压缩空白', () => {
  assert.equal(normalize('ＪＳＯＮ　格式化'), 'json 格式化')
  assert.equal(normalize('  Hello   World '), 'hello world')
})

test('tokenize：中文 bigram + 单字 + 拉丁整词', () => {
  const t = tokenize('年终奖税 abc123')
  assert.ok(t.includes('年终'))
  assert.ok(t.includes('终奖'))
  assert.ok(t.includes('奖税'))
  assert.ok(t.includes('年') && t.includes('税')) // 单字回退
  assert.ok(t.includes('abc123')) // 拉丁数字不拆
})

test('queryTokens 去重保持顺序', () => {
  const t = queryTokens('年终 年终')
  assert.equal(t.filter((x) => x === '年终').length, 1)
})

function doc(id: string, patch: Partial<SearchDocument>): SearchDocument {
  return {
    id,
    name: '',
    tagline: '',
    category: 'work',
    type: 'web',
    targetUsers: [],
    scenarios: [],
    painPoints: [],
    keywords: [],
    updatedAt: '2026-10-14',
    ...patch
  }
}

test('scoreKeyword：名称完全命中高于仅场景弱命中', () => {
  const idx = buildIndex([
    doc('a', { name: '年终奖个税筹划器', keywords: ['年终奖', '个税'] }),
    doc('b', { name: '天气查询', scenarios: ['发了年终奖随便写写'], keywords: ['天气'] })
  ])
  const sa = scoreKeyword(idx[0]!, '年终奖个税')
  const sb = scoreKeyword(idx[1]!, '年终奖个税')
  assert.ok(sa.score > sb.score, `${sa.score} 应大于 ${sb.score}`)
})

test('关键词整词重叠带来加成', () => {
  const idx = buildIndex([doc('a', { keywords: ['sha256', '哈希'] })])
  const s = scoreKeyword(idx[0]!, 'sha256')
  assert.ok(s.score > 0.3)
  assert.ok(s.matchedKeywords.includes('sha256'))
})

test('空查询得 0 分', () => {
  const idx = buildIndex([doc('a', { name: 'x' })])
  assert.equal(scoreKeyword(idx[0]!, '   ').score, 0)
})

test('highlightSnippet：转义 XSS 且包裹 mark', () => {
  assert.equal(escapeHtml('<b>&"'), '&lt;b&gt;&amp;&quot;')
  const html = highlightSnippet('帮我格式化 JSON 数据', 'json')
  assert.ok(html.includes('<mark>'))
  assert.ok(!/<script/i.test(html))
})

test('highlightSnippet：无命中时安全原样返回', () => {
  const html = highlightSnippet('普通文本', '不存在的词')
  assert.ok(html.includes('普通文本'))
  assert.ok(!html.includes('<mark>'))
})

test('SearchEngine：关键词模式端到端排序', async () => {
  const engine = new SearchEngine([
    doc('json', { name: 'JSON 格式化', keywords: ['json', '格式化'] }),
    doc('regex', { name: '正则测试', keywords: ['regex', '正则'] })
  ])
  const r = await engine.search('json 怎么格式化', { ai: null })
  assert.equal(r.mode, 'keyword')
  assert.equal(r.hits[0]!.doc.id, 'json')
  assert.ok(r.hits[0]!.highlights.length > 0)
})

test('SearchEngine：空白查询返回空', async () => {
  const engine = new SearchEngine([doc('a', { name: 'a' })])
  assert.equal((await engine.search('', { ai: null })).hits.length, 0)
})
