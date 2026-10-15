/**
 * Lit + TypeScript 代码生成器（Pro 档，文本产物：需构建链运行）。
 * 输出 Lit 3 风格单文件组件：@customElement / @property / css 变量 / slots / CustomEvent。
 */
import type { ComponentModel, CssVarDef } from '../model'
import { tagNameOf } from '../model'
import { jsStr, pascal, safeIdent, safePascalIdent, safeComment, safeKebab } from '../code'

function safeCss(v: CssVarDef): string {
  return String(v.default ?? '').replace(/[^a-zA-Z0-9#%,.()/_\-:;! ]/g, '')
}

export function litFileName(m: ComponentModel): string {
  return `${tagNameOf(m)}.ts`
}

export function litSource(m: ComponentModel): string {
  const tag = tagNameOf(m)
  const cls = safePascalIdent(m.className, 'MyComponent')
  const props = m.properties.map((p) => ({ ...p, name: safeIdent(p.name) }))
  const events = m.events.map((e) => ({ ...e, name: safeKebab(e.name) || 'event' }))
  const slots = m.slots.map((s) => ({ ...s, name: safeKebab(s.name) }))
  const cssVars = m.cssVars.map((v) => ({ ...v, name: safeKebab(v.name) })).filter((v) => v.name)
  const safeDesc = safeComment(m.description)

  const propLines = props
    .map((p) => {
      if (p.type === 'number')
        return `  @property({ type: Number }) ${p.name}: number = ${Number(p.default) || 0}; // ${safeComment(p.description)}`
      if (p.type === 'boolean')
        return `  @property({ type: Boolean }) ${p.name} = ${String(p.default).trim().toLowerCase() === 'true'}; // ${safeComment(p.description)}`
      return `  @property() ${p.name}: string = ${jsStr(p.default)}; // ${safeComment(p.description)}`
    })
    .join('\n')

  const emits = events
    .map(
      (e) =>
        `  private emit${pascal(e.name)}(detail: unknown = {}) {\n    this.dispatchEvent(new CustomEvent(${jsStr(e.name)}, { bubbles: true, composed: true, detail }));\n  }`
    )
    .join('\n')

  const valueRows = props
    .filter((p) => p.type !== 'boolean')
    .map((p) => `      <div class="row"><span>${p.name}</span><span>\${this.${p.name}}</span></div>`)
    .join('\n')
  const boolRows = props
    .filter((p) => p.type === 'boolean')
    .map((p) => `      <div class="row"><span>${p.name}</span><span>\${this.${p.name} ? 'true' : 'false'}</span></div>`)
    .join('\n')
  const namedSlots = slots.filter((s) => s.name)
  const slotLines =
    namedSlots.map((s) => `      <slot name="${s.name}"></slot>`).join('\n') +
    (namedSlots.length ? '\n' : '') +
    `      <slot></slot>`
  const iconSlot = namedSlots.some((s) => s.name === 'icon') ? '<slot name="icon"></slot>' : ''
  const onClick = events[0]
    ? ` @click=\${() => { if (!this.disabled) this.emit${pascal(events[0].name)}({ source: 'action' }); }}`
    : ''

  const cssHostVars = cssVars.map((v) => `    --${v.name}: ${safeCss(v) || 'initial'};`).join('\n')

  return `/**
 * ${cls} — 由方子「跨框架组件库工作台」生成的 Lit 3 组件。
 * 标签：<${tag}>
 * 描述：${safeDesc}
 * 依赖：lit（BSD-3-Clause，可商用）。使用 decorators 需 tsconfig 开启 experimentalDecorators
 * 或改用 Lit 推荐的 static properties 写法。
 */
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement(${jsStr(tag)})
export class ${cls} extends LitElement {
  static styles = css\`
    :host {
      display: inline-block;
      font-family: system-ui, -apple-system, Segoe UI, sans-serif;
${cssHostVars}
    }
    .root { border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; min-width: 160px; box-sizing: border-box; }
    .row { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; line-height: 1.7; }
    .row span:last-child { font-weight: 600; }
    button { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; margin-top: 8px;
      padding: 6px 14px; border-radius: var(--radius, 8px); background: var(--primary-color, #2563eb); color: #fff; font-size: 13px; }
    button[disabled] { opacity: .5; cursor: not-allowed; }
  \`;

${propLines || '  // （未定义属性）'}

${emits || '  // （未定义事件）'}

  render() {
    return html\`
      <div class="root" part="root">
${valueRows}
${boolRows}
        <button type="button" data-action ?disabled=\${this.disabled}${onClick}>${iconSlot}<span>\${(this as any).label ?? ''}</span></button>
${slotLines}
      </div>
    \`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    ${jsStr(tag)}: ${cls};
  }
}
`
}
