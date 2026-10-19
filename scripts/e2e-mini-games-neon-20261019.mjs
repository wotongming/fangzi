/**
 * 2026-10-19 mini-games 炫光系列（007 M1）三视口 E2E（H 档 checkpoint）。
 *
 * 强制 WebGL2（newCompatContext：navigator.gpu=undefined + abort SW），覆盖：
 *  - 选游戏页：经典区 + 炫光区；炫光连消免费卡、两款“即将上线”占位不可进
 *  - 进入炫光连消：FocusStage 纯净全屏（选游戏页元素消失）、后端落 webgl2、canvas 有 backing 尺寸
 *  - 真实滑动交换产生消除：HUD 分数增长、粒子爆发截图、轻触/暂停/继续/重开/退出
 *  - 付费门：免费态点专业版 DOM 游戏拦截到付费墙；注入已购订单后可进入
 *  - PC/平板/手机零横向溢出 + 无 pageerror（SW 主动 abort 噪音过滤）+ 真实截图
 *
 * 运行前：npx vite preview --port 4173 --host 127.0.0.1
 */
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { newCompatContext, horizontalOverflow, SW_NOISE, CHROMIUM, LAUNCH_ARGS } from './_gpu-ctx.mjs'

const { chromium } = pw

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = join(ROOT, 'src/tools/mini-games/docs/shots')
const ORIGIN = 'http://localhost:4173'
mkdirSync(SHOTS, { recursive: true })

const fail = []
const log = (...a) => console.log('[e2e-neon]', ...a)

function seedPro() {
  localStorage.setItem(
    'fangzi:billing:v1',
    JSON.stringify({
      orders: [
        {
          id: 'ord_e2e_neon_pro',
          toolId: 'mini-games',
          kind: 'freemium-pro',
          amountCents: 1990,
          currency: 'CNY',
          status: 'paid',
          createdAt: new Date().toISOString(),
          paidAt: new Date().toISOString()
        }
      ],
      usage: {}
    })
  )
}

async function newPage(browser, viewport, withPro) {
  const ctx = await newCompatContext(browser, viewport)
  if (withPro) await ctx.addInitScript(seedPro)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => {
    if (!SW_NOISE.test(e.message)) fail.push(`pageerror: ${e.message}`)
  })
  page.on('console', (m) => {
    if (m.type() === 'error' && !SW_NOISE.test(m.text())) fail.push(`console.error: ${m.text()}`)
  })
  return { ctx, page }
}

async function shot(page, name) {
  await page.screenshot({ path: join(SHOTS, name) })
  log('shot', name)
}

async function gotoPicker(page) {
  await page.goto(`${ORIGIN}/#/t/mini-games`)
  await page.waitForSelector('.zone', { timeout: 15000 })
}

async function waitBackend(page) {
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.glow')
      return el && el.getAttribute('data-backend') !== 'init'
    },
    { timeout: 20000 }
  )
  return page.getAttribute('.glow', 'data-backend')
}

async function enterGlow(page) {
  await page.locator('.neon-card.free', { hasText: '炫光连消' }).click()
  await page.waitForSelector('.focus-stage', { timeout: 15000 })
  const backend = await waitBackend(page)
  return backend
}

async function canvasSize(page) {
  return page.evaluate(() => {
    const c = document.querySelector('.glow canvas')
    return c ? { w: c.width, h: c.height } : { w: 0, h: 0 }
  })
}

async function scoreNow(page) {
  const t = await page.locator('.hud-score').innerText()
  return parseInt(t.replace(/[^0-9]/g, '') || '0', 10)
}

/**
 * 在棋盘上尝试随机相邻交换，直到 HUD 分数增长（真实走通交换→消除→连锁→计分链路）。
 * 返回是否在预算内打出分数。
 */
async function playUntilScore(page, { shots = 0 } = {}) {
  const box = await page.locator('.board').boundingBox()
  if (!box) return false
  const cell = (r, c) => ({
    x: box.x + ((c + 0.5) / 8) * box.width,
    y: box.y + ((r + 0.5) / 8) * box.height
  })
  for (let i = 0; i < 60; i++) {
    const r = Math.floor(Math.random() * 8)
    const c = Math.floor(Math.random() * 8)
    const horiz = Math.random() > 0.5
    const r2 = horiz ? r : r < 7 ? r + 1 : r - 1
    const c2 = horiz ? (c < 7 ? c + 1 : c - 1) : c
    const a = cell(r, c)
    const b = cell(r2, c2)
    await page.mouse.move(a.x, a.y)
    await page.mouse.down()
    await page.mouse.move(b.x, b.y, { steps: 4 })
    await page.mouse.up()
    await page.waitForTimeout(200) // 130ms 交换动画 + 结算
    if (shots > 0 && i % 3 === 0) {
      // 过程中也截一张，尽量捕捉到粒子爆发瞬间
      if ((await scoreNow(page)) > 0) {
        await shot(page, `shot-burst-${shots}.png`)
        return true
      }
    }
    if ((await scoreNow(page)) > 0) return true
  }
  return (await scoreNow(page)) > 0
}

async function openSheet(page) {
  await page.locator('.hud-btn').click()
  await page.waitForSelector('.sheet', { timeout: 5000 })
}

async function checkOverflow(page, label) {
  const d = await horizontalOverflow(page)
  log(`overflow[${label}] -> ${d}`)
  if (d > 2) fail.push(`${label} 横向溢出 ${d}px`)
}

async function run() {
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: LAUNCH_ARGS })

  // —— PC 免费态：占位卡、进入炫光、滑动消除、HUD/暂停/重开/退出、付费门 ——
  {
    const { ctx, page } = await newPage(browser, { width: 1280, height: 800 }, false)
    await gotoPicker(page)

    // 两款“即将上线”占位不可进入，也不弹付费墙
    const soonCount = await page.locator('.neon-card.soon').count()
    if (soonCount !== 2) fail.push(`应有 2 张即将上线占位，实际 ${soonCount}`)
    await page.locator('.neon-card.soon').first().click()
    await page.waitForTimeout(300)
    if ((await page.locator('.focus-stage').count()) !== 0) fail.push('即将上线卡片不应进入游戏')
    if ((await page.locator('.paywall').count()) !== 0) fail.push('即将上线卡片不应弹付费墙')
    await shot(page, 'shot-01-pc-picker.png')

    // 免费态点专业版 DOM 游戏（三消）→ 付费墙
    await page.locator('.gcard', { hasText: '三消' }).first().click()
    await page.waitForSelector('.paywall', { timeout: 5000 })
    const pw = await page.locator('.paywall').innerText()
    if (!pw.includes('19.9')) fail.push(`付费墙应显示 ¥19.90，实际：${pw.slice(0, 120)}`)
    await shot(page, 'shot-02-pc-paywall.png')
    await page.locator('.paywall .link', { hasText: '先玩免费游戏' }).click()
    await page.waitForTimeout(200)

    // 进入炫光连消
    const backend = await enterGlow(page)
    log('backend =', backend)
    if (backend !== 'webgl2' && backend !== 'canvas2d') fail.push(`后端应降级到 webgl2/canvas2d，实际 ${backend}`)
    const cs = await canvasSize(page)
    log('canvas backing =', JSON.stringify(cs))
    if (cs.w < 10 || cs.h < 10) fail.push(`canvas backing 尺寸异常 ${JSON.stringify(cs)}`)
    // 纯净全屏：选游戏页元素不应出现
    if ((await page.locator('.zone').count()) !== 0) fail.push('专注态不应显示选游戏页')
    if ((await page.locator('.hud-score').count()) !== 1) fail.push('专注态应显示极简分数 HUD')
    await checkOverflow(page, 'pc-glow')

    // 真实滑动打出消除
    const scored = await playUntilScore(page, { shots: 3 })
    if (!scored) fail.push('多次随机相邻交换后仍未得分，交换/消除链路异常')
    log('HUD 分数 =', await scoreNow(page))

    // 暂停 / 继续
    await openSheet(page)
    await page.locator('.sheet-btn', { hasText: '暂停' }).click()
    await page.waitForTimeout(300)
    if (!(await page.locator('.sheet-btn', { hasText: '继续' }).isVisible())) fail.push('暂停后应出现“继续”')
    await shot(page, 'shot-04-pc-sheet-paused.png')
    await page.locator('.sheet-btn', { hasText: '继续' }).click()
    await page.waitForTimeout(200)
    if ((await page.locator('.sheet').count()) !== 0) log('继续后浮层已收起')

    // 重开：分数归零、棋盘重建
    await openSheet(page)
    await page.locator('.sheet-btn', { hasText: '重新开始' }).click()
    await waitBackend(page)
    await page.waitForTimeout(300)
    if ((await scoreNow(page)) !== 0) fail.push('重新开始后分数应归零')
    await shot(page, 'shot-05-pc-glow-fresh.png')

    // 退出：回到选游戏页
    await openSheet(page)
    await page.locator('.sheet-btn', { hasText: '退出游戏' }).click()
    await page.waitForSelector('.zone', { timeout: 5000 })
    await checkOverflow(page, 'pc-picker')
    await ctx.close()
  }

  // —— PC 专业版已购：可进入专业版 DOM 游戏（三消），DOM 舞台无 GPU HUD 分数 ——
  {
    const { ctx, page } = await newPage(browser, { width: 1280, height: 800 }, true)
    await gotoPicker(page)
    await page.locator('.gcard', { hasText: '三消' }).first().click()
    await page.waitForSelector('.focus-stage.is-dom', { timeout: 8000 })
    await page.waitForTimeout(400)
    if ((await page.locator('.paywall').count()) > 0) fail.push('已购专业版不应再弹付费墙')
    if ((await page.locator('.hud-score').count()) > 0) fail.push('DOM 游戏不应显示 GPU 分数 HUD（避免重复记分）')
    await shot(page, 'shot-06-pc-dom-pro.png')
    // 退出
    await page.locator('.hud-btn').click()
    await page.waitForSelector('.sheet')
    await page.locator('.sheet-btn', { hasText: '退出游戏' }).click()
    await page.waitForSelector('.zone', { timeout: 5000 })
    await ctx.close()
  }

  // —— 手机 / 平板：选游戏页 + 炫光全屏自适应 + 溢出 ——
  for (const [label, vp, pickerShot, stageShot] of [
    ['mobile', { width: 375, height: 812 }, 'shot-07-mobile-picker.png', 'shot-08-mobile-glow.png'],
    ['tablet', { width: 834, height: 1112 }, 'shot-09-tablet-picker.png', 'shot-10-tablet-glow.png']
  ]) {
    const { ctx, page } = await newPage(browser, vp, false)
    await gotoPicker(page)
    await shot(page, pickerShot)
    await checkOverflow(page, `${label}-picker`)
    const backend = await enterGlow(page)
    if (backend !== 'webgl2' && backend !== 'canvas2d') fail.push(`${label} 后端异常 ${backend}`)
    const cs = await canvasSize(page)
    if (cs.w < 10 || cs.h < 10) fail.push(`${label} canvas backing 异常 ${JSON.stringify(cs)}`)
    await playUntilScore(page, {})
    await page.waitForTimeout(150)
    await shot(page, stageShot)
    await checkOverflow(page, `${label}-glow`)
    await ctx.close()
  }

  await browser.close()

  if (fail.length) {
    console.error('\n❌ E2E 失败：\n - ' + fail.join('\n - '))
    process.exit(1)
  }
  console.log('\n✅ mini-games 炫光 M1 三视口 E2E 全部通过')
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
