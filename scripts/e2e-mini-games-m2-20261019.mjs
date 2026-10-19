/**
 * 2026-10-19 mini-games 炫光系列（007 M2）三视口 E2E。
 *
 * 强制 WebGL2（navigator.gpu=undefined + abort SW），覆盖：
 *  - 手势回归：炫光连消“轻点棋盘格”不再唤出暂停菜单（菜单只能由右上按钮打开）；点选/滑动仍可走子
 *  - 霓虹脉冲 neon-pulse（专业版）：进入、后端落 webgl2/canvas2d、canvas backing、
 *    依据下落音符真实点按轨道得分、漏光后 3 miss 结束、再来一首复位
 *  - 星轨穿梭 orbit-surge（专业版）：进入、拖动光体生存计分增长、撞击结束、再来一局复位
 *  - 免费态点两款专业版霓虹游戏被付费墙拦截
 *  - PC/手机零横向溢出 + 无 pageerror + 真实截图
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
const log = (...a) => console.log('[e2e-m2]', ...a)

function seedPro() {
  localStorage.setItem(
    'fangzi:billing:v1',
    JSON.stringify({
      orders: [
        {
          id: 'ord_e2e_m2_pro',
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

async function scoreNow(page) {
  await page.waitForSelector('.hud-score', { timeout: 5000 })
  const t = await page.locator('.hud-score').innerText()
  return parseInt(t.replace(/[^0-9]/g, '') || '0', 10)
}

async function checkOverflow(page, label) {
  const d = await horizontalOverflow(page)
  log(`overflow[${label}] -> ${d}`)
  if (d > 2) fail.push(`${label} 横向溢出 ${d}px`)
}

async function waitBackend(page, rootSel) {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel)
      return el && el.getAttribute('data-backend') !== 'init'
    },
    rootSel,
    { timeout: 20000 }
  )
  return page.getAttribute(rootSel, 'data-backend')
}

/** 读取最接近判定线的音符所在轨道，无则 -1。 */
function nearestLane() {
  const H = 0.82
  const root = document.querySelector('.pulse')
  if (!root) return -1
  const pr = root.getBoundingClientRect()
  let best = -1
  let bd = Infinity
  root.querySelectorAll('.note').forEach((n) => {
    const rr = n.getBoundingClientRect()
    const y = (rr.top + rr.height / 2 - pr.top) / pr.height
    const x = rr.left + rr.width / 2 - pr.left
    const lane = Math.min(2, Math.max(0, Math.floor(x / (pr.width / 3))))
    const d = Math.abs(y - H)
    if (d < bd) {
      bd = d
      best = lane
    }
  })
  return bd <= 0.1 ? best : -1
}

async function tapLane(page, lane) {
  const box = await page.locator('.pulse .lane').nth(lane).boundingBox()
  if (!box) return
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}

async function run() {
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: LAUNCH_ARGS })

  // —— ① 手势回归：免费进入炫光连消，轻点棋盘格不得弹菜单 ——
  {
    const { ctx, page } = await newPage(browser, { width: 1280, height: 800 }, false)
    await gotoPicker(page)
    await page.locator('.gcard', { hasText: '炫光连消' }).click()
    await page.waitForSelector('.focus-stage', { timeout: 15000 })
    await waitBackend(page, '.glow')

    const board = await page.locator('.glow .board').boundingBox()
    if (!board) fail.push('找不到炫光棋盘')
    if (board) {
      const cell = (r, c) => ({
        x: board.x + ((c + 0.5) / 8) * board.width,
        y: board.y + ((r + 0.5) / 8) * board.height
      })
      // 单击一颗宝石（轻点）：不应弹出暂停菜单
      const a = cell(3, 3)
      await page.mouse.click(a.x, a.y)
      await page.waitForTimeout(150)
      if ((await page.locator('.sheet').count()) !== 0) fail.push('回归失败：轻点宝石仍会弹出菜单')
      // 再点相邻格（点选交换）：仍不应弹菜单
      const b = cell(3, 4)
      await page.mouse.click(b.x, b.y)
      await page.waitForTimeout(200)
      if ((await page.locator('.sheet').count()) !== 0) fail.push('回归失败：点选相邻格弹出菜单')
      // 菜单只能由右上按钮打开
      await page.locator('.hud-btn').click()
      await page.waitForSelector('.sheet', { timeout: 5000 })
      await page.waitForTimeout(100)
      if ((await page.locator('.sheet').count()) !== 1) fail.push('右上按钮应能打开暂停菜单')
      await page.locator('.sheet-btn', { hasText: '退出游戏' }).click()
      await page.waitForSelector('.zone', { timeout: 5000 })
    }
    await ctx.close()
  }

  // —— ② 免费态点专业版霓虹游戏 → 付费墙 ——
  {
    const { ctx, page } = await newPage(browser, { width: 1280, height: 800 }, false)
    await gotoPicker(page)
    await page.locator('.gcard', { hasText: '霓虹脉冲' }).first().click()
    await page.waitForSelector('.paywall', { timeout: 5000 })
    const pw = await page.locator('.paywall').innerText()
    if (!pw.includes('19.9')) fail.push(`专业版付费墙应显示 ¥19.90，实际：${pw.slice(0, 120)}`)
    if ((await page.locator('.focus-stage').count()) !== 0) fail.push('未购不应进入霓虹脉冲')
    await page.locator('.paywall .link', { hasText: '先玩免费游戏' }).click()
    await ctx.close()
  }

  // —— ③ 霓虹脉冲（已购）：真实点按得分 → 漏光结束 → 再来一首 ——
  {
    const { ctx, page } = await newPage(browser, { width: 1280, height: 800 }, true)
    await gotoPicker(page)
    await page.locator('.gcard', { hasText: '霓虹脉冲' }).first().click()
    await page.waitForSelector('.focus-stage', { timeout: 15000 })
    const backend = await waitBackend(page, '.pulse')
    log('pulse backend =', backend)
    if (backend !== 'webgl2' && backend !== 'canvas2d') fail.push(`脉冲后端异常 ${backend}`)
    const cs = await page.evaluate(() => {
      const c = document.querySelector('.pulse canvas')
      return c ? { w: c.width, h: c.height } : { w: 0, h: 0 }
    })
    if (cs.w < 10 || cs.h < 10) fail.push(`脉冲 canvas backing 异常 ${JSON.stringify(cs)}`)

    // 依据音符位置主动点轨，争取打出分数
    let scored = false
    const deadline = Date.now() + 7000
    while (Date.now() < deadline && !scored) {
      const lane = await page.evaluate(nearestLane)
      if (lane >= 0) await tapLane(page, lane)
      await page.waitForTimeout(110)
      if ((await scoreNow(page)) > 0) scored = true
      if ((await page.locator('.pulse .over').count()) > 0) break
    }
    log('pulse scored =', scored, 'score =', await scoreNow(page).catch(() => -1))
    if (!scored) fail.push('多次按音符点轨后仍未得分，节奏击打链路异常')
    await checkOverflow(page, 'pc-pulse')

    // 停止操作 → 累计 3 次漏击 → 结束遮罩
    await page.waitForSelector('.pulse .over', { timeout: 9000 })
    const miss = await page.locator('.pulse .miss-dots i.lost').count()
    if (miss < 3) fail.push(`结束时应有 3 个漏击点，实际 ${miss}`)
    await shot(page, 'shot-11-pc-neon-pulse.png')

    // 再来一首：遮罩消失、分数归零
    await page.locator('.pulse .over-btn').click()
    await page.waitForTimeout(300)
    if ((await page.locator('.pulse .over').count()) !== 0) fail.push('再来一首后结束遮罩应消失')
    if ((await scoreNow(page)) !== 0) fail.push('再来一首后分数应归零')
    await ctx.close()
  }

  // —— ④ 星轨穿梭（已购）：拖动生存计分 → 撞击结束 → 再来一局 ——
  {
    const { ctx, page } = await newPage(browser, { width: 1280, height: 800 }, true)
    await gotoPicker(page)
    await page.locator('.gcard', { hasText: '星轨穿梭' }).first().click()
    await page.waitForSelector('.focus-stage', { timeout: 15000 })
    const backend = await waitBackend(page, '.surge')
    log('surge backend =', backend)
    if (backend !== 'webgl2' && backend !== 'canvas2d') fail.push(`星轨后端异常 ${backend}`)

    const field = await page.locator('.surge .field').boundingBox()
    if (!field) fail.push('找不到星轨操作区')
    if (field) {
      // 按住并左右规避拖动 2.6s，生存分应增长
      await page.mouse.move(field.x + field.width * 0.5, field.y + field.height * 0.7)
      await page.mouse.down()
      let dir = 1
      for (let i = 0; i < 20; i++) {
        const px = await page.getAttribute('.surge', 'data-px').then((v) => parseFloat(v || '0.5'))
        // 简单规避：靠近一侧就换向
        if (px > 0.75) dir = -1
        if (px < 0.25) dir = 1
        await page.mouse.move(field.x + field.width * (px + dir * 0.18), field.y + field.height * 0.7, { steps: 3 })
        await page.waitForTimeout(120)
      }
      await page.mouse.up()
      const s1 = await scoreNow(page)
      log('surge survival score =', s1)
      if (s1 <= 0) fail.push('生存拖动后应有计分增长')
      await checkOverflow(page, 'pc-surge')
      await shot(page, 'shot-12-pc-orbit-surge.png')

      // 碰撞收紧为真实像素圆距后，停在原地可能长时间不被擦到；
      // 改为主动追击“最接近玩家线”的下落障碍，确定性地制造一次撞击 → 结束。
      await page.mouse.move(field.x + field.width * 0.5, field.y + field.height * 0.7)
      await page.mouse.down()
      const chaseDeadline = Date.now() + 10000
      while (Date.now() < chaseDeadline && !(await page.locator('.surge .over').count())) {
        const enemyX = await page.evaluate(() => {
          const f = document.querySelector('.surge .field')
          if (!f) return null
          const fr = f.getBoundingClientRect()
          const en = [...document.querySelectorAll('.surge .orb.enemy')]
            .map((e) => {
              const r = e.getBoundingClientRect()
              return {
                x: (r.left + r.width / 2 - fr.left) / fr.width,
                y: (r.top + r.height / 2 - fr.top) / fr.height
              }
            })
            .filter((o) => o.y < 0.9)
            .sort((a, b) => b.y - a.y)[0]
          return en ? en.x : null
        })
        if (enemyX != null) {
          await page.mouse.move(field.x + enemyX * field.width, field.y + field.height * 0.7, { steps: 2 })
        }
        await page.waitForTimeout(60)
      }
      await page.waitForSelector('.surge .over', { timeout: 6000 })
      await page.mouse.up().catch(() => {})
      // 再来一局：遮罩消失、分数回落到刚开局的极小值（生存分随时间增长，不能要求恒为 0）
      await page.locator('.surge .over-btn').click()
      await page.waitForTimeout(60)
      if ((await page.locator('.surge .over').count()) !== 0) fail.push('再来一局后结束遮罩应消失')
      const resetScore = await scoreNow(page)
      if (resetScore > 10) fail.push(`再来一局后分数应回落到开局水平，实际 ${resetScore}`)
    }
    await ctx.close()
  }

  // —— ⑤ 手机：霓虹脉冲全屏自适应 + 零溢出 + 截图 ——
  {
    const { ctx, page } = await newPage(browser, { width: 375, height: 812 }, true)
    await gotoPicker(page)
    await checkOverflow(page, 'mobile-picker-m2')
    await page.locator('.gcard', { hasText: '霓虹脉冲' }).first().click()
    await page.waitForSelector('.focus-stage', { timeout: 15000 })
    await waitBackend(page, '.pulse')
    await page.waitForTimeout(600)
    await checkOverflow(page, 'mobile-pulse')
    await shot(page, 'shot-13-mobile-neon-pulse.png')
    await ctx.close()
  }

  await browser.close()

  if (fail.length) {
    console.error('\n❌ M2 E2E 失败：\n - ' + fail.join('\n - '))
    process.exit(1)
  }
  console.log('\n✅ mini-games 炫光 M2 E2E 全部通过')
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
