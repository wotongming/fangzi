// E2E：账单订阅盘点与自动续费预警（subscription-audit）
// 三视口（PC/平板/手机）导入脱敏微信+支付宝账单，验证识别、智能标注、决定、解约指引、导出、无横向溢出。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SHOTS = path.join(ROOT, 'src/tools/subscription-audit/docs/shots')
const FIX = '/tmp/fix009'
const ORIGIN = 'http://localhost:4173'
const URL = `${ORIGIN}/#/t/subscription-audit`
const CHROMIUM = '/usr/local/bin/chromium'
const ARGS = ['--no-sandbox', '--disable-dev-shm-usage']
const SW_NOISE = /fetching the script|serviceWorker|unknown error occurred when fetching/i

fs.mkdirSync(SHOTS, { recursive: true })
const fail = []
const log = (...a) => console.log('[e2e009]', ...a)

// 预置“已买断专业版”，覆盖 multi-account / insights / remind-export
async function seedPro() {
  const seed = {
    orders: [
      {
        id: 'ord_e2e_009_pro',
        toolId: 'subscription-audit',
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
  return ctx
}

async function overflow(page, label) {
  const d = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
    sh: document.documentElement.scrollHeight
  }))
  const bad = d.sw - d.cw > 2
  log(`overflow[${label}] scrollW=${d.sw} clientW=${d.cw} -> ${bad ? 'FAIL 横向溢出' : 'ok'}`)
  if (bad) fail.push(`${label} 横向溢出 ${d.sw - d.cw}px`)
}

async function runFlow(browser, vp, label, shotNames) {
  const ctx = await newCtx(browser, vp, true)
  const page = await ctx.newPage()
  page.on('console', (m) => {
    if (m.type() === 'error' && !SW_NOISE.test(m.text())) fail.push(`${label} console.error: ${m.text()}`)
  })
  await page.goto(URL, { waitUntil: 'networkidle' })

  // 导入两份脱敏账单（UTF-8 微信 + GBK 支付宝）
  await page.setInputFiles('input[type=file]', [
    path.join(FIX, 'wechat_bill.csv'),
    path.join(FIX, 'alipay_bill.csv')
  ])
  await page.waitForSelector('.subs li', { timeout: 30000 })
  // 等导入完成的浮层提示消失，避免遮挡截图
  await page.waitForSelector('.toast', { state: 'detached', timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(300)

  // 识别结果：核心月付订阅都应出现
  const body = await page.textContent('body')
  for (const name of ['爱奇艺', '腾讯视频', '优酷', '百度网盘']) {
    if (!body.includes(name)) fail.push(`${label} 未识别出订阅: ${name}`)
  }
  const subCount = await page.locator('.subs li').count()
  log(`[${label}] 识别订阅数=${subCount}`)
  if (subCount < 4) fail.push(`${label} 订阅数不足: ${subCount}`)

  // 一年合计应为正
  const annualTxt = await page.locator('.stat .num').nth(1).textContent()
  const annual = Number(String(annualTxt).replace(/[^\d.]/g, ''))
  log(`[${label}] 一年合计=${annualTxt}`)
  if (!(annual > 0)) fail.push(`${label} 一年合计非正: ${annualTxt}`)

  // 智能标注（专业版）：优酷涨价、视频类同类重复 至少出现
  if (!body.includes('涨价')) fail.push(`${label} 缺少“涨价”标注`)
  if (!body.includes('同类重复')) fail.push(`${label} 缺少“同类重复”标注`)

  if (shotNames[0]) await page.screenshot({ path: path.join(SHOTS, shotNames[0]), fullPage: false })

  // 展开第一个“如何关闭”，验证官方解约步骤与链接
  await page.locator('.subs li').first().locator('button.link', { hasText: '如何关闭' }).click()
  await page.waitForSelector('.subs li .guide ol li', { timeout: 5000 })
  const stepCount = await page.locator('.subs li').first().locator('.guide ol li').count()
  const helpHref = await page.locator('.subs li').first().locator('.guide a').first().getAttribute('href')
  log(`[${label}] 解约指引步骤=${stepCount} 链接=${helpHref}`)
  if (stepCount < 1) fail.push(`${label} 解约指引无步骤`)
  if (!/^https?:\/\//.test(helpHref || '')) fail.push(`${label} 解约官方链接无效: ${helpHref}`)
  if (shotNames[1]) await page.screenshot({ path: path.join(SHOTS, shotNames[1]), fullPage: false })

  // 标注“取消” -> 可省金额更新
  const saveBefore = await page.locator('.stat.save .num').textContent()
  await page.locator('.subs li').first().locator('button', { hasText: '取消' }).first().click()
  await page.waitForTimeout(300)
  const saveAfter = await page.locator('.stat.save .num').textContent()
  log(`[${label}] 标记取消 可省 ${saveBefore} -> ${saveAfter}`)
  if (saveBefore === saveAfter) fail.push(`${label} 标记取消后可省金额未更新`)

  // 导出报告 CSV（下载断言）
  const [dlCsv] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    page.locator('button', { hasText: '导出报告 CSV' }).click()
  ])
  const csvName = dlCsv.suggestedFilename()
  log(`[${label}] CSV 下载=${csvName}`)
  if (!/\.csv$/i.test(csvName)) fail.push(`${label} CSV 下载文件名异常: ${csvName}`)

  // 生成 .ics（下载断言）
  const [dlIcs] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    page.locator('button', { hasText: '生成续费提醒日历' }).click()
  ])
  const icsName = dlIcs.suggestedFilename()
  log(`[${label}] ICS 下载=${icsName}`)
  if (!/\.ics$/i.test(icsName)) fail.push(`${label}] ICS 下载文件名异常: ${icsName}`)
  const icsPath = path.join('/tmp', icsName)
  await dlIcs.saveAs(icsPath)
  const ics = fs.readFileSync(icsPath, 'utf8')
  for (const token of ['BEGIN:VCALENDAR', 'VEVENT', 'RRULE', 'VALARM']) {
    if (!ics.includes(token)) fail.push(`${label} ICS 缺少 ${token}`)
  }

  // 类别结构 & household-finance 互链
  if (!(await page.locator('.cats .cat').count())) fail.push(`${label} 缺少支出结构`)
  const hf = await page.locator('a[href*="household-finance"]').count()
  if (!hf) fail.push(`${label} 缺少 household-finance 互链`)

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(200)
  if (shotNames[2]) await page.screenshot({ path: path.join(SHOTS, shotNames[2]), fullPage: false })
  await overflow(page, label)

  await ctx.close()
}

async function runFreeGate(browser) {
  // 未购买：应出现升级入口，专业标注区不直接可用
  const ctx = await newCtx(browser, { width: 1280, height: 800 }, false)
  const page = await ctx.newPage()
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.setInputFiles('input[type=file]', [path.join(FIX, 'wechat_bill.csv')])
  await page.waitForSelector('.subs li', { timeout: 30000 })
  await page.waitForTimeout(500)
  const upgrade = await page.locator('button', { hasText: '升级专业版' }).count()
  log(`[free] 升级入口=${upgrade}`)
  if (!upgrade) fail.push('免费态未显示升级专业版入口')
  await ctx.close()
}

const browser = await pw.chromium.launch({ executablePath: CHROMIUM, args: ARGS, headless: true })
try {
  await runFlow(browser, { width: 1280, height: 800 }, 'PC', ['pc-1-overview.png', 'pc-2-cancel-guide.png', 'pc-3-export.png'])
  await runFlow(browser, { width: 834, height: 1112 }, '平板', ['tablet-1.png', null, null])
  await runFlow(browser, { width: 375, height: 812 }, '手机', ['mobile-1.png', null, null])
  await runFreeGate(browser)
} finally {
  await browser.close()
}

console.log('\n==== E2E009 RESULT ====')
if (fail.length) {
  console.log('FAIL:')
  for (const f of fail) console.log(' -', f)
  process.exit(1)
}
console.log('ALL PASS')
process.exit(0)
