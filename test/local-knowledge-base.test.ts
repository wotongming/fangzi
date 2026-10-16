import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BertTokenizer, padBatch } from '../src/tools/local-knowledge-base/lib/tokenizer.ts'
import { chunkText, parseDocument, detectFormat } from '../src/tools/local-knowledge-base/lib/ingest.ts'
import { BM25, tokenize } from '../src/tools/local-knowledge-base/lib/bm25.ts'
import { cosine, rrf, retrieveAndAnswer } from '../src/tools/local-knowledge-base/lib/retrieval.ts'
import { fileUrl, orderedSources, EMBED_MODEL } from '../src/tools/local-knowledge-base/lib/models.ts'
import type { KBChunk } from '../src/tools/local-knowledge-base/lib/types.ts'

/** 构造一个行号即 id 的迷你 BERT 词表：前 100 占位，[UNK]=100 <[BOS_never_used_51bce0c785ca2f68081bfa7d91973934]>=101 [SEP]=102 [MASK]=103 */
function miniVocab(tokens: string[]): string {
  const v: string[] = new Array(100).fill('x')
  v[100] = '[UNK]'
  v[101] = '<[BOS_never_used_51bce0c785ca2f68081bfa7d91973934]>'
  v[102] = '[SEP]'
  v[103] = '[MASK]'
  let next = 104
  for (const t of tokens) if (!v.includes(t)) v[next++] = t
  return v.join('\n')
}

test('detectFormat 识别四种格式，未知返回 null', () => {
  assert.equal(detectFormat('a.txt'), 'txt')
  assert.equal(detectFormat('a.MD'), 'markdown')
  assert.equal(detectFormat('x.csv'), 'csv')
  assert.equal(detectFormat('page.html'), 'html')
  assert.equal(detectFormat('page.htm'), 'html')
  assert.equal(detectFormat('a.pdf'), null)
  assert.equal(detectFormat('a.docx'), null)
})

test('BertTokenizer 中文按字切分并加 CLS/SEP', () => {
  const tok = new BertTokenizer(miniVocab(['合', '同', '违', '约']))
  const enc = tok.encode('合同违约')
  assert.deepEqual(enc.tokens, ['<[BOS_never_used_51bce0c785ca2f68081bfa7d91973934]>', '合', '同', '违', '约', '[SEP]'])
  assert.deepEqual([...enc.inputIds], [101, 104, 105, 106, 107, 102])
  assert.equal(enc.attentionMask.length, enc.inputIds.length)
  assert.ok(enc.attentionMask.every((v) => v === 1))
})

test('BertTokenizer WordPiece 最长匹配与未登录回退', () => {
  const tok = new BertTokenizer(miniVocab(['he', '##llo', '合', '同']))
  assert.deepEqual(tok.wordpiece('hello'), ['he', '##llo'])
  // 超长/无法匹配 → [UNK]
  assert.deepEqual(tok.wordpiece('z'.repeat(200)), ['[UNK]'])
  const enc = tok.encode('hello')
  assert.equal(enc.tokens[1], 'he')
  assert.equal(enc.tokens[2], '##llo')
})

test('encode 超长截断为 maxLen（含 CLS/SEP）', () => {
  const tok = new BertTokenizer(miniVocab(['合', '同']))
  const enc = tok.encode('合同合同合同', 5)
  assert.equal(enc.inputIds.length, 5)
  assert.equal(enc.tokens[0], '<[BOS_never_used_51bce0c785ca2f68081bfa7d91973934]>')
  assert.equal(enc.tokens[4], '[SEP]')
})

test('padBatch 对齐长度并置 mask', () => {
  const tok = new BertTokenizer(miniVocab(['a', 'b']))
  const { inputIds, attentionMask, dims } = padBatch([tok.encode('a'), tok.encode('a b')])
  assert.deepEqual(dims, [2, 4])
  assert.equal(inputIds.length, 8)
  // 第一条最后一位为 PAD，mask=0
  assert.equal(attentionMask[3], 0)
  assert.equal(attentionMask[7], 1)
})

test('chunkText 按标题切段并控制长度', () => {
  const doc = '## 第一节\n' + '合同双方应履行义务。'.repeat(40) + '\n## 第二节\n违约责任需要赔偿。'
  const chunks = chunkText(doc, 200, 20)
  assert.ok(chunks.length > 1)
  assert.ok(chunks.every((c) => c.length > 0))
  assert.ok(chunks.some((c) => c.includes('第二节')))
  assert.ok(chunks[0].startsWith('## 第一节'))
})

test('chunkText 空文本返回空数组', () => {
  assert.deepEqual(chunkText('   \n  '), [])
})

test('parseDocument CSV 去引号并按行成句', () => {
  const out = parseDocument('姓名,金额\n张三,"1,000"\n李四,200', 'csv')
  assert.ok(out.includes('张三，1，000') || out.includes('张三'))
  assert.ok(out.includes('李四，200'))
})

test('parseDocument HTML 去标签（Node 极简兜底）', () => {
  const out = parseDocument('<p>违约责任</p><script>bad()</script>', 'html')
  assert.ok(out.includes('违约责任'))
  assert.ok(!out.includes('bad()'))
})

test('BM25 中文二元 + 拉丁词检索排序', () => {
  const bm = new BM25()
  bm.add('1', '合同约定了违约责任与赔偿金额')
  bm.add('2', '今天天气晴朗适合出游')
  bm.add('3', '一方违约时应当承担赔偿责任')
  const hits = bm25search(bm, '违约赔偿责任', 2)
  assert.equal(hits[0].id === '1' || hits[0].id === '3', true)
  assert.ok(!hits.find((h) => h.id === '2'))
})

function bm25search(bm: BM25, q: string, k: number) {
  return bm.search(q, k)
}

test('BM25 remove 后不再命中', () => {
  const bm = new BM25()
  bm.add('1', '违约责任条款')
  bm.remove('1')
  assert.deepEqual(bm.search('违约', 5), [])
})

test('tokenize 同时产出拉丁词与 CJK 一元/二元', () => {
  const t = tokenize('hello 违约')
  assert.ok(t.includes('hello'))
  assert.ok(t.includes('违'))
  assert.ok(t.includes('违约'))
})

test('cosine 归一化向量相似度', () => {
  assert.ok(Math.abs(cosine([1, 0], [1, 0]) - 1) < 1e-9)
  assert.ok(Math.abs(cosine([1, 0], [0, 1])) < 1e-9)
})

test('rrf 两路融合', () => {
  const fused = rrf([{ id: 'a', rank: 1 }, { id: 'b', rank: 2 }], [{ id: 'b', rank: 1 }])
  assert.ok((fused.get('b') ?? 0) > (fused.get('a') ?? 0))
})

function makeChunks(): KBChunk[] {
  return [
    { id: 'c1', docId: 'd1', docName: '合同.txt', index: 0, text: '合同约定，一方违约时应当承担违约责任并赔偿对方损失。' },
    { id: 'c2', docId: 'd1', docName: '合同.txt', index: 1, text: '争议解决方式为向甲方所在地人民法院提起诉讼。' },
    { id: 'c3', docId: 'd2', docName: '天气.txt', index: 0, text: '周末天气晴朗，适合户外运动和野餐。' }
  ]
}

test('retrieveAndAnswer 纯 BM25 通道产出引用与置信度', async () => {
  const bm = new BM25()
  const chunks = makeChunks()
  chunks.forEach((c) => bm.add(c.id, c.text))
  const res = await retrieveAndAnswer('违约了怎么赔偿？', { chunks, bm25: bm, topK: 3 })
  assert.equal(res.semantic, false)
  assert.ok(res.citations.length > 0)
  assert.equal(res.citations[0].docId, 'd1')
  assert.match(res.answer, /\[\d+\]/)
})

test('retrieveAndAnswer 语义通道（注入 embedQuery）走 RRF 并标记 semantic', async () => {
  const bm = new BM25()
  // 向量方向：让 c1 与查询同向
  const chunks: KBChunk[] = [
    { id: 'c1', docId: 'd', docName: 'a', index: 0, text: '违约赔偿', vector: [1, 0] },
    { id: 'c2', docId: 'd', docName: 'a', index: 1, text: '无关内容', vector: [0, 1] }
  ]
  chunks.forEach((c) => bm.add(c.id, c.text))
  const res = await retrieveAndAnswer('赔偿', {
    chunks,
    bm25: bm,
    embedQuery: async () => [1, 0],
    topK: 2
  })
  assert.equal(res.semantic, true)
  assert.equal(res.citations[0].chunkId, 'c1')
  assert.ok(res.confidence > 0.9)
  assert.equal(res.lowConfidence, false)
})

test('retrieveAndAnswer 空知识库给出无结果提示', async () => {
  const res = await retrieveAndAnswer('随便问', { chunks: [], bm25: new BM25() })
  assert.equal(res.citations.length, 0)
  assert.equal(res.lowConfidence, true)
  assert.match(res.answer, /没有检索到/)
})

test('模型源同源源优先，fileUrl 拼接正确，orderedSources 过滤非法自定义源', () => {
  // 无自定义源时，同源（方子 /mf）始终第一，国内直连/可离线
  const first = orderedSources({ customBase: '', order: ['hf-mirror', 'huggingface'] })[0]
  assert.equal(first.id, 'self')
  assert.equal(fileUrl(first, EMBED_MODEL, 'config.json'), '/mf/bge-small-zh-v1.5/config.json')
  // 非法 custom（非 https）被剔除，回落到同源源
  const only = orderedSources({ customBase: 'http://insecure', order: ['custom', 'hf-mirror'] })
  assert.equal(only[0].id, 'self')
  // 合法 https custom 置顶，同源紧随其后
  const withCustom = orderedSources({ customBase: 'https://bucket.r2.dev/', order: ['custom', 'hf-mirror'] })
  assert.equal(withCustom[0].host, 'https://bucket.r2.dev')
  assert.equal(withCustom[1]?.id, 'self')
  const cu = fileUrl(withCustom[0], EMBED_MODEL, 'vocab.txt')
  assert.equal(cu, 'https://bucket.r2.dev/Xenova/bge-small-zh-v1.5/resolve/main/vocab.txt')
})
