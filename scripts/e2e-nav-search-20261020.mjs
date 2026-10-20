// 导航更名 + 独立搜索页 + 我的方子仅收藏 + 下拉唤起搜索：三视口 E2E
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
const { chromium } = pw
const CHROMIUM = '/usr/local/bin/chromium'
const BASE = 'http://127.0.0.1:4173'
const SHOT_DIR = 'docs/shots'
const FAV = ['mini-games', 'image-converter', 'local-transcribe', 'json-formatter', 'password-generator']

const { mkdirSync } = await import('node:fs')
mkdirSync(SHOT_DIR, { recursive: true })

async function shot(page, name) {
  await page.screenshot({ path: `${SHOT_DIR}/${name}`, fullPage: true })
  console.log('shot', name)
}
async function overflow(page) {
  return await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
}

// 合成一段触摸手势并派发到底部首页容器；dy 向下为正
async function dispatchPull(page, dy, dx = 0) {
  await page.evaluate(({ dy, dx }) => {
    const host = document.querySelector('.home')
    if (!host) return
    const mk = (y, x) => new Touch({ identifier: 1, target: host, clientY: y, clientX: x })
    const startY = 200
    const fire = (type, t) => host.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], cancelable: true, bubbles: true }))
    fire('touchstart', mk(startY, 0))
    fire('touchmove', mk(startY + dy, dx))
    fire('touchend', mk(startY + dy, dx))
  }, { dy, dx })
}

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const fails = []

async function freshCtx(vp, fav) {
  const ctx = await browser.newContext({ viewport: vp })
  await ctx.route('**/sw.js', (r) => r.abort())
  await ctx.route('**/registerSW.js', (r) => r.abort())
  await ctx.addInitScript((fav) => {
    try { localStorage.setItem('fangzi:favorites:v1', JSON.stringify(fav)) } catch {}
    try { localStorage.setItem('fz-manual-seen', '1') } catch {}
  }, fav)
  return ctx
}

// ---------- 三视口：导航文案/SVG/首页仅收藏/无搜索区 ----------
for (const [label, vp] of [
  ['pc', { width: 1280, height: 860 }],
  ['tablet', { width: 834, height: 1112 }],
  ['mobile', { width: 375, height: 812 }]
]) {
  const ctx = await freshCtx(vp, FAV)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => fails.push(`${label} pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !/serviceWorker|fetching the script|An unknown error occurred when fetching/i.test(m.text())) fails.push(`${label} console: ${m.text()}`) })
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForSelector('.search-entry', { timeout: 8000 })

  // 底部/顶部导航文案
  const bodyText = await page.locator('body').innerText()
  for (const t of ['我的方子', '方子铺', '开方指南', '设置']) {
    if (!bodyText.includes(t)) fails.push(`${label} 缺少导航名「${t}」`)
  }
  for (const old of ['全部工具', '使用帮助']) {
    if (bodyText.includes(old)) fails.push(`${label} 残留旧导航名「${old}」`)
  }
  // 内联 SVG 图标（底部 tab 4 个），旧 emoji 不再出现
  const svgCount = await page.locator('.tabbar svg.tab-ico').count()
  if (label === 'mobile' && svgCount !== 4) fails.push(`${label} 底部内联SVG=${svgCount} != 4`)
  for (const emo of ['🏠', '🧰', '📖', '⚙️']) {
    if (bodyText.includes(emo)) fails.push(`${label} 残留旧 emoji ${emo}`)
  }

  // 首页不得有搜索区/最新工具/新手引导
  for (const sel of ['.hero', '.search-unit', '.manual-hint', '.results']) {
    if (await page.locator(sel).count() !== 0) fails.push(`${label} 首页仍渲染 ${sel}`)
  }
  if (await page.locator('.block').last().locator('h2', { hasText: '最新工具' }).count() !== 0) {
    fails.push(`${label} 首页仍有「最新工具」推荐块`)
  }
  // 收藏胶囊存在、数量正确
  const favCount = await page.locator('.fav-chip').count()
  if (favCount !== FAV.length) fails.push(`${label} 收藏胶囊 ${favCount} != ${FAV.length}`)

  const d = await overflow(page)
  console.log(`overflow[${label}]=${d} favChips=${favCount} svg=${svgCount}`)
  if (d > 2) fails.push(`${label} 横向溢出 ${d}px`)

  if (label === 'pc') await shot(page, 'nav-home-pc.png')
  if (label === 'mobile') await shot(page, 'nav-home-mobile.png')
  await ctx.close()
}

// ---------- 空收藏态 + 去方子铺 ----------
{
  const ctx = await freshCtx({ width: 375, height: 812 }, [])
  const page = await ctx.newPage()
  page.on('pageerror', (e) => fails.push(`empty pageerror: ${e.message}`))
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForSelector('.empty-state', { timeout: 8000 })
  const cta = page.locator('.es-cta', { hasText: '去方子铺逛逛' })
  if (await cta.count() !== 1) fails.push('空态缺少「去方子铺逛逛」入口')
  await shot(page, 'nav-empty-mobile.png')
  await cta.click()
  await page.waitForURL('**/#/browse', { timeout: 8000 })
  const h1 = await page.locator('h1').innerText()
  if (h1.trim() !== '方子铺') fails.push(`方子铺标题=${h1}`)
  await shot(page, 'nav-browse.png')
  const d = await overflow(page)
  if (d > 2) fails.push(`方子铺横向溢出 ${d}px`)
  await ctx.close()
}

// ---------- PC 紧凑入口 → /search 完成一次搜索 ----------
{
  const ctx = await freshCtx({ width: 1280, height: 860 }, FAV)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => fails.push(`search-pc pageerror: ${e.message}`))
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.locator('.search-entry').click()
  await page.waitForURL('**/#/search', { timeout: 8000 })
  await page.waitForSelector('.search-unit', { timeout: 8000 })
  // 点一条「大家都在问」保证命中
  await page.locator('.chip').first().click()
  await page.waitForSelector('.grid .tool-card', { timeout: 10000 })
  const hitN = await page.locator('.grid .tool-card').count()
  if (hitN === 0) fails.push('PC 搜索无结果卡')
  await shot(page, 'nav-search-pc.png')
  // 点结果进工具页
  await page.locator('.grid .tool-card').first().click()
  await page.waitForTimeout(600)
  if (!page.url().includes('/t/')) fails.push('搜索结果点击未进入工具页')
  // 返回搜索页
  await page.locator('.back-btn').first().click().catch(() => {})
  await ctx.close()
}

// ---------- 手机：下拉 <1/4 回弹、≥1/4 进 /search、水平不误触 ----------
{
  const ctx = await freshCtx({ width: 375, height: 812 }, FAV)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => fails.push(`pull pageerror: ${e.message}`))
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForSelector('.search-entry', { timeout: 8000 })
  const vh = await page.evaluate(() => window.innerHeight)

  // 未达标（0.20*vh）回弹，URL 不变
  await dispatchPull(page, vh * 0.20, 0)
  await page.waitForTimeout(350)
  if (page.url().includes('/search')) fails.push('下拉 0.20*vh 误进 /search')

  // 水平滑动（dy 小、dx 大）不触发
  await dispatchPull(page, 10, 90)
  await page.waitForTimeout(250)
  if (page.url().includes('/search')) fails.push('水平滑动误进 /search')

  // 达标（0.30*vh）进 /search
  await dispatchPull(page, vh * 0.30, 0)
  await page.waitForURL('**/#/search', { timeout: 8000 })
  await page.waitForSelector('.search-unit', { timeout: 8000 })
  await shot(page, 'nav-search-mobile.png')

  // 搜索框输入查询出结果
  await page.locator('.search-input').fill('压缩图片')
  await page.locator('.prescribe').click()
  await page.waitForSelector('.grid .tool-card', { timeout: 10000 })
  const d = await overflow(page)
  if (d > 2) fails.push(`搜索页横向溢出 ${d}px`)
  await ctx.close()
}

if (fails.length) {
  console.error('FAILS:\n' + fails.join('\n'))
  process.exit(1)
}
console.log('✅ 导航更名/搜索页/收藏页/下拉唤起三视口 E2E 通过')
await browser.close()
