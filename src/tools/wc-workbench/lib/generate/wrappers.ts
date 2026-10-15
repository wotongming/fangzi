/**
 * 跨框架 wrapper 生成器（Pro 档，文本产物）。
 * V1 覆盖 React（@lit/react createComponent 风格）与 Vue 3（defineComponent + h）。
 * 消费的是自定义元素标签 <tag>，因此同一份 wrapper 既能包 Lit 版，也能包原生版元素。
 */
import type { ComponentModel, PropDef, EventDef } from '../model'
import { tagNameOf } from '../model'
import { jsStr, pascal, safeIdent, safePascalIdent } from '../code'

function reactEventKey(e: EventDef): string {
  return 'on' + pascal(e.name)
}
function vueHandlerKey(e: EventDef): string {
  return 'on' + pascal(e.name)
}

/** 生成的 TS 属性类型 */
function tsType(p: PropDef): string {
  return p.type === 'number' ? 'number' : p.type === 'boolean' ? 'boolean' : 'string'
}
function vuePropType(p: PropDef): string {
  return p.type === 'number' ? 'Number' : p.type === 'boolean' ? 'Boolean' : 'String'
}

export function reactFileName(m: ComponentModel): string {
  return `${tagNameOf(m)}.react.tsx`
}

export function reactSource(m: ComponentModel): string {
  const tag = tagNameOf(m)
  const comp = safePascalIdent(m.className, 'MyComponent')
  const props = m.properties.map((p) => ({ ...p, name: safeIdent(p.name) }))
  const events = m.events.map((e) => ({ ...e, name: e.name.replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'event' }))
  const litImport = `./${tag}.js` // 与 npm 包 src 输出一致
  const eventsObj = events
    .map((e) => `    ${reactEventKey(e)}: ${jsStr(e.name)} as '${e.name}',`)
    .join('\n')
  const propsT = props.map((p) => `  ${p.name}?: ${tsType(p)};`).join('\n')

  return `/**
 * ${comp} 的 React wrapper —— 由方子 wc-workbench 生成（@lit/react 风格）。
 * 适用于 React 18/19；React 19 已原生支持自定义元素，也可直接渲染 <${tag}>，
 * 此 wrapper 额外提供类型化 props 与事件。
 */
import * as React from 'react';
import { createComponent } from '@lit/react';
import { ${comp} as ${comp}Element } from ${jsStr(litImport)};

export interface ${comp}Props {
${propsT}
  children?: React.ReactNode;
}

export const ${comp}React = createComponent({
  react: React,
  tagName: ${jsStr(tag)},
  elementClass: ${comp}Element,
  events: {
${eventsObj || '    // （未声明事件）'}
  },
});

export default ${comp}React;
`
}

export function vueFileName(m: ComponentModel): string {
  return `${tagNameOf(m)}.vue.ts`
}

export function vueSource(m: ComponentModel): string {
  const tag = tagNameOf(m)
  const comp = safePascalIdent(m.className, 'MyComponent')
  const props = m.properties.map((p) => ({ ...p, name: safeIdent(p.name) }))
  const events = m.events.map((e) => ({ ...e }))
  const propsObj = props
    .map((p) => `    ${p.name}: { type: ${vuePropType(p)}, default: ${p.type === 'string' ? jsStr(p.default) : (p.type === 'boolean' ? (String(p.default).trim().toLowerCase() === 'true' ? 'true' : 'false') : (Number(p.default) || 0))} },`)
    .join('\n')
  const emitsArr = events.map((e) => `    ${jsStr(e.name)},`).join('\n')
  const propFwd = props.map((p) => `        ${p.name}: props.${p.name},`).join('\n')
  const handlerFwd = events
    .map((e) => `        ${vueHandlerKey(e)}: (ev: Event) => emit(${jsStr(e.name)}, (ev as CustomEvent).detail),`)
    .join('\n')

  return `/**
 * ${comp} 的 Vue 3 wrapper —— 由方子 wc-workbench 生成。
 * Vue 3.4+ 已能直接使用自定义元素 <${tag}>；此 wrapper 提供声明式 props/emits 类型。
 */
import { defineComponent, h } from 'vue';

export const ${comp}Vue = defineComponent({
  name: ${jsStr('V' + comp)},
  props: {
${propsObj || '    // （未定义属性）'}
  },
  emits: [
${emitsArr || '    // （未定义事件）'}
  ],
  setup(props, { attrs, slots, emit }) {
    return () =>
      h(
        ${jsStr(tag)},
        {
          ...attrs,
${propFwd}
${handlerFwd}
        },
        slots,
      );
  },
});

export default ${comp}Vue;
`
}
