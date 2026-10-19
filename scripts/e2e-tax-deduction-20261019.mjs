/**
 * 2026-10-19 tax-deduction 多端 E2E（M 档）。
 *  覆盖：空态→免费层 1 项与第 2 项升级门→(专业版)多项目录入→易错预检（房贷/租金互斥）→
 *       夫妻分摊三方案→退税估算→资料留存清单→说明页免责→三视口零横向溢出 + 真实截图。
 *  运行前：npx vite preview --port 4173 --host 127.0.0.1
 */
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const { chromium } = pw
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = join(ROOT, 'src/tools/tax-deduction/docs/shots')
const ORIGIN = 'http://localhost:4173'
const CHROMIUM = '/usr/local/bin/chromium'
mkdirSync(SHOTS, { recursive: true })

const fail = []
const log = (...a) => console.log('[e2e-tax]', ...a)

function seedPro() {
  const seed = {
    orders: [
      {
        id: 'ord_e2e_tax_pro',
        toolId: 'tax-deduction',
        kind: 'freemium-pro',
        amountCents: 690,
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
  page.on('dialog', (d) => d.accept())
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
async function gotoTool(page) {
  await page.goto(`${ORIGIN}/#/t/tax-deduction`)
  await page.waitForSelector('.seg', { timeout: 15000 })
}
async function addItem(page, kind, fill) {
  await page.getByRole('button', { name: '＋ 添加扣除项' }).click()
  await page.waitForSelector('.form', { timeout: 5000 })
  await page.locator('.form select').nth(0).selectOption(kind)
  if (fill) await fill(page)
  await page.getByRole('button', { name: '保存扣除项' }).click()
  await page.waitForSelector('.card-row', { timeout: 5000 })
}

async function run() {
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-dev-shm-usage'] })

  // —— 免费态（PC）：1 项可用，第 2 项被升级门拦截 ——
  {
    const { ctx, page } = await newCtx(browser, { width: 1280, height: 860 }, false)
    await gotoTool(page)
    await page.getByRole('button', { name: /📝 扣除项/ }).click()
    await addItem(page, 'childEducation', (p) => p.locator('input[placeholder*="张小明"]').fill('张家大宝'))
    if ((await page.locator('.card-row').count()) !== 1) fail.push('免费态应建出 1 项')

    await page.getByRole('button', { name: '＋ 添加扣除项' }).click()
    await page.waitForTimeout(400)
    const formOpened = await page.locator('.form').isVisible().catch(() => false)
    const gateToast = await page.locator('.toast').innerText().catch(() => '')
    if (formOpened || !gateToast.includes('升级')) fail.push(`免费层第 2 项应被升级门拦截，toast=${gateToast}`)
    log('免费层第 2 项升级门 OK：', gateToast)

    await page.getByRole('button', { name: /📊 总览/ }).click()
    const total = await page.locator('.total-amount').innerText()
    if (!total.includes('24000.00')) fail.push(`免费态 1 个子女 100% 全年应 24000.00，实际：${total.replace(/\n/g, ' ')}`)
    log('免费态合计：', total.replace(/\n/g, ' '))
    await overflow(page, 'pc-free')
    await ctx.close()
  }

  // —— 专业态（PC）：多项录入 / 校验 / 夫妻方案 / 估算 / 资料 ——
  {
    const { ctx, page } = await newCtx(browser, { width: 1280, height: 860 }, true)
    await gotoTool(page)
    await page.getByRole('button', { name: /📝 扣除项/ }).click()
    await addItem(page, 'childEducation', (p) => p.locator('input[placeholder*="张小明"]').fill('张家大宝'))
    await addItem(page, 'childEducation', async (p) => {
      await p.locator('input[placeholder*="张小明"]').fill('张家二宝')
      await p.locator('.form select').nth(1).selectOption('0.5') // 本人 50%
    })
    await addItem(page, 'mortgageLoan')
    await addItem(page, 'elderlySupport')
    if ((await page.locator('.card-row').count()) !== 4) fail.push('专业态应建出 4 项')

    // 编辑表单截图
    await page.locator('.card-row').first().click()
    await page.waitForSelector('.form')
    await shot(page, 'shot-02-pc-edit-form.png')
    await page.getByRole('button', { name: '← 返回' }).click()

    // 校验：合规填报无风险
    await page.getByRole('button', { name: /✅ 校验/ }).click()
    await page.waitForSelector('.finding')
    let errCnt = await page.locator('.f-error').count()
    if (errCnt !== 0) fail.push(`合规 4 项不应有风险，实际 ${errCnt}`)
    await shot(page, 'shot-03-pc-check-clean.png')

    // 制造房贷+租金互斥
    await page.getByRole('button', { name: /📝 扣除项/ }).click()
    await addItem(page, 'housingRent')
    await page.getByRole('button', { name: /✅ 校验/ }).click()
    await page.waitForSelector('.f-error')
    const codeText = await page.locator('.f-error .code').first().innerText()
    if (!codeText.includes('LOAN_RENT_CONFLICT')) fail.push(`应报房贷租金互斥，实际 ${codeText}`)
    log('互斥校验 OK：', codeText)
    await shot(page, 'shot-04-pc-check-conflict.png')
    // 删除租金恢复合规
    await page.getByRole('button', { name: /📝 扣除项/ }).click()
    const rentRow = page.locator('.card-row', { hasText: '住房租金' })
    await rentRow.click()
    await page.waitForSelector('.form')
    await page.getByRole('button', { name: '删除该扣除项' }).click()
    await page.waitForTimeout(400)
    if ((await page.locator('.card-row').count()) !== 4) fail.push('删除租金后应恢复 4 项')

    // 夫妻方案：按全额重算可分摊合计 = 大宝24000+二宝24000+房贷12000 = 60000
    await page.getByRole('button', { name: /👫 夫妻方案/ }).click()
    await page.waitForSelector('.split-row')
    if ((await page.locator('.split-row').count()) !== 3) fail.push('应有 3 种分摊方案')
    const splitCard = await page.locator('.card').filter({ hasText: '可分摊项家庭年度合计' })
    const splitText = await splitCard.innerText()
    if (!splitText.includes('60000.00')) fail.push(`可分摊家庭合计应 60000.00，实际：${splitText.replace(/\n/g, ' ')}`)
    const halfText = await page.locator('.split-row').nth(1).innerText()
    if (!halfText.includes('30000.00')) fail.push(`各 50% 本人应为 30000.00，实际：${halfText.replace(/\n/g, ' ')}`)
    log('夫妻方案合计 OK')
    await shot(page, 'shot-05-pc-split.png')

    // 估算 + 资料清单：填入扣除前应纳税所得额 200000，制造跨档
    await page.getByRole('button', { name: /🧮 估算/ }).click()
    await page.locator('input[inputmode="decimal"]').first().fill('200000')
    await page.waitForSelector('.result')
    const saved = await page.locator('.result strong').innerText()
    log('估算少缴：', saved)
    // 实际扣除合计 84000：200000 起 20% 档，扣后 116000 进 10% 档，跨档省 14000
    if (!saved.includes('14000.00')) fail.push(`跨档少缴应为 14000.00，实际 ${saved}`)
    if ((await page.locator('.doc-row').count()) !== 3) fail.push('资料清单应 3 类（子女/房贷/赡养）')
    await shot(page, 'shot-06-pc-estimate-docs.png')

    // 总览截图（专业态最终）
    await page.getByRole('button', { name: /📊 总览/ }).click()
    await page.waitForSelector('.total-amount')
    const grand = await page.locator('.total-amount').innerText()
    if (!grand.includes('84000.00')) fail.push(`全年合计应 84000.00，实际 ${grand.replace(/\n/g, ' ')}`)
    await shot(page, 'shot-01-pc-overview.png')

    // 说明页免责
    await page.getByRole('button', { name: /ℹ️ 说明/ }).click()
    await page.waitForSelector('.about')
    const about = await page.locator('.about').innerText()
    if (!about.includes('不代申报') || !about.includes('税务机关')) fail.push('说明页缺少不代申报/税务机关免责')
    await overflow(page, 'pc-pro')
    await ctx.close()
  }

  // —— 手机 / 平板自适应（专业态，录入后看总览） ——
  for (const [label, vp, shotName] of [
    ['mobile', { width: 375, height: 812 }, 'shot-07-mobile-overview.png'],
    ['tablet', { width: 834, height: 1112 }, 'shot-08-tablet-overview.png']
  ]) {
    const { ctx, page } = await newCtx(browser, vp, true)
    await gotoTool(page)
    await page.getByRole('button', { name: /📝 扣除项/ }).click()
    await addItem(page, 'childEducation', (p) => p.locator('input[placeholder*="张小明"]').fill('张家大宝'))
    await addItem(page, 'elderlySupport')
    await page.getByRole('button', { name: /📊 总览/ }).click()
    await page.waitForSelector('.total-amount')
    await shot(page, shotName)
    await overflow(page, label)
    await ctx.close()
  }

  await browser.close()

  if (fail.length) {
    console.error('\n❌ E2E 失败：\n - ' + fail.join('\n - '))
    process.exit(1)
  }
  console.log('\n✅ tax-deduction 三视口 E2E 全部通过，截图 8 张')
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
