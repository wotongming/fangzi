import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
const { chromium } = pw
const browser = await chromium.launch({
  executablePath: '/usr/local/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-webgpu']
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' })

const result = await page.evaluate(async () => {
  const adapter = await navigator.gpu.requestAdapter()
  const device = await adapter.requestDevice()
  const GW = 512
  const GH = 300
  // 5 万个点，集中在归一化 (0.3,0.3) 附近
  const n = 50000
  const xy = new Float32Array(n * 2)
  for (let i = 0; i < n; i++) {
    xy[i * 2] = 0.3 + (Math.random() - 0.5) * 0.02
    xy[i * 2 + 1] = 0.3 + (Math.random() - 0.5) * 0.02
  }
  const pointBuf = device.createBuffer({ size: xy.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
  device.queue.writeBuffer(pointBuf, 0, xy)
  const binsBuf = device.createBuffer({ size: GW * GH * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC })
  const peakBuf = device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC })
  device.queue.writeBuffer(binsBuf, 0, new Uint32Array(GW * GH))
  device.queue.writeBuffer(peakBuf, 0, new Uint32Array(1))

  const U = /* wgsl */ `
struct Uniforms { view: vec4<f32>, plot: vec4<f32>, css: vec2<f32>, grid: vec2<u32>, pointCount: u32, mode: u32 };
@group(0) @binding(0) var<uniform> U: Uniforms;
`
  const bgl = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }
    ]
  })
  const uni = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const f = new Float32Array(14)
  f.set([0, 0, 1, 1, 0, 0, 1, 1, 1, 1])
  const u32 = new Uint32Array(f.buffer)
  u32[10] = GW
  u32[11] = GH
  u32[12] = n
  device.queue.writeBuffer(uni, 0, f)
  const bg = device.createBindGroup({ layout: bgl, entries: [
    { binding: 0, resource: { buffer: uni } },
    { binding: 1, resource: { buffer: binsBuf } },
    { binding: 2, resource: { buffer: pointBuf } }
  ] })
  const mod = device.createShaderModule({ code: U + `
@group(0) @binding(1) var<storage, read_write> bins: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read> pts: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= U.pointCount) { return; }
  let x = pts[i*2u]; let y = pts[i*2u+1u];
  if (x < U.view.x || x > U.view.z || y < U.view.y || y > U.view.w) { return; }
  let gx = clamp(u32(floor((x-U.view.x)/(U.view.z-U.view.x)*f32(U.grid.x))),0u,U.grid.x-1u);
  let gy = clamp(u32(floor((y-U.view.y)/(U.view.w-U.view.y)*f32(U.grid.y))),0u,U.grid.y-1u);
  atomicAdd(&bins[gy*U.grid.x+gx],1u);
}` })
  const pipe = device.createComputePipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }), compute: { module: mod, entryPoint: 'main' } })

  const enc = device.createCommandEncoder()
  const cp = enc.beginComputePass()
  cp.setPipeline(pipe)
  cp.setBindGroup(0, bg)
  cp.dispatchWorkgroups(Math.ceil(n / 64))
  cp.end()
  // 读回 bins 总和与 peak
  const sumOut = device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
  // 用 reduce buffer 不现实，直接 copy bins 全部到一个 mappable（153600*4≈600KB）
  const readBuf = device.createBuffer({ size: GW * GH * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
  enc.copyBufferToBuffer(binsBuf, 0, readBuf, 0, GW * GH * 4)
  device.queue.submit([enc.finish()])
  await readBuf.mapAsync(GPUMapMode.READ)
  const got = new Uint32Array(readBuf.getMappedRange())
  let sum = 0
  let peak = 0
  let nonZero = 0
  for (const c of got) {
    sum += c
    if (c > 0) nonZero++
    if (c > peak) peak = c
  }
  return { sum, peak, nonZero, n, limits: adapter.limits.maxStorageBufferBindingSize, maxComputePerDim: adapter.limits.maxComputeWorkgroupsPerDimension }
})
console.log(JSON.stringify(result, null, 2))
await browser.close()
