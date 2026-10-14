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
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)))
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[console.${m.type()}]`, m.text().slice(0, 260))
})
await page.goto('http://localhost:4173/#/t/gpu-data-viz', { waitUntil: 'networkidle' })
await page.waitForTimeout(1000)
await page.getByRole('button', { name: /立即买断/ }).click()
await page.getByRole('button', { name: /载入 100 万点示例/ }).click()
await page.waitForFunction(() => (document.querySelector('.badge-row')?.textContent || '').includes('1.00M'), { timeout: 60000 })
await page.waitForTimeout(2000)

async function probe(sel, label) {
  return page.evaluate((s) => {
    const c = document.querySelector(s)
    if (!c) return { label: s, missing: true }
    const url = c.toDataURL('image/png')
    const cv = document.createElement('canvas')
    cv.width = c.width
    cv.height = c.height
    const g = cv.getContext('2d')
    const img = new Image()
    return new Promise((resolve) => {
      img.onload = () => {
        g.drawImage(img, 0, 0)
        const d = g.getImageData(0, 0, cv.width, cv.height).data
        let colored = 0
        let nontransparent = 0
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] > 0) nontransparent++
          if (!(d[i] > 245 && d[i + 1] > 245 && d[i + 2] > 245) && d[i + 3] > 10) colored++
        }
        resolve({ label: s, w: c.width, h: c.height, nontransparent, colored, urlLen: url.length })
      }
      img.src = url
    })
  }, sel).then((r) => ({ ...r, label }))
}

for (const chart of ['散点密度', '热力图']) {
  await page.getByRole('button', { name: chart }).click().catch(() => {})
  await page.waitForTimeout(1500)
  const data = await probe('canvas.data-layer', chart + ':data')
  console.log(JSON.stringify(data))
}
// 折线
await page.getByRole('button', { name: /折线/ }).click()
await page.waitForTimeout(1500)
console.log(JSON.stringify(await probe('canvas.data-layer', '折线:data')))
await browser.close()
