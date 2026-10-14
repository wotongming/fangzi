/**
 * GPU 大数据可视化面板 —— 领域类型定义（gpu-data-viz）
 *
 * 坐标约定（重要）：
 *  - 原始值（raw）：CSV/JSON 中的真实数值（或日期的毫秒时间戳）。
 *  - 归一化坐标（norm）：按所选 X/Y 列的 min/max 线性映射到 [0,1]，y 轴向上。
 *    GPU 渲染、视口变换、CPU binning 全部在归一化空间进行，与数据量级解耦。
 */

/** 图型：折线（按列聚合均值）/ 散点（二维密度）/ 热力图（连续密度色带） */
export type ChartType = 'line' | 'scatter' | 'heatmap'

/** 渲染后端：WebGPU 优先，WebGL2 回退，Canvas2D 兜底 */
export type BackendKind = 'webgpu' | 'webgl2' | 'canvas2d'

/** 列类型：只有 number / date（转时间戳）可作为坐标轴；string 仅可作标签 */
export type ColumnType = 'number' | 'date' | 'string'

export interface ColumnMeta {
  name: string
  index: number
  type: ColumnType
  /** 数值/日期列的原始范围；string 列为 NaN */
  min: number
  max: number
}

/**
 * 载入后的数据集。
 * xy 为 interleaved 归一化坐标（x0,y0,x1,y1...），长度 2*rowCount；
 * rawX/rawY 保留原始值（日期为毫秒时间戳），供刷选统计与导出使用。
 */
export interface Dataset {
  headers: string[]
  columns: ColumnMeta[]
  /** 实际载入行数（免费额度触发截断时 < totalRows） */
  rowCount: number
  /** 源文件/粘贴内容的总行数（不含表头） */
  totalRows: number
  truncated: boolean
  /** 归一化坐标，长度 2*rowCount（ArrayBuffer 支持，便于直接上传 GPU） */
  xy: Float32Array<ArrayBuffer>
  /** X/Y 原始数值，长度 rowCount（日期列为毫秒时间戳） */
  rawX: Float64Array
  rawY: Float64Array
  xMeta: ColumnMeta
  yMeta: ColumnMeta
  /** 数据来源文件名（粘贴数据为「粘贴数据」） */
  sourceName: string
  /** ≤10 万行时保留的原始 CSV 行（不含表头），用于完整导出；大数据集不保留 */
  rawLines?: string[]
}

/** 视口：归一化空间内的可见窗口，y0 为下边界 */
export interface View {
  x0: number
  y0: number
  x1: number
  y1: number
}

export const FULL_VIEW: View = { x0: 0, y0: 0, x1: 1, y1: 1 }

/** 绘图区（去除坐标轴留白后）在 canvas 中的像素矩形（DPR 无关的 CSS 像素） */
export interface PlotRect {
  x: number
  y: number
  w: number
  h: number
}

export interface RenderOptions {
  chart: ChartType
  view: View
  plot: PlotRect
  /** devicePixelRatio */
  dpr: number
}

/** 三个后端实现的统一渲染接口 */
export interface VizRenderer {
  readonly kind: BackendKind
  /** 数据不变时只调 render；切换数据集时重设 */
  setData(xy: Float32Array<ArrayBuffer>, pointCount: number): void
  render(o: RenderOptions): void
  destroy(): void
}

export interface PointStats {
  count: number
  xMin: number
  xMax: number
  xAvg: number
  yMin: number
  yMax: number
  yAvg: number
}
