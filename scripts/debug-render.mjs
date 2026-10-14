import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
const { chromium } = pw
const browser = await chromium.launch({
  executablePath: '/usr/local/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-webgpu']
})
const page = await browser.newPage({ viewport: { width: 900, height: 600 } })
page.on('console', (m) => m.type() === 'error' && console.log('[console.error]', m.text().slice(0, 200)))
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' })

const out = await page.evaluate(async () => {
  try {
    const adapter = await navigator.gpu.requestAdapter()
    const device = await adapter.requestDevice()
    device.lost.then((info) => console.log('DEVICE LOST', info.reason, info.message))
    const canvas = document.createElement('canvas')
    canvas.style.width = '840px'
    canvas.style.height = '446px'
    canvas.style.position = 'fixed'
    canvas.style.left = '0'
    canvas.style.top = '0'
    canvas.style.zIndex = '9999'
    canvas.width = 840
    canvas.height = 446
    document.body.appendChild(canvas)
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const ctx = canvas.getContext('webgpu')
    const fmt = navigator.gpu.getPreferredCanvasFormat()
    ctx.configure({ device, format: fmt, alphaMode: 'premultiplied' })

    const GW = 512, GH = 300
    const bins = new Uint32Array(GW * GH)
    for (let gy = 80; gy < 100; gy++) for (let gx = 140; gx < 170; gx++) bins[gy * GW + gx] = 500
    bins[90 * GW + 150] = 1000
    const binBuf = device.createBuffer({ size: bins.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
    const peakBuf = device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
    device.queue.writeBuffer(binBuf, 0, bins)
    device.queue.writeBuffer(peakBuf, 0, new Uint32Array([1000]))
    const uniBuf = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    const f = new Float32Array(14)
    f.set([0, 0, 1, 1, 66, 18, 720, 400, 840, 446])
    new Uint32Array(f.buffer).set([GW, GH, 0, 0], 10)
    device.queue.writeBuffer(uniBuf, 0, f)

    const code = `
struct Uniforms { view: vec4<f32>, plot: vec4<f32>, css: vec2<f32>, grid: vec2<u32>, pointCount: u32, mode: u32 };
@group(0) @binding(0) var<uniform> U: Uniforms;
fn toClip(nx: f32, ny: f32) -> vec4<f32> {
  let sx = (U.plot.x + nx * U.plot.z) / U.css.x;
  let sy = (U.plot.y + (1.0 - ny) * U.plot.w) / U.css.y;
  return vec4<f32>(sx * 2.0 - 1.0, 1.0 - sy * 2.0, 0.0, 1.0);
}
struct VOut { @builtin(position) pos: vec4<f32>, @location(0) f: vec2<f32> };
@vertex
fn quadVs(@builtin(vertex_index) vid: u32) -> VOut {
  var corners = array<vec2<f32>, 4>(
    vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 1.0)
  );
  var o: VOut;
  o.f = corners[vid];
  o.pos = toClip(o.f.x, o.f.y);
  return o;
}
@group(0) @binding(1) var<storage, read> binsRead: array<u32>;
@group(0) @binding(2) var<storage, read> peakRead: array<u32>;
@fragment
fn quadFs(in: VOut) -> @location(0) vec4<f32> {
  let gx = clamp(u32(floor(in.f.x * f32(U.grid.x))), 0u, U.grid.x - 1u);
  let gy = clamp(u32(floor(in.f.y * f32(U.grid.y))), 0u, U.grid.y - 1u);
  let c = f32(binsRead[gy * U.grid.x + gx]);
  if (c < 0.5) { discard; }
  let m = f32(peakRead[0]);
  let t = log(1.0 + 6.0 * c / m) / log(7.0);
  return vec4<f32>(t, 0.3, 1.0 - t, 0.85);
}`
    const bgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } }
      ]
    })
    const mod = device.createShaderModule({ code })
    const pipe = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
      vertex: { module: mod, entryPoint: 'quadVs' },
      fragment: { module: mod, entryPoint: 'quadFs', targets: [{ format: 'rgba8unorm' }] },
      primitive: { topology: 'triangle-strip' }
    })
    const bg = device.createBindGroup({ layout: bgl, entries: [
      { binding: 0, resource: { buffer: uniBuf } },
      { binding: 1, resource: { buffer: binBuf } },
      { binding: 2, resource: { buffer: peakBuf } }
    ] })
    // 离屏纹理，避开 headless canvas external texture 问题
    const W = 840, H = 446
    const tex = device.createTexture({ size: { width: W, height: H }, format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC })
    const enc = device.createCommandEncoder()
    const rp = enc.beginRenderPass({
      colorAttachments: [{ view: tex.createView(), clearValue: { r: 1, g: 1, b: 1, a: 1 }, loadOp: 'clear', storeOp: 'store' }]
    })
    rp.setPipeline(pipe)
    rp.setBindGroup(0, bg)
    rp.draw(4)
    rp.end()
    const readBuf = device.createBuffer({ size: H * Math.ceil((W * 4) / 256) * 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
    const bpr = Math.ceil((W * 4) / 256) * 256
    enc.copyTextureToBuffer({ texture: tex }, { buffer: readBuf, bytesPerRow: bpr, rowsPerImage: H }, { width: W, height: H })
    device.queue.submit([enc.finish()])
    await readBuf.mapAsync(GPUMapMode.READ)
    const raw = new Uint8Array(readBuf.getMappedRange())
    const d = new Uint8Array(W * H * 4)
    for (let y = 0; y < H; y++) d.set(raw.subarray(y * bpr, y * bpr + W * 4), y * W * 4)
    let nonwhite = 0
    let colored = 0
    const sample = []
    for (let p = 0; p < d.length; p += 4) {
      const isClear = d[p] > 245 && d[p + 1] > 245 && d[p + 2] > 245 && d[p + 3] > 245
      if (!isClear) nonwhite++
      if (d[p + 3] > 20 && !(d[p] > 240 && d[p + 1] > 240 && d[p + 2] > 240)) {
        colored++
        if (sample.length < 5) sample.push([d[p], d[p + 1], d[p + 2], d[p + 3]])
      }
    }
    return { nonwhite, colored, sample }
  } catch (e) {
    return { error: String(e) }
  }
})
console.log('standalone density render:', JSON.stringify(out))
await browser.close()
