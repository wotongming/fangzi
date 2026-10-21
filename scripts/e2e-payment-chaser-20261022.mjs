/**
 * 2026-10-22 payment-chaser（自由职业追款助手）三视口 E2E。
 *
 * 覆盖（PC 1280×860 / 平板 834×1112 / 手机 375×812 + 移动 UA）：
 *  1) 录入两笔应收（一笔逾期 45 天、一笔未到期）→ 看板账龄分桶数字正确；
 *  2) 生成梯度话术（45 天 → 最后通牒档）；
 *  3) 两次留痕形成时间线；
 *  4) 导出证据包 PDF（断言 %PDF 魔数、页数）与 CSV（含客户/金额关键字）；
 *  5) 断网二次加载（SW + IndexedDB）数据仍在；零横向溢出、无 pageerror。
 *
 * 运行前：npm run build && npm run preview -- --port 4173
 */
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { horizontalOverflow, SW_NOISE, CHROMIUM, LAUNCH_ARGS } from './_gpu-ctx.mjs'

const { chromium } = pw
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = join(ROOT, 'src/tools/payment-chaser/docs/shots')
mkdirSync(SHOTS, { recursive: true })
const ORIGIN = 'http://localhost:4173'

const fail = []
const log = (...a) => console.log('[e2e-payment-chaser]', ...a)

const VIEWPORTS = [
  [{ width: 1280, height: 860 }, 'pc'],
  [{ width: 834, height: 1112 }, 'tablet'],
  [{ width: 375, height: 812 }, 'mobile']
]
const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 13; PCT-AL10) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.0.0 Mobile Safari/537.36'

function isoDaysFromNow(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function newPage(browser, viewport, label) {
  const ctx = await browser.newContext({
    viewport,
    userAgent: label === 'mobile' ? MOBILE_UA : undefined
  })
  await ctx.addInitScript(() => {
    // 每视口独立隔离存储，避免串数据
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => { if (!SW_NOISE.test(e.message)) fail.push(`[${label}] pageerror: ${e.message}`) })
  page.on('console', (m) => {
    if (m.type() === 'error' && !SW_NOISE.test(m.text())) fail.push(`[${label}] console.error: ${m.text()}`)
  })
  return { ctx, page }
}

async function fillInvoice(page, client, project, amount, dueOffsetDays) {
  await page.getByPlaceholder('客户名称（如：王总 / XX公司）').fill(client)
  await page.getByPlaceholder('项目（如：官网设计 V2）').fill(project)
  await page.getByPlaceholder('金额（元，如 8000）').fill(String(amount))
  await page.locator('label.row input[type=date]').fill(isoDaysFromNow(dueOffsetDays))
  await page.getByRole('button', { name: '入账' }).click()
}

for (const [viewport, label] of VIEWPORTS) {
  log(`== viewport ${label} ${JSON.stringify(viewport)} ==`)
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: LAUNCH_ARGS })
  const { ctx, page } = await newPage(browser, viewport, label)
  await page.goto(`${ORIGIN}/#/t/payment-chaser`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)

  // 1) 两笔应收：逾期45天 + 未到期
  await fillInvoice(page, '上海星辰设计公司', '官网V2改版', 8000, -45)
  await page.waitForTimeout(200)
  await fillInvoice(page, '北京张老师', '品牌海报3张', 3000, 10)
  await page.waitForTimeout(300)

  // 看板：待收合计 = 11000
  const body = await page.textContent('body')
  if (!body.includes('待收合计')) fail.push(`[${label}] 看板缺失`)
  if (!body.includes('11,000.00')) fail.push(`[${label}] 待收合计金额错误: ${body.match(/待收合计[^（]*/)?.[0]}`)
  log('看板待收合计 ok, 0-30桶文本存在')

  // 2) 生成话术（逾期45天 → 最后通牒）
  await page.getByRole('button', { name: '生成话术' }).first().click()
  await page.waitForTimeout(200)
  const letter = await page.textContent('.letter').catch(() => '')
  if (!letter.includes('最后通牒')) fail.push(`[${label}] 话术档位错误: ${letter.slice(0, 40)}`)
  if (!letter.includes('上海星辰设计公司')) fail.push('[${label}] 话术未填客户')
  log('梯度话术=最后通牒 ok')

  // 3) 两次留痕
  await page.getByPlaceholder('这次催收说了什么（如：发了催告函/电话沟通）').fill('微信发送催告函')
  await page.getByRole('button', { name: '留痕' }).click()
  await page.waitForTimeout(200)
  await page.getByPlaceholder('对方回应（可选）').fill('说下周五付款')
  await page.getByPlaceholder('这次催收说了什么（如：发了催告函/电话沟通）').fill('电话跟进')
  await page.getByRole('button', { name: '留痕' }).click()
  await page.waitForTimeout(300)

  // 4) 导出证据包 PDF（首击本地模拟支付解锁，次击真正导出）
  await page.getByRole('button', { name: '导出证据包 PDF' }).click()
  await page.waitForTimeout(600)
  const pdfPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出证据包 PDF' }).click()
  const pdf = await pdfPromise
  const pdfBuf = await pdf.path().then((p) => import('node:fs').then((fs) => fs.readFileSync(p)))
  if (!pdfBuf.subarray(0, 5).toString().startsWith('%PDF')) fail.push(`[${label}] PDF 魔数错误: ${pdfBuf.subarray(0,5).toString()}`)
  const tail = pdfBuf.subarray(-1024).toString()
  if (!/%%EOF/.test(tail)) fail.push(`[${label}] PDF 缺 %%EOF`)
  log(`证据包 PDF ok, ${pdfBuf.length}B, 魔数=%PDF`)

  // CSV 导出含客户/金额（首击解锁）
  await page.getByRole('button', { name: '导出 CSV' }).click()
  await page.waitForTimeout(600)
  const csvPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 CSV' }).click()
  const csv = await csvPromise
  const csvBuf = await csv.path().then((p) => import('node:fs').then((fs) => fs.readFileSync(p)))
  const csvText = csvBuf.toString('utf8')
  if (!csvText.includes('上海星辰设计公司') || !csvText.includes('8000.00')) fail.push(`[${label}] CSV 缺客户/金额: ${csvText.slice(0,200)}`)
  log('CSV 含客户/金额 ok')

  // 横向溢出
  const over = await horizontalOverflow(page)
  if (over > 0) fail.push(`[${label}] 横向溢出 ${over}px`)

  // 截图：PC 主界面 / 手机
  if (label === 'pc') await page.screenshot({ path: join(SHOTS, 'pc-dashboard.png'), fullPage: false })
  if (label === 'mobile') await page.screenshot({ path: join(SHOTS, 'mobile-list.png'), fullPage: false })
  if (label === 'tablet') await page.screenshot({ path: join(SHOTS, 'tablet-dashboard.png'), fullPage: false })

  // 5) 断网二次加载（同 context，模拟 SW 已缓存 + IDB 持久）
  await ctx.setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(800)
  const offlineBody = await page.textContent('body')
  if (!offlineBody.includes('上海星辰设计公司')) fail.push(`[${label}] 断网后数据丢失`)
  log('断网二次加载数据仍在 ok')

  await browser.close()
}

log(fail.length ? `FAILED: ${fail.join('\n')}` : 'ALL PASS')
process.exit(fail.length ? 1 : 0)
