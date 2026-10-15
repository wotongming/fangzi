import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toWorkerMessage, isTransferable } from '../reusable-module/worker-post/worker-post.ts'

test('普通数组与对象原样可克隆，无 transfer', () => {
  const { data, transfer } = toWorkerMessage({ a: 1, b: [1, 2, 3], s: 'x' })
  assert.deepEqual(data, { a: 1, b: [1, 2, 3], s: 'x' })
  assert.equal(transfer.length, 0)
})

test('剥离 Vue reactive 风格 Proxy，输出为普通数组/对象', () => {
  const raw = { headers: ['x', 'y'], nested: { v: [1, 2] } }
  const proxy = new Proxy(raw, {
    get(target, p) {
      return Reflect.get(target, p as keyof typeof target)
    }
  })
  const { data } = toWorkerMessage(proxy)
  assert.ok(Array.isArray((data as { headers: unknown }).headers))
  assert.equal(Object.getPrototypeOf(data), Object.prototype)
  assert.deepEqual(data, raw)
})

test('typed array 的底层 buffer 自动登记为 Transferable 且数据保留', () => {
  const xy = new Float32Array([0.1, 0.2, 0.3])
  const { data, transfer } = toWorkerMessage({ xy })
  assert.equal(transfer.length, 1)
  assert.equal(transfer[0], xy.buffer)
  assert.ok(isTransferable(xy.buffer))
  assert.deepEqual(Array.from((data as { xy: Float32Array }).xy).map((v) => Math.round(v * 1e6) / 1e6), [0.1, 0.2, 0.3])
})

test('裸 ArrayBuffer 被自动收集', () => {
  const buf = new ArrayBuffer(16)
  const { transfer } = toWorkerMessage({ buf })
  assert.equal(transfer[0], buf)
})

test('autoTransfer=false 时不转移任何对象（保留主线程副本）', () => {
  const xy = new Int32Array([1, 2])
  const { transfer } = toWorkerMessage({ xy }, false)
  assert.equal(transfer.length, 0)
  assert.equal(xy.length, 2) // 未被 neuter
})

test('剔除对象与数组中的函数', () => {
  const { data } = toWorkerMessage({ a: 1, fn: () => 1, list: [1, () => 2, 3] })
  const d = data as Record<string, unknown>
  assert.deepEqual(Object.keys(d).sort(), ['a', 'list'])
  assert.deepEqual(d.list, [1, 3])
})

test('支持循环引用', () => {
  const obj: Record<string, unknown> = { a: 1 }
  obj.self = obj
  const { data } = toWorkerMessage(obj)
  assert.equal((data as Record<string, unknown>).self, data)
})

test('支持 Map/Set/Date', () => {
  const d = new Date(0)
  const { data } = toWorkerMessage({ m: new Map([['k', 1]]), s: new Set([2]), d })
  const r = data as { m: Map<string, number>; s: Set<number>; d: Date }
  assert.equal(r.m.get('k'), 1)
  assert.ok(r.s.has(2))
  assert.ok(r.d instanceof Date)
  assert.equal(r.d.getTime(), 0)
})
