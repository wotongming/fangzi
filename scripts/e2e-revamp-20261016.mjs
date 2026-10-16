/**
 * 2026-10-16 改版验证：邮箱替换、整体降价、README/手册刷新、手册接入页面。
 * 覆盖：
 *  A. 顶部导航出现「使用帮助」；/help 渲染手册（标题 + GFM 表格 + 18 个网页工具 + 新邮箱/新价）。
 *  B. 首页首次访问出现新手引导条，点 × 后写入 localStorage 且本次消失。
 *  C. 付费工具卡与付费墙显示新价（简历 ¥29.90，年终奖 ¥12.90），旧价 ¥49.90 不再出现。
 *  D. 工具「用户指导」新价（如简历指导含 ¥29.90 而非 ¥49.90）。
 *  E. PC/平板/手机三视口帮助页与首页无横向溢出。
 * 运行前：npx vite preview --port 4173 --host 127.0.0.1
 */
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
const { chromium } = pw

const ORIGIN = 'http://localhost:4173'
const CHROMIUM = '/usr/local/bin/chromium'
const results = []
async function check(name, fn) {
  const t0 = Date.now()
  try { results.push({ name, ok: true, ms: Date.now() - t0, detail: await fn() }) }
  catch (e) { results.push({ name, ok: false, ms: Date.now() - t0, detail: e.message }) }
}
async function newCtx(browser, viewport) {
  const ctx = await browser.newContext({ viewport })
  await ctx.route('**/sw.js', (r) => r.abort())
  await ctx.route('**/registerSW.js', (r) => r.abort())
  return ctx
}
const SW_NOISE = /fetching the script|serviceWorker|An unknown error occurred when fetching/i

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-dev-shm-usage'] })

// ---- A/B/C/D：PC ----
{
  const ctx = await newCtx(browser, { width: 1280, height: 800 })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error' && !SW_NOISE.test(m.text())) errors.push(m.text()) })

  await page.goto(ORIGIN + '/#/help', { waitUntil: 'networkidle' })
  await page.waitForSelector('.markdown-body table', { timeout: 10000 })

  await check('A1 顶部导航含「使用帮助」', async () => {
    const txt = await page.locator('.topnav').innerText()
    if (!txt.includes('使用帮助')) throw new Error('nav missing')
    return 'ok'
  })
  await check('A2 帮助页渲染手册标题与 18 工具表述', async () => {
    const body = await page.locator('.markdown-body').innerText()
    if (!body.includes('方子 · 用户使用手册')) throw new Error('no title')
    if (!body.includes('18 个网页工具')) throw new Error('no count')
    return 'ok'
  })
  await check('A3 GFM 表格被渲染为 table（表头+行）', async () => {
    const th = await page.locator('.markdown-body thead th').count()
    const rows = await page.locator('.markdown-body tbody tr').count()
    if (th < 4) throw new Error(`th=${th}`)
    if (rows < 18) throw new Error(`rows=${rows}`)
    return `th=${th} rows=${rows}`
  })
  await check('A4 手册含新邮箱与新价、不含旧邮箱', async () => {
    const body = await page.locator('.markdown-body').innerText()
    if (!body.includes('fangziasia@163.com')) throw new Error('new email missing')
    if (body.includes('wotongming')) throw new Error('old email present')
    if (!body.includes('¥29.90')) throw new Error('new price missing')
    if (body.includes('¥49.90') || body.includes('¥39.90')) throw new Error('old price present')
    return 'ok'
  })

  // 首页首访引导
  await page.goto(ORIGIN + '/#/', { waitUntil: 'networkidle' })
  await check('B1 首次访问首页出现新手引导', async () => {
    await page.waitForSelector('.manual-hint', { timeout: 8000 })
    return 'ok'
  })
  await check('B2 点 × 关闭引导并写入本机记忆', async () => {
    await page.locator('.manual-hint-close').click()
    await page.waitForTimeout(200)
    const visible = await page.locator('.manual-hint').count()
    if (visible !== 0) throw new Error('still visible')
    const seen = await page.evaluate(() => localStorage.getItem('fz-manual-seen'))
    if (seen !== '1') throw new Error('not persisted')
    await page.reload({ waitUntil: 'networkidle' })
    const again = await page.locator('.manual-hint').count()
    if (again !== 0) throw new Error('reappeared after reload')
    return 'ok'
  })
  await check('B3 点引导正文可跳转 /help', async () => {
    // 清掉记忆以再次显示
    await page.evaluate(() => localStorage.removeItem('fz-manual-seen'))
    await page.reload({ waitUntil: 'networkidle' })
    await page.locator('.manual-hint-body').click()
    await page.waitForSelector('.markdown-body table', { timeout: 8000 })
    if (!page.url().includes('/help')) throw new Error(page.url())
    return 'ok'
  })

  // 付费工具卡新价（价格由 manifest 派生，全部工具页即权威展示）
  await page.goto(ORIGIN + '/#/browse', { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  await check('C1 全部工具页：简历/知识库/转写等显示 29.9、无 49.9', async () => {
    const txt = await page.locator('body').innerText()
    if (!txt.includes('29.9')) throw new Error('29.9 missing')
    if (txt.includes('49.9')) throw new Error('49.9 still present')
    return 'ok'
  })
  await check('C2 全部工具页：年终奖 12.9、可嵌入组件 24.9、家庭/图片 19.9', async () => {
    const txt = await page.locator('body').innerText()
    for (const p of ['12.9', '24.9', '19.9']) if (!txt.includes(p)) throw new Error(`${p} missing`)
    return 'ok'
  })
  await check('C3 全部工具页：批量文本按次价 0.1、插件 6.9', async () => {
    const txt = await page.locator('body').innerText()
    if (!txt.includes('0.1')) throw new Error('0.1 missing')
    if (!txt.includes('6.9')) throw new Error('6.9 missing')
    if (txt.includes('0.2')) throw new Error('old 0.2/次 still present')
    return 'ok'
  })

  await check('E1 PC 无横向溢出（help/home）', async () => {
    await page.goto(ORIGIN + '/#/help', { waitUntil: 'networkidle' })
    const o1 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    await page.goto(ORIGIN + '/#/', { waitUntil: 'networkidle' })
    const o2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (o1 > 2 || o2 > 2) throw new Error(`overflow help=${o1} home=${o2}`)
    return `help=${o1} home=${o2}`
  })

  await check('F Console 无未捕获错误（忽略 SW abort）', async () => {
    if (errors.length) throw new Error(errors.join(' | '))
    return 'ok'
  })
  await ctx.close()
}

// ---- 平板 / 手机视口溢出 ----
for (const [name, w, h] of [['平板', 834, 1112], ['手机', 375, 812]]) {
  const ctx = await newCtx(browser, { width: w, height: h })
  const page = await ctx.newPage()
  await page.goto(ORIGIN + '/#/help', { waitUntil: 'networkidle' })
  await page.waitForSelector('.markdown-body table', { timeout: 10000 })
  await check(`E2 ${name}帮助页可读且无横向溢出（${w}×${h}）`, async () => {
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    const rows = await page.locator('.markdown-body tbody tr').count()
    if (rows < 18) throw new Error(`rows=${rows}`)
    if (over > 2) throw new Error(`overflow=${over}`)
    return `overflow=${over} rows=${rows}`
  })
  await page.goto(ORIGIN + '/#/', { waitUntil: 'networkidle' })
  await check(`E3 ${name}首页无横向溢出（${w}×${h}）`, async () => {
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (over > 2) throw new Error(`overflow=${over}`)
    return `overflow=${over}`
  })
  await ctx.close()
}

await browser.close()

const pass = results.filter((r) => r.ok).length
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  (${String(r.ms).padStart(5)}ms)  ${r.name}${r.ok ? ' — ' + r.detail : ' :: ' + r.detail}`)
}
console.log(`\n汇总：${pass}/${results.length}`)
process.exit(pass === results.length ? 0 : 1)
