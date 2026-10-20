/**
 * 2026-10-20 小游戏三优化 三视口 E2E（强制 WebGL2）：
 *  ① 莫比环跑酷：Q 版卡通角色 + 约45°俯瞰追尾镜头（前路不被角色遮挡）
 *  ② 炫光连消：目标 HUD/进度条 + 强化消除特效（爆圈/闪光/震屏）+ 通关结算
 *  ③ 霓虹脉冲：选曲页（5 首公有领域经典旋律 + 自由脉冲）+ 谱面下落 + 命中奏响
 * 断言：后端落 webgl2/canvas2d、canvas backing 正常、零横向溢出、无 pageerror、真实截图。
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
const log = (...a) => console.log('[e2e-games3]', ...a)

async function newPage(browser, viewport) {
  const ctx = await newCompatContext(browser, viewport)
  // 注入“小游戏专业版已购”，避免 GPU 游戏点击落到付费墙而进不了专注态。
  await ctx.addInitScript(() => {
    localStorage.setItem(
      'fangzi:billing:v1',
      JSON.stringify({
        orders: [
          {
            id: 'ord_e2e_trio_pro',
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
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => {
    if (!SW_NOISE.test(e.message)) fail.push(`pageerror: ${e.message}`)
  })
  page.on('console', (m) => {
    if (m.type() === 'error' && !SW_NOISE.test(m.text())) fail.push(`console.error: ${m.text()}`)
  })
  return { ctx, page }
}
const shot = (page, name) => page.screenshot({ path: join(SHOTS, name) }).then(() => log('shot', name))
const gotoPicker = (page) => page.goto(`${ORIGIN}/#/t/mini-games`).then(() => page.waitForSelector('.gcard', { timeout: 20000 }))
async function overflow(page, label) {
  const d = await horizontalOverflow(page)
  log(`overflow[${label}] -> ${d}`)
  if (d > 2) fail.push(`${label} 横向溢出 ${d}px`)
}

async function enterCard(page, name) {
  await page.locator('.gcard', { hasText: name }).first().click()
  await page.waitForSelector('.focus-stage', { timeout: 20000 })
}

// —— 炫光连消 ——
async function waitGlowBackend(page) {
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.glow')
      return el && el.getAttribute('data-backend') !== 'init'
    },
    { timeout: 20000 }
  )
  return page.getAttribute('.glow', 'data-backend')
}
function goalLeft(page) {
  return page.locator('.goal-label').innerText().then((t) => {
    const m = /还差\s*(\d+)/.exec(t)
    return m ? Number(m[1]) : -1
  })
}
async function glowSwapUntilProgress(page) {
  const box = await page.locator('.board').boundingBox()
  if (!box) return false
  const start = await goalLeft(page)
  const cell = (r, c) => ({ x: box.x + ((c + 0.5) / 8) * box.width, y: box.y + ((r + 0.5) / 8) * box.height })
  for (let i = 0; i < 80; i++) {
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
    await page.waitForTimeout(210)
    const left = await goalLeft(page)
    if (left >= 0 && left < start) {
      log('glow 目标剩余', left, '/ 起始', start)
      return true
    }
    if ((await page.locator('.result').count()) > 0) return true
  }
  return (await goalLeft(page)) < start
}

async function runGlow(page, vp) {
  await enterCard(page, '炫光连消')
  const backend = await waitGlowBackend(page)
  log('glow backend =', backend)
  if (backend !== 'webgl2' && backend !== 'canvas2d') fail.push(`炫光后端异常 ${backend}`)
  if (!(await page.locator('.goal-hud').isVisible())) fail.push('缺少目标进度 HUD')
  if ((await goalLeft(page)) !== 60) fail.push('开局目标剩余应为 60')
  const progressed = await glowSwapUntilProgress(page)
  if (!progressed) fail.push('多次交换后目标进度未推进')
  await shot(page, `glow-${vp}-effects.png`)
  await overflow(page, `glow-${vp}`)
}

// —— 霓虹脉冲 ——
async function runNeonPickerAndSong(page, vp, songName) {
  await enterCard(page, '霓虹脉冲')
  await page.waitForSelector('.picker', { timeout: 15000 })
  const songBtns = await page.locator('.song-btn').count()
  log('song buttons =', songBtns)
  if (songBtns !== 6) fail.push(`选曲应含 6 个按钮（5 曲目+自由），实际 ${songBtns}`)
  if (!(await page.locator('.song-btn', { hasText: '小星星' }).count())) fail.push('缺少小星星')
  if (!(await page.locator('.song-btn', { hasText: '欢乐颂' }).count())) fail.push('缺少欢乐颂')
  if (!(await page.locator('.song-btn', { hasText: '卡农' }).count())) fail.push('缺少卡农')
  await shot(page, `neon-${vp}-picker.png`)
  await page.locator('.song-btn', { hasText: songName }).first().click()
  await page.waitForSelector('.song-tag', { timeout: 8000 })
  const tag = await page.locator('.song-tag').innerText()
  if (!tag.includes(songName)) fail.push(`曲名标签应含 ${songName}，实际 ${tag}`)
  // 等待谱面音符下落出现
  await page.waitForFunction(() => document.querySelectorAll('.note').length > 0, { timeout: 8000 })
  // 点几下判定线附近的轨道（触发命中/奏响，不强制命中）
  const box = await page.locator('.lanes').boundingBox()
  if (box) {
    for (let i = 0; i < 3; i++) {
      await page.mouse.click(box.x + box.width * (0.2 + 0.3 * i), box.y + box.height * 0.8)
      await page.waitForTimeout(120)
    }
  }
  await page.waitForTimeout(400)
  await shot(page, `neon-${vp}-playing.png`)
  await overflow(page, `neon-${vp}`)
}

// —— 莫比环跑酷 ——
async function runMobius(page, vp) {
  await enterCard(page, '莫比环跑酷')
  await page.waitForSelector('.mb-run', { timeout: 20000 })
  // 首页 CTA → 教学 → 开跑
  const cta0 = page.locator('.mb-run .panel .cta').first()
  if (await cta0.isVisible().catch(() => false)) await cta0.click()
  const teach = page.locator('.mb-run .panel .cta', { hasText: '开跑' })
  if (await teach.isVisible().catch(() => false)) await teach.click()
  await page.waitForTimeout(2500)
  if ((await page.locator('.mb-run .panel', { hasText: '暂不支持 3D' }).count()) > 0) {
    fail.push('WebGL2 下莫比环不应提示不支持 3D')
    return
  }
  const cs = await page.evaluate(() => {
    const c = document.querySelector('.run-canvas')
    return c ? { w: c.width, h: c.height } : { w: 0, h: 0 }
  })
  log('mobius canvas backing =', JSON.stringify(cs))
  if (cs.w < 10 || cs.h < 10) fail.push(`莫比环 canvas backing 异常 ${JSON.stringify(cs)}`)
  // 跑一会儿，让角色进入奔跑姿态
  await page.waitForTimeout(2500)
  await shot(page, `mobius-${vp}-run.png`)
  await overflow(page, `mobius-${vp}`)
}

async function run() {
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: LAUNCH_ARGS })
  try {
    // PC：三款全流程
    {
      const { ctx, page } = await newPage(browser, { width: 1280, height: 800 })
      await gotoPicker(page)
      await runMobius(page, 'pc')
    }
    {
      const { ctx, page } = await newPage(browser, { width: 1280, height: 800 })
      await gotoPicker(page)
      await runGlow(page, 'pc')
    }
    {
      const { ctx, page } = await newPage(browser, { width: 1280, height: 800 })
      await gotoPicker(page)
      await runNeonPickerAndSong(page, 'pc', '小星星')
    }
    // 平板：霓虹选曲/谱面 + 炫光
    {
      const { ctx, page } = await newPage(browser, { width: 834, height: 1112 })
      await gotoPicker(page)
      await runNeonPickerAndSong(page, 'tablet', '欢乐颂')
    }
    {
      const { ctx, page } = await newPage(browser, { width: 834, height: 1112 })
      await gotoPicker(page)
      await runGlow(page, 'tablet')
    }
    // 手机：选曲 + 莫比环跑酷
    {
      const { ctx, page } = await newPage(browser, { width: 375, height: 812 })
      await gotoPicker(page)
      await runNeonPickerAndSong(page, 'mobile', '两只老虎')
    }
    {
      const { ctx, page } = await newPage(browser, { width: 375, height: 812 })
      await gotoPicker(page)
      await runMobius(page, 'mobile')
    }
  } finally {
    await browser.close()
  }

  if (fail.length) {
    console.error('\n❌ E2E 失败：')
    for (const f of fail) console.error(' -', f)
    process.exit(1)
  }
  console.log('\n✅ 三游戏三视口 E2E 全部通过')
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
