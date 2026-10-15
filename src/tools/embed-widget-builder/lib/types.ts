/**
 * embed-widget-builder 类型模型
 * 配置可序列化（JSON），既是编辑器状态，也会被整体烘焙进生成的独立 Web Component 脚本。
 */

export type WidgetKind = 'contact' | 'feedback' | 'rating' | 'calculator' | 'countdown'

export type FieldType = 'text' | 'email' | 'textarea' | 'number'

export interface FieldCfg {
  id: string
  /** 提交数据里的键名（英文/拼音，作为 data key） */
  name: string
  label: string
  type: FieldType
  required: boolean
  placeholder?: string
}

export interface ThemeCfg {
  /** 品牌主色（按钮 / 强调），CSS 颜色 */
  primary: string
  /** 圆角 px */
  radius: number
}

export interface CalcCfg {
  qtyLabel: string
  qtyDefault: number
  unitLabel: string
  unitPrice: number
  fixedFee: number
  currency: string
}

export interface CountdownCfg {
  /** ISO 本地时间（datetime-local），烘焙进脚本后转为绝对时间戳 */
  targetAt: string
  completeText: string
  showSeconds: boolean
}

export interface WidgetConfig {
  /** 6 位短 id，决定自定义元素标签 widget-fz-<id> 与存储 key；同一组件保持稳定 */
  id: string
  kind: WidgetKind
  title: string
  description: string
  submitLabel: string
  successText: string
  /** 是否展示「由方子生成」角标；免费版强制 true，Pro 可关闭 */
  poweredBy: boolean
  theme: ThemeCfg
  /** contact：可编辑字段 */
  fields?: FieldCfg[]
  /** feedback：单选项 */
  choices?: string[]
  /** rating：分值上限与两端文案 */
  max?: number
  lowLabel?: string
  highLabel?: string
  calc?: CalcCfg
  countdown?: CountdownCfg
}

/** 组件在预览/宿主侧产生的一次提交记录 */
export interface WidgetSubmission {
  ts: number
  kind: WidgetKind
  [key: string]: string | number
}
