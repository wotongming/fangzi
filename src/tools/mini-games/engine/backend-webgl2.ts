/**
 * WebGL2 渲染后端（无头 CI 的权威可视后端，也是多数设备 M1 的主力）。
 *
 * 黑底 + 加法混合发光点精灵；辉光通过同批粒子按更大点尺寸 / 更低透明度叠画实现，
 * 不引入 FBO 后处理，保证在 SwiftShader 软渲染与移动 GPU 上都稳定且性能可控。
 */
import type { FrameInfo, NeonParticle, QualitySpec, Renderer } from './types'
import { POINT_FRAG, POINT_VERT } from './shaders'

const STRIDE = 6 // x, y, size, hue, life, glow

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)
  if (!sh) throw new Error('webgl2: createShader 失败')
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) || 'unknown shader error'
    gl.deleteShader(sh)
    throw new Error(`webgl2: 着色器编译失败 ${log}`)
  }
  return sh
}

export class WebGl2Renderer implements Renderer {
  readonly kind = 'webgl2' as const
  private canvas: HTMLCanvasElement | null = null
  private gl: WebGL2RenderingContext | null = null
  private program: WebGLProgram | null = null
  private vao: WebGLVertexArrayObject | null = null
  private vbo: WebGLBuffer | null = null
  private loc: Record<string, WebGLUniformLocation | null> = {}
  private attrs: Record<string, number> = {}
  private buffer: Float32Array = new Float32Array(0)
  private cssW = 1
  private cssH = 1
  private dpr = 1
  private bloomPasses: number

  constructor(spec: QualitySpec) {
    this.bloomPasses = spec.bloomPasses
    this.buffer = new Float32Array(spec.particleCap * STRIDE)
  }

  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.canvas = canvas
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      premultipliedAlpha: false,
      powerPreference: 'high-performance'
    })
    if (!gl) throw new Error('webgl2: 不支持 WebGL2 上下文')
    this.gl = gl

    const vs = compile(gl, gl.VERTEX_SHADER, POINT_VERT)
    const fs = compile(gl, gl.FRAGMENT_SHADER, POINT_FRAG)
    const program = gl.createProgram()
    if (!program) throw new Error('webgl2: createProgram 失败')
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`webgl2: program 链接失败 ${gl.getProgramInfoLog(program)}`)
    }
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    this.program = program

    for (const u of ['u_res', 'u_shake', 'u_dpr', 'u_sizeMul', 'u_alphaMul']) {
      this.loc[u] = gl.getUniformLocation(program, u)
    }
    for (const a of ['a_pos', 'a_size', 'a_hue', 'a_life', 'a_glow']) {
      this.attrs[a] = gl.getAttribLocation(program, a)
    }

    this.vao = gl.createVertexArray()
    this.vbo = gl.createBuffer()
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
    gl.bufferData(gl.ARRAY_BUFFER, this.buffer.byteLength, gl.DYNAMIC_DRAW)
    const fBytes = STRIDE * 4
    gl.enableVertexAttribArray(this.attrs['a_pos']!)
    gl.vertexAttribPointer(this.attrs['a_pos']!, 2, gl.FLOAT, false, fBytes, 0)
    gl.enableVertexAttribArray(this.attrs['a_size']!)
    gl.vertexAttribPointer(this.attrs['a_size']!, 1, gl.FLOAT, false, fBytes, 8)
    gl.enableVertexAttribArray(this.attrs['a_hue']!)
    gl.vertexAttribPointer(this.attrs['a_hue']!, 1, gl.FLOAT, false, fBytes, 12)
    gl.enableVertexAttribArray(this.attrs['a_life']!)
    gl.vertexAttribPointer(this.attrs['a_life']!, 1, gl.FLOAT, false, fBytes, 16)
    gl.enableVertexAttribArray(this.attrs['a_glow']!)
    gl.vertexAttribPointer(this.attrs['a_glow']!, 1, gl.FLOAT, false, fBytes, 20)
    gl.bindVertexArray(null)

    gl.clearColor(0.015, 0.02, 0.035, 1)
    gl.disable(gl.DEPTH_TEST)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE) // 加法发光
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    this.cssW = cssW
    this.cssH = cssH
    this.dpr = dpr
    if (!this.canvas || !this.gl) return
    const w = Math.max(1, Math.round(cssW * dpr))
    const h = Math.max(1, Math.round(cssH * dpr))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    this.gl.viewport(0, 0, w, h)
  }

  // 颜色取自每个粒子自带色相（顶点属性），后端无需单独保存调色板；保留接口以符合 Renderer 契约。
  setPalette(_hues: number[]): void {
    /* no-op：颜色随粒子下发 */
  }

  private U(name: string): WebGLUniformLocation | null {
    return this.loc[name] ?? null
  }

  setBloomPasses(passes: number): void {
    this.bloomPasses = Math.max(0, Math.min(2, Math.round(passes)))
  }

  render(particles: readonly NeonParticle[], info: FrameInfo): void {
    const gl = this.gl
    if (!gl || !this.program || !this.vao || !this.vbo) return
    const n = Math.min(particles.length, this.buffer.length / STRIDE)
    const arr = this.buffer
    for (let i = 0; i < n; i++) {
      const p = particles[i]
      if (!p) continue
      const o = i * STRIDE
      arr[o] = p.x
      arr[o + 1] = p.y
      arr[o + 2] = p.size
      arr[o + 3] = p.hue
      arr[o + 4] = p.maxLife > 0 ? Math.max(0, Math.min(1, p.life / p.maxLife)) : 0
      arr[o + 5] = p.glow
    }

    // 背景随节拍在深靛蓝间呼吸。
    gl.clearColor(
      0.015 + 0.018 * info.beat,
      0.02 + 0.018 * info.beat,
      0.035 + 0.03 * info.beat,
      1
    )
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (n === 0) return

    gl.useProgram(this.program)
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, arr.subarray(0, n * STRIDE))
    gl.uniform2f(this.U('u_res'), this.cssW, this.cssH)
    gl.uniform2f(this.U('u_shake'), info.shakeX, info.shakeY)
    gl.uniform1f(this.U('u_dpr'), this.dpr)

    // 核心 + 至多两层放大光晕（口径与 Canvas2D 后端保持一致）。
    const passes: Array<[number, number]> = [[1, 1]]
    if (this.bloomPasses >= 1) passes.push([2.1, 0.32])
    if (this.bloomPasses >= 2) passes.push([3.2, 0.14])
    for (const [sizeMul, alphaMul] of passes) {
      gl.uniform1f(this.U('u_sizeMul'), sizeMul)
      gl.uniform1f(this.U('u_alphaMul'), alphaMul)
      gl.drawArrays(gl.POINTS, 0, n)
    }
    gl.bindVertexArray(null)
  }

  dispose(): void {
    const gl = this.gl
    if (!gl) return
    try {
      if (this.vbo) gl.deleteBuffer(this.vbo)
      if (this.vao) gl.deleteVertexArray(this.vao)
      if (this.program) gl.deleteProgram(this.program)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    } catch {
      /* 释放失败可忽略 */
    }
    this.gl = null
    this.program = null
    this.vbo = null
    this.vao = null
  }
}
