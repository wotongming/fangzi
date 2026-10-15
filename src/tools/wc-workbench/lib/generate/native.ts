/**
 * 原生 Web Components 代码生成器（免费档、零依赖、可直接 <script> 运行）。
 * 产物为 IIFE：class extends HTMLElement + attachShadow + observedAttributes，
 * 含 prop/attribute 双向反射、CustomEvent 派发方法、slot、CSS 变量主题接口。
 * 定位「可读、可编辑的骨架」。shadow 结构在生成期固化为静态字符串，
 * 运行时属性值一律走 textContent / 属性，不把用户值拼进 HTML。
 */
import type { ComponentModel, CssVarDef, PropDef } from '../model'
import { tagNameOf } from '../model'
import { jsStr, pascal, defaultLiteral, safeIdent, safePascalIdent, safeComment, safeKebab } from '../code'

export function nativeFileName(m: ComponentModel): string {
  return `${tagNameOf(m)}.js`
}

/** CSS 变量默认值只放行安全字符，避免注入畸形样式 */
function safeCss(v: CssVarDef): string {
  return String(v.default ?? '').replace(/[^a-zA-Z0-9#%,.()/_\-:;! ]/g, '')
}

/** 规范化属性：得到安全 JS 名与 kebab attribute */
function np(p: PropDef): PropDef & { pn: string } {
  return { ...p, name: safeIdent(p.name), attr: safeKebab(p.attr) || camelAttr(p.name), pn: safeIdent(p.name) }
}
function camelAttr(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9-]/g, '')
}

export function nativeSource(m: ComponentModel): string {
  const tag = tagNameOf(m)
  const cls = safePascalIdent(m.className, 'MyComponent')
  const props = m.properties.map(np)
  const events = m.events.map((e) => ({ ...e, name: safeKebab(e.name) || 'event' }))
  const slots = m.slots.map((s) => ({ ...s, name: safeKebab(s.name) }))
  const cssVars = m.cssVars.map((v) => ({ ...v, name: safeKebab(v.name) })).filter((v) => v.name)
  const safeDesc = safeComment(m.description)
  const boolProps = props.filter((p) => p.type === 'boolean')
  const valueProps = props.filter((p) => p.type !== 'boolean')
  const firstEvent = events[0]

  const observed = props.map((p) => `    ${jsStr(p.attr)}`).join(',\n')

  const initFields = props
    .map((p) =>
      p.type === 'boolean'
        ? `    this.__${p.pn} = this.hasAttribute(${jsStr(p.attr)}) || (${defaultLiteral(p.type, p.default)});`
        : `    this.__${p.pn} = this.hasAttribute(${jsStr(p.attr)}) ? this.getAttribute(${jsStr(p.attr)}) : (${defaultLiteral(p.type, p.default)});`
    )
    .join('\n')

  const defineProps = props
    .map((p) => {
      const setBody =
        p.type === 'boolean'
          ? `      this.__${p.pn} = !!v;\n      this.toggleAttribute(${jsStr(p.attr)}, !!v);\n      this._sync();`
          : `      this.__${p.pn} = v;\n      if (v == null) { this.removeAttribute(${jsStr(p.attr)}); } else { this.setAttribute(${jsStr(p.attr)}, String(v)); }\n      this._sync();`
      return `    Object.defineProperty(this, ${jsStr(p.name)}, {
      configurable: true, enumerable: true,
      get() { return this.__${p.pn}; },
      set(v) {
${setBody}
      }
    });`
    })
    .join('\n')

  const attrCases = props
    .map((p) => {
      if (p.type === 'boolean')
        return `      if (name === ${jsStr(p.attr)}) { this.__${p.pn} = value != null; this._sync(); return; }`
      if (p.type === 'number')
        return `      if (name === ${jsStr(p.attr)}) { const n = Number(value); this.__${p.pn} = value == null ? (${defaultLiteral(p.type, p.default)}) : (Number.isFinite(n) ? n : 0); this._sync(); return; }`
      return `      if (name === ${jsStr(p.attr)}) { this.__${p.pn} = value == null ? (${defaultLiteral(p.type, p.default)}) : value; this._sync(); return; }`
    })
    .join('\n')

  const syncValue = valueProps
    .map((p) => {
      const node = `this.shadowRoot.querySelector('[data-prop=${jsStr(p.attr)}]')`
      return `    var n_${p.pn} = ${node}; if (n_${p.pn}) n_${p.pn}.textContent = String(this.${p.pn} == null ? '' : this.${p.pn});`
    })
    .join('\n')
  const syncBool = boolProps
    .map((p) => {
      const node = `this.shadowRoot.querySelector('[data-prop=${jsStr(p.attr)}]')`
      return `    var b_${p.pn} = ${node}; if (b_${p.pn}) { b_${p.pn}.textContent = this.${p.pn} ? 'true' : 'false'; b_${p.pn}.classList.toggle('on', !!this.${p.pn}); }`
    })
    .join('\n')
  const labelProp = props.find((p) => p.name === 'label')
  const labelSync = labelProp
    ? `    var lab = this.shadowRoot.querySelector('[data-label]'); if (lab) lab.textContent = String(this.${labelProp.pn} == null ? '' : this.${labelProp.pn});`
    : ''
  // 约定：存在 boolean 属性 disabled 时，同步禁用内部示例按钮（视觉与点击双重拦截）
  const hasDisabled = props.some((p) => p.name === 'disabled' && p.type === 'boolean')
  const syncAction = hasDisabled
    ? `    var actb = this.shadowRoot.querySelector('button[data-action]'); if (actb) actb.disabled = !!this.disabled;`
    : ''

  const emitMethods = events
    .map((e) => `    emit${pascal(e.name)}(detail) {
      this.dispatchEvent(new CustomEvent(${jsStr(e.name)}, { bubbles: true, composed: true, detail: detail || {} }));
    }`)
    .join('\n')

  const clickBind = firstEvent
    ? `    var act = this.shadowRoot.querySelector('[data-action]');
    if (act) act.addEventListener('click', function () { if (!this.disabled) this.emit${pascal(firstEvent.name)}({ source: 'action' }); }.bind(this));`
    : ''

  // —— 生成期固化的 shadow 结构 ——
  const rows = [
    ...valueProps.map((p) => `        <div class="row"><span class="k">${p.name}</span><span class="v" data-prop="${p.attr}"></span></div>`),
    ...boolProps.map((p) => `        <div class="row"><span class="k">${p.name}</span><span class="v b" data-prop="${p.attr}"></span></div>`)
  ].join('\n')
  const namedSlots = slots.filter((s) => s.name)
  const slotLines =
    namedSlots.map((s) => `        <slot name="${s.name}"></slot>`).join('\n') +
    (namedSlots.length ? '\n' : '') +
    `        <slot></slot>`
  const iconSlot = namedSlots.some((s) => s.name === 'icon') ? '<slot name="icon"></slot>' : ''

  const struct = [
    '<style>',
    ':host{display:inline-block;font-family:system-ui,-apple-system,Segoe UI,sans-serif;}',
    `:host{${cssVars.map((v) => `--${v.name}:${safeCss(v) || 'initial'}`).join(';')}}`,
    '.root{border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;min-width:160px;box-sizing:border-box;}',
    '.row{display:flex;justify-content:space-between;gap:12px;font-size:13px;line-height:1.7;}',
    '.k{color:#64748b}.v{color:#0f172a;font-weight:600}.v.on{color:var(--primary-color,#2563eb)}',
    'button{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:6px;margin-top:8px;padding:6px 14px;border-radius:var(--radius,8px);background:var(--primary-color,#2563eb);color:#fff;font-size:13px}',
    'button[disabled]{opacity:.5;cursor:not-allowed}',
    '</style>',
    '<div class="root" part="root">',
    rows,
    '  <div class="act"><button type="button" data-action>' + iconSlot + '<span data-label></span></button></div>',
    slotLines,
    '</div>'
  ]
    .filter((l) => l !== '')
    .join('\n')

  return `/**
 * ${cls} — 由方子「跨框架组件库工作台」生成的原生 Web Component（零依赖）。
 * 标签：<${tag}>
 * 描述：${safeDesc}
 * 属性 / 事件 / 插槽 / CSS 变量见同包 custom-elements.json 与 API 文档。
 */
(function () {
  'use strict';

  class ${cls} extends HTMLElement {
    static get observedAttributes() {
      return [
${observed}
      ];
    }

    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this.shadowRoot.innerHTML = ${jsStr(struct)};
${initFields}
${defineProps}
      this._sync();
    }

    connectedCallback() {
${clickBind || '      /* 未声明事件：示例按钮不派发 */'}
    }

    attributeChangedCallback(name, oldValue, value) {
      if (oldValue === value) return;
${attrCases}
    }

    _sync() {
      if (!this.shadowRoot) return;
${syncValue || '      /* 无 string/number 属性需同步 */'}
${syncBool}
${labelSync}
${syncAction}
    }

${emitMethods || '    /* 未声明自定义事件 */'}
  }

  if (!customElements.get(${jsStr(tag)})) {
    customElements.define(${jsStr(tag)}, ${cls});
  }
})();
`
}
