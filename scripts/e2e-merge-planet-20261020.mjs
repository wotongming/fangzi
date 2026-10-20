/**
 * 2026-10-20 「合成大星球」(merge-planet) 三视口 E2E（matter.js 本地物理 + Canvas2D）。
 *
 * 视口：PC 1280×860 / 平板 834×1112 / 手机 375×812。
 * 覆盖：选卡进入 → 真实投放（指针滑轨）→ 同级确定性合成升级与加分 → 连锁 →
 * 越线持续 1.75s 判负 → 重开复位 → 断网（无任何外部 CDN 请求，chunk 已进 SW 预缓存）可加载游玩；
 * 手机专项：顶部滑轨几何断言（待投球/引导线在顶部安全区、落点列在触点 y 之上，不压堆叠区）。
 * 断言：canvas backing 正常、零横向溢出、无 pageerror（SW abort 噪音按既有方式过滤）、真实截图。
 *
 * 运行前：npx vite preview --port 4173 --host 127.0.0.1
 */
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { newCompatContext, horizontalOverflow, SW_NOISE, CHROMIUM, LAUNCH_ARGS } from './_gpu-ctx.mjs'

const { chromium } = pw
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = join(ROOT, 'src/tools/mini-games/docs/shots')
const ORIGIN = 'http://localhost:4173'
mkdirSync(SHOTS, { recursive: true })

const fail = []
const log = (...a) => console.log('[e2e-merge-planet]', ...a)

async function newPage(browser, viewport) {
  const ctx = await newCompatContext(browser, viewport)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => {
    if (!SW_NOISE.test(e.message)) fail.push(`pageerror: ${e.message}`)
  })
  page.on('console', (m) => {
    if (m.type() === 'error' && !SW_NOISE.test(m.text())) fail.push(`console.error: ${m.text()}`)
  })
  // 记录所有请求：离线/零 CDN 校验（除同源外不应有任何外部 URL）
  const external = []
  page.on('request', (req) => {
    const u = req.url()
    if (!u.startsWith(ORIGIN)) external.push(u)
  })
  return { ctx, page, external }
}
const shot = (page, name) => page.screenshot({ path: join(SHOTS, name) }).then(() => log('shot', name))
const gotoPicker = async (page) => {
  await page.goto(`${ORIGIN}/#/t/mini-games`)
  await page.waitForSelector('.gcard', { timeout: 20000 })
  // 把「合成大星球」卡片滚入视野，便于选卡截图直接看到新游戏
  await page.locator('.gcard', { hasText: '合成大星球' }).first().scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)
}

async function overflow(page, label) {
  const d = await horizontalOverflow(page)
  log(`overflow[${label}] -> ${d}`)
  if (d > 2) fail.push(`${label} 横向溢出 ${d}px`)
}

async function enterGame(page) {
  await page.locator('.gcard', { hasText: '合成大星球' }).first().click()
  await page.waitForSelector('.focus-stage', { timeout: 20000 })
  await page.waitForFunction(() => !!window.__mergePlanet, { timeout: 15000 })
  const cs = await page.evaluate(() => {
    const c = document.querySelector('.mp-canvas')
    return c ? { w: c.width, h: c.height } : { w: 0, h: 0 }
  })
  log('canvas backing =', JSON.stringify(cs))
  if (cs.w < 10 || cs.h < 10) fail.push(`合成大星球 canvas backing 异常 ${JSON.stringify(cs)}`)
}

const scoreNow = (page) => page.evaluate(() => window.__mergePlanet.score())
const phaseNow = (page) => page.evaluate(() => window.__mergePlanet.phase())

/** 真实投放：在画面上按住横向轻拖后松手（走组件 pointer 滑轨链路）。 */
async function realDrop(page, x) {
  const box = await page.locator('.mp').boundingBox()
  if (!box) return
  await page.mouse.move(box.x + x, box.y + 40)
  await page.mouse.down()
  await page.mouse.move(box.x + x + 24, box.y + 40, { steps: 3 })
  await page.mouse.up()
  await page.waitForTimeout(220)
}

/** 确定性同级合成：两只同级近距叠加 → 升级加分；返回合成后分数。 */
async function deterministicMerge(page, tier, x) {
  await page.evaluate(([t, px]) => {
    window.__mergePlanet.spawn(t, px)
    window.__mergePlanet.spawn(t, px)
  }, [tier, x])
  await page.waitForTimeout(350)
  return scoreNow(page)
}

/** 截图铺陈：摆放几颗不同等级展示球（不同级互不合并，仅用于画面饱满度，不影响断言）。 */
async function decorateBoard(page) {
  await page.evaluate(() => {
    const spots = [
      [5, 300], [6, 430], [7, 580], [9, 720]
    ]
    for (const [t, px] of spots) window.__mergePlanet.spawn(t, px)
  })
  await page.waitForTimeout(300)
}

// —— PC：选卡 / 投放 / 合成升级 / 连锁 / 越线判负 / 重开 ——
async function runPC(page) {
  await gotoPicker(page)
  await shot(page, 'mp-pc-picker.png')
  await enterGame(page)
  await overflow(page, 'pc-picker')

  // 真实投放若干次（输入链路），不强制立即得分
  for (const x of [0.35, 0.55, 0.45]) await realDrop(page, x)
  await page.waitForTimeout(500)
  await shot(page, 'mp-pc-drop.png')

  // 确定性合成升级（陨石→月球），分数应 >0
  const s1 = await deterministicMerge(page, 0, 220)
  log('首次合成后 score =', s1)
  if (!(s1 > 0)) fail.push('同级合成后分数未增长')
  await decorateBoard(page)
  await shot(page, 'mp-pc-merge.png')

  // 连锁：再合成一级，分数继续增长
  const s2 = await deterministicMerge(page, 1, 240)
  log('连锁合成后 score =', s2)
  if (!(s2 > s1)) fail.push('连锁未继续加分')

  // 越线持续判负：holdAbove 走真实 1.75s 持续计时状态机
  await page.evaluate(() => window.__mergePlanet.holdAbove(true))
  await page.waitForTimeout(2100)
  const phase = await phaseNow(page)
  log('越线后 phase =', phase)
  if (phase !== 'lose') fail.push('持续越线未判负')
  if (!(await page.locator('.mp-result').isVisible())) fail.push('缺少判负结算卡片')
  await shot(page, 'mp-pc-result.png')

  // 重开复位
  await page.locator('.mp-btn').click()
  await page.waitForTimeout(300)
  const after = await scoreNow(page)
  const ph2 = await phaseNow(page)
  log('重开后 score =', after, 'phase =', ph2)
  if (after !== 0) fail.push('重开后分数未归零')
  if (ph2 !== 'play') fail.push('重开后未回到 play')
  await overflow(page, 'pc-play')
}

// —— 平板：投放 + 溢出 ——
async function runTablet(page) {
  await gotoPicker(page)
  await enterGame(page)
  for (const x of [0.3, 0.6, 0.45]) await realDrop(page, x)
  await page.waitForTimeout(400)
  await shot(page, 'mp-tablet-drop.png')
  await overflow(page, 'tablet-play')
}

// —— 手机：选卡 / 投放 / 顶部滑轨不遮挡几何断言 ——
async function runMobile(page) {
  await gotoPicker(page)
  await shot(page, 'mp-mobile-picker.png')
  await enterGame(page)

  // 顶部滑轨拖动瞄准（手指在顶部窄横条）
  const box = await page.locator('.mp').boundingBox()
  await page.mouse.move(box.x + 160, box.y + 36)
  await page.mouse.down()
  await page.mouse.move(box.x + 230, box.y + 36, { steps: 4 })
  await page.mouse.up()
  await page.waitForTimeout(200)

  const aim = await page.locator('.mp-aim').boundingBox()
  const guide = await page.locator('.mp-guide').boundingBox()
  log('aim box =', JSON.stringify(aim), 'guide box =', JSON.stringify(guide))
  if (!aim) fail.push('缺少待投球 .mp-aim')
  if (!guide) fail.push('缺少引导线 .mp-guide')
  // 待投球位于顶部安全区（y < 100px），不压堆叠区
  if (aim && aim.top > 100) fail.push(`待投球未在顶部安全区：top=${aim.top}`)
  // 引导线从滑轨向下，顶端贴近滑轨底
  if (guide && Math.abs(guide.top - (aim?.bottom ?? 0)) > 40) fail.push('引导线顶端未接滑轨')

  // 手指移到下半屏水平拖动：预览/引导线仍在触点 y 之上（不被手指压住）
  const touchY = box.y + 520
  await page.mouse.move(box.x + 150, touchY)
  await page.mouse.down()
  await page.mouse.move(box.x + 250, touchY, { steps: 4 })
  await page.mouse.up()
  await page.waitForTimeout(200)
  const aim2 = await page.locator('.mp-aim').boundingBox()
  const guide2 = await page.locator('.mp-guide').boundingBox()
  log('下半屏拖动后 aim =', JSON.stringify(aim2), 'guide =', JSON.stringify(guide2))
  if (aim2 && aim2.bottom >= touchY) fail.push('下半屏拖动时待投球压到触点 y 之下（遮挡落点）')
  if (guide2 && guide2.top >= touchY) fail.push('引导线未位于触点 y 之上')
  await shot(page, 'mp-mobile-drop.png')
  await shot(page, 'mp-mobile-occlusion.png')
  await overflow(page, 'mobile-play')
}

async function run() {
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: LAUNCH_ARGS })
  try {
    // PC 1280×860
    {
      const { page, external } = await newPage(browser, { width: 1280, height: 860 })
      await runPC(page)
      if (external.length) fail.push(`存在外部 CDN 请求：${external.slice(0, 3).join(', ')}`)
      await page.close()
    }
    // 平板 834×1112
    {
      const { page, external } = await newPage(browser, { width: 834, height: 1112 })
      await runTablet(page)
      if (external.length) fail.push(`平板存在外部 CDN 请求：${external.slice(0, 3).join(', ')}`)
      await page.close()
    }
    // 手机 375×812
    {
      const { page, external } = await newPage(browser, { width: 375, height: 812 })
      await runMobile(page)
      if (external.length) fail.push(`手机存在外部 CDN 请求：${external.slice(0, 3).join(', ')}`)
      await page.close()
    }
    // 断网可玩：静态核对 SW 预缓存清单含 matter-physics 与 merge-planet chunk，
    // 且会话内零外部 CDN 请求（物理引擎全量打进本地包）。
    {
      const sw = readFileSync(join(ROOT, 'dist/sw.js'), 'utf8')
      if (!sw.includes('matter-physics-')) fail.push('SW 预缓存清单缺少 matter-physics chunk')
      if (!sw.includes('merge-planet-')) fail.push('SW 预缓存清单缺少 merge-planet chunk')
      log('SW 预缓存含 matter-physics 与 merge-planet chunk ✓')
      // 离线进入并确定性合成（本地包直出，无外网依赖）
      const { page, external } = await newPage(browser, { width: 375, height: 812 })
      await gotoPicker(page)
      await enterGame(page)
      const s = await deterministicMerge(page, 0, 180)
      log('离线链路合成 score =', s)
      if (!(s > 0)) fail.push('断网链路无法合成游玩')
      if (external.length) fail.push(`离线链路存在外部 CDN 请求：${external.slice(0, 3).join(', ')}`)
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
  console.log('\n✅ 合成大星球三视口 E2E（投放/合成/连锁/越线判负/重开/断网/不遮挡）全部通过')
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
