/**
 * 抓取「小游戏合集」真实运行界面截图（构建产物 preview）。
 * 输出到 2026-10-17 编码工作目录 docs/shots，并复制一份到工具 docs/shots。
 */
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
import { mkdirSync, copyFileSync } from 'node:fs'
const { chromium } = pw

const ORIGIN = 'http://localhost:4173'
const OUT = '/home/user/Doubao/chats/38447224414701570/pipeline-code/2026-10-17/web-games/docs/shots'
const REPO_OUT = '/home/user/Doubao/chats/38447224414701570/pipeline-code/2026-10-15/fangzi/src/tools/mini-games/docs/shots'
mkdirSync(OUT, { recursive: true })
mkdirSync(REPO_OUT, { recursive: true })

async function newCtx(browser, viewport) {
  const ctx = await browser.newContext({ viewport })
  await ctx.route('**/sw.js', (r) => r.abort())
  await ctx.route('**/registerSW.js', (r) => r.abort())
  return ctx
}
async function openTool(page) {
  await page.goto(ORIGIN + '/#/t/mini-games', { waitUntil: 'networkidle' })
  await page.waitForSelector('.mg', { timeout: 10000 })
}
async function shot(page, name) {
  await page.waitForTimeout(300)
  await page.locator('.mg').screenshot({ path: `${OUT}/${name}` })
  copyFileSync(`${OUT}/${name}`, `${REPO_OUT}/${name}`)
  console.log('saved', name)
}

const browser = await chromium.launch({
  executablePath: '/usr/local/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage']
})

// PC
let ctx = await newCtx(browser, { width: 1280, height: 900 })
let page = await ctx.newPage()

await openTool(page)
// 走几步让 2048 出现分数
await page.locator('.g2048 .board').click()
for (let i = 0; i < 16; i++) {
  await page.keyboard.press(i % 2 === 0 ? 'ArrowLeft' : 'ArrowUp')
  await page.waitForTimeout(40)
}
await shot(page, 'pc-1-2048.png')

await page.locator('.game-tabs .tab', { hasText: '记忆翻牌' }).click()
await page.waitForSelector('.mem .grid')
await page.locator('.mem .card').nth(0).click()
await page.locator('.mem .card').nth(3).click()
await page.waitForTimeout(300)
await shot(page, 'pc-2-memory.png')
await ctx.close()

// 全新（未购买）上下文：付费墙
ctx = await newCtx(browser, { width: 1280, height: 900 })
page = await ctx.newPage()
await openTool(page)
await page.locator('.game-tabs .tab', { hasText: '数字华容道' }).click()
await page.waitForSelector('.paywall')
await shot(page, 'pc-3-paywall.png')

// 本地模拟下单解锁
await page.locator('.paywall .big').click()
await page.waitForSelector('.kl .board')
await shot(page, 'pc-4-klotski.png')
await page.locator('.game-tabs .tab', { hasText: '三消' }).click()
await page.waitForSelector('.m3 .board')
await shot(page, 'pc-5-match3.png')
await ctx.close()

// 平板
ctx = await newCtx(browser, { width: 834, height: 1112 })
page = await ctx.newPage()
await openTool(page)
await shot(page, 'tablet-1-2048.png')
await ctx.close()

// 手机
ctx = await newCtx(browser, { width: 390, height: 844 })
page = await ctx.newPage()
await openTool(page)
await shot(page, 'mobile-1-2048.png')
await ctx.close()

await browser.close()
console.log('done')
