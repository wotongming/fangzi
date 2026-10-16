/**
 * 2026-10-17 新工具「小游戏合集」验证：
 *  - 搜索「小游戏」首条命中并能打开工具页
 *  - 4 个游戏标签；2048 可键盘操作且发生合并计分
 *  - 记忆翻牌可翻牌、难度切换改变牌数
 *  - 专业版付费墙（华容道/三锁锁定、价格 ¥19.90），本地模拟下单后解锁
 *  - 用户指导页非空
 *  - PC / 平板 / 手机三视口无横向溢出、无未捕获错误
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

{
  const ctx = await newCtx(browser, { width: 1280, height: 800 })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error' && !SW_NOISE.test(m.text())) errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

  await check('H1 搜索「小游戏」首条命中并打开工具页', async () => {
    await page.goto(ORIGIN + '/#/', { waitUntil: 'networkidle' })
    await page.fill('.search-input', '午休想玩个打发时间的小游戏 2048')
    await page.click('button.prescribe')
    await page.waitForSelector('.grid .tool-card, .grid a, .grid > *', { timeout: 10000 })
    const firstHref = await page.locator('.grid > *').first().getAttribute('href').catch(() => null)
    if (!firstHref || !firstHref.includes('mini-games')) throw new Error(`首条未命中 mini-games：${firstHref}`)
    await page.locator('.grid > *').first().click()
    await page.waitForSelector('.game-tabs', { timeout: 10000 })
    if (!page.url().includes('mini-games')) throw new Error('未进入工具页')
    return firstHref
  })

  await check('H2 渲染 4 个游戏标签，默认 2048，专业版游戏带锁', async () => {
    const tabs = page.locator('.game-tabs .tab')
    if ((await tabs.count()) !== 4) throw new Error('tab 数量不是 4')
    const names = await page.locator('.game-tabs .tab-name').allInnerTexts()
    if (!names.includes('2048') || !names.includes('三消')) throw new Error(`标签缺失：${names.join(',')}`)
    const locks = await page.locator('.game-tabs .tab .lock').count()
    if (locks !== 2) throw new Error(`应 2 个专业版带锁，实际 ${locks}`)
    // 默认 2048 棋盘 16 格，初始至少 2 块
    const tiles = await page.locator('.g2048 .cell:not(.empty)').count()
    if (tiles < 2) throw new Error(`初始棋子=${tiles}`)
    return `tabs=4 locks=2 initTiles=${tiles}`
  })

  await check('H3 2048 键盘可操作且发生合并（得分>0）', async () => {
    await page.locator('.g2048 .board').click()
    for (let i = 0; i < 24; i++) {
      await page.keyboard.press(i % 2 === 0 ? 'ArrowLeft' : 'ArrowUp')
      await page.waitForTimeout(40)
    }
    const scoreTxt = await page.locator('.bar .sc').first().locator('b').innerText()
    const score = Number(scoreTxt)
    if (!(score > 0)) throw new Error(`2048 未发生合并计分：${scoreTxt}`)
    return `score=${score}`
  })

  await check('H4 记忆翻牌可翻牌，难度切换改变牌数', async () => {
    await page.locator('.game-tabs .tab', { hasText: '记忆翻牌' }).click()
    await page.waitForSelector('.mem .grid', { timeout: 5000 })
    if ((await page.locator('.mem .card').count()) !== 12) throw new Error('简单应为 6 对 12 张')
    await page.locator('.mem .card').nth(0).click()
    await page.waitForTimeout(50)
    if (!(await page.locator('.mem .card').nth(0).getAttribute('class'))?.includes('up')) throw new Error('首张未翻开')
    await page.locator('.diffs .diff', { hasText: '困难' }).click()
    await page.waitForTimeout(60)
    if ((await page.locator('.mem .card').count()) !== 24) throw new Error('困难应为 12 对 24 张')
    return 'easy=12 hard=24'
  })

  await check('H5 专业版未解锁：华容道显示付费墙与价格', async () => {
    await page.locator('.game-tabs .tab', { hasText: '数字华容道' }).click()
    await page.waitForSelector('.paywall', { timeout: 5000 })
    const body = await page.locator('.panel').innerText()
    if (!body.includes('¥19.90')) throw new Error('未显示买断价 ¥19.90')
    if ((await page.locator('.kl .board').count()) !== 0) throw new Error('未锁定，不应出现棋盘')
    return 'paywall ok'
  })

  await check('H6 下单解锁后华容道/三消都可玩', async () => {
    await page.locator('.paywall .big').click()
    await page.waitForSelector('.kl .board', { timeout: 5000 })
    const tiles = await page.locator('.kl .tile:not(.empty)').count()
    if (tiles !== 8) throw new Error(`3x3 应 8 个数字块，实际 ${tiles}`)
    // 锁标记应消失
    if ((await page.locator('.game-tabs .tab .lock').count()) !== 0) throw new Error('解锁后仍有锁标')
    await page.locator('.game-tabs .tab', { hasText: '三消' }).click()
    await page.waitForSelector('.m3 .board', { timeout: 5000 })
    const gems = await page.locator('.m3 .gem').count()
    if (gems !== 64) throw new Error(`三消应 64 格，实际 ${gems}`)
    return 'klotski=8tiles match3=64gems unlocked'
  })

  await check('H7 Console 无未捕获错误（忽略 SW abort）', async () => {
    if (errors.length) throw new Error(errors.join(' | '))
    return 'ok'
  })

  await ctx.close()
}

// 用户指导页非空
{
  const ctx = await newCtx(browser, { width: 1280, height: 800 })
  const page = await ctx.newPage()
  await check('H8 用户指导页有实际内容（非“暂未提供”）', async () => {
    await page.goto(ORIGIN + '/#/t/mini-games/guide', { waitUntil: 'networkidle' })
    await page.waitForSelector('.markdown-body', { timeout: 10000 })
    const body = await page.locator('.markdown-body').innerText()
    if (body.includes('暂未提供使用指导') || body.trim().length < 120) throw new Error('指导内容为空')
    if (!body.includes('2048') || !body.includes('专业版')) throw new Error('缺少关键小节')
    return `len=${body.length}`
  })
  await ctx.close()
}

// 三视口无横向溢出
for (const [label, vp] of [['PC', { width: 1280, height: 800 }], ['平板', { width: 834, height: 1112 }], ['手机', { width: 375, height: 812 }]]) {
  const ctx = await newCtx(browser, vp)
  const page = await ctx.newPage()
  await check(`H9 ${label} 工具页无横向溢出`, async () => {
    await page.goto(ORIGIN + '/#/t/mini-games', { waitUntil: 'networkidle' })
    await page.waitForSelector('.g2048 .board', { timeout: 10000 })
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
