/**
 * wc-workbench 组件定义模型（单一事实源）。
 * 一份 ComponentModel 同时驱动：属性表单 / 原生 & Lit 代码生成 / 跨框架 wrapper /
 * 实时预览 / API 文档 / custom-elements.json / npm 包导出，保证各路输出一致、可整体序列化。
 */

export type PropType = 'string' | 'number' | 'boolean'

export interface PropDef {
  /** JS 属性名（camelCase） */
  name: string
  /** 反射到的 HTML attribute（kebab-case，自动派生可手改） */
  attr: string
  type: PropType
  /** 默认值（字符串形式存储，按 type 解释） */
  default: string
  description: string
}

export interface EventDef {
  /** 事件名（kebab-case，如 change） */
  name: string
  /** CustomEvent.detail 的字段说明 */
  detail: string
  description: string
}

export interface SlotDef {
  /** 具名插槽名；空串表示默认插槽 */
  name: string
  description: string
}

export interface CssVarDef {
  /** 不含前导 -- 的变量名，如 primary-color */
  name: string
  default: string
  description: string
}

export interface ComponentModel {
  /** PascalCase 类名，如 MyButton */
  className: string
  /** 作者/命名空间前缀，用于保证标签含连字符且不易冲突，如 acme */
  prefix: string
  description: string
  properties: PropDef[]
  events: EventDef[]
  slots: SlotDef[]
  cssVars: CssVarDef[]
  /** 本地保存时间戳 */
  updatedAt?: number
}

/** 仅保留 [a-z0-9-]，用于 attribute / 事件 / 变量片段 */
export function slug(s: string): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** camelCase -> kebab-case */
export function camelToKebab(s: string): string {
  return slug(s.replace(/([a-z0-9])([A-Z])/g, '$1-$2'))
}

/** 任意输入 -> 合法 PascalCase 标识符（至少一个字母） */
export function toClassName(s: string): string {
  const parts = String(s ?? '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
  let name = parts.join('')
  if (!name) name = 'MyComponent'
  if (/^[0-9]/.test(name)) name = 'C' + name
  return name
}

/** 标签名：prefix-classkebab，强制至少一个连字符且不以连字符开头（自定义元素硬性要求） */
export function tagNameOf(m: Pick<ComponentModel, 'prefix' | 'className'>): string {
  const prefix = slug(m.prefix) || 'wc'
  const base = camelToKebab(m.className) || 'component'
  const tag = `${prefix}-${base}`.replace(/-+/g, '-').replace(/^-+|-+$/g, '')
  return tag.includes('-') ? tag : `wc-${tag}`
}

/** 自定义元素标签合法性：必须全小写、含连字符、不以连字符开头 */
export function isValidTagName(tag: string): boolean {
  return /^[a-z][a-z0-9]*-[a-z0-9-]*[a-z0-9]$/.test(tag)
}

export function emptyModel(name = 'My Button'): ComponentModel {
  const cls = toClassName(name)
  return {
    className: cls,
    prefix: 'wc',
    description: '一个跨框架可用的自定义元素。',
    properties: [
      { name: 'label', attr: 'label', type: 'string', default: '按钮', description: '按钮上显示的文字' },
      { name: 'disabled', attr: 'disabled', type: 'boolean', default: 'false', description: '是否禁用' }
    ],
    events: [{ name: 'press', detail: '{ source }', description: '点击且未禁用时触发' }],
    slots: [
      { name: '', description: '默认插槽：按钮内部的自定义内容' },
      { name: 'icon', description: '可选图标' }
    ],
    cssVars: [
      { name: 'primary-color', default: '#2563eb', description: '主题色' },
      { name: 'radius', default: '8px', description: '圆角' }
    ],
    updatedAt: Date.now()
  }
}

/** 新增属性时给出不重名的建议名与对应 attr */
export function suggestPropName(existing: PropDef[], seed = 'prop'): { name: string; attr: string } {
  const used = new Set(existing.map((p) => p.name))
  let i = existing.length + 1
  let name = seed
  while (used.has(name)) name = `${seed}${++i}`
  return { name, attr: camelToKebab(name) }
}
