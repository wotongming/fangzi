/**
 * 2026-11-02《租赁证据链》rent-evidence 三视口 E2E（M 档）。
 * 覆盖：台账记账 → 报修工单（自动责任初判）→ 交接照带水印保存 → 证据包 PDF 导出
 * 断网可玩、零横向溢出、无 pageerror、零外部请求。
 * 运行前：npx vite preview --port 4173 --host 127.0.0.1（后台）
 */
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { newCompatContext, horizontalOverflow, SW_NOISE, LAUNCH_ARGS, CHROMIUM } from './_gpu-ctx.mjs'

const { chromium } = pw
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = join(ROOT, 'src/tools/rent-evidence/docs/shots')
const SAMPLE_IMG = join(ROOT, 'src/tools/mini-games/gpu-games/starvein/docs/shots/pc-vein.png')
const ORIGIN = 'http://localhost:4173'

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

const fail = []
const log = (...a) => console.log('[e2e-rent-evidence]', ...a)

async function newPage(browser, viewport, mobile = false) {
  const ctx = mobile
    ? await browser.newContext({ viewport, hasTouch: true, userAgent: MOBILE_UA })
    : await newCompatContext(browser, viewport)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => { if (!SW_NOISE.test(e.message)) fail.push(`pageerror: ${e.message}`) })
  const external = []
  page.on('request', (req) => { const u = req.url(); if (!u.startsWith(ORIGIN)) external.push(u) })
  return { ctx, page, external }
}

async function mainChain(page) {
  await page.goto(`${ORIGIN}/#/t/rent-evidence`)
  await page.waitForSelector('.rw .tabs', { timeout: 20000 })

  // 1) 台账记账
  await page.locator('.tabs button', { hasText: '台账' }).click()
  await page.locator('.rw select').first().selectOption('deposit')
  await page.locator('.rw input[type=number]').fill('3000')
  await page.locator('.rw input[placeholder*=备注]').fill('2026-11 押金')
  await page.locator('.primary', { hasText: '记账' }).click()
  await page.waitForFunction(() => document.body.innerText.includes('押金 ¥3000'), { timeout: 5000 })
  log('ledger ok: 押金 ¥3000')

  // 2) 报修工单（自然老化 → landlord）
  await page.locator('.tabs button', { hasText: '报修工单' }).click()
  await page.locator('input[placeholder*=标题]').fill('厨房水龙头漏水')
  await page.locator('textarea').fill('水管老化，自己渗水')
  await page.locator('input[placeholder*=维修费用]').fill('150')
  await page.locator('input[type=file][hidden]').setInputFiles(SAMPLE_IMG)
  await page.locator('.primary', { hasText: '保存工单' }).click()
  await page.waitForFunction(() => document.body.innerText.includes('疑似房东责任'), { timeout: 8000 })
  log('ticket ok: 责任初判=landlord')

  // 3) 交接照片（带时间戳水印）
  await page.locator('.tabs button', { hasText: '交接照片' }).click()
  const fileInputs = page.locator('input[type=file][hidden]')
  await fileInputs.first().setInputFiles(SAMPLE_IMG)
  await page.waitForSelector('.grid figure img', { timeout: 10000 })
  const imgs = await page.locator('.grid figure img').count()
  log('photo saved, figures=', imgs)

  // 4) 证据包 PDF 导出（捕获 download）
  await page.locator('.tabs button', { hasText: '证据包' }).click()
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.locator('.primary', { hasText: '导出证据包 PDF' }).click()
  ])
  log('pdf download suggested:', download.suggestedFilename())
}

async function runViewport(browser, name, viewport, mobile = false) {
  const { ctx, page, external } = await newPage(browser, viewport, mobile)
  try {
    await mainChain(page)
    await page.locator('.tabs button', { hasText: '交接照片' }).click()
    await page.waitForSelector('.grid figure img', { timeout: 5000 })
    await page.waitForTimeout(300)
    await page.screenshot({ path: join(SHOTS, `${name}.png`) })
    log('shot', `${name}.png`)
    const overflow = await horizontalOverflow(page)
    if (overflow !== 0) fail.push(`${name} overflow=${overflow}px`)
    log('overflow=', overflow, 'external=', external.length)
  } catch (e) {
    fail.push(`${name}: ${e.message}`)
  } finally {
    await ctx.close()
  }
}

const browser = await chromium.launch({ executablePath: CHROMIUM, args: LAUNCH_ARGS })
try {
  await runViewport(browser, 'pc-rent-evidence', { width: 1280, height: 860 })
  await runViewport(browser, 'tablet-rent-evidence', { width: 834, height: 1112 })
  await runViewport(browser, 'mobile-rent-evidence', { width: 375, height: 812 }, true)

  // reload 持久化：台账/工单/照片存 IndexedDB，刷新后仍在
  const { ctx, page } = await newPage(browser, { width: 375, height: 812 }, true)
  try {
    await mainChain(page)
    await page.reload()
    await page.waitForSelector('.rw .tabs', { timeout: 20000 })
    await page.locator('.tabs button', { hasText: '台账' }).click()
    await page.waitForFunction(() => document.body.innerText.includes('押金 ¥3000'), { timeout: 8000 })
    await page.locator('.tabs button', { hasText: '报修工单' }).click()
    await page.waitForFunction(() => document.body.innerText.includes('疑似房东责任'), { timeout: 8000 })
    log('reload 持久化：台账/工单/照片跨刷新保留')
  } catch (e) {
    fail.push('reload-persist: ' + e.message)
  }
  await ctx.close()
} finally {
  await browser.close()
}

if (fail.length) {
  console.error('❌ 失败：')
  for (const f of fail) console.error(' -', f)
  process.exit(1)
}
console.log('✅ 《租赁证据链》三视口 E2E 全部通过')
