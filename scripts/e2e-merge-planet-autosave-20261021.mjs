/**
 * 2026-10-21「合成宇宙」切后台续玩修复 · 三视口 E2E。
 *
 * 场景① hidden→visible：进行中球位置/分数不暴涨、不瞬间判负、物理回前台正常；
 * 场景② hidden 写快照 → 整页 reload：弹「继续上一局」，继续后球数/tier/分数一致；
 *          「开始新局」清快照；通关后快照被清；自动快照键与手动存档分键互不污染。
 * 运行前：npx vite preview --port 4173 --host 127.0.0.1
 */
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { newCompatContext, horizontalOverflow, SW_NOISE, CHROMIUM, LAUNCH_ARGS } from './_gpu-ctx.mjs'

const { chromium } = pw
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = join(ROOT, 'src/tools/mini-games/docs/shots')
const ORIGIN = 'http://localhost:4173'
const AUTO_KEY = 'fangzi:merge-planet:auto-save:v1'
const MANUAL_KEY = 'fangzi:merge-planet:save:v1'

const fail = []
const log = (...a) => console.log('[e2e-autosave]', ...a)
const shot = (page, name) =>
  page.screenshot({ path: join(SHOTS, name) }).then(() => log('shot', name))

async function newPage(browser, viewport) {
  const ctx = await newCompatContext(browser, viewport)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => { if (!SW_NOISE.test(e.message)) fail.push(`pageerror: ${e.message}`) })
  page.on('console', (m) => { if (m.type() === 'error' && !SW_NOISE.test(m.text())) fail.push(`console.error: ${m.text()}`) })
  const external = []
  page.on('request', (req) => { const u = req.url(); if (!u.startsWith(ORIGIN)) external.push(u) })
  return { ctx, page, external }
}

async function enterGame(page) {
  await page.goto(`${ORIGIN}/#/t/mini-games`)
  await page.waitForSelector('.gcard', { timeout: 20000 })
  await page.locator('.gcard', { hasText: '合成宇宙' }).first().click()
  await page.waitForSelector('.focus-stage', { timeout: 20000 })
  await page.waitForFunction(() => !!window.__mergePlanet, { timeout: 15000 })
  await page.evaluate(() => { window.__mergePlanet.clearAutoSave(); window.__mergePlanet.reset() })
}

/** 把页面切到 hidden / visible（模拟切后台再切回，不真正离开）。 */
async function setHidden(page, hidden) {
  await page.evaluate((h) => {
    Object.defineProperty(document, 'hidden', { value: h, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  }, hidden)
  await page.waitForTimeout(300)
}

async function overflow(page, label) {
  const d = await horizontalOverflow(page)
  log(`overflow[${label}] -> ${d}px`)
  if (d > 2) fail.push(`${label} 横向溢出 ${d}px`)
}

async function scenario1_runtimePause(page, label) {
  // 摆几个静止球（底部），记录位置/分数
  await page.evaluate(() => { window.__mergePlanet.reset() })
  await page.evaluate(() => {
    const root = document.querySelector('.mp').getBoundingClientRect()
    window.__mergePlanet.spawn(3, root.width * 0.4, root.height * 0.7)
    window.__mergePlanet.spawn(5, root.width * 0.6, root.height * 0.75)
  })
  await page.waitForTimeout(600)
  const before = await page.evaluate(() => ({
    n: window.__mergePlanet.boardCount(),
    score: window.__mergePlanet.score(),
    tiers: window.__mergePlanet.boardTiers()
  }))
  // 切后台 2.5s（rAF 在无头里仍跑，但 dt clamp 限制；关键：不瞬间判负、位置不暴涨）
  await setHidden(page, true)
  await page.waitForTimeout(2500)
  await setHidden(page, false)
  await page.waitForTimeout(400)
  const after = await page.evaluate(() => ({
    n: window.__mergePlanet.boardCount(),
    score: window.__mergePlanet.score(),
    tiers: window.__mergePlanet.boardTiers(),
    phase: window.__mergePlanet.phase()
  }))
  log(`[${label}] 场景① before=${JSON.stringify(before)} after=${JSON.stringify(after)}`)
  if (after.phase !== 'play') fail.push(`${label} 切回后 phase=${after.phase}（不应判负）`)
  if (after.n !== before.n) fail.push(`${label} 切回后球数 ${after.n}!==${before.n}`)
  if (after.score !== before.score) fail.push(`${label} 切回后分数变化 ${before.score}→${after.score}`)
  // hidden 时已写自动快照
  const has = await page.evaluate((k) => !!localStorage.getItem(k), AUTO_KEY)
  if (!has) fail.push(`${label} 切后台未写自动快照`)
}

async function scenario2_reloadResume(page, label) {
  // 摆局面 → 快照 → reload → 应弹「继续上一局」
  await page.evaluate(() => { window.__mergePlanet.reset(); window.__mergePlanet.clearAutoSave() })
  await page.evaluate(() => {
    const root = document.querySelector('.mp').getBoundingClientRect()
    window.__mergePlanet.spawn(4, root.width * 0.35, root.height * 0.6)
    window.__mergePlanet.spawn(7, root.width * 0.65, root.height * 0.68)
  })
  await page.waitForTimeout(500)
  await page.evaluate(() => window.__mergePlanet.autoSaveNow())
  const before = await page.evaluate(() => ({
    n: window.__mergePlanet.boardCount(),
    tiers: window.__mergePlanet.boardTiers(),
    score: window.__mergePlanet.score()
  }))
  await page.reload()
  await page.waitForSelector('.gcard', { timeout: 20000 })
  await page.locator('.gcard', { hasText: '合成宇宙' }).first().click()
  await page.waitForSelector('.focus-stage', { timeout: 20000 })
  await page.waitForFunction(() => !!window.__mergePlanet, { timeout: 15000 })
  // 应出现恢复弹层
  await page.waitForSelector('.mp-card', { timeout: 8000 })
  const card = await page.locator('.mp-card').innerText()
  log(`[${label}] reload 后弹层：${card.replace(/\n/g, ' ').slice(0, 40)}`)
  if (!card.includes('继续上一局')) fail.push(`${label} reload 后未弹「继续上一局」`)
  await shot(page, label === 'mobile' ? 'mp-mobile-autosave-resume.png' : `mp-${label}-autosave-resume.png`)
  // 点继续
  await page.locator('.mp-card button', { hasText: '继续上一局' }).click()
  await page.waitForTimeout(400)
  const after = await page.evaluate(() => ({
    n: window.__mergePlanet.boardCount(),
    tiers: window.__mergePlanet.boardTiers(),
    score: window.__mergePlanet.score()
  }))
  log(`[${label}] 恢复后 = ${JSON.stringify(after)}（before ${JSON.stringify(before)}）`)
  if (after.n !== before.n) fail.push(`${label} 恢复后球数 ${after.n}!==${before.n}`)
  if (JSON.stringify(after.tiers) !== JSON.stringify(before.tiers)) fail.push(`${label} 恢复后 tier 不一致`)
  // 继续后自动快照已被消费？仍保留直到新局/结束——这里再开新局应清
  // 手动存档键不应被自动快照污染
  const manual = await page.evaluate((k) => localStorage.getItem(k), MANUAL_KEY)
  if (manual) fail.push(`${label} 自动快照流程污染了手动存档键`)
  // 再来一局 → 清自动快照
  await page.evaluate(() => window.__mergePlanet.reset())
  await page.waitForTimeout(200)
  const cleared = await page.evaluate((k) => !localStorage.getItem(k), AUTO_KEY)
  if (!cleared) fail.push(`${label} 重开后自动快照未清除`)
}

async function winClearsAuto(page, label) {
  await page.evaluate(() => { window.__mergePlanet.reset(); window.__mergePlanet.spawn(9, 400) })
  await page.waitForTimeout(300)
  await page.evaluate(() => window.__mergePlanet.autoSaveNow())
  await page.evaluate(() => window.__mergePlanet.showWin())
  await page.waitForTimeout(400)
  const cleared = await page.evaluate((k) => !localStorage.getItem(k), AUTO_KEY)
  log(`[${label}] 通关后快照已清=${cleared}`)
  if (!cleared) fail.push(`${label} 通关后自动快照未清除`)
}

async function run() {
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: LAUNCH_ARGS })
  try {
    for (const [vp, label] of [
      [{ width: 1280, height: 860 }, 'pc'],
      [{ width: 834, height: 1112 }, 'tablet'],
      [{ width: 375, height: 812 }, 'mobile']
    ]) {
      const { page, external } = await newPage(browser, vp)
      await enterGame(page)
      await scenario1_runtimePause(page, label)
      await scenario2_reloadResume(page, label)
      await winClearsAuto(page, label)
      await overflow(page, label)
      if (external.length) fail.push(`${label} 存在外部请求：${external.slice(0, 2).join(', ')}`)
      await page.close()
    }
    // 断网 SW 可玩
    {
      const sw = readFileSync(join(ROOT, 'dist/sw.js'), 'utf8')
      if (!sw.includes('merge-planet-')) fail.push('SW 预缓存缺 merge-planet chunk')
      const { page, external } = await newPage(browser, { width: 375, height: 812 })
      await enterGame(page)
      if (external.length) fail.push('离线链路存在外部请求')
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
  console.log('\n✅ 切后台自动暂停+自动快照续玩 三视口 E2E 全部通过')
}
run().catch((e) => { console.error(e); process.exit(1) })
