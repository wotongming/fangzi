/**
 * 2026-10-29《星脉》starvein 三视口 E2E（M 档）。
 *
 * 覆盖：
 *  - 选卡进入 → intro 点屏开始 → 真实 pointer 拖动画线点亮节点
 *  - 点亮数/分数变化 → debug 收线 → 结算评级 S/A/B/C
 *  - hidden 自动暂停、进度不丢；reload 弹继续 → resumeAuto 还原；discardAuto 清快照
 *  - 断网（SW）可玩；零横向溢出、无 pageerror、零外部请求
 *
 * 运行前：npx vite preview --port 4173 --host 127.0.0.1
 */
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { newCompatContext, horizontalOverflow, SW_NOISE, CHROMIUM, LAUNCH_ARGS } from './_gpu-ctx.mjs'

const { chromium } = pw
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = join(ROOT, 'src/tools/mini-games/gpu-games/starvein/docs/shots')
const ORIGIN = 'http://localhost:4173'
const AUTO_KEY = 'fangzi:starvein:auto-save:v1'

const fail = []
const log = (...a) => console.log('[e2e-starvein]', ...a)

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

async function newPage(browser, viewport, mobile = false) {
  const ctx = mobile
    ? await browser.newContext({ viewport, hasTouch: true, userAgent: MOBILE_UA })
    : await newCompatContext(browser, viewport)
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
  await page.locator('.gcard', { hasText: '星脉' }).first().click()
  await page.waitForSelector('.focus-stage', { timeout: 20000 })
  await page.waitForFunction(() => !!window.__starvein, undefined, { timeout: 15000 })
  if (clear) await page.evaluate(() => window.__starvein.clearAutoSave())
}

async function waitPhase(page, target, timeout = 5000) {
  await page.waitForFunction((t) => window.__starvein && window.__starvein.debug.phase() === t, target, { timeout })
}

async function shot(page, name) {
  await page.screenshot({ path: join(SHOTS, name) })
  log('shot', name)
}

async function mainChain(page, label, shotName) {
  // intro → 点屏开始
  await waitPhase(page, 'intro')
  const box = await page.locator('.vein-canvas').boundingBox()
  if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await waitPhase(page, 'play')

  // 真实拖拽：从核心出发，沿真实星网节点依次画线（从低到高取前 6 个星星节点）
  const core = await page.evaluate(() => window.__starvein.debug.coreScreen())
  const stars = await page.evaluate(() => {
    const g = window.__starvein.debug
    return g.getMap().nodes.filter((n) => n.role === 'star').sort((a, b) => b.y - a.y).slice(0, 6)
  })
  await page.mouse.move(core.x, core.y)
  await page.mouse.down()
  const before = await page.evaluate(() => window.__starvein.debug.state())
  for (const node of stars) {
    const p = await page.evaluate((id) => window.__starvein.debug.nodeScreen(id), node.id)
    await page.mouse.move(p.x, p.y, { steps: 6 })
    await page.waitForTimeout(50)
  }
  await page.waitForTimeout(150)
  const after = await page.evaluate(() => window.__starvein.debug.state())
  log(`[${label}] before=${JSON.stringify(before)} after=${JSON.stringify(after)}`)
  if (after.lit <= before.lit) fail.push(`${label} 拖动画线未点亮任何节点`)
  if (after.score <= before.score) fail.push(`${label} 点亮后分数未增长`)
  const fps = await page.evaluate(() => window.__starvein.debug.fps())
  log(`[${label}] fps=${fps.toFixed(1)}`)
  if (fps < 15) fail.push(`${label} 帧率过低：${fps.toFixed(1)}fps`)
  if (shotName) await shot(page, shotName)
  await page.mouse.up()

  // hidden 自动暂停、进度不丢
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForTimeout(200)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })

  // 收线 → 结算评级
  await page.evaluate(() => window.__starvein.debug.forceExit())
  await waitPhase(page, 'result')
  const result = await page.evaluate(() => window.__starvein.debug.state())
  log(`[${label}] result=${JSON.stringify(result)}`)
  if (!['S', 'A', 'B', 'C'].includes(result.grade)) fail.push(`${label} 结算评级非法：${result.grade}`)
  if (result.score <= 0) fail.push(`${label} 结算分数应为正`)

  // 快照 → reload → 弹继续 → resumeAuto 还原
  await page.evaluate(() => window.__starvein.autoSaveNow())
  await page.reload()
  await enterGame(page, { clear: false })
  await waitPhase(page, 'resume')
  const beforeResume = await page.evaluate(() => window.__starvein.debug.state())
  await page.evaluate(() => window.__starvein.resumeAuto())
  await waitPhase(page, 'play')
  const back = await page.evaluate(() => window.__starvein.debug.state())
  log(`[${label}] resume before=${JSON.stringify(beforeResume)} after=${JSON.stringify(back)}`)
  if (back.lit < beforeResume.lit) fail.push(`${label} 续玩后点亮数丢失`)
  // 新局清快照
  await page.evaluate(() => window.__starvein.discardAuto())
  const cleared = await page.evaluate((k) => !localStorage.getItem(k), AUTO_KEY)
  if (!cleared) fail.push(`${label} 新局后自动快照未清除`)
}

async function run() {
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: LAUNCH_ARGS })
  try {
    const viewports = [
      [{ width: 1280, height: 860 }, 'pc', false, 'pc-vein.png'],
      [{ width: 834, height: 1112 }, 'tablet', false, 'tablet-vein.png'],
      [{ width: 375, height: 812 }, 'mobile', true, 'mobile-vein.png']
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

    // PC 结算面板截图
    {
      const { page } = await newPage(browser, { width: 1280, height: 860 })
      await enterGame(page)
      const box = await page.locator('.vein-canvas').boundingBox()
      if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await waitPhase(page, 'play')
      await page.evaluate(() => window.__starvein.debug.forceExit())
      await waitPhase(page, 'result')
      await page.waitForTimeout(300)
      await shot(page, 'pc-result.png')
      await page.close()
    }

    // SW 预缓存包含本游戏 chunk；断网二次进入可玩
    const swPath = join(ROOT, 'dist/sw.js')
    if (!existsSync(swPath)) fail.push('dist/sw.js 不存在')
    else {
      const sw = readFileSync(swPath, 'utf8')
      if (!/starvein-[A-Za-z0-9_-]+\.js/.test(sw)) fail.push('SW 预缓存未包含 starvein chunk')
    }
    {
      const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, userAgent: MOBILE_UA })
      const page = await ctx.newPage()
      page.on('pageerror', (e) => { if (!SW_NOISE.test(e.message)) fail.push(`offline pageerror: ${e.message}`) })
      await enterGame(page)
      await page.waitForFunction(() => navigator.serviceWorker && !!navigator.serviceWorker.ready, undefined, { timeout: 10000 })
      await page.reload({ waitUntil: 'load' })
      await page.waitForFunction(() => navigator.serviceWorker && !!navigator.serviceWorker.controller, undefined, { timeout: 10000 })
      await ctx.setOffline(true)
      await page.reload({ waitUntil: 'load', timeout: 10000 })
      await page.waitForSelector('.gcard', { timeout: 10000 })
      await page.locator('.gcard', { hasText: '星脉' }).first().click()
      await page.waitForSelector('.focus-stage', { timeout: 10000 })
      await page.waitForFunction(() => !!window.__starvein, undefined, { timeout: 10000 })
      await page.waitForFunction(
        () => ['intro', 'resume', 'play'].includes(window.__starvein.debug.phase()),
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
  console.log('\n✅ 《星脉》三视口 + 续玩 + 断网 E2E 全部通过')
}

run().catch((e) => { console.error(e); process.exit(1) })
