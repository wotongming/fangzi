/**
 * 2026-10-17 移动端原生外壳验证：
 *  PC(1280)：顶部导航/页脚仍在、底部 Tab 不存在（桌面布局零回归）
 *  手机(375)：底部 Tab 4 项与激活态、顶部导航/页脚隐藏、Tab 可切页；
 *            mini-games/pose 有全屏按钮，进入后外壳隐藏、工具容器沉浸，退出恢复；
 *            非沉浸工具（json-formatter）无全屏按钮；各页无横向溢出；几何变量就位
 *  平板(834，≥821 断点走桌面布局)：无横向溢出
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
const displayOf = (page, sel) =>
  page.evaluate((s) => getComputedStyle(document.querySelector(s)).display, sel)
const overflowOf = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-dev-shm-usage'] })

// ---------- PC：桌面布局保持 ----------
{
  const ctx = await newCtx(browser, { width: 1280, height: 800 })
  const page = await ctx.newPage()
  page.on('console', (m) => { if (m.type() === 'error' && !SW_NOISE.test(m.text())) console.log('PC-ERR', m.text()) })
  await page.goto(ORIGIN + '/#/', { waitUntil: 'networkidle' })

  await check('PC1 桌面顶部导航与页脚仍在，底部 Tab 不存在', async () => {
    if ((await displayOf(page, '.topnav')) === 'none') throw new Error('顶部导航被隐藏')
    if ((await displayOf(page, '.footer')) === 'none') throw new Error('页脚被隐藏')
    if ((await displayOf(page, '.tabbar')) !== 'none') throw new Error('桌面不应显示底部 Tab')
    return 'topnav+footer visible, tabbar none'
  })
  await check('PC2 桌面首页无横向溢出', async () => {
    const o = await overflowOf(page)
    if (o > 2) throw new Error(`overflow=${o}`)
    return `overflow=${o}`
  })
  await ctx.close()
}

// ---------- 手机：底部 Tab + 沉浸 ----------
{
  const ctx = await newCtx(browser, { width: 375, height: 812 })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error' && !SW_NOISE.test(m.text())) errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

  await check('M1 手机底部 Tab 显示 4 项，顶部导航/页脚隐藏', async () => {
    await page.goto(ORIGIN + '/#/', { waitUntil: 'networkidle' })
    if ((await displayOf(page, '.tabbar')) === 'none') throw new Error('底部 Tab 未显示')
    const n = await page.locator('.tabbar .tab').count()
    if (n !== 4) throw new Error(`Tab 项=${n}`)
    if ((await displayOf(page, '.topnav')) !== 'none') throw new Error('手机仍显示顶部导航')
    if ((await displayOf(page, '.footer')) !== 'none') throw new Error('手机仍显示页脚')
    return 'tabs=4'
  })

  await check('M2 首页 Tab 处于激活态', async () => {
    if ((await page.locator('.tabbar .tab.on').count()) !== 1) throw new Error('激活 Tab 数≠1')
    const onHref = await page.locator('.tabbar .tab.on').getAttribute('href')
    if (onHref !== '#/' && onHref !== './') throw new Error(`激活项 href=${onHref}`)
    return onHref
  })

  await check('M3 点底部 Tab 可切到「全部工具」并正确激活', async () => {
    await page.click('.tabbar .tab:has-text("全部工具")')
    await page.waitForTimeout(250)
    if (!page.url().includes('/browse')) throw new Error(`url=${page.url()}`)
    const active = await page.locator('.tabbar .tab.on').getAttribute('href')
    if (!active || !active.includes('browse')) throw new Error(`激活=${active}`)
    const o = await overflowOf(page)
    if (o > 2) throw new Error(`browse overflow=${o}`)
    return 'browse active, overflow=0'
  })

  await check('M4 设置页可经底部 Tab 到达且无横向溢出', async () => {
    await page.click('.tabbar .tab:has-text("设置")')
    await page.waitForTimeout(250)
    if (!page.url().includes('/settings')) throw new Error(`url=${page.url()}`)
    const o = await overflowOf(page)
    if (o > 2) throw new Error(`settings overflow=${o}`)
    return 'settings ok'
  })

  await check('M5 几何变量就位（--tab-h/--sab/--gutter-x）', async () => {
    const vars = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement)
      return { tab: s.getPropertyValue('--tab-h').trim(), sab: s.getPropertyValue('--sab').trim(), gutter: s.getPropertyValue('--gutter-x').trim() }
    })
    if (!vars.tab) throw new Error('缺 --tab-h')
    if (!vars.sab) throw new Error('缺 --sab')
    if (vars.gutter !== '12px') throw new Error(`移动侧留白应 12px，实际 ${vars.gutter}`)
    return JSON.stringify(vars)
  })

  await check('M6 mini-games 显示全屏按钮', async () => {
    await page.goto(ORIGIN + '/#/t/mini-games', { waitUntil: 'networkidle' })
    await page.waitForSelector('.game-tabs', { timeout: 10000 })
    const n = await page.locator('button:has-text("全屏")').count()
    if (n < 1) throw new Error('mini-games 无全屏按钮')
    return 'fullscreen btn present'
  })

  await check('M7 进入沉浸后外壳隐藏、工具容器铺满；退出恢复', async () => {
    await page.click('button:has-text("全屏")')
    await page.waitForTimeout(200)
    const inImm = await page.evaluate(() => ({
      shell: document.querySelector('.app-shell').classList.contains('is-immersive'),
      runner: document.querySelector('.runner').classList.contains('runner-immersive'),
      tabbar: getComputedStyle(document.querySelector('.tabbar')).display,
      topbar: getComputedStyle(document.querySelector('.topbar')).display
    }))
    if (!inImm.shell || !inImm.runner) throw new Error(`未进入沉浸：${JSON.stringify(inImm)}`)
    if (inImm.tabbar !== 'none' || inImm.topbar !== 'none') throw new Error(`沉浸态外壳未隐藏：${JSON.stringify(inImm)}`)
    const o = await overflowOf(page)
    if (o > 2) throw new Error(`沉浸态 overflow=${o}`)
    // 退出
    await page.click('button:has-text("退出全屏")')
    await page.waitForTimeout(200)
    const restored = await page.evaluate(() => ({
      shell: document.querySelector('.app-shell').classList.contains('is-immersive'),
      tabbar: getComputedStyle(document.querySelector('.tabbar')).display
    }))
    if (restored.shell) throw new Error('退出后 shell 仍沉浸')
    if (restored.tabbar === 'none') throw new Error('退出后底部 Tab 未恢复')
    return 'enter/exit ok'
  })

  await check('M8 pose-fitness-coach 也提供全屏入口', async () => {
    await page.goto(ORIGIN + '/#/t/pose-fitness-coach', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.sticky-bar', { timeout: 10000 })
    const n = await page.locator('button:has-text("全屏")').count()
    if (n < 1) throw new Error('pose 无全屏按钮')
    return 'pose fullscreen btn'
  })

  await check('M9 非沉浸工具 json-formatter 无全屏按钮', async () => {
    await page.goto(ORIGIN + '/#/t/json-formatter', { waitUntil: 'networkidle' })
    await page.waitForTimeout(400)
    const n = await page.locator('button:has-text("全屏")').count()
    if (n !== 0) throw new Error(`不应有全屏按钮，实际 ${n}`)
    return 'no fullscreen btn'
  })

  await check('M10 手机控制台无未捕获错误', async () => {
    if (errors.length) throw new Error(errors.join(' | '))
    return 'clean'
  })
  await ctx.close()
}

// ---------- 平板 834（≥821 走桌面断点）：无溢出 ----------
{
  const ctx = await newCtx(browser, { width: 834, height: 1112 })
  const page = await ctx.newPage()
  await page.goto(ORIGIN + '/#/browse', { waitUntil: 'networkidle' })
  await check('T1 平板(834)走桌面布局且无横向溢出', async () => {
    if ((await displayOf(page, '.tabbar')) !== 'none') throw new Error('834 宽不应显示底部 Tab')
    if ((await displayOf(page, '.topnav')) === 'none') throw new Error('顶部导航应显示')
    const o = await overflowOf(page)
    if (o > 2) throw new Error(`tablet overflow=${o}`)
    return `overflow=${o}`
  })
  await ctx.close()
}

await browser.close()

let pass = 0
for (const r of results) {
  console.log(`${r.ok ? '✅' : '❌'} ${r.name} — ${r.ok ? r.detail : r.detail}`)
  if (r.ok) pass++
}
console.log(`汇总：${pass}/${results.length}`)
process.exit(pass === results.length ? 0 : 1)
