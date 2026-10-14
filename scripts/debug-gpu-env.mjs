import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
const { chromium } = pw
const browser = await chromium.launch({
  executablePath: '/usr/local/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-webgpu']
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)))
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' })
const r = await page.evaluate(async () => {
  const out = { gpu: 'gpu' in navigator, ua: navigator.userAgent }
  if (navigator.gpu) {
    const t0 = performance.now()
    const a = await Promise.race([
      navigator.gpu.requestAdapter().then(
        (x) => ({ v: x ? 'adapter' : 'null', ms: performance.now() - t0 }),
        (e) => ({ v: 'reject:' + e.message, ms: performance.now() - t0 })
      ),
      new Promise((res) => setTimeout(() => res({ v: 'TIMEOUT', ms: performance.now() - t0 }), 5000))
    ])
    out.adapter = a
  }
  const c = document.createElement('canvas')
  out.gl2 = Boolean(c.getContext('webgl2'))
  const dbg = c.getContext('webgl2')?.getExtension('WEBGL_debug_renderer_info')
  out.renderer = dbg ? c.getContext('webgl2').getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'n/a'
  return out
})
console.log(JSON.stringify(r, null, 2))
await browser.close()
