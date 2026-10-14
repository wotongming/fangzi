import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
const { chromium } = pw
const browser = await chromium.launch({
  executablePath: '/usr/local/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-webgpu']
})
const page = await browser.newPage({ viewport: { width: 860, height: 480 } })
page.on('console', (m) => console.log('[c]', m.type(), m.text().slice(0, 200)))
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' })
await page.evaluate(async () => {
  const GW = 512, GH = 300
  const adapter = await navigator.gpu.requestAdapter()
  const device = await adapter.requestDevice()
  device.addEventListener('uncapturederror', (e) => console.log('GPUERR', e.error?.constructor?.name, e.error?.message))
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'width:840px;height:446px;position:fixed;left:10px;top:10px;z-index:9999'
  canvas.width = 840; canvas.height = 446
  document.body.appendChild(canvas)
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const ctx = canvas.getContext('webgpu')
  const fmt = navigator.gpu.getPreferredCanvasFormat()
  ctx.configure({ device, format: fmt, alphaMode: 'premultiplied' })

  // 数据
  const n = 100000
  const xy = new Float32Array(n * 2)
  for (let i = 0; i < n; i++) {
    xy[i * 2] = 0.3 + (Math.random() - 0.5) * 0.05
    xy[i * 2 + 1] = 0.4 + (Math.random() - 0.5) * 0.05
  }
  const pointBuf = device.createBuffer({ size: xy.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
  device.queue.writeBuffer(pointBuf, 0, xy)
  const zerosBins = new Uint32Array(GW * GH)
  const binBuf = device.createBuffer({ size: zerosBins.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
  const peakBuf = device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
  const uniBuf = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const f = new Float32Array(14)
  f.set([0, 0, 1, 1, 66, 18, 756, 386, 840, 446])
  new Uint32Array(f.buffer).set([GW, GH, n, 0], 10)
  device.queue.writeBuffer(uniBuf, 0, f)

  const UD = `struct Uniforms { view: vec4<f32>, plot: vec4<f32>, css: vec2<f32>, grid: vec2<u32>, pointCount: u32, mode: u32 };
@group(0) @binding(0) var<uniform> U: Uniforms;
fn toClip(nx: f32, ny: f32) -> vec4<f32> {
  let sx = (U.plot.x + nx * U.plot.z) / U.css.x;
  let sy = (U.plot.y + (1.0 - ny) * U.plot.w) / U.css.y;
  return vec4<f32>(sx * 2.0 - 1.0, 1.0 - sy * 2.0, 0.0, 1.0);
}`
  const bglBin = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }
  ] })
  const binMod = device.createShaderModule({ code: UD + `
@group(0) @binding(1) var<storage, read_write> bins: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read> pts: array<f32>;
@compute @workgroup_size(64)
fn bin2d(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x; if (i >= U.pointCount) { return; }
  let x = pts[i*2u]; let y = pts[i*2u+1u];
  if (x < U.view.x || x > U.view.z || y < U.view.y || y > U.view.w) { return; }
  let gx = clamp(u32(floor((x-U.view.x)/(U.view.z-U.view.x)*f32(U.grid.x))),0u,U.grid.x-1u);
  let gy = clamp(u32(floor((y-U.view.y)/(U.view.w-U.view.y)*f32(U.grid.y))),0u,U.grid.y-1u);
  atomicAdd(&bins[gy*U.grid.x+gx],1u);
}` })
  const bglMax = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }
  ] })
  const maxMod = device.createShaderModule({ code: UD + `
@group(0) @binding(1) var<storage, read> binsRo: array<u32>;
@group(0) @binding(2) var<storage, read_write> peak: array<atomic<u32>>;
@compute @workgroup_size(256)
fn mx(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x; if (i >= U.grid.x*U.grid.y) { return; }
  atomicMax(&peak[0], binsRo[i]);
}` })
  const pBin = device.createComputePipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [bglBin] }), compute: { module: binMod, entryPoint: 'bin2d' } })
  const pMax = device.createComputePipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [bglMax] }), compute: { module: maxMod, entryPoint: 'mx' } })
  const bgBin = device.createBindGroup({ layout: bglBin, entries: [
    { binding: 0, resource: { buffer: uniBuf } }, { binding: 1, resource: { buffer: binBuf } }, { binding: 2, resource: { buffer: pointBuf } }] })
  const bgMax = device.createBindGroup({ layout: bglMax, entries: [
    { binding: 0, resource: { buffer: uniBuf } }, { binding: 1, resource: { buffer: binBuf } }, { binding: 2, resource: { buffer: peakBuf } }] })

  const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT
  const bglDen = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: VF, buffer: { type: 'uniform' } },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } }
  ] })
  const denMod = device.createShaderModule({ code: UD + `
struct VOut { @builtin(position) pos: vec4<f32>, @location(0) f: vec2<f32> };
@vertex fn qv(@builtin(vertex_index) vid: u32) -> VOut {
  var c = array<vec2<f32>,4>(vec2<f32>(0.,0.),vec2<f32>(1.,0.),vec2<f32>(0.,1.),vec2<f32>(1.,1.));
  var o: VOut; o.f=c[vid]; o.pos=toClip(o.f.x,o.f.y); return o;
}
@group(0) @binding(1) var<storage,read> br: array<u32>;
@group(0) @binding(2) var<storage,read> pk: array<u32>;
@fragment fn qf(in: VOut) -> @location(0) vec4<f32> {
  let gx=clamp(u32(floor(in.f.x*f32(U.grid.x))),0u,U.grid.x-1u);
  let gy=clamp(u32(floor(in.f.y*f32(U.grid.y))),0u,U.grid.y-1u);
  let cc=f32(br[gy*U.grid.x+gx]);
  if (cc<0.5) { discard; }
  let m=f32(pk[0]); let t=log(1.0+6.0*cc/m)/log(7.0);
  return vec4<f32>(t,0.3,1.0-t,0.9);
}` })
  const pDen = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bglDen] }),
    vertex: { module: denMod, entryPoint: 'qv' },
    fragment: { module: denMod, entryPoint: 'qf', targets: [{ format: fmt }] },
    primitive: { topology: 'triangle-strip' }
  })
  const bgDen = device.createBindGroup({ layout: bglDen, entries: [
    { binding: 0, resource: { buffer: uniBuf } }, { binding: 1, resource: { buffer: binBuf } }, { binding: 2, resource: { buffer: peakBuf } }] })

  window.__g = { device, ctx, canvas }
  const draw = () => {
    device.queue.writeBuffer(binBuf, 0, zerosBins)
    device.queue.writeBuffer(peakBuf, 0, new Uint32Array(1))
    const enc = device.createCommandEncoder()
    const cp = enc.beginComputePass()
    cp.setPipeline(pBin); cp.setBindGroup(0, bgBin); cp.dispatchWorkgroups(Math.ceil(n / 64))
    cp.setPipeline(pMax); cp.setBindGroup(0, bgMax); cp.dispatchWorkgroups(Math.ceil((GW * GH) / 256))
    cp.end()
    const rp = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), clearValue: { r: 0.96, g: 0.97, b: 0.96, a: 1 }, loadOp: 'clear', storeOp: 'store' }] })
    rp.setPipeline(pDen); rp.setBindGroup(0, bgDen); rp.draw(4)
    rp.end()
    device.queue.submit([enc.finish()])
  }
  draw()
  await device.queue.onSubmittedWorkDone()
  await new Promise((r) => setTimeout(r, 400))
})
await page.screenshot({ path: '/tmp/gpu-density-faithful.png' })
console.log('done')
await browser.close()
