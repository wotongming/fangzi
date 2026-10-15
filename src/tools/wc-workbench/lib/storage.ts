/**
 * 组件库本地持久化（localStorage）。免费档最多保存 FREE_LIBRARY_LIMIT 个。
 * 导入时做结构校验，损坏/非法文件不覆盖现有库。
 */
import type { ComponentModel, PropType } from './model'
import { tagNameOf, toClassName, slug, camelToKebab } from './model'
import { safeIdent, safeKebab } from './code'

const KEY = 'fz-wc-workbench:v1'
export const FREE_LIBRARY_LIMIT = 3

interface Stored {
  models: ComponentModel[]
}

function isPropType(t: unknown): t is PropType {
  return t === 'string' || t === 'number' || t === 'boolean'
}

/** 轻量结构校验：能作为组件模型继续编辑即接受，否则抛错 */
export function sanitizeModel(raw: unknown): ComponentModel {
  if (typeof raw !== 'object' || raw === null) throw new Error('模型不是对象')
  const o = raw as Record<string, unknown>
  if (typeof o.className !== 'string' || !o.className.trim()) throw new Error('缺少 className')
  if (typeof o.prefix !== 'string' || !o.prefix.trim()) throw new Error('缺少 prefix')
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
  const properties = arr(o.properties).map((p) => {
    const x = p as Record<string, unknown>
    if (!x || typeof x.name !== 'string') throw new Error('存在非法属性')
    const name = safeIdent(x.name, 'prop')
    return {
      name,
      attr: typeof x.attr === 'string' ? safeKebab(x.attr) || camelToKebab(name) : camelToKebab(name),
      type: isPropType(x.type) ? x.type : 'string',
      default: x.default == null ? '' : String(x.default),
      description: typeof x.description === 'string' ? x.description : ''
    }
  })
  const events = arr(o.events)
    .map((e) => {
      const x = e as Record<string, unknown>
      return {
        name: safeKebab(typeof x.name === 'string' ? x.name : ''),
        detail: typeof x.detail === 'string' ? x.detail : '',
        description: typeof x.description === 'string' ? x.description : ''
      }
    })
    .filter((e) => e.name)
  const slots = arr(o.slots).map((s) => {
    const x = s as Record<string, unknown>
    return { name: safeKebab(typeof x.name === 'string' ? x.name : ''), description: typeof x.description === 'string' ? x.description : '' }
  })
  const cssVars = arr(o.cssVars)
    .map((v) => {
      const x = v as Record<string, unknown>
      return { name: safeKebab(typeof x.name === 'string' ? x.name : ''), default: typeof x.default === 'string' ? x.default : '', description: typeof x.description === 'string' ? x.description : '' }
    })
    .filter((v) => v.name)
  return {
    className: toClassName(typeof o.className === 'string' ? o.className : ''),
    prefix: slug(typeof o.prefix === 'string' ? o.prefix : '') || 'wc',
    description: typeof o.description === 'string' ? o.description : '',
    properties,
    events,
    slots,
    cssVars,
    updatedAt: Date.now()
  }
}

function read(): Stored {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { models: [] }
    const parsed = JSON.parse(raw) as Stored
    return Array.isArray(parsed.models) ? parsed : { models: [] }
  } catch {
    return { models: [] }
  }
}

function write(s: Stored): void {
  localStorage.setItem(KEY, JSON.stringify(s))
}

export function listModels(): ComponentModel[] {
  return read().models.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
}

/** Pro 不受数量上限：保存时由调用方告知是否专业版 */
export function saveModelBilling(m: ComponentModel, pro: boolean): { saved: boolean; reason?: string } {
  const s = read()
  const tag = tagNameOf(m)
  const idx = s.models.findIndex((x) => tagNameOf(x) === tag)
  if (!pro && idx === -1 && s.models.length >= FREE_LIBRARY_LIMIT)
    return { saved: false, reason: `免费版本地最多保存 ${FREE_LIBRARY_LIMIT} 个组件` }
  const next = { ...m, updatedAt: Date.now() }
  if (idx === -1) s.models.push(next)
  else s.models[idx] = next
  write(s)
  return { saved: true }
}

export function deleteModel(tag: string): void {
  const s = read()
  s.models = s.models.filter((x) => tagNameOf(x) !== tag)
  write(s)
}

export function parseModelJson(text: string): ComponentModel {
  return sanitizeModel(JSON.parse(text))
}
