/**
 * WebGPU 后端（首选）：
 * - 数据点常驻 storage buffer；每帧仅更新 uniform（视口/绘图区），交互零重传。
 * - compute shader 做二维 / 一维分桶（atomic 计数；Y 均值用定点数 atomicAdd）。
 * - 散点（hexbin 硬格）与热力（四邻域双线性平滑）共用覆盖绘图区的 quad，
 *   fragment shader 直接读分桶 buffer，按 viridis + log 密度着色，无纹理回读。
 * - 折线用 LINE_LIST 邻桶连线（空桶输出越界顶点形成断点）。
 *
 * 每条管线使用独立 shader 模块与独立 bind group layout，避免同模块 binding 别名。
 * 设备申请失败由上层降级到 WebGL2。
 */
import type { RenderOptions, VizRenderer } from '../types'

const UNIFORM_DECL = /* wgsl */ `
struct Uniforms {
  view: vec4<f32>,
  plot: vec4<f32>,
  css: vec2<f32>,
  grid: vec2<u32>,
  pointCount: u32,
  mode: u32,
};
@group(0) @binding(0) var<uniform> U: Uniforms;
fn toClip(nx: f32, ny: f32) -> vec4<f32> {
  let sx = (U.plot.x + nx * U.plot.z) / U.css.x;
  let sy = (U.plot.y + (1.0 - ny) * U.plot.w) / U.css.y;
  return vec4<f32>(sx * 2.0 - 1.0, 1.0 - sy * 2.0, 0.0, 1.0);
}
`

const RAMP_DECL = /* wgsl */ `
const STOPS = array<vec3<f32>, 11>(
  vec3<f32>(0.267, 0.004, 0.329), vec3<f32>(0.282, 0.137, 0.455),
  vec3<f32>(0.251, 0.263, 0.529), vec3<f32>(0.204, 0.369, 0.553),
  vec3<f32>(0.161, 0.471, 0.557), vec3<f32>(0.125, 0.565, 0.549),
  vec3<f32>(0.133, 0.655, 0.518), vec3<f32>(0.267, 0.745, 0.439),
  vec3<f32>(0.475, 0.820, 0.318), vec3<f32>(0.741, 0.871, 0.149),
  vec3<f32>(0.992, 0.906, 0.145)
);
fn ramp(t: f32) -> vec3<f32> {
  let p = clamp(t, 0.0, 1.0) * 10.0;
  let i = clamp(u32(floor(p)), 0u, 9u);
  return mix(STOPS[i], STOPS[i + 1u], p - f32(i));
}
fn densityT(c: f32, m: f32) -> f32 {
  if (c <= 0.0 || m <= 0.0) { return 0.0; }
  return log(1.0 + 6.0 * c / m) / log(7.0);
}
`

const WGSL_BIN2D =
  UNIFORM_DECL +
  /* wgsl */ `
@group(0) @binding(1) var<storage, read_write> bins: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read> pts: array<f32>;
@compute @workgroup_size(64)
fn bin2d(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= U.pointCount) { return; }
  let x = pts[i * 2u];
  let y = pts[i * 2u + 1u];
  if (x < U.view.x || x > U.view.z || y < U.view.y || y > U.view.w) { return; }
  var gx = clamp(u32(floor((x - U.view.x) / (U.view.z - U.view.x) * f32(U.grid.x))), 0u, U.grid.x - 1u);
  var gy = clamp(u32(floor((y - U.view.y) / (U.view.w - U.view.y) * f32(U.grid.y))), 0u, U.grid.y - 1u);
  atomicAdd(&bins[gy * U.grid.x + gx], 1u);
}
`

const WGSL_BIN1D =
  UNIFORM_DECL +
  /* wgsl */ `
@group(0) @binding(1) var<storage, read_write> lc: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read> pts: array<f32>;
@group(0) @binding(3) var<storage, read_write> ls: array<atomic<u32>>;
@compute @workgroup_size(64)
fn bin1d(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= U.pointCount) { return; }
  let x = pts[i * 2u];
  if (x < U.view.x || x > U.view.z) { return; }
  let gx = clamp(u32(floor((x - U.view.x) / (U.view.z - U.view.x) * f32(U.grid.x))), 0u, U.grid.x - 1u);
  atomicAdd(&lc[gx], 1u);
  let y = pts[i * 2u + 1u];
  let ny = clamp((y - U.view.y) / (U.view.w - U.view.y), 0.0, 1.0);
  atomicAdd(&ls[gx], u32(ny * 1000000.0));
}
`

const WGSL_MAX =
  UNIFORM_DECL +
  /* wgsl */ `
@group(0) @binding(1) var<storage, read> binsRo: array<u32>;
@group(0) @binding(2) var<storage, read_write> peak: array<atomic<u32>>;
@compute @workgroup_size(256)
fn maxReduce(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= U.grid.x * U.grid.y) { return; }
  atomicMax(&peak[0], binsRo[i]);
}
`

const WGSL_DENSITY =
  UNIFORM_DECL +
  RAMP_DECL +
  /* wgsl */ `
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
  let m = f32(peakRead[0]);
  if (U.mode == 1u) {
    let gx = in.f.x * f32(U.grid.x) - 0.5;
    let gy = in.f.y * f32(U.grid.y) - 0.5;
    let x0i = clamp(i32(floor(gx)), 0, i32(U.grid.x) - 1);
    let y0i = clamp(i32(floor(gy)), 0, i32(U.grid.y) - 1);
    let x1i = clamp(x0i + 1, 0, i32(U.grid.x) - 1);
    let y1i = clamp(y0i + 1, 0, i32(U.grid.y) - 1);
    let tx = clamp(gx - floor(gx), 0.0, 1.0);
    let ty = clamp(gy - floor(gy), 0.0, 1.0);
    let c00 = f32(binsRead[y0i * i32(U.grid.x) + x0i]);
    let c10 = f32(binsRead[y0i * i32(U.grid.x) + x1i]);
    let c01 = f32(binsRead[y1i * i32(U.grid.x) + x0i]);
    let c11 = f32(binsRead[y1i * i32(U.grid.x) + x1i]);
    let c = mix(mix(c00, c10, tx), mix(c01, c11, tx), ty);
    if (c < 0.5) { discard; }
    return vec4<f32>(ramp(densityT(c, m)), 1.0);
  }
  let gx = clamp(u32(floor(in.f.x * f32(U.grid.x))), 0u, U.grid.x - 1u);
  let gy = clamp(u32(floor(in.f.y * f32(U.grid.y))), 0u, U.grid.y - 1u);
  let c = f32(binsRead[gy * U.grid.x + gx]);
  if (c < 0.5) { discard; }
  return vec4<f32>(ramp(densityT(c, m)), 0.85);
}
`

const WGSL_LINE =
  UNIFORM_DECL +
  /* wgsl */ `
struct VOut { @builtin(position) pos: vec4<f32> };
@group(0) @binding(1) var<storage, read> lc: array<u32>;
@group(0) @binding(2) var<storage, read> ls: array<u32>;
@vertex
fn lineVs(@builtin(vertex_index) vid: u32) -> VOut {
  let seg = vid / 2u;
  let gx = seg + (vid % 2u);
  var o: VOut;
  let cnt = lc[gx];
  if (cnt == 0u) { o.pos = vec4<f32>(3.0, 3.0, 3.0, 1.0); return o; }
  let nx = (f32(gx) + 0.5) / f32(U.grid.x);
  let ny = f32(ls[gx]) / f32(cnt) / 1000000.0;
  o.pos = toClip(nx, ny);
  return o;
}
@fragment
fn lineFs() -> @location(0) vec4<f32> {
  return vec4<f32>(0.18, 0.44, 0.32, 1.0);
}
`

const GRID_W = 512
const GRID_H = 300
const WORKGROUP = 64

export class WebGpuRenderer implements VizRenderer {
  readonly kind = 'webgpu' as const
  private pointCount = 0
  private pointBuf!: GPUBuffer
  private binBuf!: GPUBuffer
  private peakBuf!: GPUBuffer
  private lcBuf!: GPUBuffer
  private lsBuf!: GPUBuffer
  private uniformBuf!: GPUBuffer
  private pBin2d!: GPUComputePipeline
  private pBin1d!: GPUComputePipeline
  private pMax!: GPUComputePipeline
  private pDensity!: GPURenderPipeline
  private pLine!: GPURenderPipeline
  private bgBins!: GPUBindGroup
  private bgLineCompute!: GPUBindGroup
  private bgMax!: GPUBindGroup
  private bgDensity!: GPUBindGroup
  private bgLineRender!: GPUBindGroup
  private zerosBins = new Uint32Array(GRID_W * GRID_H)
  private zerosLine = new Uint32Array(GRID_W)
  private zeroPeak = new Uint32Array(1)
  private uniformF = new Float32Array(14)
  private uniformU = new Uint32Array(this.uniformF.buffer)
  private format: GPUTextureFormat
  private context: GPUCanvasContext
  private configured = false

  private constructor(
    private canvas: HTMLCanvasElement,
    private device: GPUDevice
  ) {
    const ctx = canvas.getContext('webgpu')
    if (!ctx) throw new Error('WebGPU canvas 上下文不可用')
    this.context = ctx
    this.format = (navigator as Navigator & { gpu: GPU }).gpu.getPreferredCanvasFormat()
    this.initResources()
  }

  static async create(canvas: HTMLCanvasElement): Promise<WebGpuRenderer> {
    const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<GPUAdapter | null> } }
    if (!nav.gpu) throw new Error('WebGPU 不受支持')
    const adapter = await nav.gpu.requestAdapter()
    if (!adapter) throw new Error('无可用 GPU 适配器')
    const device = await adapter.requestDevice()
    device.addEventListener('uncapturederror', ((ev: Event) => {
      const err = (ev as GPUUncapturedErrorEvent).error
      console.warn('[gpu-data-viz] WebGPU 错误：', err?.constructor?.name, err?.message)
    }) as EventListener)
    return new WebGpuRenderer(canvas, device)
  }

  private initResources(): void {
    const d = this.device
    const CV = GPUShaderStage.COMPUTE
    const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT
    const uniformEntry = (vis: number): GPUBindGroupLayoutEntry => ({
      binding: 0,
      visibility: vis,
      buffer: { type: 'uniform' }
    })
    const roEntry = (binding: number, vis: number): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: vis,
      buffer: { type: 'read-only-storage' }
    })
    const rwEntry = (binding: number): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: CV,
      buffer: { type: 'storage' }
    })

    const mkCompute = (code: string, entry: string, entries: GPUBindGroupLayoutEntry[]): GPUComputePipeline => {
      const bgl = d.createBindGroupLayout({ entries })
      return d.createComputePipeline({
        layout: d.createPipelineLayout({ bindGroupLayouts: [bgl] }),
        compute: { module: d.createShaderModule({ code }), entryPoint: entry }
      })
    }

    const mDensity = d.createShaderModule({ code: WGSL_DENSITY })
    const mLine = d.createShaderModule({ code: WGSL_LINE })

    // bin2d：0 uniform / 1 bins rw / 2 pts ro
    this.pBin2d = mkCompute(WGSL_BIN2D, 'bin2d', [uniformEntry(CV), rwEntry(1), roEntry(2, CV)])
    // bin1d：0 uniform / 1 lc rw / 2 pts ro / 3 ls rw
    this.pBin1d = mkCompute(WGSL_BIN1D, 'bin1d', [uniformEntry(CV), rwEntry(1), roEntry(2, CV), rwEntry(3)])
    // max：0 uniform / 1 bins ro / 2 peak rw
    this.pMax = mkCompute(WGSL_MAX, 'maxReduce', [uniformEntry(CV), roEntry(1, CV), rwEntry(2)])

    const densityBgl = d.createBindGroupLayout({
      entries: [uniformEntry(VF), roEntry(1, GPUShaderStage.FRAGMENT), roEntry(2, GPUShaderStage.FRAGMENT)]
    })
    this.pDensity = d.createRenderPipeline({
      layout: d.createPipelineLayout({ bindGroupLayouts: [densityBgl] }),
      vertex: { module: mDensity, entryPoint: 'quadVs' },
      fragment: {
        module: mDensity,
        entryPoint: 'quadFs',
        targets: [
          {
            format: this.format,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
            }
          }
        ]
      },
      primitive: { topology: 'triangle-strip' }
    })

    const lineBgl = d.createBindGroupLayout({
      entries: [uniformEntry(GPUShaderStage.VERTEX), roEntry(1, GPUShaderStage.VERTEX), roEntry(2, GPUShaderStage.VERTEX)]
    })
    this.pLine = d.createRenderPipeline({
      layout: d.createPipelineLayout({ bindGroupLayouts: [lineBgl] }),
      vertex: { module: mLine, entryPoint: 'lineVs' },
      fragment: { module: mLine, entryPoint: 'lineFs', targets: [{ format: this.format }] },
      primitive: { topology: 'line-list' }
    })

    this.uniformBuf = d.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.binBuf = d.createBuffer({ size: this.zerosBins.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
    this.peakBuf = d.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
    this.lcBuf = d.createBuffer({ size: this.zerosLine.byteLength * 2, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
    this.lsBuf = d.createBuffer({ size: this.zerosLine.byteLength * 2, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
    this.pointBuf = d.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })

    this.bgBins = d.createBindGroup({
      layout: this.pBin2d.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuf } },
        { binding: 1, resource: { buffer: this.binBuf } },
        { binding: 2, resource: { buffer: this.pointBuf } }
      ]
    })
    this.bgMax = d.createBindGroup({
      layout: this.pMax.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuf } },
        { binding: 1, resource: { buffer: this.binBuf } },
        { binding: 2, resource: { buffer: this.peakBuf } }
      ]
    })
    this.bgDensity = d.createBindGroup({
      layout: densityBgl,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuf } },
        { binding: 1, resource: { buffer: this.binBuf } },
        { binding: 2, resource: { buffer: this.peakBuf } }
      ]
    })
    this.bgLineRender = d.createBindGroup({
      layout: lineBgl,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuf } },
        { binding: 1, resource: { buffer: this.lcBuf } },
        { binding: 2, resource: { buffer: this.lsBuf } }
      ]
    })
    this.rebuildLineComputeGroup()
  }

  private rebuildLineComputeGroup(): void {
    this.bgLineCompute = this.device.createBindGroup({
      layout: this.pBin1d.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuf } },
        { binding: 1, resource: { buffer: this.lcBuf } },
        { binding: 2, resource: { buffer: this.pointBuf } },
        { binding: 3, resource: { buffer: this.lsBuf } }
      ]
    })
  }

  setData(xy: Float32Array<ArrayBuffer>, pointCount: number): void {
    this.pointCount = pointCount
    const d = this.device
    this.pointBuf.destroy()
    const bytes = Math.max(16, pointCount * 2 * 4)
    this.pointBuf = d.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
    d.queue.writeBuffer(this.pointBuf, 0, xy.buffer, xy.byteOffset, pointCount * 2 * 4)
    this.rebuildLineComputeGroup()
    this.bgBins = d.createBindGroup({
      layout: this.pBin2d.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuf } },
        { binding: 1, resource: { buffer: this.binBuf } },
        { binding: 2, resource: { buffer: this.pointBuf } }
      ]
    })
  }

  private writeUniforms(o: RenderOptions, mode: number): void {
    const f = this.uniformF
    f[0] = o.view.x0
    f[1] = o.view.y0
    f[2] = o.view.x1
    f[3] = o.view.y1
    f[4] = o.plot.x
    f[5] = o.plot.y
    f[6] = o.plot.w
    f[7] = o.plot.h
    f[8] = this.canvas.clientWidth
    f[9] = this.canvas.clientHeight
    this.uniformU[10] = GRID_W
    this.uniformU[11] = GRID_H
    this.uniformU[12] = this.pointCount
    this.uniformU[13] = mode
    this.device.queue.writeBuffer(this.uniformBuf, 0, this.uniformF)
  }

  render(o: RenderOptions): void {
    if (this.pointCount === 0) return
    const d = this.device
    const pw = Math.max(1, Math.round(this.canvas.clientWidth * o.dpr))
    const ph = Math.max(1, Math.round(this.canvas.clientHeight * o.dpr))
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw
      this.canvas.height = ph
      this.configured = false
    }
    if (!this.configured) {
      this.context.configure({ device: d, format: this.format, alphaMode: 'premultiplied' })
      this.configured = true
    }

    const isLine = o.chart === 'line'
    this.writeUniforms(o, o.chart === 'heatmap' ? 1 : 0)
    // 清零缓冲必须在 command encoder 打开之前完成，避免 buffer 同时被写与被录制引用
    if (isLine) {
      d.queue.writeBuffer(this.lcBuf, 0, this.zerosLine)
      d.queue.writeBuffer(this.lsBuf, 0, this.zerosLine)
    } else {
      d.queue.writeBuffer(this.binBuf, 0, this.zerosBins)
      d.queue.writeBuffer(this.peakBuf, 0, this.zeroPeak)
    }
    const enc = d.createCommandEncoder()
    const cp = enc.beginComputePass()
    if (isLine) {
      cp.setPipeline(this.pBin1d)
      cp.setBindGroup(0, this.bgLineCompute)
      cp.dispatchWorkgroups(Math.ceil(this.pointCount / WORKGROUP))
    } else {
      cp.setPipeline(this.pBin2d)
      cp.setBindGroup(0, this.bgBins)
      cp.dispatchWorkgroups(Math.ceil(this.pointCount / WORKGROUP))
      cp.setPipeline(this.pMax)
      cp.setBindGroup(0, this.bgMax)
      cp.dispatchWorkgroups(Math.ceil((GRID_W * GRID_H) / 256))
    }
    cp.end()

    const rp = enc.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store'
        }
      ]
    })
    if (isLine) {
      rp.setPipeline(this.pLine)
      rp.setBindGroup(0, this.bgLineRender)
      rp.draw((GRID_W - 1) * 2)
    } else {
      rp.setPipeline(this.pDensity)
      rp.setBindGroup(0, this.bgDensity)
      rp.draw(4)
    }
    rp.end()
    d.queue.submit([enc.finish()])
  }

  destroy(): void {
    try {
      for (const b of [this.pointBuf, this.binBuf, this.peakBuf, this.lcBuf, this.lsBuf, this.uniformBuf]) b.destroy()
      this.device.destroy()
    } catch {
      /* 销毁幂等 */
    }
  }
}
