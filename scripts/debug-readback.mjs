import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
const { chromium } = pw
const browser = await chromium.launch({
  executablePath: '/usr/local/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-webgpu']
})
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
await ctx.route('**/sw.js', (r) => r.abort())
await ctx.route('**/registerSW.js', (r) => r.abort())
const page = await ctx.newPage()
page.on('console', (m) => {
  const t = m.text()
  if (t.includes('gpu-debug') || t.includes('WebGPU') || m.type() === 'error') console.log(`[${m.type()}]`, t.slice(0, 300))
})
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)))
await page.goto('http://localhost:4173/#/t/gpu-data-viz', { waitUntil: 'networkidle' })
await page.waitForTimeout(1000)
await page.getByRole('button', { name: /立即买断/ }).click()
await page.getByRole('button', { name: /载入 100 万点示例/ }).click()
await page.waitForFunction(() => (document.querySelector('.badge-row')?.textContent || '').includes('1.00M'), { timeout: 60000 })
await page.waitForTimeout(800)
// 触发多次缩放/平移，强制持续 present
const box = await page.locator('.canvas-wrap').boundingBox()
for (let i = 0; i < 4; i++) {
  await page.mouse.move(box.x + 400, box.y + 220)
  await page.mouse.wheel(0, -120)
  await page.waitForTimeout(180)
}
await page.mouse.move(box.x + 300, box.y + 200)
await page.mouse.down()
await page.mouse.move(box.x + 380, box.y + 260, { steps: 6 })
await page.mouse.up()
await page.waitForTimeout(1200)
await page.screenshot({ path: '/tmp/app-webgpu-after.png' })
console.log('backend:', (await page.locator('.badge-row').innerText()).replace(/\n/g, ' | '))
await browser.close()
