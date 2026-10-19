// 临时：首页改版（收藏紧凑 + 搜索/大家都在问整体）三视口截图与零溢出
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
const { chromium } = pw
const CHROMIUM = '/usr/local/bin/chromium'
const BASE = 'http://127.0.0.1:4173'
const FAV = ['mini-games', 'image-converter', 'local-transcribe', 'json-formatter', 'password-generator']

const SHOT_DIR = '/tmp/home-shots'
const { mkdirSync } = await import('node:fs')
mkdirSync(SHOT_DIR, { recursive: true })
async function shot(page, name) {
  await page.screenshot({ path: `${SHOT_DIR}/${name}`, fullPage: true })
  console.log('shot', name)
}
async function overflow(page) {
  return await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
}

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const fails = []
for (const [label, vp] of [
  ['pc', { width: 1280, height: 800 }],
  ['tablet', { width: 834, height: 1112 }],
  ['mobile', { width: 375, height: 812 }]
]) {
  const ctx = await browser.newContext({ viewport: vp })
  await ctx.route('**/sw.js', (r) => r.abort())
  await ctx.route('**/registerSW.js', (r) => r.abort())
  await ctx.addInitScript((fav) => {
    try { localStorage.setItem('fangzi:favorites:v1', JSON.stringify(fav)) } catch {}
    try { localStorage.setItem('fz-manual-seen', '1') } catch {}
  }, FAV)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => fails.push(`${label} pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !/serviceWorker|fetching the script|An unknown error occurred when fetching/i.test(m.text())) fails.push(`${label} console: ${m.text()}`) })
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForSelector('.search-unit', { timeout: 8000 })
  // 收藏紧凑链接存在且不含描述大卡
  const favCount = await page.locator('.fav-chip').count()
  if (favCount !== FAV.length) fails.push(`${label} 收藏胶囊数 ${favCount} != ${FAV.length}`)
  // 大家都在问在 search-unit 内部
  const inside = await page.locator('.search-unit .ask-title', { hasText: '大家都在问' }).count()
  if (inside !== 1) fails.push(`${label} 大家都在问未与搜索框合并`)
  // 收藏区不应再渲染 ToolCard（.tool-card）
  const tcInFav = await page.locator('.fav-block .tool-card').count()
  if (tcInFav !== 0) fails.push(`${label} 收藏区仍有完整工具卡 ${tcInFav}`)
  const d = await overflow(page)
  console.log(`overflow[${label}] =`, d, 'favChips=', favCount)
  if (d > 2) fails.push(`${label} 横向溢出 ${d}px`)
  await shot(page, `shot-home-${label}.png`)
  // 点一个收藏胶囊能跳转
  await page.locator('.fav-link', { hasText: '小游戏合集' }).first().click().catch(() => {})
  await page.waitForTimeout(300)
  if (!page.url().includes('/t/mini-games')) fails.push(`${label} 收藏链接跳转失败 url=${page.url()}`)
  await ctx.close()
}
if (fails.length) { console.error('FAILS:\n' + fails.join('\n')); process.exit(1) }
console.log('✅ 首页改版三视口检查通过')
await browser.close()
