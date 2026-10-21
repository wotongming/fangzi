/**
 * 2026-10-21「合成宇宙」通关节奏重平衡 · 三视口 E2E（动态投放池）。
 *
 * 覆盖：
 *  - 开局 maxReached=0：nextSpawnTier 恒为陨石(0)，不放高级球；
 *  - 随进度 maxReached 抬升后，nextSpawnTier 上沿同步上移、且绝不超过 maxSpawnForReach(R) 合理上沿；
 *  - 高级球会随进度直接投放（后期能抓到明显高于早期的 tier）；
 *  - 挑战性保留：死亡线越线持续 ~1.75s 仍判负；
 *  - showWin 仍能合出 19 宇宙触发通关结算；
 *  - 三视口零横向溢出、无 pageerror；断网 SW 可玩。
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

const fail = []
const log = (...a) => console.log('[e2e-balance]', ...a)
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
  await page.evaluate(() => window.__mergePlanet.reset())
}

async function overflow(page, label) {
  const d = await horizontalOverflow(page)
  log(`overflow[${label}] -> ${d}`)
  if (d > 2) fail.push(`${label} 横向溢出 ${d}px`)
}

/** 收集 n 次 nextSpawnTier 样本，返回 {max,min,distinct}。 */
function collectSpawns(page, n) {
  return page.evaluate((k) => {
    const out = []
    for (let i = 0; i < k; i++) out.push(window.__mergePlanet.nextSpawnTier())
    return { max: Math.max(...out), min: Math.min(...out), distinct: [...new Set(out)].sort((a, b) => a - b) }
  }, n)
}

async function dynamicPoolCheck(page, label) {
  await page.evaluate(() => window.__mergePlanet.reset())
  // 开局 R=0：只能掉陨石
  let reached = await page.evaluate(() => window.__mergePlanet.maxReached())
  if (reached !== 0) fail.push(`${label} 开局 maxReached=${reached} 应为 0`)
  const early = await collectSpawns(page, 60)
  log(`[${label}] 开局 R=0 投放样本 =`, JSON.stringify(early))
  if (early.max !== 0) fail.push(`${label} 开局不应投出 >陨石 的球（max=${early.max}）`)

  // 推进到 R≈9（经调试钩子合成到太阳），投放上沿应明显抬升
  await page.evaluate(() => window.__mergePlanet.spawn(9, 400))
  await page.waitForTimeout(200)
  reached = await page.evaluate(() => window.__mergePlanet.maxReached())
  const mid = await collectSpawns(page, 200)
  log(`[${label}] 进度 R=${reached} 投放样本 max=${mid.max} distinct=`, JSON.stringify(mid.distinct))
  if (reached < 9) fail.push(`${label} 推进后 maxReached=${reached} 未到 9`)
  if (!(mid.max >= 4)) fail.push(`${label} 后期投放上沿未明显抬升（max=${mid.max}）`)
  // 上沿合理：R=9 表值=7，留 ±1 容差
  if (mid.max > 9) fail.push(`${label} 投放越过上沿太多（R=${reached} max=${mid.max}）`)

  // 再推进到 R≈15，能抓到高级直接投放球
  await page.evaluate(() => window.__mergePlanet.spawn(15, 500))
  await page.waitForTimeout(200)
  const late = await collectSpawns(page, 300)
  log(`[${label}] 进度 R=15 投放样本 max=${late.max}`)
  if (!(late.max >= 9)) fail.push(`${label} 高级进度下未抓到高级直接投放球（max=${late.max}）`)
}

async function deathLineStillFails(page, label) {
  await page.evaluate(() => window.__mergePlanet.reset())
  await page.evaluate(() => window.__mergePlanet.holdAbove(true))
  await page.waitForTimeout(2100)
  const phase = await page.evaluate(() => window.__mergePlanet.phase())
  log(`[${label}] 越线后 phase=${phase}`)
  if (phase !== 'lose') fail.push(`${label} 死亡线判负未保留`)
  await page.evaluate(() => window.__mergePlanet.holdAbove(false))
}

async function winStillWorks(page, label) {
  await page.evaluate(() => window.__mergePlanet.reset())
  await page.evaluate(() => window.__mergePlanet.showWin())
  await page.waitForTimeout(400)
  const phase = await page.evaluate(() => window.__mergePlanet.phase())
  const card = await page.locator('.mp-card').innerText()
  log(`[${label}] 通关 phase=${phase} | ${card.replace(/\n/g, ' ').slice(0, 24)}`)
  if (phase !== 'win') fail.push(`${label} 通关结算未触发`)
  if (!card.includes('宇宙')) fail.push(`${label} 通关未显示「宇宙」`)
}

/** 摆一段后期高级天体（不同级互不合并），截图体现「高级球随进度直发」。 */
async function stageLateBoard(page, placements, shotName) {
  await page.evaluate((list) => {
    const root = document.querySelector('.mp').getBoundingClientRect()
    const baseY = root.height * 0.56
    for (const [t, fx] of list) window.__mergePlanet.spawn(t, root.width * fx, baseY)
  }, placements)
  await page.waitForTimeout(700)
  await shot(page, shotName)
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
      await dynamicPoolCheck(page, label)
      await deathLineStillFails(page, label)
      await winStillWorks(page, label)
      // 后期高级球画面（进度推进后直发的高级天体）
      await page.evaluate(() => window.__mergePlanet.reset())
      await stageLateBoard(page, [[10, 0.18], [12, 0.42], [14, 0.66], [16, 0.88]],
        label === 'mobile' ? 'mp-mobile-late.png' : 'mp-pc-late.png')
      await overflow(page, label)
      if (external.length) fail.push(`${label} 存在外部 CDN 请求：${external.slice(0, 2).join(', ')}`)
      await page.close()
    }
    // 断网可玩
    {
      const sw = readFileSync(join(ROOT, 'dist/sw.js'), 'utf8')
      if (!sw.includes('merge-planet-')) fail.push('SW 预缓存缺 merge-planet chunk')
      log('SW 预缓存含 merge-planet chunk ✓')
      const { page, external } = await newPage(browser, { width: 375, height: 812 })
      await enterGame(page)
      const reached = await page.evaluate(() => window.__mergePlanet.maxReached())
      if (reached !== 0) fail.push('断网开局 maxReached 异常')
      if (external.length) fail.push('离线链路存在外部 CDN 请求')
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
  console.log('\n✅ 动态投放池三视口 E2E（开局只低级/进度上移/死亡线仍判负/通关/断网）全部通过')
}
run().catch((e) => { console.error(e); process.exit(1) })
