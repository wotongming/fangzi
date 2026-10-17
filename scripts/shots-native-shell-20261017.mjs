/** 2026-10-17 移动原生外壳 guide 截图：PC 首页 / 平板全部工具 / 手机首页底部Tab / 手机小游戏沉浸态 */
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
const { chromium } = pw
const ORIGIN = 'http://localhost:4173'
const CHROMIUM = '/usr/local/bin/chromium'
const OUT = '/home/user/Doubao/chats/38447224414701570/pipeline-code/2026-10-17/native-shell/docs/shots'

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
async function shot(vp, url, name, { immersive = false, wait = null } = {}) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 })
  await ctx.route('**/sw.js', (r) => r.abort())
  await ctx.route('**/registerSW.js', (r) => r.abort())
  const page = await ctx.newPage()
  await page.goto(ORIGIN + url, { waitUntil: 'networkidle' })
  if (wait) await page.waitForSelector(wait, { timeout: 10000 })
  if (immersive) {
    await page.click('button:has-text("全屏")')
    await page.waitForTimeout(250)
  }
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/${name}` })
  console.log('shot', name)
  await ctx.close()
}

await shot({ width: 1280, height: 800 }, '/#/', 'pc-home.png')
await shot({ width: 834, height: 1112 }, '/#/browse', 'tablet-browse.png')
await shot({ width: 375, height: 812 }, '/#/', 'mobile-home.png')
await shot({ width: 375, height: 812 }, '/#/t/mini-games', 'mobile-games-immersive.png', {
  immersive: true,
  wait: '.game-tabs'
})
await browser.close()
console.log('done')
