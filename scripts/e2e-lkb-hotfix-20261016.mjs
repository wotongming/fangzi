/**
 * 2026-10-16 热修聚焦验证（003 + 通用指导页）：
 *  A. 同源 /mf bge 模型文件可达（200、字节精确、非 HTML）。
 *  B. pipeline 工具“用户指导”页不再空白（local-knowledge-base / resume-jd-matcher）。
 *  C. 勾选“启用语义嵌入”导入文档：文档立即落库可见（模型不可达也不阻塞）；
 *     且同源源下语义模型可成功下载并初始化。
 * 运行前：npm run preview（:4173）
 */
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
const { chromium } = pw
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FIX = '/tmp/lkb-hotfix'
const ORIGIN = 'http://localhost:4173'
const CHROMIUM = '/usr/local/bin/chromium'
mkdirSync(FIX, { recursive: true })
writeFileSync(join(FIX, 'contract.txt'),
  '产品采购合同\n任何一方违约应承担违约责任，赔偿全部损失，违约金为合同金额百分之二十。')

const results = []
async function check(name, fn) {
  const t0 = Date.now()
  try { results.push({ name, ok: true, ms: Date.now() - t0, detail: await fn() }) }
  catch (e) { results.push({ name, ok: false, ms: Date.now() - t0, detail: e.message }) }
}

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
await ctx.route('**/sw.js', (r) => r.abort())
await ctx.route('**/registerSW.js', (r) => r.abort())
const page = await ctx.newPage()

/* A. 同源源直取（不经 SW，直接打静态站） */
for (const [f, expectSize] of [
  ['config.json', 716],
  ['onnx/model_quantized.onnx', 24010842]
]) {
  await check(`A 同源 /mf/${f} 可达且字节正确`, async () => {
    const res = await page.request.get(`${ORIGIN}/mf/bge-small-zh-v1.5/${f}`)
    if (!res.ok()) throw new Error('HTTP ' + res.status())
    const ct = res.headers()['content-type'] || ''
    if (ct.includes('text/html')) throw new Error('被回退成 HTML')
    const buf = await res.body()
    if (expectSize && buf.length !== expectSize) throw new Error(`size ${buf.length} != ${expectSize}`)
    return `${res.status()} ${buf.length}B ct=${ct.split(';')[0]}`
  })
}

/* B. 指导页有正文 */
for (const id of ['local-knowledge-base', 'resume-jd-matcher']) {
  await check(`B 用户指导页有内容：${id}`, async () => {
    await page.goto(`${ORIGIN}/#/t/${id}/guide`)
    await page.waitForTimeout(300)
    const empty = await page.locator('.guide-page .empty').count()
    const len = (await page.locator('.markdown-body').innerText().catch(() => '')).length
    if (empty) throw new Error('仍显示“暂未提供使用指导”')
    if (len < 120) throw new Error('正文过短：' + len)
    return `正文 ${len} 字`
  })
}

/* C1. 勾选语义也能立即导入（文档落库不被模型阻塞） */
await check('C1 勾选语义嵌入，导入文档立即出现在文档库', async () => {
  await page.goto(`${ORIGIN}/#/t/local-knowledge-base`)
  await page.waitForSelector('.lkb h1')
  // 清空可能残留文档（indexedDB）
  await page.evaluate(async () => { indexedDB.deleteDatabase('fz-local-knowledge-base-v1') }).catch(() => {})
  await page.reload(); await page.waitForSelector('.lkb h1')
  await page.check('.chk input').catch(() => {})
  await page.setInputFiles('input[type=file]', [join(FIX, 'contract.txt')])
  // 无论模型快慢，文档应在 90s 内落库
  await page.waitForFunction(() => document.querySelectorAll('.doclist tbody tr').length >= 1, null, { timeout: 120000 })
  const rows = await page.locator('.doclist tbody tr').count()
  if (rows < 1) throw new Error('文档未入库')
  return `文档行 ${rows}`
})

/* C2. 同源源下语义模型可就绪 */
let semanticOk = false
await check('C2 同源模型下载并初始化成功', async () => {
  await page.locator('.tabs button', { hasText: '设置' }).first().click()
  await page.waitForTimeout(300)
  await page.locator('section.panel .btn-primary').first().click()
  await page.waitForFunction(() => {
    const t = document.querySelector('.lkb')?.textContent || ''
    return t.includes('语义模型已就绪') || t.includes('模型准备失败')
  }, null, { timeout: 180000 })
  const body = await page.locator('.lkb').innerText()
  if (!body.includes('语义模型已就绪')) {
    const m = body.match(/模型准备失败[^\n]*/)
    throw new Error(m ? m[0] : '未就绪')
  }
  semanticOk = true
  return '模型已就绪（同源）'
})

console.log('\n========== 003 热修聚焦验证 ==========')
let pass = 0
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'} (${String(r.ms).padStart(6)}ms) ${r.name}${r.ok ? ' — ' + r.detail : '\n   → ' + r.detail}`)
  if (r.ok) pass++
}
console.log(`\n汇总 ${pass}/${results.length}；语义模型=${semanticOk ? '同源已验证' : '未就绪'}`)
await browser.close()
process.exit(pass === results.length ? 0 : 1)
