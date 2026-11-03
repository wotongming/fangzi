import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { newCompatContext, horizontalOverflow, LAUNCH_ARGS, CHROMIUM } from './_gpu-ctx.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SHOTS = join(ROOT, '/src/tools/health-trend/docs/shots')
const ORIGIN = 'http://127.0.0.1:4173'
const fail = []
const { chromium } = pw

const log = (...a) => console.log('[e2e-health-trend]', ...a)

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

async function newPage(browser, viewport, mobile = false) {
  const ctx = mobile
    ? await browser.newContext({ viewport, hasTouch: true, userAgent: MOBILE_UA })
    : await newCompatContext(browser, viewport)
  const page = await ctx.newPage()
  const external = []
  page.on('request', (req) => { const u = req.url(); if (!u.startsWith(ORIGIN)) external.push(u) })
  return { ctx, page, external }
}

async function mainChain(page) {
  await page.goto(`${ORIGIN}/#/t/health-trend`)
  await page.waitForSelector('.rw h2', { timeout: 15000 })

  // 录入：血糖 3 年（缓慢爬升）
  await page.locator('.rw input[type=number]').nth(0).fill('2022')
  await page.locator('.rw input').filter({ hasText: '' }).first()
  await page.getByPlaceholder('如 总胆固醇').fill('空腹血糖')
  await page.locator('.rw input[type=number]').nth(1).fill('5.0')
  await page.getByPlaceholder('如 mmol/L').fill('mmol/L')
  await page.locator('.rw input[type=number]').nth(2).fill('6.1')
  await page.getByRole('button', { name: '＋ 录入本年测量' }).click()
  await page.waitForFunction(() => document.body.innerText.includes('已录入'), { timeout: 5000 })

  await page.locator('.rw input[type=number]').nth(0).fill('2023')
  await page.locator('.rw input[type=number]').nth(1).fill('5.5')
  await page.getByRole('button', { name: '＋ 录入本年测量' }).click()
  await page.locator('.rw input[type=number]').nth(0).fill('2024')
  await page.locator('.rw input[type=number]').nth(1).fill('6.0')
  await page.getByRole('button', { name: '＋ 录入本年测量' }).click()
  await page.waitForFunction(() => document.body.innerText.includes('缓慢爬升'), { timeout: 5000 })
  log('climb detected: 空腹血糖')

  // 录入一个超限
  await page.getByPlaceholder('如 总胆固醇').fill('尿酸')
  await page.locator('.rw input[type=number]').nth(1).fill('480')
  await page.getByPlaceholder('如 mmol/L').fill('μmol/L')
  await page.locator('.rw input[type=number]').nth(2).fill('420')
  await page.getByRole('button', { name: '＋ 录入本年测量' }).click()
  await page.waitForFunction(() => document.body.innerText.includes('复查行动清单'), { timeout: 5000 })
  const charts = await page.locator('.card').count()
  log('cards=', charts)
  if (charts < 2) fail.push(`cards=${charts}`)
}

async function runViewport(browser, name, viewport, mobile = false) {
  const { ctx, page, external } = await newPage(browser, viewport, mobile)
  try {
    await mainChain(page)
    await page.waitForTimeout(300)
    await page.screenshot({ path: join(SHOTS, `${name}.png`) })
    log('shot', `${name}.png`)
    const overflow = await horizontalOverflow(page)
    if (overflow !== 0) fail.push(`${name} overflow=${overflow}px`)
    log('overflow=', overflow)
    return { ctx, page }
  } catch (e) {
    fail.push(`${name}: ${e.message}`)
    await ctx.close()
  }
}

const browser = await chromium.launch({ executablePath: CHROMIUM, args: LAUNCH_ARGS })
try {
  const pc = await runViewport(browser, 'pc-health-trend', { width: 1280, height: 860 })
  // reload 持久化（同 context reload，IDB 才不丢）
  if (pc) {
    await pc.page.reload()
    await pc.page.waitForFunction(() => document.body.innerText.includes('空腹血糖'), { timeout: 8000 })
    log('reload 持久化：空腹血糖/尿酸跨刷新保留')
    await pc.ctx.close()
  }
  await runViewport(browser, 'tablet-health-trend', { width: 834, height: 1112 })
  await runViewport(browser, 'mobile-health-trend', { width: 375, height: 812, hasTouch: true }, true)
} finally {
  await browser.close()
}

if (fail.length) {
  console.error('❌ 失败：', fail)
  process.exit(1)
}
console.log('✅ 三视口 E2E 通过')
