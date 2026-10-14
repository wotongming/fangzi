import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
const { chromium } = pw

const browser = await chromium.launch({
  executablePath: '/usr/local/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-webgpu']
})
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
// 阻止 SW 注册，确保每次都加载最新构建（E2E 验证不受预缓存干扰）
await ctx.route('**/sw.js', (r) => r.abort())
await ctx.route('**/registerSW.js', (r) => r.abort())
const page = await ctx.newPage()
page.on('console', (m) => console.log('[console]', m.type(), m.text().slice(0, 200)))
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)))

await page.goto('http://localhost:4173/#/t/gpu-data-viz', { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
const chunk = await page.evaluate(() =>
  performance
    .getEntriesByType('resource')
    .map((e) => e.name)
    .filter((n) => n.includes('gpu-data-viz') || n.includes('webgpu-'))
)
console.log('loaded chunks:', chunk)
console.log('backend badge:', (await page.locator('.badge-row .badge').allInnerTexts()).join(' | '))
await page.getByRole('button', { name: /立即买断/ }).click()
await page.getByRole('button', { name: /载入 100 万点示例/ }).click()
await page.waitForFunction(() => (document.querySelector('.badge-row')?.textContent || '').includes('1.00M'), { timeout: 60000 })
await page.waitForTimeout(1500)
console.log('after load:', (await page.locator('.badge-row').innerText()).replace(/\n/g, ' | '))

const btnCount = await page.getByRole('button', { name: /框选/ }).count()
console.log('框选-like buttons:', btnCount)
await page.getByRole('button', { name: '框选' }).click().catch((e) => console.log('click fail', e.message))
await page.waitForTimeout(200)
const active = await page.evaluate(() => [...document.querySelectorAll('.bar-left button')].find((b) => b.className.includes('active'))?.textContent)
console.log('active mode btn:', active)

const box = await page.locator('.canvas-wrap').boundingBox()
console.log('wrap box:', JSON.stringify(box))
await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.3)
await page.mouse.down()
for (let i = 1; i <= 8; i++) {
  await page.mouse.move(box.x + box.width * (0.25 + (0.5 * i) / 8), box.y + box.height * (0.3 + (0.4 * i) / 8))
}
await page.mouse.up()
await page.waitForTimeout(800)
console.log('brush-card count:', await page.locator('.brush-card').count())
console.log('brush-card text:', await page.locator('.brush-card').innerText().catch(() => '(none)'))
await page.screenshot({ path: '/tmp/debug-brush.png', fullPage: true })
await browser.close()
