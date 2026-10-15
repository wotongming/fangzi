/**
 * Custom Elements Manifest（custom-elements.json）生成器。
 * 遵循 @custom-elements-manifest/schema 1.0.0，供 VS Code 等编辑器做标签/属性补全与文档。
 */
import type { ComponentModel } from './model'
import { tagNameOf } from './model'

const TYPE_TEXT: Record<string, string> = {
  string: 'string',
  number: 'number',
  boolean: 'boolean'
}

export interface CEM {
  schemaVersion: string
  modules: Array<Record<string, unknown>>
}

export function manifestObject(m: ComponentModel): CEM {
  const tag = tagNameOf(m)
  const file = `${tag}.js`

  const attributes = m.properties.map((p) => ({
    name: p.attr,
    fieldName: p.name,
    type: { text: TYPE_TEXT[p.type] ?? 'string' },
    default: JSON.stringify(p.type === 'number' ? Number(p.default) || 0 : p.type === 'boolean' ? String(p.default).trim().toLowerCase() === 'true' : p.default),
    description: p.description
  }))

  const fields = m.properties.map((p) => ({
    kind: 'field',
    name: p.name,
    type: { text: TYPE_TEXT[p.type] ?? 'string' },
    description: p.description
  }))

  const events = m.events.map((e) => ({
    name: e.name,
    type: { text: 'CustomEvent' },
    description: e.detail ? `${e.description}（detail：${e.detail}）` : e.description
  }))

  const slots = m.slots.map((s) => {
    const base: Record<string, string> = { description: s.description }
    if (s.name) base.name = s.name // 无 name 字段即默认插槽
    return base
  })

  const cssProperties = m.cssVars.map((v) => ({
    name: `--${v.name}`,
    default: v.default,
    description: v.description
  }))

  return {
    schemaVersion: '1.0.0',
    modules: [
      {
        kind: 'javascript-module',
        path: file,
        declarations: [
          {
            kind: 'class',
            name: m.className,
            tagName: tag,
            customElement: true,
            description: m.description,
            attributes,
            members: fields,
            events,
            slots,
            cssProperties
          }
        ],
        exports: [
          { kind: 'js', name: m.className, declaration: { name: m.className } },
          { kind: 'custom-element-definition', name: tag, declaration: { name: m.className, module: file } }
        ]
      }
    ]
  }
}

export function manifestJson(m: ComponentModel): string {
  return JSON.stringify(manifestObject(m), null, 2)
}

export const manifestFileName = 'custom-elements.json'
