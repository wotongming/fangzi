import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildFeedbackMailto, FEEDBACK_TARGET_EMAIL } from '../src/core/feedback.ts'

test('反馈 mailto：收件人固定为 fangziasia 邮箱', () => {
  const url = buildFeedbackMailto('new')
  assert.ok(url.startsWith(`mailto:${FEEDBACK_TARGET_EMAIL}?`))
  assert.equal(FEEDBACK_TARGET_EMAIL, 'fangziasia@163.com')
})

test('反馈 mailto：提新需求带正确主题与三条模板引导（已编码）', () => {
  const url = buildFeedbackMailto('new', '证件照压缩')
  const qs = url.slice(url.indexOf('?') + 1)
  const params = new URLSearchParams(qs)
  const subject = params.get('subject') ?? ''
  const body = params.get('body') ?? ''
  assert.match(subject, /新需求/)
  for (const kw of ['使用场景', '现有', '希望它能做到']) assert.ok(body.includes(kw), `缺少 ${kw}`)
  assert.ok(body.includes('证件照压缩'))
  // 必须是编码后的 query string，不能出现裸换行/空格破坏 mailto
  assert.ok(!qs.includes('\n'))
})

test('反馈 mailto：优化旧工具带工具名/操作/期望与实际模板', () => {
  const url = buildFeedbackMailto('improve')
  const params = new URLSearchParams(url.slice(url.indexOf('?') + 1))
  const subject = params.get('subject') ?? ''
  const body = params.get('body') ?? ''
  assert.match(subject, /优化建议/)
  for (const kw of ['什么操作', '期望的表现', '实际的表现']) assert.ok(body.includes(kw), `缺少 ${kw}`)
})
