/**
 * image-converter 001 单元测试：
 * - pipeline 工具链（validateChain / deriveExt / runChain 顺序与中止）
 * - batch 批量（导入过滤、ZIP 解压/打包、并发队列与错误）
 * - ai/models 注册表与元数据校验
 * - monetization 变现判定（买断/订阅/用量包/免费额度）
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { zipSync } from 'fflate'

// Node 测试环境无 localStorage，提供内存垫片
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

import { runChain, validateChain, deriveExt, type StepDef, type JobItem, type StepRuntime } from '../src/tools/image-converter/lib/pipeline.ts'
import { fromFileList, mimeFromExt, fromZip, zipResults, runBatch } from '../src/tools/image-converter/lib/batch.ts'
import { AI_MODELS, inferModel } from '../src/tools/image-converter/lib/ai/models.ts'
import { validateModelMeta } from '../src/tools/image-converter/lib/ai/loader.ts'
import { buildAccessSummary, consumeIfNeeded, purchase } from '../src/tools/image-converter/lib/monetization.ts'
import { billingProvider, __resetBillingForTest, type BillingProvider } from '../src/core/billing/index.ts'
import type { BillingPlan } from '../src/core/types'

const TOOL_ID = 'image-converter'
const PLAN: BillingPlan = {
  mode: 'buyout',
  currency: 'CNY',
  priceCents: 2990,
  features: [
    { key: 'convert', label: '转换', free: true },
    { key: 'ai', label: 'AI 增强', free: false },
    { key: 'batch', label: '批量', free: false }
  ],
  subscription: { priceCentsPerMonth: 990, priceCentsPerYear: 8900 },
  usagePack: { priceCentsPerUnit: 990, unit: '张', freePerDay: 3 },
  platformSplit: { enabled: true, partnerRatePct: 20 }
}

// useToolBilling 依赖 registry 的 import.meta.glob（Vite 专属），Node 测试中构造等价轻量桩
function makeBillingStub(provider: BillingProvider) {
  return {
    toolId: TOOL_ID,
    plan: PLAN,
    isOwned: (kind: 'buyout' | 'freemium-pro' | 'usage-pack') => provider.isOwned(TOOL_ID, kind),
    buy: async (kind: 'buyout' | 'freemium-pro' | 'usage-pack', units?: number) =>
      provider.checkout({
        toolId: TOOL_ID,
        kind,
        amountCents:
          kind === 'usage-pack' ? (PLAN.usagePack?.priceCentsPerUnit ?? 0) * (units ?? 1) : (PLAN.priceCents ?? 0),
        currency: 'CNY',
        units: kind === 'usage-pack' ? units ?? 1 : undefined
      })
  }
}

function fakeFile(name: string, type = 'image/png'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type })
}

beforeEach(() => {
  localStorage.clear()
  __resetBillingForTest()
})

// ---------- pipeline ----------
test('validateChain：空工具链拒绝', () => {
  assert.equal(validateChain([{ id: 'convert', label: 'x', enabled: false }]).ok, false)
})

test('validateChain：同类步骤重复拒绝', () => {
  const steps: StepDef[] = [
    { id: 'convert', label: '转换', enabled: true },
    { id: 'convert', label: '转换2', enabled: true }
  ]
  assert.equal(validateChain(steps).ok, false)
})

test('validateChain：合法工具链通过', () => {
  const steps: StepDef[] = [
    { id: 'convert', label: '转换', enabled: true },
    { id: 'upscale', label: '超分', enabled: true }
  ]
  assert.deepEqual(validateChain(steps), { ok: true })
})

test('deriveExt：AI 步骤优先 png', () => {
  const steps: StepDef[] = [
    { id: 'convert', label: '转换', enabled: true, params: { format: 'image/webp', quality: 0.8, maxWidth: 1000 } },
    { id: 'upscale', label: '超分', enabled: true }
  ]
  assert.equal(deriveExt(steps, 'a.jpg'), 'png')
})

test('deriveExt：纯转换按目标格式', () => {
  const steps: StepDef[] = [
    { id: 'convert', label: '转换', enabled: true, params: { format: 'image/jpeg', quality: 0.8, maxWidth: 1000 } }
  ]
  assert.equal(deriveExt(steps, 'a.png'), 'jpg')
})

test('runChain：按顺序执行并记录耗时', async () => {
  const calls: string[] = []
  const runtime: StepRuntime = {
    async run(step, input) {
      calls.push(step.id)
      return new Blob([input], { type: 'image/png' })
    }
  }
  const steps: StepDef[] = [
    { id: 'convert', label: '转换', enabled: true },
    { id: 'crop', label: '裁剪', enabled: true }
  ]
  const r = await runChain({ id: 'x', file: fakeFile('a.png') }, steps, runtime)
  assert.deepEqual(calls, ['convert', 'crop'])
  assert.equal(r.ext, 'png')
  assert.equal(r.stepLog.length, 2)
})

test('runChain：中止后抛 AbortError', async () => {
  const ctrl = new AbortController()
  const runtime: StepRuntime = {
    async run() {
      ctrl.abort()
      await new Promise((r) => setTimeout(r, 5))
      return new Blob()
    }
  }
  await assert.rejects(
    runChain({ id: 'x', file: fakeFile('a.png') }, [{ id: 'convert', label: '转换', enabled: true }], runtime, undefined, ctrl.signal),
    (e: unknown) => e instanceof DOMException && e.name === 'AbortError'
  )
})

// ---------- batch ----------
test('fromFileList：过滤非图片', () => {
  const list = [fakeFile('a.png'), fakeFile('b.txt', 'text/plain')]
  const items = fromFileList(list as unknown as FileList)
  assert.equal(items.length, 1)
  assert.equal(items[0]!.name, 'a.png')
})

test('mimeFromExt：常见扩展名映射', () => {
  assert.equal(mimeFromExt('x.JPG'), 'image/jpeg')
  assert.equal(mimeFromExt('x.webp'), 'image/webp')
  assert.equal(mimeFromExt('x.unknown'), 'application/octet-stream')
})

test('fromZip：解压并提取图片、跳过非图片', async () => {
  const zipped = zipSync({
    'dir/a.png': new Uint8Array([1, 2, 3]),
    'dir/b.jpg': new Uint8Array([4, 5, 6]),
    'dir/readme.txt': new Uint8Array([9, 9, 9])
  })
  const zipFile = new File([zipped], 'batch.zip', { type: 'application/zip' })
  const items = await fromZip(zipFile)
  assert.equal(items.length, 2)
  assert.deepEqual(items.map((i) => i.name).sort(), ['a.png', 'b.jpg'])
})

test('zipResults：打包后可回读', async () => {
  const blob = await zipResults([
    { name: 'out.png', blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }) }
  ])
  const { unzipSync } = await import('fflate')
  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  assert.ok(entries['out.png'])
})

test('runBatch：并发执行、错误项标记、进度回调', async () => {
  const items = [fakeFile('1.png'), fakeFile('2.png'), fakeFile('3.png')].map((f) => ({
    id: f.name,
    file: f,
    name: f.name
  }))
  let done = 0
  let total = 0
  const tasks = await runBatch(
    items,
    async (item) => {
      if (item.name === '2.png') throw new Error('bad image')
      return { blob: new Blob([1]), ext: 'png' }
    },
    { concurrency: 2, cb: { onProgress: (d, t) => ((done = d), (total = t)) } }
  )
  assert.equal(total, 3)
  assert.equal(done, 3)
  assert.equal(tasks.filter((t) => t.status === 'done').length, 2)
  assert.equal(tasks.filter((t) => t.status === 'error').length, 1)
  assert.equal(tasks.find((t) => t.item.name === '2.png')?.error, 'bad image')
})

// ---------- ai/models ----------
test('AI_MODELS：注册表包含两个模型且元数据完整', () => {
  assert.ok(AI_MODELS.upscale)
  assert.ok(AI_MODELS.bgremove)
  for (const meta of Object.values(AI_MODELS)) {
    assert.deepEqual(validateModelMeta(meta), { ok: true })
  }
  assert.equal(AI_MODELS.upscale.license, 'BSD-3-Clause')
  assert.equal(AI_MODELS.bgremove.license, 'Apache-2.0')
})

test('inferModel：按来源识别模型', () => {
  assert.equal(inferModel('RealESRGAN_x4plus_anime_6B.onnx'), 'upscale')
  assert.equal(inferModel('Xenova/modnet'), 'bgremove')
  assert.equal(inferModel('unknown'), null)
})

// ---------- monetization ----------
test('变现：默认免费额度可用（unlocked=true，剩余3张/日）', () => {
  const provider = billingProvider()
  const billing = makeBillingStub(provider)
  const summary = buildAccessSummary(billing, PLAN, TOOL_ID)
  assert.equal(summary.buyoutOwned, false)
  assert.equal(summary.proOwned, false)
  assert.equal(summary.freeRemainingToday, 3)
  // 每日免费额度即视为可用（freemium：免费层先扣免费额度）
  assert.equal(summary.unlocked, true)
})

test('变现：未解锁时消耗每日免费额度，买断后不再扣减', async () => {
  const provider = billingProvider()
  const billing = makeBillingStub(provider)
  const before = buildAccessSummary(billing, PLAN, TOOL_ID)
  assert.equal(before.usage.used, 0)
  consumeIfNeeded(before, TOOL_ID, PLAN)
  const after = buildAccessSummary(billing, PLAN, TOOL_ID)
  assert.equal(after.usage.used, 1)
  assert.equal(after.freeRemainingToday, 2)

  // 买断后扣减不生效（免费额度不再被消耗）
  await purchase(billing, 'buyout')
  const owned = buildAccessSummary(billing, PLAN, TOOL_ID)
  const usedBefore = owned.usage.used
  consumeIfNeeded(owned, TOOL_ID, PLAN)
  assert.equal(buildAccessSummary(billing, PLAN, TOOL_ID).usage.used, usedBefore)
})

test('变现：免费额度耗尽且未购买时 locked（unlocked=false）', async () => {
  const provider = billingProvider()
  const billing = makeBillingStub(provider)
  // 连续消耗 3 次，耗尽每日免费额度
  for (let i = 0; i < 3; i++) {
    const s = buildAccessSummary(billing, PLAN, TOOL_ID)
    consumeIfNeeded(s, TOOL_ID, PLAN)
  }
  const exhausted = buildAccessSummary(billing, PLAN, TOOL_ID)
  assert.equal(exhausted.usage.used, 3)
  assert.equal(exhausted.freeRemainingToday, 0)
  assert.equal(exhausted.unlocked, false)

  // 购买用量包后重新解锁
  await purchase(billing, 'usage-pack')
  const withPack = buildAccessSummary(billing, PLAN, TOOL_ID)
  assert.ok(withPack.usage.remaining > 0)
  assert.equal(withPack.unlocked, true)
})

test('变现：provider.isOwned 与订单记录一致', async () => {
  const provider = billingProvider()
  const billing = makeBillingStub(provider)
  assert.equal(provider.isOwned(TOOL_ID, 'buyout'), false)
  await purchase(billing, 'buyout')
  assert.equal(provider.isOwned(TOOL_ID, 'buyout'), true)
  assert.equal(provider.isOwned(TOOL_ID, 'freemium-pro'), false)
})

test('变现：买断后解锁全部', async () => {
  const provider = billingProvider()
  const billing = makeBillingStub(provider)
  await purchase(billing, 'buyout')
  const summary = buildAccessSummary(billing, PLAN, TOOL_ID)
  assert.equal(summary.buyoutOwned, true)
  assert.equal(summary.unlocked, true)
})

test('变现：订阅后解锁全部', async () => {
  const provider = billingProvider()
  const billing = makeBillingStub(provider)
  await purchase(billing, 'subscription-month')
  const summary = buildAccessSummary(billing, PLAN, TOOL_ID)
  assert.equal(summary.proOwned, true)
  assert.equal(summary.unlocked, true)
})

test('变现：用量包购买后 purchased>0 且解锁', async () => {
  const provider = billingProvider()
  const billing = makeBillingStub(provider)
  await purchase(billing, 'usage-pack')
  const summary = buildAccessSummary(billing, PLAN, TOOL_ID)
  assert.ok(summary.usage.purchasedQuota > 0)
  assert.ok(summary.usage.remaining > 0)
  assert.equal(summary.unlocked, true)
})
