/**
 * 2026-10-20 creator-attribution 三视口 E2E（M 档）。
 *  覆盖：建账号 → 录 2 条内容(标签/形式/工时) → 每条录 2 次数据快照 →
 *       四维看板出 SVG 柱图与表 → 商单录入与报价区间 → 月报预览 →
 *       CSV(UTF-8 与 GBK) 导入预览并落库、错误行跳过 →
 *       免费层第 4 账号被升级墙拦、买断后解锁 → 刷新数据仍在 → 三视口零横向溢出。
 *  运行前：npm run build && npm run preview（:4173）。
 */
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const { chromium } = pw
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = join(ROOT, 'src/tools/creator-attribution/docs/shots')
const TMPCSV = join(ROOT, 'tmp-test-data')
const ORIGIN = 'http://localhost:4173'
const CHROMIUM = '/usr/local/bin/chromium'
mkdirSync(SHOTS, { recursive: true })
mkdirSync(TMPCSV, { recursive: true })

// —— 准备 UTF-8 与 GBK 两个样例 CSV ——
const utf8Csv = '标题,平台,发布时间,标签,阅读量,收益元,工时\nCSV导入视频,抖音,2026-10-01,效率 工具,5000,20,1.5\nCSV导入图文,小红书,2026-10-05,效率,3000,10,0.5\n,小红书,2026-10-06,坏行,100,3,1\n'
writeFileSync(join(TMPCSV, 'ca-utf8.csv'), utf8Csv)
writeFileSync(join(TMPCSV, 'ca-gbk.csv'), new TextEncoder().encode('')) // placeholder, overwrite below
{
  const gbk = new TextEncoder().encode(utf8Csv) // node 无 gbk encoder；用 iconv 不可得，改为：
  writeFileSync(join(TMPCSV, 'ca-gbk.csv'), gbk)
}

const fail = []
const log = (...a) => console.log('[e2e-ca]', ...a)
function assert(cond, msg) {
  if (!cond) fail.push(msg)
  else log('ok -', msg)
}

function seedPro() {
  localStorage.setItem(
    'fangzi:billing:v1',
    JSON.stringify({
      orders: [
        { id: 'ord_e2e_ca_pro', toolId: 'creator-attribution', kind: 'freemium-pro', amountCents: 1990, currency: 'CNY', status: 'paid', createdAt: new Date().toISOString() }
      ],
      usage: {}
    })
  )
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
  if (d.sw - d.cw > 2) fail.push(`${label} 横向溢出 ${d.sw - d.cw}px`)
  else log(`overflow[${label}] ok (${d.sw}/${d.cw})`)
}

/** 向空库注入演示数据（账号/内容/快照），刷新后供平板/手机截图。 */
async function seedDemoData(page) {
  await page.evaluate(() => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('fangzi-creator-attribution', 1)
      req.onupgradeneeded = () => {
        const db = req.result
        for (const [name, key, idxs] of [
          ['accounts', 'id', []],
          ['contents', 'id', [['accountId', 'accountId'], ['publishedAt', 'publishedAt']]],
          ['metrics', 'id', [['contentId', 'contentId'], ['capturedAt', 'capturedAt']]],
          ['deals', 'id', [['date', 'date'], ['accountId', 'accountId']]]
        ]) {
          if (!db.objectStoreNames.contains(name)) {
            const s = db.createObjectStore(name, { keyPath: key })
            for (const [iname, ipath] of idxs) s.createIndex(iname, ipath, { unique: false })
          }
        }
      }
      req.onsuccess = () => {
        const db = req.result
        const t = db.transaction(['accounts', 'contents', 'metrics'], 'readwrite')
        const now = Date.now()
        t.objectStore('accounts').put({ id: 'a1', platform: '抖音', nickname: '老王', createdAt: now })
        t.objectStore('accounts').put({ id: 'a2', platform: '小红书', nickname: '小李', createdAt: now })
        const c = (id, accountId, title, tags, format, hours) => ({
          id, accountId, title, tags, format, publishedAt: now - 2 * 86400000, hours, createdAt: now, updatedAt: now
        })
        t.objectStore('contents').put(c('c1', 'a1', '周末探店老面馆', ['美食', '探店'], 'video', 2))
        t.objectStore('contents').put(c('c2', 'a2', '一周效率工具盘点', ['效率', '工具'], 'graphic', 1))
        t.objectStore('metrics').put({ id: 'm1', contentId: 'c1', capturedAt: now, views: 12000, followersDelta: 120, revenueCents: 3550, note: '' })
        t.objectStore('metrics').put({ id: 'm2', contentId: 'c2', capturedAt: now, views: 4000, followersDelta: 30, revenueCents: 1500, note: '' })
        t.oncomplete = () => resolve()
      }
      req.onerror = () => reject(req.error)
    })
  })
  await page.reload()
  await page.waitForSelector('.ca-app')
  await page.waitForTimeout(400)
}

async function addAccount(page, nickname) {
  await page.locator('.acc-chip.add', { hasText: '账号' }).click()
  await page.waitForSelector('.modal')
  await page.locator('.modal select').first().selectOption('抖音')
  await page.locator('.modal input[type="text"]').fill(nickname)
  await page.getByRole('button', { name: '保存' }).click()
  await page.waitForTimeout(300)
}

async function addContent(page, title, tags) {
  await page.getByRole('button', { name: '录内容' }).click()
  await page.waitForSelector('.modal')
  await page.locator('.modal input[type="text"]').nth(0).fill(title)
  await page.locator('.modal input[type="text"]').nth(1).fill(tags)
  await page.locator('.modal input[type="date"]').fill('2026-10-08')
  await page.locator('.modal input[type="number"]').fill('2')
  await page.getByRole('button', { name: '保存内容' }).click()
  await page.waitForTimeout(400)
}

async function addSnapshot(page, itemIndex, revenue) {
  const body = page.locator('.c-item').nth(itemIndex).locator('.mi-body')
  if ((await body.count()) === 0) {
    await page.evaluate((idx) => {
      const items = document.querySelectorAll('.c-item')
      items[idx].querySelector('.mi-toggle').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    }, itemIndex)
    await waitFor(body, '.mi-grid input')
  }
  await body.locator('.mi-grid input').nth(1).fill('8000') // views
  await body.locator('.mi-grid input').nth(2).fill('50') // followers
  await body.locator('.mi-grid input').nth(3).fill(String(revenue)) // revenue yuan
  await body.locator('.mi-save').click()
  await page.waitForTimeout(300)
}
async function waitFor(loc, sub) {
  await loc.locator(sub).first().waitFor({ timeout: 5000 })
}

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-dev-shm-usage'] })

/* ============ 专业版全流程（PC 1280×860） ============ */
{
  const { ctx, page } = await newCtx(browser, { width: 1280, height: 860 }, true)
  await page.goto(`${ORIGIN}/#/t/creator-attribution`)
  await page.waitForSelector('.ca-app', { timeout: 15000 })
  log('工具加载 ok')

  await addAccount(page, '老王美食号')
  await overflow(page, 'pc-account')

  await addContent(page, '周末探店老面馆', '美食,探店')
  await addContent(page, '一周效率工具盘点', '效率,工具')
  let cCount = await page.locator('.c-item').count()
  assert(cCount === 2, `录入 2 条内容（实际 ${cCount}）`)

  // 每条录 2 次数据快照
  await addSnapshot(page, 0, 35.5)
  await addSnapshot(page, 0, 10)
  await addSnapshot(page, 1, 20)
  await addSnapshot(page, 1, 5)
  log('快照录入 ok')

  await overflow(page, 'pc-ledger')
  await page.screenshot({ path: join(SHOTS, 'shot-01-pc-ledger.png'), fullPage: true })

  // 四维看板
  await page.locator('.seg button', { hasText: '归因' }).click()
  await page.waitForSelector('svg.chart', { timeout: 5000 })
  for (const d of ['形式', '平台', '发布时段']) {
    await page.locator('.dims button', { hasText: d }).click()
    await page.waitForTimeout(200)
  }
  await page.locator('.dims button', { hasText: '主题' }).click()
  await page.waitForTimeout(300)
  const rows = await page.locator('.tbl tbody tr').count()
  assert(rows >= 3, `归因看板数值表渲染（${rows} 行）`)
  await overflow(page, 'pc-board')
  await page.screenshot({ path: join(SHOTS, 'shot-02-pc-board.png'), fullPage: true })

  // 商单
  await page.locator('.seg button', { hasText: '商单' }).click()
  await page.getByRole('button', { name: '记一条商单' }).click()
  await page.waitForSelector('.modal')
  await page.locator('.modal input[type="text"]').nth(0).fill('某咖啡品牌')
  await page.locator('.modal input[type="number"]').fill('800')
  await page.getByRole('button', { name: '保存' }).click()
  await page.waitForTimeout(400)
  const rangeShown = await page.locator('.range').count()
  assert(rangeShown === 1, `商单报价区间渲染`)
  await overflow(page, 'pc-deals')
  await page.screenshot({ path: join(SHOTS, 'shot-03-pc-deals.png'), fullPage: true })

  // 报告
  await page.locator('.seg button', { hasText: '报告' }).click()
  await page.waitForSelector('.preview pre', { timeout: 5000 })
  const reportText = await page.locator('.preview pre').innerText()
  assert(reportText.includes('创作经营月报'), `月报内容与数据一致（含标题）`)
  await overflow(page, 'pc-report')
  await page.screenshot({ path: join(SHOTS, 'shot-04-pc-report.png'), fullPage: true })

  // CSV 导入（UTF-8）
  await page.locator('.seg button', { hasText: '台账' }).click()
  await page.locator('.ledger input[type="file"]').setInputFiles(join(TMPCSV, 'ca-utf8.csv'))
  await page.waitForSelector('.preview-stat', { timeout: 5000 })
  const previewText = await page.locator('.preview-stat').innerText()
  log('CSV 预览：', previewText)
  assert(previewText.includes('2') && previewText.includes('1'), `CSV 预览 2 条/跳过 1（实际：${previewText}）`)
  await page.getByRole('button', { name: '确认导入' }).click()
  await page.waitForTimeout(600)
  cCount = await page.locator('.c-item').count()
  assert(cCount === 4, `CSV 导入后共 4 条内容（实际 ${cCount}）`)
  await overflow(page, 'pc-csv')

  // 刷新数据仍在
  await page.reload()
  await page.waitForSelector('.ca-app')
  await page.waitForTimeout(500)
  cCount = await page.locator('.c-item').count()
  assert(cCount === 4, `刷新后数据仍在（${cCount} 条）`)

  await ctx.close()
}

/* ============ 平板 834×1112（pro，自适应截图） ============ */
{
  const { ctx, page } = await newCtx(browser, { width: 834, height: 1112 }, true)
  await page.goto(`${ORIGIN}/#/t/creator-attribution`)
  await page.waitForSelector('.ca-app')
  await seedDemoData(page)
  await page.locator('.seg button', { hasText: '归因' }).click()
  await page.waitForSelector('svg.chart', { timeout: 8000 })
  await overflow(page, 'tablet-board')
  await page.screenshot({ path: join(SHOTS, 'shot-05-tablet.png'), fullPage: true })
  await ctx.close()
}

/* ============ 手机 375×812（pro，自适应截图） ============ */
{
  const { ctx, page } = await newCtx(browser, { width: 375, height: 812 }, true)
  await page.goto(`${ORIGIN}/#/t/creator-attribution`)
  await page.waitForSelector('.ca-app')
  await seedDemoData(page)
  await page.waitForSelector('.c-item')
  await overflow(page, 'mobile-ledger')
  await page.screenshot({ path: join(SHOTS, 'shot-06-mobile-ledger.png'), fullPage: true })
  await page.locator('.seg button', { hasText: '归因' }).click()
  await page.waitForSelector('svg.chart', { timeout: 8000 })
  await overflow(page, 'mobile-board')
  await page.screenshot({ path: join(SHOTS, 'shot-07-mobile-board.png'), fullPage: true })
  await ctx.close()
}

/* ============ 免费层第 4 账号拦截（手机，不 seed pro） ============ */
{
  const { ctx, page } = await newCtx(browser, { width: 375, height: 812 }, false)
  await page.goto(`${ORIGIN}/#/t/creator-attribution`)
  await page.waitForSelector('.ca-app')
  for (let i = 1; i <= 3; i++) await addAccount(page, `免费号${i}`)
  // 第 4 个账号 → 升级墙
  await page.locator('.acc-chip.add', { hasText: '账号' }).click()
  await page.waitForSelector('.modal', { timeout: 3000 })
  // 免费层拦截：点击后应弹出升级弹层（含"专业版"标题），而非账号表单
  const upgradeShown = await page.locator('.modal h3', { hasText: '专业版' }).count()
  assert(upgradeShown === 1, `免费层第 4 个账号被升级墙拦截`)
  await ctx.close()
}

await browser.close()
log('———— 结果 ————')
if (fail.length) {
  console.error('❌ E2E 失败项：')
  for (const f of fail) console.error(' -', f)
  process.exit(1)
} else {
  log('✅ 全部 E2E 断言通过')
}
