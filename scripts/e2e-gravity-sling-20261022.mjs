/**
 * 2026-10-22《挽星弓》gravity-sling 三视口 E2E（M 档）。
 *
 * 覆盖：
 *  - 选卡进入 → 首局手势引导 → 真实 pointer 拖拽蓄力（预测轨迹/橡皮筋）→ 松手发射
 *  - 调试缝强制命中第 1 关星门 → win 面板 → 进入第 2 关，分数/关卡断言
 *  - hidden 自动暂停、进度不丢；回前台经菜单「继续」恢复
 *  - 写快照 → reload → 弹「继续上一局」→ 恢复 level/score；「开始新局」清快照
 *  - 断网（SW）可玩；零横向溢出、无 pageerror、零外部请求
 *
 * 运行前：npx vite preview --port 4173 --host 127.0.0.1
 */
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { newCompatContext, horizontalOverflow, SW_NOISE, CHROMIUM, LAUNCH_ARGS } from './_gpu-ctx.mjs'

const { chromium } = pw
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = join(ROOT, 'src/tools/mini-games/gpu-games/gravity-sling/docs/shots')
const ORIGIN = 'http://localhost:4173'
const AUTO_KEY = 'fangzi:gravity-sling:auto-save:v1'

const fail = []
const log = (...a) => console.log('[e2e-gravity-sling]', ...a)

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

async function newPage(browser, viewport, mobile = false) {
  const ctx = mobile
    ? await browser.newContext({ viewport, hasTouch: true, userAgent: MOBILE_UA })
    : await newCompatContext(browser, viewport)
  await ctx.addInitScript(() => {
    try {
      Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined, configurable: true })
    } catch {}
  })
  await ctx.route('**/sw.js', (r) => r.abort())
  await ctx.route('**/registerSW.js', (r) => r.abort())
  const page = await ctx.newPage()
  page.on('pageerror', (e) => { if (!SW_NOISE.test(e.message)) fail.push(`pageerror: ${e.message}`) })
  page.on('console', (m) => { if (m.type() === 'error' && !SW_NOISE.test(m.text())) fail.push(`console.error: ${m.text()}`) })
  const external = []
  page.on('request', (req) => { const u = req.url(); if (!u.startsWith(ORIGIN)) external.push(u) })
  return { ctx, page, external }
}

async function enterGame(page, { clear = true } = {}) {
  await page.goto(`${ORIGIN}/#/t/mini-games`)
  await page.waitForSelector('.gcard', { timeout: 20000 })
  await page.locator('.gcard', { hasText: '挽星弓' }).first().click()
  await page.waitForSelector('.focus-stage', { timeout: 20000 })
  await page.waitForFunction(() => !!window.__gravitySling, undefined, { timeout: 15000 })
  // 首局引导：点画布中央进入瞄准（坐标按各视口实测，避免固定点落在移动端屏外）
  const phase0 = await page.evaluate(() => window.__gravitySling.debug.phase())
  if (phase0 === 'intro') {
    const box = await page.locator('.sling-canvas').boundingBox()
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForFunction(
      () => window.__gravitySling.debug.phase() === 'aim',
      undefined,
      { timeout: 5000 }
    )
  }
  if (clear) await page.evaluate(() => { window.__gravitySling.clearAutoSave(); window.__gravitySling.reset() })
}

async function waitPhase(page, target, timeout = 4000) {
  await page.waitForFunction((t) => window.__gravitySling && window.__gravitySling.debug.phase() === t, target, { timeout })
}

async function setHidden(page, hidden) {
  await page.evaluate((h) => {
    Object.defineProperty(document, 'hidden', { value: h, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  }, hidden)
  await page.waitForTimeout(300)
}

async function shot(page, name) {
  await page.screenshot({ path: join(SHOTS, name) })
  log('shot', name)
}

async function mainChain(page, label, shotName) {
  // 真实拖拽蓄力（锚点向下拉伸 → 瞄准向上），截预测轨迹 + 橡皮筋
  const a = await page.evaluate(() => window.__gravitySling.debug.anchorScreen())
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(a.x, a.y + 150, { steps: 10 })
  await page.waitForTimeout(220)
  await shot(page, shotName)
  await page.mouse.up()
  await page.waitForTimeout(150)

  // 调试缝强制命中第 1 关星门，确定性进入 win
  await page.evaluate(() => {
    const g = window.__gravitySling
    g.debug.forcePortal()
    g.debug.launch(-90, 1)
  })
  await waitPhase(page, 'win')
  const win = await page.evaluate(() => ({ score: window.__gravitySling.state().score, level: window.__gravitySling.state().level }))
  log(`[${label}] win = ${JSON.stringify(win)}`)
  if (win.level !== 0) fail.push(`${label} 首关 level=${win.level} 应为 0`)
  if (win.score <= 0) fail.push(`${label} 通关后分数应为正`)

  // 进入下一关
  await page.evaluate(() => window.__gravitySling.nextLevel())
  await page.waitForTimeout(200)
  const after = await page.evaluate(() => ({ level: window.__gravitySling.state().level, score: window.__gravitySling.state().score }))
  log(`[${label}] next level = ${JSON.stringify(after)}`)
  if (after.level !== 1) fail.push(`${label} 进入下一关失败：level=${after.level}`)
  if (after.score !== win.score) fail.push(`${label} 过关后分数未保留`)

  // hidden 自动暂停且进度不丢
  await setHidden(page, true)
  const pausedHidden = await page.evaluate(() => window.__gravitySling.debug.isPaused())
  const levelHidden = await page.evaluate(() => window.__gravitySling.state().level)
  log(`[${label}] hidden paused=${pausedHidden} level=${levelHidden}`)
  if (!pausedHidden) fail.push(`${label} 切后台未自动暂停`)
  if (levelHidden !== 1) fail.push(`${label} 切后台后关卡进度丢失`)
  await setHidden(page, false)
  // 回前台保持暂停，经菜单继续
  await page.locator('.hud-btn').click()
  await page.waitForTimeout(150)
  await page.locator('.sheet-btn', { hasText: '继续' }).click()
  await page.waitForTimeout(200)
  const pausedAfter = await page.evaluate(() => window.__gravitySling.debug.isPaused())
  if (pausedAfter) fail.push(`${label} 点继续后仍处于暂停`)

  // 快照 → reload → 续玩
  await page.evaluate(() => window.__gravitySling.autoSaveNow())
  const before = await page.evaluate(() => ({ level: window.__gravitySling.state().level, score: window.__gravitySling.state().score }))
  await page.reload()
  await enterGame(page, { clear: false })
  await waitPhase(page, 'resume', 5000)
  await page.evaluate(() => window.__gravitySling.resumeAuto())
  await page.waitForTimeout(200)
  const back = await page.evaluate(() => ({ level: window.__gravitySling.state().level, score: window.__gravitySling.state().score }))
  log(`[${label}] reload 续玩 before=${JSON.stringify(before)} after=${JSON.stringify(back)}`)
  if (back.level !== before.level) fail.push(`${label} 续玩关卡不一致`)
  if (back.score !== before.score) fail.push(`${label} 续玩分数不一致`)
  // 开始新局清快照
  await page.evaluate(() => window.__gravitySling.discardAuto())
  const cleared = await page.evaluate((k) => !localStorage.getItem(k), AUTO_KEY)
  if (!cleared) fail.push(`${label} 新局后自动快照未清除`)
}

async function run() {
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: LAUNCH_ARGS })
  try {
    const viewports = [
      [{ width: 1280, height: 860 }, 'pc', false, 'pc-aim.png'],
      [{ width: 834, height: 1112 }, 'tablet', false, 'tablet-aim.png'],
      [{ width: 375, height: 812 }, 'mobile', true, 'mobile-aim.png']
    ]
    for (const [vp, label, mobile, shotName] of viewports) {
      const { page, external } = await newPage(browser, vp, mobile)
      await enterGame(page)
      await mainChain(page, label, shotName)
      const ov = await horizontalOverflow(page)
      log(`[${label}] overflow=${ov}px`)
      if (ov > 2) fail.push(`${label} 横向溢出 ${ov}px`)
      if (external.length) fail.push(`${label} 存在外部请求：${external.slice(0, 3).join(', ')}`)
      await page.close()
    }

    // PC 通关面板截图（独立上下文，避免续玩流程干扰）
    {
      const { page } = await newPage(browser, { width: 1280, height: 860 })
      await enterGame(page)
      await page.evaluate(() => { const g = window.__gravitySling; g.debug.forcePortal(); g.debug.launch(-90, 1) })
      await waitPhase(page, 'win')
      await page.waitForTimeout(300)
      await shot(page, 'pc-win.png')
      await page.close()
    }

    // SW 预缓存包含本游戏懒加载 chunk；断网二次进入可玩
    const swPath = join(ROOT, 'dist/sw.js')
    if (!existsSync(swPath)) fail.push('dist/sw.js 不存在')
    else {
      const sw = readFileSync(swPath, 'utf8')
      if (!/gravity-sling-[A-Za-z0-9_-]+\.js/.test(sw)) fail.push('SW 预缓存未包含 gravity-sling chunk')
    }
    {
      const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, userAgent: MOBILE_UA })
      const page = await ctx.newPage()
      page.on('pageerror', (e) => { if (!SW_NOISE.test(e.message)) fail.push(`offline pageerror: ${e.message}`) })
      await enterGame(page)
      // 先在线等 SW 就绪并在线 reload 一次，使当前页面被 SW 控制，再断网二次加载
      await page.waitForFunction(() => navigator.serviceWorker && !!navigator.serviceWorker.ready, undefined, { timeout: 10000 })
      await page.reload({ waitUntil: 'load' })
      await page.waitForFunction(() => navigator.serviceWorker && !!navigator.serviceWorker.controller, undefined, { timeout: 10000 })
      await ctx.setOffline(true)
      await page.reload({ waitUntil: 'load', timeout: 10000 })
      await page.waitForSelector('.gcard', { timeout: 10000 })
      await page.locator('.gcard', { hasText: '挽星弓' }).first().click()
      await page.waitForSelector('.focus-stage', { timeout: 10000 })
      await page.waitForFunction(() => !!window.__gravitySling, undefined, { timeout: 10000 })
      await page.waitForFunction(
        () => ['aim', 'resume', 'intro'].includes(window.__gravitySling.debug.phase()),
        undefined,
        { timeout: 8000 }
      )
      log('offline: 断网二次加载后游戏可进入')
      await page.close()
    }
  } finally {
    await browser.close()
  }
  if (fail.length) {
    console.error('\n❌ E2E 失败：')
    for (const f of fail) console.error(' -', f)
    process.exit(1)
  }
  console.log('\n✅ 《挽星弓》三视口 + 续玩 + 断网 E2E 全部通过')
}

run().catch((e) => { console.error(e); process.exit(1) })
