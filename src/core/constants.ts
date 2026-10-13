import type { BillingMode, PluginPlatform, ToolCategory, ToolType } from './types'

export const CATEGORY_LABELS: Record<ToolCategory, string> = {
  life: '生活',
  work: '工作',
  compliance: '合规',
  developer: '开发',
  security: '安全'
}

export const TOOL_TYPE_LABELS: Record<ToolType, string> = {
  web: '网页工具',
  plugin: '插件'
}

export const BILLING_LABELS: Record<BillingMode, string> = {
  free: '免费',
  buyout: '买断',
  freemium: '免费增值',
  usage: '按次/量'
}

export const PLATFORM_LABELS: Record<PluginPlatform, string> = {
  'browser-chromium': 'Chrome / Edge 浏览器',
  'browser-firefox': 'Firefox 浏览器',
  vscode: 'VS Code 插件',
  idea: 'IntelliJ IDEA 插件'
}

/** 金额（分）转展示文本 */
export function formatPrice(cents: number | undefined, currency: 'CNY' | 'USD' = 'CNY'): string {
  if (cents === undefined) return ''
  if (currency === 'CNY') return `¥${(cents / 100).toFixed(2)}`
  return `$${(cents / 100).toFixed(2)}`
}
