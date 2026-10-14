/**
 * WebGL2 回退后端（主力兼容路径，桌面覆盖率接近 100%）。
 *
 * - scatter：原始点一次性上传 VBO，每帧仅更新视口 uniform，单次 gl.POINTS 绘制百万点（GPU 顶点吞吐）；
 * - line：CPU 一维分桶得到每桶均值（≤ 画布宽度个顶点），gl.LINE_STRIP 绘制；
 * - heatmap：CPU 二维分桶 → viridis 密度色写入 RGBA 纹理，GPU 双线性放大铺满绘图区。
 *
 * 无 transform feedback / compute 依赖，集成显卡与虚拟机软渲染（SwiftShader）均可运行。
 */
import { bin1D, bin2D, maxCount } from '../bins'
import type { RenderOptions, VizRenderer } from '../types'
import { densityT, ramp } from './color'

const SCATTER_VS = `#version 300 es
in vec2 aPos;
uniform vec4 uView;   // x0,y0,x1,y1（全量归一化空间）
uniform vec4 uPlot;   // px,py,pw,ph（CSS 像素）
uniform vec2 uCss;    // cssW,cssH
void main(){
  float nx = (aPos.x - uView.x) / (uView.z - uView.x);
  float ny = (aPos.y - uView.y) / (uView.w - uView.y);
  float sx = (uPlot.x + nx * uPlot.z) / uCss.x;
  float sy = (uPlot.y + (1.0 - ny) * uPlot.w) / uCss.y;
  gl_Position = vec4(sx * 2.0 - 1.0, 1.0 - sy * 2.0, 0.0, 1.0);
  gl_PointSize = 2.0;
}`

const SCATTER_FS = `#version 300 es
precision highp float;
out vec4 outColor;
void main(){
  vec2 d = gl_PointCoord - vec2(0.5);
  if (dot(d,d) > 0.25) discard;       // 圆点
  outColor = vec4(0.18, 0.44, 0.32, 0.28);
}`

const HEAT_VS = `#version 300 es
in vec2 aCorner;
out vec2 vUv;
uniform vec4 uPlot;
uniform vec2 uCss;
void main(){
  vUv = aCorner;
  float sx = (uPlot.x + aCorner.x * uPlot.z) / uCss.x;
  float sy = (uPlot.y + (1.0 - aCorner.y) * uPlot.w) / uCss.y;
  gl_Position = vec4(sx * 2.0 - 1.0, 1.0 - sy * 2.0, 0.0, 1.0);
}`

const HEAT_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
out vec4 outColor;
void main(){
  vec4 c = texture(uTex, vUv);
  if (c.a < 0.01) discard;
  outColor = c;
}`

const LINE_VS = `#version 300 es
in vec2 aPos;
uniform vec4 uView;
uniform vec4 uPlot;
uniform vec2 uCss;
void main(){
  float nx = (aPos.x - uView.x) / (uView.z - uView.x);
  float ny = (aPos.y - uView.y) / (uView.w - uView.y);
  float sx = (uPlot.x + nx * uPlot.z) / uCss.x;
  float sy = (uPlot.y + (1.0 - ny) * uPlot.w) / uCss.y;
  gl_Position = vec4(sx * 2.0 - 1.0, 1.0 - sy * 2.0, 0.0, 1.0);
}`

const LINE_FS = `#version 300 es
precision highp float;
out vec4 outColor;
void main(){ outColor = vec4(0.18, 0.44, 0.32, 1.0); }`

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh)
    gl.deleteShader(sh)
    throw new Error('WebGL shader 编译失败：' + log)
  }
  return sh
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs))
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs))
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('WebGL program 链接失败：' + gl.getProgramInfoLog(p))
  return p
}

export class WebGL2Renderer implements VizRenderer {
  readonly kind = 'webgl2' as const
  private gl: WebGL2RenderingContext
  private xy: Float32Array<ArrayBuffer> = new Float32Array(0)
  private count = 0
  private pointBuf: WebGLBuffer
  private lineBuf: WebGLBuffer
  private heatVbo: WebGLBuffer
  private tex: WebGLTexture
  private pScatter: WebGLProgram
  private pHeat: WebGLProgram
  private pLine: WebGLProgram
  private gridW = 0
  private gridH = 0

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
      powerPreference: 'high-performance'
    })
    if (!gl) throw new Error('WebGL2 不可用')
    this.gl = gl
    this.pScatter = program(gl, SCATTER_VS, SCATTER_FS)
    this.pHeat = program(gl, HEAT_VS, HEAT_FS)
    this.pLine = program(gl, LINE_VS, LINE_FS)
    this.pointBuf = gl.createBuffer()!
    this.lineBuf = gl.createBuffer()!
    this.heatVbo = gl.createBuffer()!
    this.tex = gl.createTexture()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.heatVbo)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
  }

  setData(xy: Float32Array<ArrayBuffer>, pointCount: number): void {
    const gl = this.gl
    this.xy = xy
    this.count = pointCount
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuf)
    gl.bufferData(gl.ARRAY_BUFFER, xy, gl.STATIC_DRAW)
  }

  private resize(o: RenderOptions): void {
    const gl = this.gl
    const pw = Math.max(1, Math.round(this.canvas.clientWidth * o.dpr))
    const ph = Math.max(1, Math.round(this.canvas.clientHeight * o.dpr))
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw
      this.canvas.height = ph
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  private commonUniforms(p: WebGLProgram, o: RenderOptions): void {
    const gl = this.gl
    gl.uniform4f(gl.getUniformLocation(p, 'uView'), o.view.x0, o.view.y0, o.view.x1, o.view.y1)
    gl.uniform4f(gl.getUniformLocation(p, 'uPlot'), o.plot.x, o.plot.y, o.plot.w, o.plot.h)
    gl.uniform2f(gl.getUniformLocation(p, 'uCss'), this.canvas.clientWidth, this.canvas.clientHeight)
  }

  render(o: RenderOptions): void {
    if (this.count === 0) return
    this.resize(o)
    const gl = this.gl
    gl.enable(gl.SCISSOR_TEST)
    gl.scissor(
      Math.round(o.plot.x * o.dpr),
      Math.round((this.canvas.clientHeight - o.plot.y - o.plot.h) * o.dpr),
      Math.round(o.plot.w * o.dpr),
      Math.round(o.plot.h * o.dpr)
    )
    if (o.chart === 'line') this.drawLine(o)
    else if (o.chart === 'heatmap') this.drawHeat(o)
    else this.drawScatter(o)
    gl.disable(gl.SCISSOR_TEST)
  }

  private bindAttrib(loc: number, size: number): void {
    const gl = this.gl
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0)
  }

  private drawScatter(o: RenderOptions): void {
    const gl = this.gl
    gl.useProgram(this.pScatter)
    this.commonUniforms(this.pScatter, o)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuf)
    this.bindAttrib(gl.getAttribLocation(this.pScatter, 'aPos'), 2)
    gl.drawArrays(gl.POINTS, 0, this.count)
  }

  private drawLine(o: RenderOptions): void {
    const gl = this.gl
    const w = Math.max(2, Math.round(o.plot.w))
    const { avg } = bin1D(this.xy, this.count, o.view, w)
    const verts: number[] = []
    for (let gx = 0; gx < avg.length; gx++) {
      const y = avg[gx]!
      if (Number.isNaN(y)) continue
      verts.push((gx + 0.5) / avg.length, y)
    }
    gl.useProgram(this.pLine)
    this.commonUniforms(this.pLine, o)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.DYNAMIC_DRAW)
    this.bindAttrib(gl.getAttribLocation(this.pLine, 'aPos'), 2)
    if (verts.length >= 2) gl.drawArrays(gl.LINE_STRIP, 0, verts.length / 2)
  }

  private drawHeat(o: RenderOptions): void {
    const gl = this.gl
    const gw = Math.max(2, Math.min(1024, Math.round(o.plot.w * 0.5)))
    const gh = Math.max(2, Math.min(1024, Math.round(o.plot.h * 0.5)))
    const bins = bin2D(this.xy, this.count, o.view, gw, gh)
    const m = maxCount(bins)
    const rgba = new Uint8Array(gw * gh * 4)
    for (let k = 0; k < bins.length; k++) {
      const c = bins[k]!
      if (c === 0) continue
      const [r, g, b] = ramp(densityT(c, m))
      rgba[k * 4] = r
      rgba[k * 4 + 1] = g
      rgba[k * 4 + 2] = b
      rgba[k * 4 + 3] = 255
    }
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    if (this.gridW !== gw || this.gridH !== gh) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gw, gh, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba)
      this.gridW = gw
      this.gridH = gh
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gw, gh, gl.RGBA, gl.UNSIGNED_BYTE, rgba)
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)

    gl.useProgram(this.pHeat)
    this.commonUniforms(this.pHeat, o)
    gl.uniform1i(gl.getUniformLocation(this.pHeat, 'uTex'), 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.heatVbo)
    this.bindAttrib(gl.getAttribLocation(this.pHeat, 'aCorner'), 2)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  destroy(): void {
    const gl = this.gl
    gl.deleteBuffer(this.pointBuf)
    gl.deleteBuffer(this.lineBuf)
    gl.deleteBuffer(this.heatVbo)
    gl.deleteTexture(this.tex)
    gl.deleteProgram(this.pScatter)
    gl.deleteProgram(this.pHeat)
    gl.deleteProgram(this.pLine)
    this.xy = new Float32Array(0)
  }
}
