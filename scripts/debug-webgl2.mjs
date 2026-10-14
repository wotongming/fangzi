import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
const { chromium } = pw
const browser = await chromium.launch({
  executablePath: '/usr/local/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage']
})
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
// 模拟不支持 WebGPU 的浏览器，强制走 WebGL2 降级路径
await ctx.addInitScript(() => {
  try {
    Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined, configurable: true })
  } catch {}
})
await ctx.route('**/sw.js', (r) => r.abort())
await ctx.route('**/registerSW.js', (r) => r.abort())
const page = await ctx.newPage()
page.on('console', (m) => m.type() === 'error' && console.log('[err]', m.text().slice(0, 160)))
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 160)))
await page.goto('http://localhost:4173/#/t/gpu-data-viz', { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
console.log('backend:', (await page.locator('.badge-row .badge').first().innerText()))
await page.getByRole('button', { name: /立即买断/ }).click()
await page.getByRole('button', { name: /载入 100 万点示例/ }).click()
await page.waitForFunction(() => (document.querySelector('.badge-row')?.textContent || '').includes('1.00M'), { timeout: 60000 })
await page.waitForTimeout(2000)
console.log('after load:', (await page.locator('.badge-row').innerText()).replace(/\n/g, ' | '))
await page.screenshot({ path: '/tmp/webgl2-scatter.png', fullPage: false })
await page.getByRole('button', { name: '热力图' }).click()
await page.waitForTimeout(1000)
await page.screenshot({ path: '/tmp/webgl2-heatmap.png', fullPage: false })
await page.getByRole('button', { name: /折线/ }).click()
await page.waitForTimeout(1000)
await page.screenshot({ path: '/tmp/webgl2-line.png', fullPage: false })
console.log('shots saved')
await browser.close()
