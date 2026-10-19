/**
 * 2026-10-19 008「莫比环 MÖBIUS」三视口 E2E（H 档）。
 *
 * 强制 WebGL2（newCompatContext：navigator.gpu=undefined + abort SW），覆盖：
 *  - 菜单 → 首次教学 → 开始：three 懒加载成功（非 unsupported），canvas 有 backing 尺寸
 *  - 点按画面翻转：只读钩子 __mobius.getFace() 0↔1（真实输入→逻辑链路）
 *  - 暂停/继续；不操作自然撞墙 → 结算面板出现（碰撞/结算链路）
 *  - 免费态无续命按钮，「解锁专业版」打开付费墙显示 ¥12.90；注入已购订单后出现光盾续命
 *  - 立刻重开回到对局
 *  - PC/平板/手机零横向溢出 + 无 pageerror（SW abort 噪音过滤）+ 真实截图
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
const SHOTS = join(ROOT, 'src/tools/mobius-runner/docs/shots')
const ORIGIN = 'http://localhost:4173'
mkdirSync(SHOTS, { recursive: true })

const fail = []
const log = (...a) => console.log('[e2e-mobius]', ...a)

function seedPro() {
  localStorage.setItem(
    'fangzi:billing:v1',
    JSON.stringify({
      orders: [
        {
          id: 'ord_e2e_mobius_pro',
          toolId: 'mobius-runner',
          kind: 'freemium-pro',
          amountCents: 1290,
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

const dbg = (page, fn) => page.evaluate((k) => {
  const h = window.__mobius
  return h ? h[k]() : null
}, fn)

async function startGame(page) {
  await page.goto(`${ORIGIN}/#/t/mobius-runner`)
  await page.waitForSelector('.panel.menu .cta', { timeout: 20000 })
  await page.locator('.panel.menu .cta').click()
  // three chunk 异步加载：教学面板可能稍晚出现；已学过则直接进对局
  try {
    await page.waitForSelector('.panel.tutorial .cta', { timeout: 20000 })
    await page.locator('.panel.tutorial .cta').click()
  } catch {
    /* 无教学（已学过）→ 应已 running */
  }
  await page.waitForFunction(() => window.__mobius && window.__mobius.getStatus() === 'running', { timeout: 20000 })
}

async function canvasInfo(page) {
  return page.evaluate(() => {
    const c = document.querySelector('.mr-canvas')
    return c ? { w: c.width, h: c.height } : { w: 0, h: 0 }
  })
}

async function checkOverflow(page, label) {
  const d = await horizontalOverflow(page)
  log(`overflow[${label}] -> ${d}`)
  if (d > 2) fail.push(`${label} 横向溢出 ${d}px`)
}

async function run() {
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: LAUNCH_ARGS })

  // —— PC 免费态：菜单/教学/翻转/暂停/死亡/付费墙/重开 ——
  {
    const { ctx, page } = await newPage(browser, { width: 1280, height: 800 }, false)
    await startGame(page)

    if ((await page.locator('.panel', { hasText: '暂不支持 3D' }).count()) > 0) fail.push('不应进入不支持 WebGL 兜底')
    const cs = await canvasInfo(page)
    log('canvas backing =', JSON.stringify(cs))
    if (cs.w < 10 || cs.h < 10) fail.push(`canvas backing 尺寸异常 ${JSON.stringify(cs)}`)

    // 点按画面翻转：0→1→0
    const f0 = await dbg(page, 'getFace')
    await page.locator('.mr-canvas').click({ position: { x: 300, y: 400 } })
    await page.waitForTimeout(60)
    const f1 = await dbg(page, 'getFace')
    await page.locator('.mr-canvas').click({ position: { x: 300, y: 400 } })
    await page.waitForTimeout(60)
    const f2 = await dbg(page, 'getFace')
    log('faces', f0, f1, f2)
    if (f1 === f0) fail.push('首次点按后 face 未翻转')
    if (f2 !== f0) fail.push('第二次点按后 face 应回到初始面')
    await shot(page, 'shot-01-pc-playing.png')
    await checkOverflow(page, 'pc-playing')

    // 暂停 / 继续
    await page.locator('.hud .icon-btn').click()
    await page.waitForSelector('.panel h2', { hasText: '已暂停' })
    await shot(page, 'shot-02-pc-paused.png')
    await page.locator('.panel .cta', { hasText: '继续' }).click()
    await page.waitForFunction(() => window.__mobius && window.__mobius.getStatus() === 'running', { timeout: 5000 })

    // 不操作，等待自然撞墙进入结算（连续多道闸门内必中）
    await page.waitForSelector('.panel.dead', { timeout: 30000 })
    const sc = await page.locator('.panel.dead .big-score').innerText()
    log('dead score =', sc.trim())
    if (await page.locator('.panel.dead .cta.revive').count() > 0) fail.push('免费态不应出现光盾续命按钮')
    await shot(page, 'shot-03-pc-dead.png')

    // 解锁专业版 → 付费墙显示 ¥12.90
    await page.locator('.panel.dead .ghost', { hasText: '解锁专业版' }).click()
    await page.waitForSelector('.panel.paywall')
    const pwText = await page.locator('.panel.paywall').innerText()
    if (!pwText.includes('12.9')) fail.push(`付费墙应显示 ¥12.90，实际：${pwText.slice(0, 160)}`)
    await shot(page, 'shot-04-pc-paywall.png')
    await page.locator('.panel.paywall .ghost', { hasText: '先玩免费版' }).click()

    // 立刻重开
    await page.locator('.panel.dead .cta', { hasText: '立刻重开' }).click()
    await page.waitForFunction(() => window.__mobius && window.__mobius.getStatus() === 'running', { timeout: 8000 })
    log('restart ok')
    await ctx.close()
  }

  // —— PC 专业版已购：死亡后出现光盾续命 ——
  {
    const { ctx, page } = await newPage(browser, { width: 1280, height: 800 }, true)
    await startGame(page)
    await page.waitForSelector('.panel.dead', { timeout: 30000 })
    const reviveBtn = page.locator('.panel.dead .cta.revive')
    if (!(await reviveBtn.count())) fail.push('已购专业版死亡后应出现光盾续命按钮')
    await shot(page, 'shot-05-pc-revive.png')
    await reviveBtn.click()
    await page.waitForFunction(() => window.__mobius && window.__mobius.getStatus() === 'running', { timeout: 5000 })
    await checkOverflow(page, 'pc-revived')
    await ctx.close()
  }

  // —— 平板 / 手机：全屏自适应 + 翻转 + 溢出 + 菜单截图 ——
  for (const [label, vp, menuShot, playShot] of [
    ['tablet', { width: 834, height: 1112 }, 'shot-06-tablet-menu.png', 'shot-07-tablet-playing.png'],
    ['mobile', { width: 375, height: 812 }, 'shot-08-mobile-menu.png', 'shot-09-mobile-playing.png']
  ]) {
    const { ctx, page } = await newPage(browser, vp, false)
    await page.goto(`${ORIGIN}/#/t/mobius-runner`)
    await page.waitForSelector('.panel.menu .cta', { timeout: 20000 })
    await shot(page, menuShot)
    await checkOverflow(page, `${label}-menu`)
    await startGame(page)
    const cs = await canvasInfo(page)
    if (cs.w < 10 || cs.h < 10) fail.push(`${label} canvas backing 异常 ${JSON.stringify(cs)}`)
    await page.locator('.mr-canvas').click({ position: { x: vp.width * 0.5, y: vp.height * 0.55 } })
    await page.waitForTimeout(60)
    if ((await dbg(page, 'getFace')) == null) fail.push(`${label} 翻转钩子无状态`)
    await page.waitForTimeout(400)
    await shot(page, playShot)
    await checkOverflow(page, `${label}-playing`)
    await ctx.close()
  }

  await browser.close()

  if (fail.length) {
    console.error('\n❌ E2E 失败：\n - ' + fail.join('\n - '))
    process.exit(1)
  }
  console.log('\n✅ 莫比环 MÖBIUS 三视口 E2E 全部通过')
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
