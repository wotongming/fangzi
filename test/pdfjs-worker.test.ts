import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveWorkerSrc,
  isWorkerLoadFailure,
  normalizePdfError,
  configurePdfjs,
  PDFJS_WORKER_PATH
} from '../reusable-module/pdfjs-worker/pdfjs-worker.ts'

test('worker URL：BASE_URL 带/不带尾斜杠都拼出稳定同源 .js 路径', () => {
  assert.equal(resolveWorkerSrc('/'), `/${PDFJS_WORKER_PATH}`)
  assert.equal(resolveWorkerSrc('/app/'), `/app/${PDFJS_WORKER_PATH}`)
  assert.equal(resolveWorkerSrc('/app'), `/app/${PDFJS_WORKER_PATH}`)
  // 稳定名不含哈希、不含 .mjs、不含 ?url
  const url = resolveWorkerSrc('/')
  assert.ok(url.endsWith('.js'))
  assert.ok(!url.includes('.mjs'))
  assert.ok(!url.includes('?url'))
  assert.ok(!/-[A-Za-z0-9_]{8}\./.test(url))
})

test('worker 失败识别：fake worker / 动态导入 / Failed to fetch 均命中', () => {
  assert.ok(isWorkerLoadFailure(new Error('Setting up fake worker failed: Failed to fetch dynamically imported module')))
  assert.ok(isWorkerLoadFailure(new Error('Could not load worker: /pdfjs/pdf.worker.min.js')))
  assert.ok(isWorkerLoadFailure('Failed to fetch dynamically imported module: https://x/a.mjs'))
})

test('worker 失败识别：普通业务错误（非 PDF / 扫描件）不误判', () => {
  assert.ok(!isWorkerLoadFailure(new Error('未能从该 PDF 提取到文字，可能是扫描件/图片版 PDF')))
  assert.ok(!isWorkerLoadFailure(new Error('Invalid PDF structure')))
  assert.ok(!isWorkerLoadFailure(null))
})

test('错误归一化：worker 失败转中文可重试提示；业务错误原样保留', () => {
  const friendly = normalizePdfError(new Error('Setting up fake worker failed: Failed to fetch dynamically imported module'))
  assert.match(friendly.message, /PDF 解析组件加载失败/)
  assert.match(friendly.message, /系统 Chrome|Edge/)
  const business = normalizePdfError(new Error('未能从该 PDF 提取到文字，可能是扫描件'))
  assert.equal(business.message, '未能从该 PDF 提取到文字，可能是扫描件')
  const wrapped = normalizePdfError('boom')
  assert.equal(wrapped.message, 'boom')
})

test('configurePdfjs 幂等：重复调用只设一次稳定 workerSrc', () => {
  const lib = configurePdfjs()
  const first = lib.GlobalWorkerOptions.workerSrc
  assert.ok(first?.endsWith(PDFJS_WORKER_PATH))
  configurePdfjs()
  assert.equal(lib.GlobalWorkerOptions.workerSrc, first)
})
