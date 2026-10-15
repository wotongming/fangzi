/**
 * 003 本地知识库智能问答：多端 E2E 验证 + 真实截图（档位：H，checkpoint）。
 * 覆盖：
 *  - PC：四格式导入建库（先纯 BM25，不依赖模型下载）→ 问答 → [n] 引用弹层 →
 *    对话保存 / 导出 .md → 免费 20 文档上限拦截 → 写 paid 订单解锁后可继续导入 →
 *    设置页模型源展示（免费时自定义源禁用）
 *  - 真实语义链路（H 档关键路径）：从 hf-mirror 下载 bge-small q8 onnx(约24MB)+分词文件，
 *    Cache Storage 缓存，ort WASM 初始化，语义嵌入建库，问答 meta 显示「语义+关键词检索」。
 *    若网络/wasm 失败，明确记录为 checkpoint（BM25 已验证、语义待联网环境复验），不谎报。
 *  - 平板 834×1112 / 手机 375×812：无横向溢出，真实截图。
 * 运行前：npm run preview（http://localhost:4173）
 */
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
const { chromium } = pw
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = join(ROOT, 'src/tools/local-knowledge-base/docs/shots')
const FIX = '/tmp/lkb-fixtures'
const BASE = 'http://localhost:4173/#/t/local-knowledge-base'
const CHROMIUM = '/usr/local/bin/chromium'
mkdirSync(SHOTS, { recursive: true })
mkdirSync(FIX, { recursive: true })

const results = []
async function check(name, fn) {
  const t0 = Date.now()
  try {
    const detail = await fn()
    results.push({ name, ok: true, ms: Date.now() - t0, detail: detail ?? '' })
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, detail: e.message })
  }
}
async function shot(page, name) {
  await page.screenshot({ path: join(SHOTS, name), fullPage: false })
  return name
}
async function goTab(page, name) {
  await page.locator('.tabs button', { hasText: name }).first().click()
}

/* 固定语料：合同含明确“违约/赔偿”，应被 BM25 与语义双双命中 */
writeFileSync(join(FIX, 'contract.txt'),
  '产品采购合同\n甲方与乙方本着平等自愿原则签订本合同。任何一方违反本合同约定，即构成违约，应当承担违约责任，' +
  '并赔偿对方因此遭受的全部损失，违约金为合同总金额的百分之二十。争议提交甲方所在地人民法院诉讼解决。')
writeFileSync(join(FIX, 'notes.md'),
  '# 项目会议纪要\n## 进度安排\n本周完成检索模块联调，下周进行压力测试。\n## 备注\n会议在周三下午举行，参会人员包括前端与算法同学。')
writeFileSync(join(FIX, 'data.csv'),
  '月份,收入,支出\n一月,12000,8000\n二月,15000,9000\n三月,18000,11000')
writeFileSync(join(FIX, 'page.html'),
  '<html><body><h1>售后政策</h1><p>商品支持七天无理由退货。</p><script>var x=1</script></body></html>')
for (let i = 1; i <= 17; i++) {
  const n = String(i).padStart(2, '0')
  writeFileSync(join(FIX, `f${n}.txt`), `这是第 ${i} 份填充文档，用于验证免费版文档数量上限。编号 ${n}。`)
}

const browser = await chromium.launch({
  executablePath: CHROMIUM,
  args: ['--no-sandbox', '--disable-dev-shm-usage']
})
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true })
await ctx.route('**/sw.js', (r) => r.abort())
await ctx.route('**/registerSW.js', (r) => r.abort())
const page = await ctx.newPage()
const consoleErrors = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)) })
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message.slice(0, 200)))

await check('打开工具，标题与 SEO 正确，默认在文档库 tab', async () => {
  await page.goto(BASE)
  await page.waitForSelector('.lkb h1')
  const title = await page.title()
  if (!title.includes('本地知识库')) throw new Error('title 不符：' + title)
  await page.waitForSelector('.tabs button.active')
  return title
})

await check('关闭语义嵌入后，四格式（txt/md/csv/html）导入建库成功', async () => {
  await page.uncheck('.chk input')
  await page.setInputFiles('input[type=file]', [
    join(FIX, 'contract.txt'), join(FIX, 'notes.md'), join(FIX, 'data.csv'), join(FIX, 'page.html')
  ])
  await page.waitForFunction(() => !document.querySelector('.progress'), null, { timeout: 30000 })
  await page.waitForTimeout(400)
  const rows = await page.locator('.doclist tbody tr').count()
  if (rows !== 4) throw new Error('期望 4 行文档，实际 ' + rows)
  return `文档行 ${rows}`
})

await check('纯 BM25 问答：命中合同片段，答案带 [n] 引用', async () => {
  await goTab(page,'问答')
  await page.fill('.ask textarea', '一方违约了应该怎么赔偿？')
  await page.click('text=发送')
  await page.waitForSelector('.msg.assistant .cite', { timeout: 20000 })
  const meta = await page.locator('.msg.assistant .meta').first().innerText()
  if (!meta.includes('关键词检索')) throw new Error('未走关键词通道：' + meta)
  const firstCite = await page.locator('.msg.assistant .cite').first().innerText()
  if (!firstCite.includes('contract.txt')) throw new Error('首条引用不是合同：' + firstCite)
  const answer = await page.locator('.msg.assistant .content').first().innerText()
  if (!/\[\d+\]/.test(answer)) throw new Error('答案缺少 [n] 标记')
  return meta
})

await check('点击 [1] 引用弹出原文片段弹层', async () => {
  await page.click('.msg.assistant .cite >> nth=0')
  await page.waitForSelector('.modal-card .cite-text')
  const t = await page.locator('.modal-card .cite-text').innerText()
  if (!t.includes('违约')) throw new Error('引用原文不含“违约”')
  await page.click('.modal-card button.btn-primary')
  await page.waitForTimeout(200)
  return '弹层原文正确'
})

await check('对话自动保存到列表，并可导出为 .md', async () => {
  await page.waitForSelector('.conv-item .conv-title')
  const download = page.waitForEvent('download', { timeout: 10000 })
  await page.click('.conv-item >> nth=0 >> text=导出')
  const dl = await download
  if (!dl.suggestedFilename().endsWith('.md')) throw new Error('导出非 md：' + dl.suggestedFilename())
  return dl.suggestedFilename()
})

await check('设置页：免费时自定义模型源输入被禁用，内置源可见', async () => {
  await goTab(page,'设置')
  await page.waitForSelector('.form-row input[type=url]')
  const disabled = await page.locator('.form-row input[type=url]').isDisabled()
  if (!disabled) throw new Error('免费态自定义源应禁用')
  const body = await page.locator('.lkb').innerText()
  if (!body.includes('hf-mirror') || !body.includes('Cloudflare R2')) throw new Error('缺少模型源说明')
  return '自定义源禁用、内置源与对象存储说明展示'
})

await check('免费版 20 文档上限：补足到 20 后第 21 个被拦截', async () => {
  await goTab(page,'文档库')
  const rest = []
  for (let i = 1; i <= 16; i++) rest.push(join(FIX, `f${String(i).padStart(2, '0')}.txt`))
  await page.setInputFiles('input[type=file]', rest)
  await page.waitForFunction(() => !document.querySelector('.progress'), null, { timeout: 60000 })
  await page.waitForTimeout(500)
  let rows = await page.locator('.doclist tbody tr').count()
  if (rows !== 20) throw new Error('期望 20 行，实际 ' + rows)
  await page.setInputFiles('input[type=file]', [join(FIX, 'f17.txt')])
  await page.waitForSelector('.notice', { timeout: 5000 })
  const notice = await page.locator('.notice').first().innerText()
  await page.waitForTimeout(2600)
  rows = await page.locator('.doclist tbody tr').count()
  if (rows !== 20) throw new Error('被拦截后仍应为 20，实际 ' + rows)
  if (!notice.includes('20')) throw new Error('提示未说明上限：' + notice)
  return notice
})

await check('写入 paid freemium-pro 订单重载后解锁，可导入第 21 个文档', async () => {
  await page.evaluate(() => {
    localStorage.setItem('fangzi:billing:v1', JSON.stringify({
      orders: [{
        id: 'e2e-paid-003', toolId: 'local-knowledge-base', kind: 'freemium-pro',
        amountCents: 4990, currency: 'CNY', status: 'paid', provider: 'local-mock',
        createdAt: new Date().toISOString()
      }],
      usage: {}
    }))
  })
  await page.reload()
  await page.waitForSelector('.pro-badge.on')
  await page.uncheck('.chk input').catch(() => {})
  await page.setInputFiles('input[type=file]', [join(FIX, 'f17.txt')])
  await page.waitForFunction(() => !document.querySelector('.progress'), null, { timeout: 30000 })
  await page.waitForTimeout(400)
  const rows = await page.locator('.doclist tbody tr').count()
  if (rows !== 21) throw new Error('解锁后应为 21，实际 ' + rows)
  return `专业版已解锁，文档 ${rows}`
})

/* ===== H 档关键路径：真实语义模型链路（联网 + ort WASM）===== */
let semanticOk = false
await check('真实语义链路：下载 bge-small q8 模型并初始化（可能耗时）', async () => {
  await goTab(page,'设置')
  await page.locator('section.panel .btn-primary').first().click()
  // 下载+初始化可能较久，轮询设置区结果文案
  await page.waitForFunction(() => {
    const t = document.querySelector('.lkb')?.textContent || ''
    return t.includes('语义模型已就绪') || t.includes('模型准备失败')
  }, null, { timeout: 240000 })
  const body = await page.locator('.lkb').innerText()
  if (!body.includes('语义模型已就绪')) {
    const m = body.match(/模型准备失败[^\n]*/)
    throw new Error(m ? m[0] : '模型未就绪且无失败信息')
  }
  semanticOk = true
  return '模型已下载、缓存并初始化'
}, )

await check('语义嵌入建库 + 问答走「语义+关键词」混合通道', async () => {
  if (!semanticOk) throw new Error('跳过：语义模型未就绪（checkpoint：BM25 已验证）')
  await goTab(page,'文档库')
  await page.check('.chk input')
  await page.setInputFiles('input[type=file]', [join(FIX, 'contract.txt')])
  await page.waitForFunction(() => !document.querySelector('.progress'), null, { timeout: 120000 })
  await goTab(page,'问答')
  await page.click('text=＋ 新对话')
  await page.fill('.ask textarea', '违约金比例是多少')
  await page.click('text=发送')
  await page.waitForSelector('.msg.assistant .cite', { timeout: 60000 })
  const meta = await page.locator('.msg.assistant .meta').first().innerText()
  if (!meta.includes('语义+关键词')) throw new Error('未走语义混合通道：' + meta)
  return meta
})

/* ===== 截图：PC 主要视图 ===== */
await check('PC 截图：文档库 / 问答 / 设置', async () => {
  await goTab(page,'文档库')
  await page.waitForTimeout(300)
  await shot(page, 'shot-01-pc-docs.png')
  await goTab(page,'问答')
  await page.waitForSelector('.msg.assistant .cite')
  await shot(page, 'shot-02-pc-chat.png')
  await goTab(page,'设置')
  await page.waitForTimeout(300)
  await shot(page, 'shot-03-pc-settings.png')
  return '3 张 PC 截图'
})

/* ===== 多端：平板 / 手机无横向溢出 ===== */
async function responsive(viewport, label, shotName) {
  await check(`${label}（${viewport.width}×${viewport.height}）无横向溢出且可问答`, async () => {
    const c2 = await browser.newContext({ viewport, acceptDownloads: true })
    await c2.route('**/sw.js', (r) => r.abort())
    await c2.route('**/registerSW.js', (r) => r.abort())
    const p2 = await c2.newPage()
    await p2.goto(BASE)
    await p2.waitForSelector('.lkb h1')
    await p2.uncheck('.chk input').catch(() => {})
    const overflowDocs = await p2.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    if (overflowDocs > 1) throw new Error('文档库横向溢出 ' + overflowDocs)
    await p2.locator('.tabs button', { hasText: '问答' }).first().click()
    await p2.waitForTimeout(200)
    const overflowChat = await p2.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    if (overflowChat > 1) throw new Error('问答横向溢出 ' + overflowChat)
    await shot(p2, shotName)
    await c2.close()
    return `无横向溢出（docs Δ=${overflowDocs}, chat Δ=${overflowChat}）`
  })
}
await responsive({ width: 834, height: 1112 }, '平板', 'shot-04-tablet.png')
await responsive({ width: 375, height: 812 }, '手机', 'shot-05-phone.png')

await check('Console 无未捕获错误（忽略 SW abort 噪声）', async () => {
  const real = consoleErrors.filter((e) => !/Failed to register|serviceWorker|sw\.js|registerSW|ERR_ABORTED|unknown error occurred when fetching the script|Failed to fetch|importing a module script|blocked by CORS policy|ERR_FAILED/i.test(e))
  if (real.length) throw new Error(real.slice(0, 3).join(' | '))
  return '无实质 console 错误'
})

console.log('\n================ 003 E2E 结果 ================')
let pass = 0
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  (${String(r.ms).padStart(6)}ms)  ${r.name}${r.ok ? '' : '\n        → ' + r.detail}`)
  if (r.ok) pass++
}
console.log(`\n汇总：${pass}/${results.length} 通过；语义链路=${semanticOk ? '已验证' : 'CHECKPOINT 待联网复验（BM25 已验证）'}`)
await browser.close()
process.exit(pass === results.length ? 0 : 1)
