/**
 * 上新模板本地持久化（LocalStorage，仅配置、无媒体）。
 * 带版本号与损坏回退：读取失败/结构异常一律回退默认，绝不影响主流程。
 * 序列化/校验为纯函数，便于单测；读写 localStorage 的部分做了环境守卫。
 */
import type { EcomTemplateV1, EcomWatermarkConf } from './types'

export const TEMPLATE_STORAGE_KEY = 'fz-img:ecom-templates'

export function defaultWatermark(): EcomWatermarkConf {
  return {
    enabled: false,
    text: '',
    fontScale: 0.05,
    color: '#ffffff',
    opacity: 0.5,
    rotateDeg: 0,
    position: 'br',
    tile: false,
    tileGap: 0.28
  }
}

export function defaultTemplate(): EcomTemplateV1 {
  return {
    version: 1,
    name: '默认上新模板',
    specKeys: ['taobao-1x1-800'],
    output: { format: 'image/jpeg', quality: 0.88, targetBytes: 0, fit: undefined },
    bg: { mode: 'none', color: '#ffffff' },
    watermark: defaultWatermark(),
    nameTpl: '{product}_{platform}_{index}',
    product: '',
    color: '',
    updatedAt: 0
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/** 宽松校验并归一化任意输入为合法模板；非法返回 null */
export function normalizeTemplate(raw: unknown): EcomTemplateV1 | null {
  if (!isObj(raw)) return null
  if (raw.version !== 1 || !Array.isArray(raw.specKeys) || !raw.specKeys.length) return null
  const d = defaultTemplate()
  const wmIn = isObj(raw.watermark) ? raw.watermark : {}
  return {
    version: 1,
    name: typeof raw.name === 'string' && raw.name ? raw.name.slice(0, 60) : d.name,
    specKeys: raw.specKeys.filter((k): k is string => typeof k === 'string').slice(0, 20),
    output: isObj(raw.output) ? raw.output as EcomTemplateV1['output'] : {},
    bg: isObj(raw.bg)
      ? {
          mode: (raw.bg.mode as EcomTemplateV1['bg']['mode']) ?? 'none',
          color: typeof raw.bg.color === 'string' ? raw.bg.color : '#ffffff'
        }
      : d.bg,
    watermark: { ...d.watermark, ...(wmIn as Partial<EcomWatermarkConf>) },
    nameTpl: typeof raw.nameTpl === 'string' && raw.nameTpl ? raw.nameTpl.slice(0, 200) : d.nameTpl,
    product: typeof raw.product === 'string' ? raw.product : '',
    color: typeof raw.color === 'string' ? raw.color : '',
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0
  }
}

function storage(): Storage | null {
  try {
    return typeof globalThis !== 'undefined' && (globalThis as { localStorage?: Storage }).localStorage
      ? (globalThis as { localStorage: Storage }).localStorage
      : null
  } catch {
    return null
  }
}

/** 读取模板；任何异常/损坏都回退默认 */
export function loadTemplate(): EcomTemplateV1 {
  const ls = storage()
  if (!ls) return defaultTemplate()
  try {
    const raw = ls.getItem(TEMPLATE_STORAGE_KEY)
    if (!raw) return defaultTemplate()
    return normalizeTemplate(JSON.parse(raw)) ?? defaultTemplate()
  } catch {
    return defaultTemplate()
  }
}

/** 保存模板；失败静默（隐私模式/配额）不抛出 */
export function saveTemplate(tpl: EcomTemplateV1): boolean {
  const ls = storage()
  if (!ls) return false
  try {
    ls.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify({ ...tpl, updatedAt: Date.now() }))
    return true
  } catch {
    return false
  }
}
