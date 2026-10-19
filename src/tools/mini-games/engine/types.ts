/**
 * 炫光游戏渲染核心 —— 共享类型与渲染抽象。
 *
 * 游戏逻辑只面向 NeonEngine / Renderer 编程，不直接触碰具体后端；
 * WebGPU(M2) / WebGL2 / Canvas2D 三后端实现同一接口，按设备能力自动降级。
 * 坐标统一使用 CSS 像素（左上角原点，y 向下），后端内部再按 DPR 换算设备像素。
 */

export type BackendKind = 'webgpu' | 'webgl2' | 'canvas2d'

/** 单个粒子（后端无关的纯数据；fx 系统在 node 下也可直接运算/单测）。 */
export interface NeonParticle {
  x: number
  y: number
  vx: number
  vy: number
  /** 剩余生命（秒） */
  life: number
  /** 初始生命（秒），用于算存活比例 */
  maxLife: number
  /** 半径（CSS 像素） */
  size: number
  /** 色相 0..360 */
  hue: number
  /** 0..1，初始亮度倍率（爆炸核心更亮） */
  glow: number
}

export interface BurstOptions {
  /** 粒子数量 */
  count?: number
  /** 初速度量级（px/s） */
  power?: number
  /** 统一色相；不给则在调色板内随机 */
  hue?: number
  /** 扩散方向是否全向（默认 true） */
  radial?: boolean
  /** 初始方向（弧度），radial=false 时生效 */
  dir?: number
  /** 粒子半径倍率 */
  sizeScale?: number
  /** 生命（秒），不给则随机 */
  life?: number
}

/** 设备/后端能力对应的渲染规格。 */
export interface QualitySpec {
  backend: BackendKind
  /** 同时存活粒子上限 */
  particleCap: number
  /** DPR 上限 */
  dprCap: number
  /** 辉光叠绘趟数 0..2（0=仅发光点，无额外光晕） */
  bloomPasses: number
}

/** 每帧由引擎传给后端的渲染信息。 */
export interface FrameInfo {
  /** 距上帧秒数（已钳制） */
  dt: number
  /** 背景呼吸 0..1（由音频/时间驱动） */
  beat: number
  /** 屏幕震动偏移（CSS 像素） */
  shakeX: number
  shakeY: number
}

/** 三后端共同实现的渲染器接口。 */
export interface Renderer {
  readonly kind: BackendKind
  init(canvas: HTMLCanvasElement): Promise<void>
  /** 以 CSS 像素给出画布尺寸与目标 DPR（后端负责设置 backing store）。 */
  resize(cssW: number, cssH: number, dpr: number): void
  /** 设置可随机取色的色板（色相数组）。 */
  setPalette(hues: number[]): void
  /** 清空并绘制当前帧。 */
  render(particles: readonly NeonParticle[], info: FrameInfo): void
  /** 运行时调整辉光趟数（帧率自适应降档用，无需重建上下文，可选）。 */
  setBloomPasses?(passes: number): void
  /** 释放 GL/上下文资源。 */
  dispose(): void
}
