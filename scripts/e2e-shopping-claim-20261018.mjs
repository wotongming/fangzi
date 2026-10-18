/**
 * 2026-10-18 shopping-claim 多端 E2E（M 档）。
 *  覆盖：空态建案→时效窗口数值→上传真实图片证据(连续编号/压缩)→
 *       生成 12315 文本(含免责)→证据包 ZIP 下载→进度推进→规则来源/免责→
 *       免费层多案件门→三视口零横向溢出。
 *  运行前：npm run preview（:4173）。
 */
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const { chromium } = pw
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = join(ROOT, 'src/tools/shopping-claim/docs/shots')
const ORIGIN = 'http://localhost:4173'
const CHROMIUM = '/usr/local/bin/chromium'
mkdirSync(SHOTS, { recursive: true })

const fail = []
const log = (...a) => console.log('[e2e-claim]', ...a)

function seedPro() {
  const seed = {
    orders: [
      {
        id: 'ord_e2e_claim_pro',
        toolId: 'shopping-claim',
        kind: 'freemium-pro',
        amountCents: 990,
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

async function makeImageBuffer(browser) {
  const p = await browser.newPage()
  const b64 = await p.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 800
    c.height = 600
    const g = c.getContext('2d')
    g.fillStyle = '#eaf5ee'
    g.fillRect(0, 0, 800, 600)
    g.fillStyle = '#23613f'
    g.font = '48px sans-serif'
    g.fillText('EVIDENCE 订单凭证', 60, 300)
    return c.toDataURL('image/png').split(',')[1]
  })
  await p.close()
  return Buffer.from(b64, 'base64')
}

async function createCase(page) {
  await page.getByRole('button', { name: '＋ 新建维权案件' }).click()
  await page.locator('.form input[placeholder*="变频空调"]').fill('测试变频空调')
  await page.locator('.form input[placeholder*="某平台"]').fill('某平台官方旗舰店')
  await page.locator('.form input[placeholder*="订单号"]').fill('SO20261001001')
  await page.locator('.form input[placeholder="0.00"]').first().fill('2999')
  await page.locator('.form select').first().selectOption('appliance')
  await page.locator('.form input[type="date"]').nth(0).fill('2026-10-01')
  await page.locator('.form input[type="date"]').nth(1).fill('2026-10-04')
  await page.getByRole('button', { name: '保存案件' }).click()
  await page.waitForSelector('.case-card', { timeout: 5000 })
  await page.locator('.case-card').first().click()
  await page.waitForSelector('.win', { timeout: 5000 })
}

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const imgBuf = await makeImageBuffer(browser)

/* —— 专业版全流程（手机 375，重点） —— */
{
  const { ctx, page } = await newCtx(browser, { width: 375, height: 812 }, true)
  await page.goto(`${ORIGIN}/#/t/shopping-claim`)
  await page.waitForSelector('.empty', { timeout: 15000 })
  log('空态出现 ok')
  await createCase(page)

  // 时效窗口：签收 10-01，今天 10-18 → 无理由/15日已过、保修开放、价保开放
  const winsText = await page.locator('.win').allInnerTexts()
  const joined = winsText.join('\n')
  log('时效窗口：', joined.replace(/\s+/g, ' ').slice(0, 220))
  if (!/7 天无理由退货[\s\S]*已过/.test(joined)) fail.push('无理由窗口应为已过期')
  if (!/15 日内换货[\s\S]*已过/.test(joined)) fail.push('15 日换货窗口应为已过期')
  if (!/保修期[\s\S]*剩/.test(joined)) fail.push('保修窗口应为进行中')
  if (!/价保[\s\S]*剩/.test(joined)) fail.push('价保窗口应为进行中')
  if (!/消费者权益保护法/.test(joined)) fail.push('窗口缺少法规依据')
  await overflow(page, 'mobile-deadline')
  await page.screenshot({ path: join(SHOTS, 'shot-01-mobile-deadline.png'), fullPage: true })

  // 证据：上传真实图片
  await page.locator('.seg button', { hasText: '证据' }).click()
  await page.locator('.kind-btn', { hasText: '订单截图' }).click()
  await page.locator('input[placeholder*="开箱视频"]').fill('E2E 备注：订单页')
  await page.locator('.file-pick input[type="file"]').setInputFiles({ name: 'order.png', mimeType: 'image/png', buffer: imgBuf })
  await page.waitForSelector('.ev-item', { timeout: 8000 })
  await page.waitForTimeout(600)
  const evMeta = await page.locator('.ev-item .ev-meta').first().innerText()
  log('证据元信息：', evMeta.replace(/\n/g, ' / ').slice(0, 140))
  if (!/#01 订单截图/.test(evMeta)) fail.push('证据未正确编号/分类')
  if (!/01_order_/.test(evMeta)) fail.push('证据文件名不符合 序号_类型_时间戳')
  if (!/800×600|600×800/.test(evMeta)) fail.push('证据缺少尺寸信息')
  await overflow(page, 'mobile-evidence')
  await page.screenshot({ path: join(SHOTS, 'shot-02-mobile-evidence.png'), fullPage: true })

  // 文书：12315 质量问题
  await page.locator('.seg button', { hasText: '文书' }).click()
  await page.locator('.kind-btn', { hasText: '12315' }).click()
  await page.getByRole('button', { name: '生成文本' }).click()
  await page.waitForSelector('.letter-box', { timeout: 5000 })
  const letter = await page.locator('.letter-box').inputValue()
  if (!/测试变频空调/.test(letter) || !/SO20261001001/.test(letter)) fail.push('12315 文本缺商品/订单')
  if (!/12315|市场监管/.test(letter)) fail.push('12315 文本缺少投诉对象')
  if (!/不构成法律意见|自述草稿/.test(letter)) fail.push('12315 文本缺少免责声明')
  if (/\{\{[^}]+\}\}/.test(letter)) fail.push('12315 文本残留占位符')
  log('12315 文本含商品/订单/免责 ok')
  await overflow(page, 'mobile-letters')
  await page.screenshot({ path: join(SHOTS, 'shot-03-mobile-letters.png'), fullPage: true })

  // 证据包 + 当前文书 ZIP 下载
  await page.locator('.seg button', { hasText: '证据' }).click()
  await page.waitForSelector('.ev-item')
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }),
    page.getByRole('button', { name: '证据包 + 当前文书' }).click()
  ])
  const zipName = dl.suggestedFilename()
  log('证据包：', zipName)
  if (!/\.zip$/.test(zipName)) fail.push('未导出 ZIP 证据包')

  // 进度推进
  await page.locator('.seg button', { hasText: '进度' }).click()
  await page.waitForSelector('.steps')
  await page.getByRole('button', { name: /推进到下一步/ }).click()
  await page.waitForTimeout(300)
  const nowStep = await page.locator('.steps li.now').innerText()
  log('当前阶段：', nowStep)
  if (!/与商家协商/.test(nowStep)) fail.push('状态未推进到协商')
  await overflow(page, 'mobile-progress')
  await page.screenshot({ path: join(SHOTS, 'shot-04-mobile-progress.png'), fullPage: true })

  // 规则速查含来源与免责
  await page.locator('.seg button', { hasText: '规则' }).click()
  await page.waitForSelector('.rule-list')
  const rulesText = await page.locator('.rules-page').innerText()
  if (!/拆封/.test(rulesText)) fail.push('规则页缺少拆封≠不完好说明')
  if (!/不替代律师|12315/.test(rulesText)) fail.push('规则页缺少免责声明')
  log('规则页含来源/例外/免责 ok')

  await ctx.close()
}

/* —— 免费层：多案件门（手机） —— */
{
  const { ctx, page } = await newCtx(browser, { width: 375, height: 812 }, false)
  await page.goto(`${ORIGIN}/#/t/shopping-claim`)
  await page.waitForSelector('.empty', { timeout: 15000 })
  await page.getByRole('button', { name: '＋ 新建维权案件' }).click()
  await page.locator('.form input[placeholder*="变频空调"]').fill('免费案件一')
  await page.locator('.form input[type="date"]').nth(0).fill('2026-10-10')
  await page.getByRole('button', { name: '保存案件' }).click()
  await page.waitForSelector('.case-card')
  // 第二个
  await page.getByRole('button', { name: '＋ 新建维权案件' }).click()
  await page.locator('.form input[placeholder*="变频空调"]').fill('免费案件二')
  await page.locator('.form input[type="date"]').nth(0).fill('2026-10-11')
  await page.getByRole('button', { name: '保存案件' }).click()
  await page.waitForTimeout(400)
  // 第三个应被拦
  await page.getByRole('button', { name: '＋ 新建维权案件' }).click()
  await page.waitForTimeout(300)
  const toast = await page.locator('.toast').innerText().catch(() => '')
  const formOpened = await page.locator('.form input[placeholder*="变频空调"]').count()
  log('免费门 toast：', toast, '| 表单打开数:', formOpened)
  if (!/专业版/.test(toast)) fail.push('免费层第三案件未提示升级专业版')
  await overflow(page, 'mobile-free')
  await ctx.close()
}

/* —— 平板 / PC 布局（专业版） —— */
for (const [label, vp] of [
  ['tablet', { width: 834, height: 1112 }],
  ['pc', { width: 1280, height: 900 }]
]) {
  const { ctx, page } = await newCtx(browser, vp, true)
  await page.goto(`${ORIGIN}/#/t/shopping-claim`)
  await page.waitForSelector('.empty', { timeout: 15000 })
  await createCase(page)
  await overflow(page, `${label}-deadline`)
  await page.locator('.seg button', { hasText: '证据' }).click()
  await page.locator('.file-pick input[type="file"]').setInputFiles({ name: 'order.png', mimeType: 'image/png', buffer: imgBuf })
  await page.waitForSelector('.ev-item', { timeout: 8000 })
  await overflow(page, `${label}-evidence`)
  await page.screenshot({ path: join(SHOTS, `shot-05-${label}.png`), fullPage: true })
  await ctx.close()
}

if (fail.length) {
  console.error('\n❌ E2E 失败：\n - ' + fail.join('\n - '))
  process.exit(1)
}
log('\n✅ shopping-claim 全部 E2E 通过（含三视口零溢出、证据上传、ZIP、状态机、免费门）')
await browser.close()
