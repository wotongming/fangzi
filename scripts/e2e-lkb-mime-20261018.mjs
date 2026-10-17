/**
 * 2026-10-18 003 热修验证：EdgeOne 对 ort 胶水 .mjs 下发 application/octet-stream 的兼容。
 *  T1. 把 /onnx/*.mjs 强制改成 octet-stream（复刻线上）→ blob 方案下语义模型仍能“已就绪”。
 *  T2. 同 MIME 且阻断模型 onnx 下载 → 勾选语义导入文档，文档仍“即时”出现在文档库（不被模型阻塞），并降级关键词检索。
 * 运行前：npm run preview（:4173）。
 */
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const { chromium } = pw
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FIX = '/tmp/lkb-mime'
const ORIGIN = 'http://localhost:4173'
const CHROMIUM = '/usr/local/bin/chromium'
mkdirSync(FIX, { recursive: true })
writeFileSync(join(FIX, 'contract.txt'),
  '产品采购合同\n任何一方违约应承担违约责任，赔偿全部损失，违约金为合同金额百分之二十。')

const results = []
async function check(name, fn, ms = 240000) {
  const t0 = Date.now()
  try {
    const detail = await fn()
    results.push({ name, ok: true, ms: Date.now() - t0, detail })
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, detail: e.message })
  }
}

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-dev-shm-usage'] })

/** 建一个“EdgeOne 同款”上下文：胶水 mjs 一律 octet-stream；blockModel 时再阻断模型 onnx */
async function newPage({ blockModel } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await ctx.route('**/sw.js', (r) => r.abort())
  await ctx.route('**/registerSW.js', (r) => r.abort())
  // 取到真实 mjs 字节，再用错误 MIME 下发（复刻 EdgeOne 默认行为）
  const mjsResp = await ctx.request.get(`${ORIGIN}/onnx/ort-wasm-simd-threaded.mjs`)
  const mjsBody = await mjsResp.body()
  await ctx.route('**/onnx/ort-wasm-simd-threaded.mjs', (route) =>
    route.fulfill({ status: 200, contentType: 'application/octet-stream', body: mjsBody }))
  if (blockModel) {
    // 阻断全部语义模型 onnx 源（同源 + 外部镜像），模拟“模型彻底不可达”，且不等待外网 60s 超时
    await ctx.route('**/mf/bge-small-zh-v1.5/onnx/**', (r) => r.abort())
    await ctx.route(/^https:\/\/(hf-mirror\.com|huggingface\.co)\/.*bge-small-zh-v1\.5.*\/onnx\//, (r) => r.abort())
  }
  const page = await ctx.newPage()
  page.on('pageerror', () => {})
  return { ctx, page }
}

/* T1：错误 MIME 下语义模型仍就绪 */
await check('T1 .mjs=octet-stream 时语义模型仍可下载并初始化', async () => {
  const { ctx, page } = await newPage()
  await page.goto(`${ORIGIN}/#/t/local-knowledge-base`)
  await page.waitForSelector('.lkb h1')
  await page.locator('.tabs button', { hasText: '设置' }).first().click()
  await page.waitForTimeout(300)
  await page.locator('section.panel .btn-primary').first().click()
  await page.waitForFunction(() => {
    const t = document.querySelector('.lkb')?.textContent || ''
    return t.includes('语义模型已就绪') || t.includes('模型准备失败')
  }, null, { timeout: 240000 })
  const body = await page.locator('.lkb').innerText()
  await ctx.close()
  if (!body.includes('语义模型已就绪')) {
    const m = body.match(/模型准备失败[^\n]*/)
    throw new Error(m ? m[0] : '未就绪')
  }
  return '模型已就绪（blob 规避 MIME）'
})

/* T2：MIME 错误且模型阻断 → 文档即时入库 + 降级关键词 */
await check('T2 模型不可达时勾选语义导入，文档即时出现且降级关键词', async () => {
  const { ctx, page } = await newPage({ blockModel: true })
  await page.goto(`${ORIGIN}/#/t/local-knowledge-base`)
  await page.waitForSelector('.lkb h1')
  await page.evaluate(async () => { indexedDB.deleteDatabase('fz-local-knowledge-base-v1') }).catch(() => {})
  await page.reload(); await page.waitForSelector('.lkb h1')
  await page.check('.chk input').catch(() => {})
  const t0 = Date.now()
  await page.setInputFiles('input[type=file]', [join(FIX, 'contract.txt')])
  // “即时”：不等模型（模型已彻底阻断），文档名应在 20s 内出现在文档库
  await page.waitForFunction(
    () => (document.querySelector('.lkb')?.textContent || '').includes('contract.txt'),
    null, { timeout: 20000 }
  )
  const appearMs = Date.now() - t0
  // 直接查 IndexedDB：文档已持久化，且因模型失败降级为 semantic=false（可关键词问答）
  const doc = await page.evaluate(async () => {
    const dbs = await indexedDB.databases?.() ?? []
    const dbName = (dbs.map((d) => d.name).find((n) => n?.includes('local-knowledge-base')))
    return await new Promise((resolve) => {
      const req = indexedDB.open(dbName)
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction('documents', 'readonly')
        const gr = tx.objectStore('documents').getAll()
        gr.onsuccess = () => { db.close(); resolve(gr.result?.[0] ?? null) }
        gr.onerror = () => { db.close(); resolve(null) }
      }
      req.onerror = () => resolve(null)
    })
  })
  if (!doc || doc.name !== 'contract.txt') throw new Error('文档未入库或名称不符')
  if (!(doc.chunkCount >= 1)) throw new Error('分块未持久化，chunkCount=' + String(doc?.chunkCount))
  if (appearMs > 15000) throw new Error(`文档出现耗时 ${appearMs}ms，未做到即时入库`)
  // 降级提示（flash toast）：模型彻底不可达时明确告知用户已用关键词检索
  await page.waitForFunction(
    () => (document.querySelector('.lkb')?.textContent || '').includes('关键词检索'),
    null, { timeout: 60000 }
  )
  await ctx.close()
  return `文档 ${appearMs}ms 即时入库（${doc.chunkCount} 块），已提示降级关键词检索`
})

console.log('\n========== 003 MIME 热修验证 ==========')
let pass = 0
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'} (${String(r.ms).padStart(6)}ms) ${r.name}${r.ok ? ' — ' + r.detail : '\n   → ' + r.detail}`)
  if (r.ok) pass++
}
console.log(`\n汇总 ${pass}/${results.length}`)
await browser.close()
process.exit(pass === results.length ? 0 : 1)
