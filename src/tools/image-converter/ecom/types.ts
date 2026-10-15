/**
 * 电商上新模式：类型定义。
 * 全部为可序列化配置（模板可存 LocalStorage）；运行期资源（自定义底图/logo 的 Image 对象）不进配置。
 */

export type EcomFit = 'cover' | 'contain'

export type EcomFormat = 'image/jpeg' | 'image/png' | 'image/webp'

/** 换底方式：none=保持原样；color=纯色（含 white）；image=自定义底图（仅内存） */
export type EcomBgMode = 'none' | 'color' | 'image'

export interface EcomBgConf {
  mode: EcomBgMode
  /** mode=color 时的底色，如 '#ffffff' */
  color: string
}

export interface EcomWatermarkConf {
  enabled: boolean
  text: string
  /** 字号占输出短边的比例（0.01–0.12） */
  fontScale: number
  color: string
  /** 0–1 */
  opacity: number
  /** 旋转角（度） */
  rotateDeg: number
  /** 定位九宫格 */
  position: 'tl' | 'tc' | 'tr' | 'ml' | 'mc' | 'mr' | 'bl' | 'bc' | 'br'
  /** 是否对角平铺（平铺时 position 仅决定起始区域） */
  tile: boolean
  /** 平铺间距占短边比例 */
  tileGap: number
}

/** 单个平台规格（一个规格 = 每张原图的一份输出） */
export interface EcomSpec {
  /** 平台/渠道唯一键，用作 ZIP 内目录名 */
  key: string
  label: string
  /** 目标宽高比 w/h：1=1:1，3/4=0.75 竖图，4/3≈1.333 横图 */
  ratio: number
  /** 输出长边像素 */
  longEdge: number
  fit: EcomFit
  format: EcomFormat
  /** 起始编码质量 0–1（jpeg/webp） */
  quality: number
  /** 目标文件大小（字节），0=不限制；仅对 jpeg/webp 二分逼近 */
  targetBytes: number
  bg: EcomBgConf
}

/** 命名模板变量 */
export interface NameVars {
  base: string
  product: string
  color: string
  platform: string
  index: number
  ext: string
}

/** 可持久化的上新模板（不含结果与运行期图片） */
export interface EcomTemplateV1 {
  version: 1
  name: string
  specKeys: string[]
  /** 覆盖规格的全局输出设置（可选） */
  output?: Partial<Pick<EcomSpec, 'format' | 'quality' | 'targetBytes' | 'fit'>>
  bg: EcomBgConf
  watermark: EcomWatermarkConf
  nameTpl: string
  product: string
  color: string
  updatedAt: number
}
