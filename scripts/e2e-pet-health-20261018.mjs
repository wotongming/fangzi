/**
 * 2026-10-18 pet-health 工具多端 E2E（M 档）。
 *  覆盖：空态建档→默认照护待办→记两笔体重+一笔就诊花费→时间线→
 *       专业版体重曲线/费用/病情摘要(含免责)→免费层多宠门→三视口零横向溢出→.ics 导出。
 *  运行前：npm run preview（:4173）。
 */
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const { chromium } = pw
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = join(ROOT, 'src/tools/pet-health/docs/shots')
const ORIGIN = 'http://localhost:4173'
const CHROMIUM = '/usr/local/bin/chromium'
mkdirSync(SHOTS, { recursive: true })

const fail = []
const log = (...a) => console.log('[e2e-pet]', ...a)

function seedPro() {
  const seed = {
    orders: [
      {
        id: 'ord_e2e_pet_pro',
        toolId: 'pet-health',
        kind: 'freemium-pro',
        amountCents: 1290,
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

async function createPet(page, name) {
  await page.getByRole('button', { name: /建立第一只宠物档案|＋ 新增/ }).first().click()
  await page.locator('.modal input[type="text"]').first().fill(name)
  await page.getByRole('button', { name: '保存' }).click()
  await page.waitForSelector('.pet-title', { timeout: 5000 })
}

async function addWeight(page, kg) {
  await page.locator('.seg button', { hasText: '记一笔' }).click()
  await page.locator('.form select').first().selectOption('weight')
  await page.locator('input[type="number"]').first().fill(String(kg))
  await page.getByRole('button', { name: '保存记录' }).click()
  await page.waitForTimeout(400)
}

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-dev-shm-usage'] })

/* —— 专业版全流程（手机 375） —— */
{
  const { ctx, page } = await newCtx(browser, { width: 375, height: 812 }, true)
  await page.goto(`${ORIGIN}/#/t/pet-health`)
  await page.waitForSelector('.empty', { timeout: 15000 })
  log('空态出现 ok')
  await createPet(page, '豆豆')
  await page.waitForSelector('.due-item')
  const dueText = await page.locator('.due-item').first().innerText()
  log('待办：', dueText.replace(/\n/g, ' / ').slice(0, 80))
  await page.screenshot({ path: join(SHOTS, 'shot-01-mobile-board.png') })

  // 两笔体重 + 一笔就诊花费
  await addWeight(page, '4.0')
  await addWeight(page, '4.3')
  await page.locator('.seg button', { hasText: '记一笔' }).click()
  await page.locator('.form select').first().selectOption('visit')
  await page.locator('.form input[placeholder="名称"]').fill('年度体检')
  await page.locator('.form input[placeholder="0.00"]').fill('360')
  await page.getByRole('button', { name: '保存记录' }).click()
  await page.waitForTimeout(400)

  // 时间线
  await page.locator('.seg button', { hasText: '时间线' }).click()
  await page.waitForSelector('.t-item')
  const itemCount = await page.locator('.t-item').count()
  log('时间线条数', itemCount)
  if (itemCount < 3) fail.push('时间线记录数不足')
  await overflow(page, 'mobile-timeline')
  await page.screenshot({ path: join(SHOTS, 'shot-02-mobile-timeline.png'), fullPage: true })

  // 就医助手
  await page.locator('.seg button', { hasText: '就医' }).click()
  await page.waitForSelector('svg.chart', { timeout: 5000 })
  log('体重曲线渲染 ok')
  const costText = await page.locator('.cost-total').innerText()
  log('费用合计：', costText)
  if (!/360/.test(costText)) fail.push('年度花费合计不正确')
  await page.getByRole('button', { name: '生成病情摘要' }).click()
  await page.waitForSelector('.summary-box')
  const summary = await page.locator('.summary-box').inputValue()
  if (!/豆豆/.test(summary) || !/不能替代兽医诊断/.test(summary)) fail.push('病情摘要缺少宠物名或免责声明')
  log('病情摘要含免责 ok')
  await page.getByRole('button', { name: '关闭' }).click()
  await overflow(page, 'mobile-care')
  await page.screenshot({ path: join(SHOTS, 'shot-04-mobile-care.png'), fullPage: true })

  // 我的页 + 溢出
  await page.locator('.seg button', { hasText: '我的' }).click()
  await page.waitForSelector('.plan-item')
  await overflow(page, 'mobile-me')
  // 专业版不应出现升级卡
  const upgradeShown = await page.locator('.upgrade-card').count()
  if (upgradeShown > 0) fail.push('已解锁专业版仍显示升级卡')

  // 导出 .ics（监听下载）
  await page.locator('.seg button', { hasText: '待办' }).click()
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.getByRole('button', { name: '导出到系统日历' }).click()])
  const icsName = dl.suggestedFilename()
  log('导出日历：', icsName)
  if (!/\.ics$/.test(icsName)) fail.push('未导出 .ics 文件')

  await ctx.close()
}

/* —— 免费层：多宠门（手机） —— */
{
  const { ctx, page } = await newCtx(browser, { width: 375, height: 812 }, false)
  await page.goto(`${ORIGIN}/#/t/pet-health`)
  await page.waitForSelector('.empty', { timeout: 15000 })
  await createPet(page, '咪咪')
  await page.getByRole('button', { name: '＋ 新增' }).click()
  await page.waitForTimeout(300)
  const modal = await page.locator('.modal h3').innerText().catch(() => '')
  if (!/专业版/.test(modal)) fail.push('免费层新增第二只宠物未弹专业版门')
  log('免费层多宠门 ok')
  await overflow(page, 'mobile-free')
  await ctx.close()
}

/* —— 平板 / PC 布局溢出（专业版） —— */
for (const [label, vp] of [
  ['tablet', { width: 834, height: 1112 }],
  ['pc', { width: 1280, height: 900 }]
]) {
  const { ctx, page } = await newCtx(browser, vp, true)
  await page.goto(`${ORIGIN}/#/t/pet-health`)
  await page.waitForSelector('.empty', { timeout: 15000 })
  await createPet(page, '布丁')
  await page.waitForSelector('.due-item')
  await overflow(page, `${label}-board`)
  await page.locator('.seg button', { hasText: '记一笔' }).click()
  await page.waitForSelector('.form')
  await overflow(page, `${label}-add`)
  await page.screenshot({ path: join(SHOTS, `shot-03-${label}.png`), fullPage: true })
  await ctx.close()
}

if (fail.length) {
  console.error('\n❌ E2E 失败：\n - ' + fail.join('\n - '))
  process.exit(1)
}
log('\n✅ pet-health 全部 E2E 通过（含三视口零溢出）')
await browser.close()
