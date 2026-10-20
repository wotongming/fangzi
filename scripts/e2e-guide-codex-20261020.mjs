// 指导页 Markdown 安全图片 + 内嵌合成宇宙19天体图鉴：三视口 + SW 离线预缓存 E2E
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
const { chromium } = pw
const CHROMIUM = '/usr/local/bin/chromium'
const BASE = 'http://127.0.0.1:4173'
const SHOT_DIR = 'src/tools/mini-games/docs/shots'
const IMG_SRC = '/guides/merge-planet-codex.png'

const { mkdirSync } = await import('node:fs')
mkdirSync(SHOT_DIR, { recursive: true })

async function shot(page, name) {
  await page.screenshot({ path: `${SHOT_DIR}/${name}`, fullPage: true })
  console.log('shot', name)
}

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const fails = []

async function freshCtx(vp) {
  const ctx = await browser.newContext({ viewport: vp })
  return ctx
}

for (const [label, vp, wantShot] of [
  ['pc', { width: 1280, height: 860 }, true],
  ['tablet', { width: 834, height: 1112 }, false],
  ['mobile', { width: 375, height: 812 }, true]
]) {
  const ctx = await freshCtx(vp)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => fails.push(`${label} pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/serviceWorker|fetching the script|An unknown error occurred when fetching|The service worker/i.test(m.text())) {
      fails.push(`${label} console: ${m.text()}`)
    }
  })

  await page.goto(BASE + '/#/t/mini-games/guide', { waitUntil: 'networkidle' })
  const img = page.locator(`img.md-img[src="${IMG_SRC}"]`)
  if ((await img.count()) !== 1) fails.push(`${label} 指导页缺少图鉴 img.md-img`)
  // lazy 加载：滚动入视口后等待真实解码
  await img.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await page.waitForFunction(
    (src) => {
      const el = document.querySelector(`img.md-img[src="${src}"]`)
      return !!el && el.naturalWidth > 0
    },
    IMG_SRC,
    { timeout: 8000 }
  )

  // 真实加载：naturalWidth>0；图片宽 ≤ 容器，不溢出
  const stats = await img.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { nw: el.naturalWidth, w: r.width, parentW: el.parentElement?.clientWidth ?? 0 }
  })
  console.log(`[${label}] naturalWidth=${stats.nw} imgW=${Math.round(stats.w)} parentW=${stats.parentW}`)
  if (!(stats.nw > 0)) fails.push(`${label} 图鉴未真实加载（naturalWidth=0）`)
  if (stats.w > stats.parentW + 1) fails.push(`${label} 图鉴宽 ${Math.round(stats.w)} 超出容器 ${stats.parentW}`)

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  console.log(`overflow[${label}]=${overflow}`)
  if (overflow > 2) fails.push(`${label} 横向溢出 ${overflow}px`)

  // 图鉴小节文案与三段分组
  const bodyText = await page.locator('body').innerText()
  for (const t of ['合成宇宙 · 19 天体图鉴', '行星 1–10', '恒星一生 11–14', '宇宙结构 15–19']) {
    if (!bodyText.includes(t)) fails.push(`${label} 缺少图鉴文案「${t}」`)
  }

  if (wantShot) await shot(page, label === 'mobile' ? 'guide-codex-mobile.png' : 'guide-codex-pc.png')

  // 离线：SW 预缓存命中，刷新后图片仍能加载
  // 拦截图片网络后刷新：SW 已预缓存则由缓存响应（不走到 abort），验证离线可加载
  await ctx.route('**/guides/merge-planet-codex.png', (r) => r.abort())
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector(`img.md-img[src="${IMG_SRC}"]`, { state: 'attached', timeout: 8000 })
  await page.locator(`img.md-img[src="${IMG_SRC}"]`).evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await page.waitForFunction(
    (src) => {
      const el = document.querySelector(`img.md-img[src="${src}"]`)
      return !!el && el.naturalWidth > 0
    },
    IMG_SRC,
    { timeout: 8000 }
  )
  const offNw = await page.locator(`img.md-img[src="${IMG_SRC}"]`).evaluate((el) => el.naturalWidth)
  console.log(`[${label}] cached naturalWidth=${offNw}`)
  if (!(offNw > 0)) fails.push(`${label} 拦截网络刷新后图鉴未从 SW 预缓存加载`)
  await ctx.close()
}

await browser.close()

if (fails.length) {
  console.error('\n❌ 指导页图鉴 E2E 失败：')
  for (const f of fails) console.error(' -', f)
  process.exit(1)
}
console.log('\n✅ 指导页 Markdown 图鉴三视口 + 离线预缓存 E2E 通过')
