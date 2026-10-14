import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
const { chromium } = pw
const browser = await chromium.launch({
  executablePath: '/usr/local/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-webgpu']
})
const page = await browser.newPage({ viewport: { width: 400, height: 300 } })
page.on('console', (m) => console.log('[c]', m.type(), m.text().slice(0, 150)))
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' })
await page.evaluate(async () => {
  const adapter = await navigator.gpu.requestAdapter()
  const device = await adapter.requestDevice()
  device.addEventListener('uncapturederror', (e) => console.log('GPUERR', e.error?.message))
  const canvas = document.createElement('canvas')
  canvas.width = 400; canvas.height = 300
  canvas.style.width = '400px'; canvas.style.height = '300px'
  document.body.appendChild(canvas)
  const ctx = canvas.getContext('webgpu')
  const fmt = navigator.gpu.getPreferredCanvasFormat()
  ctx.configure({ device, format: fmt, alphaMode: 'opaque' })
  // 持久引用，防 GC
  window.__g = { device, ctx, canvas }
  const draw = () => {
    const enc = device.createCommandEncoder()
    const rp = enc.beginRenderPass({
      colorAttachments: [{ view: ctx.getCurrentTexture().createView(), clearValue: { r: 1, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }]
    })
    rp.end()
    device.queue.submit([enc.finish()])
  }
  draw()
  await new Promise((r) => setTimeout(r, 500))
  draw()
  await new Promise((r) => setTimeout(r, 500))
})
await page.screenshot({ path: '/tmp/gpu-red.png' })
console.log('shot saved')
await browser.close()
