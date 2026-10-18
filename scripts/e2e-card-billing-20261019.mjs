/**
 * 2026-10-19 card-billing 多端 E2E（M 档）。
 *  覆盖：空态→添加卡（账单日/offset 还款日/额度）→还款看板倒计时→标记已还/撤销→
 *       免费层第 3 卡升级门→(专业版)免息选卡器排序与最佳标记→年费刷免进度→
 *       循环利息/分期/违约金数值→说明页免责→三视口零横向溢出 + 真实截图。
 *  运行前：npm run preview（:4173）。
 */
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const { chromium } = pw
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = join(ROOT, 'src/tools/card-billing/docs/shots')
const ORIGIN = 'http://localhost:4173'
const CHROMIUM = '/usr/local/bin/chromium'
mkdirSync(SHOTS, { recursive: true })

const fail = []
const log = (...a) => console.log('[e2e-card]', ...a)

function seedPro() {
  const seed = {
    orders: [
      {
        id: 'ord_e2e_card_pro',
        toolId: 'card-billing',
        kind: 'freemium-pro',
        amountCents: 890,
        currency: 'CNY',
        status: 'paid',
        createdAt: new Date().toISOString(),
        paidAt: new Date().toISOString()
      }
    ],
    usage: {}
  }
  localStorage.setItem('fangzi:billing:v1', JSON.stringify(seed))
}

async function newCtx(browser, viewport, withPro) {
  const ctx = await browser.newContext({ viewport })
  await ctx.route('**/sw.js', (r) => r.abort())
  await ctx.route('**/registerSW.js', (r) => r.abort())
  if (withPro) await ctx.addInitScript(seedPro)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => fail.push(`pageerror: ${e.message}`))
  return { ctx, page }
}

async function overflow(page, label) {
  const d = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
  const bad = d.sw - d.cw > 2
  log(`overflow[${label}] ${d.sw}/${d.cw} -> ${bad ? 'FAIL' : 'ok'}`)
  if (bad) fail.push(`${label} 横向溢出 ${d.sw - d.cw}px`)
}

async function shot(page, name) {
  await page.screenshot({ path: join(SHOTS, name), fullPage: true })
  log('shot', name)
}

// 在「添加卡片」表单里按参数建一张卡
async function fillCard(page, { name, billingDay = '5', withFee = false }) {
  await page.getByRole('button', { name: '＋ 添加卡片' }).click()
  await page.locator('input[placeholder*="招行经典白"]').fill(name)
  await page.locator('.form select').nth(0).selectOption(billingDay) // 账单日
  if (withFee) {
    await page.locator('text=这张卡需要刷免年费').click()
    await page.locator('.nested input[type="date"]').fill('2026-12-31')
    await page.locator('.nested input[type="number"]').nth(0).fill('6')
    await page.locator('.nested input[type="number"]').nth(1).fill('4')
  }
  await page.getByRole('button', { name: '保存卡片' }).click()
  await page.waitForSelector('.card-row', { timeout: 5000 })
}

async function run() {
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-dev-shm-usage'] })

  // —— 免费态（PC 主流程 + 升级门） ——
  {
    const { ctx, page } = await newCtx(browser, { width: 1280, height: 860 }, false)
    await page.goto(`${ORIGIN}/#/t/card-billing`)
    await page.waitForSelector('.seg', { timeout: 15000 })
    log('免费态：空态加载 OK')

    await page.getByRole('button', { name: /💳 卡片/ }).click()
    await fillCard(page, { name: '招行经典白', billingDay: '5' })
    await fillCard(page, { name: '交行沃尔玛', billingDay: '15' })
    if ((await page.locator('.card-row').count()) !== 2) fail.push('应建出 2 张卡')

    // 第 3 张卡 -> 免费层升级门（toast，不进表单）
    await page.getByRole('button', { name: '＋ 添加卡片' }).click()
    await page.waitForTimeout(400)
    const stillOnList = await page.locator('.card-row').first().isVisible()
    const gateToast = await page.locator('.toast').innerText().catch(() => '')
    if (!stillOnList || !gateToast.includes('升级')) fail.push(`免费层第 3 卡应被拦截，toast=${gateToast}`)
    log('免费层第 3 卡升级门 OK：', gateToast)

    // 看板倒计时 + 还款标记/撤销
    await page.getByRole('button', { name: /⏱ 还款/ }).click()
    await page.waitForSelector('.due-card')
    const cnt = await page.locator('.due-card').count()
    if (cnt !== 2) fail.push(`看板应 2 张卡的还款日，实际 ${cnt}`)
    const pill = await page.locator('.due-card').first().locator('.pill').innerText()
    log('最近还款 pill：', pill)
    if (!/还剩|今天|逾期/.test(pill)) fail.push(`还款倒计时文案异常：${pill}`)
    await shot(page, 'shot-01-pc-dashboard.png')

    await page.locator('.due-card').first().getByRole('button', { name: '我已还款' }).click()
    await page.waitForTimeout(400)
    const undoVisible = await page.getByRole('button', { name: /已还（撤销）/ }).first().isVisible().catch(() => false)
    if (!undoVisible) fail.push('标记已还后应出现撤销按钮')
    await page.getByRole('button', { name: /已还（撤销）/ }).first().click()
    await page.waitForTimeout(300)
    log('还款标记/撤销 OK')

    // 添加卡表单截图（PC）
    await page.getByRole('button', { name: /💳 卡片/ }).click()
    await page.locator('.card-row').first().click()
    await page.waitForSelector('.form')
    await shot(page, 'shot-02-pc-edit-form.png')
    await page.getByRole('button', { name: '← 返回' }).click()
    await overflow(page, 'pc')
    await ctx.close()
  }

  // —— 专业态（PC：选卡 / 年费 / 利息） ——
  {
    const { ctx, page } = await newCtx(browser, { width: 1280, height: 860 }, true)
    await page.goto(`${ORIGIN}/#/t/card-billing`)
    await page.waitForSelector('.seg', { timeout: 15000 })
    await page.getByRole('button', { name: /💳 卡片/ }).click()
    await fillCard(page, { name: '招行经典白', billingDay: '5', withFee: true })
    await fillCard(page, { name: '交行沃尔玛', billingDay: '15' })

    // 选卡器
    await page.getByRole('button', { name: /🃏 选卡/ }).click()
    await page.waitForSelector('.pick-row')
    const rows = await page.locator('.pick-row').count()
    if (rows !== 2) fail.push(`选卡器应 2 行，实际 ${rows}`)
    const best = await page.locator('.pick-row.best').count()
    if (best !== 1) fail.push('应有且仅有 1 张最佳卡')
    const bestDays = await page.locator('.pick-row.best .days').innerText()
    log('最长免息：', bestDays)
    if (!/\d+\s*天/.test(bestDays)) fail.push('免息天数未显示')
    await shot(page, 'shot-03-pc-picker.png')

    // 年费 + 利息
    await page.getByRole('button', { name: /🏦 年费·利息/ }).click()
    await page.waitForSelector('.fee-row')
    const feeText = await page.locator('.fee-row').first().innerText()
    if (!/还差\s*2\s*笔/.test(feeText)) fail.push(`年费进度应“还差 2 笔”，实际：${feeText.replace(/\n/g, ' ')}`)
    log('年费进度 OK')
    const results = await page.locator('.result strong').allInnerTexts()
    log('利息结果：', results.join(' | '))
    if (!results.some((t) => t.includes('135.00'))) fail.push('循环利息应为 135.00 元')
    if (!results.some((t) => t.includes('864.00'))) fail.push('分期手续费应为 864.00 元')
    if (!results.some((t) => t.includes('100.00'))) fail.push('违约金应为 100.00 元')
    await shot(page, 'shot-04-pc-fee-interest.png')

    // 说明页免责
    await page.getByRole('button', { name: /ℹ️ 说明/ }).click()
    await page.waitForSelector('.about')
    const about = await page.locator('.about').innerText()
    if (!about.includes('以银行实际账单为准')) fail.push('说明页缺少以银行为准免责')
    await overflow(page, 'pc-pro')
    await ctx.close()
  }

  // —— 手机 / 平板自适应 ——
  for (const [label, vp, shotName] of [
    ['mobile', { width: 375, height: 812 }, 'shot-05-mobile-dashboard.png'],
    ['tablet', { width: 834, height: 1112 }, 'shot-06-tablet-dashboard.png']
  ]) {
    const { ctx, page } = await newCtx(browser, vp, true)
    await page.goto(`${ORIGIN}/#/t/card-billing`)
    await page.waitForSelector('.seg', { timeout: 15000 })
    await page.getByRole('button', { name: /💳 卡片/ }).click()
    await fillCard(page, { name: '招行经典白', billingDay: '5' })
    await page.getByRole('button', { name: /⏱ 还款/ }).click()
    await page.waitForSelector('.due-card')
    await shot(page, shotName)
    await overflow(page, label)
    await ctx.close()
  }

  await browser.close()

  if (fail.length) {
    console.error('\n❌ E2E 失败：\n - ' + fail.join('\n - '))
    process.exit(1)
  }
  console.log('\n✅ card-billing 三视口 E2E 全部通过，截图 6 张')
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
