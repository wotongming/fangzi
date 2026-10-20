/**
 * 2026-10-20 用户指导页（根 guide.md）E2E。
 *  遍历 10 个本次补全的工具 + 抽查 3 个已合格工具，在 PC(1280×860) 与手机(375×812) 两视口：
 *   - 打开 /#/t/<id>/guide，正文容器 .markdown-body 非空、含「快速开始」「免费与专业版」、正文 ≥800 字符；
 *   - 容器内无 <img>、无裂图；正文不含「如下图/见图/见截图/如图所示」悬空指图措辞；
 *   - 零横向溢出（scrollWidth ≤ clientWidth + 1px）、无 pageerror / console error。
 *  只验证 markdown 指导页（纯文本渲染），不进入 GPU/相机运行态，常规 Playwright 即可。
 *  运行前：npm run build && npm run preview（:4173）。
 */
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'

const { chromium } = pw
const ORIGIN = 'http://localhost:4173'
const CHROMIUM = '/usr/local/bin/chromium'

// 本次补全 / 改写的 10 个工具
const TARGETS = [
  'creator-attribution',
  'exam-review-scheduler',
  'home-vault',
  'embed-widget-builder',
  'gpu-data-viz',
  'local-knowledge-base',
  'local-transcribe',
  'pose-fitness-coach',
  'resume-jd-matcher',
  'wc-workbench'
]
// 抽查：已合格、本次未改动的工具，证明未受影响
const SPOTCHECK = ['home-medicine', 'pet-health', 'subscription-audit']

const VIEWPORTS = [
  { name: 'PC', width: 1280, height: 860 },
  { name: 'mobile', width: 375, height: 812 }
]

const DANGLING = /如下图|见图|见截图|如图所示/

const fail = []
const log = (...a) => console.log('[e2e-guides]', ...a)
function assert(cond, msg) {
  if (!cond) fail.push(msg)
  else log('ok -', msg)
}

// 本测试主动 abort sw.js / registerSW.js 以隔离 Service Worker，浏览器随后的 SW 注册
// 失败会打印 "An unknown error occurred when fetching the script."，属测试夹具噪声而非页面缺陷，过滤之；
// 其余 console.error 与全部 pageerror 仍记为失败。
const SW_FETCH_NOISE = /unknown error occurred when fetching the script/i

async function newCtx(browser, viewport) {
  const ctx = await browser.newContext({ viewport })
  await ctx.route('**/sw.js', (r) => r.abort())
  await ctx.route('**/registerSW.js', (r) => r.abort())
  const page = await ctx.newPage()
  page.on('pageerror', (e) => fail.push(`pageerror[${viewport.name}] ${e.message}`))
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !SW_FETCH_NOISE.test(msg.text())) {
      fail.push(`console.error[${viewport.name}] ${msg.text()}`)
    }
  })
  return { ctx, page }
}

async function checkGuide(page, viewport, id, strictSections) {
  await page.goto(`${ORIGIN}/#/t/${id}/guide`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.markdown-body', { timeout: 15000 })

  const body = page.locator('.markdown-body')
  const text = (await body.innerText()).trim()
  const label = `[${viewport.name}] ${id}`

  assert(text.length > 0, `${label} 正文非空`)
  if (strictSections) {
    assert(text.includes('快速开始'), `${label} 含「快速开始」`)
    assert(text.includes('免费与专业版'), `${label} 含「免费与专业版」`)
  }
  assert(text.length >= 800, `${label} 正文长度达标（${text.length} ≥ 800）`)

  const imgCount = await body.locator('img').count()
  assert(imgCount === 0, `${label} 容器内无 <img>（实际 ${imgCount}）`)
  const broken = await body.locator('img[src]').evaluateAll((els) => els.filter((e) => e.naturalWidth === 0).length)
  assert(broken === 0, `${label} 无裂图（${broken}）`)
  assert(!DANGLING.test(text), `${label} 无悬空指图措辞`)

  // 零横向溢出（容差 1px）
  const d = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth
  }))
  if (d.sw - d.cw > 1) fail.push(`${label} 横向溢出 ${d.sw - d.cw}px（${d.sw}/${d.cw}）`)
  else log(`overflow[${label}] ok (${d.sw}/${d.cw})`)
}

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-dev-shm-usage'] })

for (const viewport of VIEWPORTS) {
  // 本次 10 个目标（严格校验必备小节）
  for (const id of TARGETS) {
    const { ctx, page } = await newCtx(browser, viewport)
    await checkGuide(page, viewport, id, true)
    await ctx.close()
  }
  // 抽查已合格工具（只校验非空 / 无图 / 无溢出 / 无报错，不强制小节标题）
  for (const id of SPOTCHECK) {
    const { ctx, page } = await newCtx(browser, viewport)
    await checkGuide(page, viewport, id, false)
    await ctx.close()
  }
}

await browser.close()

if (fail.length) {
  console.error('\n❌ 用户指导页 E2E 失败：\n - ' + fail.join('\n - '))
  process.exit(1)
}
log(`\n✅ 全部指导页通过：${TARGETS.length} 个目标 + ${SPOTCHECK.length} 个抽查，PC/手机两视口零溢出、无图、无悬空措辞、无报错`)
