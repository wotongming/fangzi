/**
 * 由 ComponentModel 生成 API 文档（Markdown）与独立交互演示页（HTML）。
 */
import type { ComponentModel } from './model'
import { tagNameOf } from './model'
import { nativeSource } from './generate/native'

export function docsMarkdown(m: ComponentModel): string {
  const tag = tagNameOf(m)
  const L: string[] = []
  L.push(`# ${m.className}`)
  L.push('')
  L.push(`自定义元素标签：\`<${tag}>\``)
  L.push('')
  L.push(m.description)
  L.push('')
  L.push('## 用法')
  L.push('')
  L.push('```html')
  L.push(`<script src="./${tag}.js" defer></script>`)
  const attrSample = m.properties
    .filter((p) => p.type !== 'boolean')
    .slice(0, 3)
    .map((p) => `${p.attr}="${p.default || ''}"`)
    .join(' ')
  const boolSample = m.properties.filter((p) => p.type === 'boolean').map((p) => p.attr).join(' ')
  L.push(`<${tag} ${attrSample} ${boolSample}></${tag}>`)
  L.push('```')
  L.push('')

  L.push('## 属性 / Attributes')
  L.push('')
  if (m.properties.length) {
    L.push('| 属性 (property) | Attribute | 类型 | 默认值 | 说明 |')
    L.push('| --- | --- | --- | --- | --- |')
    for (const p of m.properties)
      L.push(`| \`${p.name}\` | \`${p.attr}\` | ${p.type} | ${p.type === 'string' ? `\`${p.default}\`` : p.default} | ${p.description} |`)
  } else L.push('（无）')
  L.push('')

  L.push('## 事件')
  L.push('')
  if (m.events.length) {
    L.push('| 事件名 | detail | 说明 |')
    L.push('| --- | --- | --- |')
    for (const e of m.events) L.push(`| \`${e.name}\` | \`${e.detail || '{}'}\` | ${e.description} |`)
  } else L.push('（无）')
  L.push('')

  L.push('## 插槽')
  L.push('')
  if (m.slots.length) {
    L.push('| 插槽 | 说明 |')
    L.push('| --- | --- |')
    for (const s of m.slots) L.push(`| ${s.name ? `\`${s.name}\`` : '默认插槽'} | ${s.description} |`)
  } else L.push('（无）')
  L.push('')

  L.push('## CSS 变量')
  L.push('')
  if (m.cssVars.length) {
    L.push('| 变量 | 默认值 | 说明 |')
    L.push('| --- | --- | --- |')
    for (const v of m.cssVars) L.push(`| \`--${v.name}\` | \`${v.default}\` | ${v.description} |`)
  } else L.push('（无）')
  L.push('')
  return L.join('\n')
}

export function docsFileName(m: ComponentModel): string {
  return `${tagNameOf(m)}.md`
}

/** 独立交互演示页：内联组件源码 + 属性控制面板（不依赖工作台/iframe） */
export function demoHtml(m: ComponentModel): string {
  const tag = tagNameOf(m)
  const controls = m.properties
    .map((p) => {
      if (p.type === 'boolean')
        return `<label><input type="checkbox" data-p="${p.name}" ${String(p.default).toLowerCase() === 'true' ? 'checked' : ''}> ${p.name}</label>`
      if (p.type === 'number')
        return `<label>${p.name} <input type="number" data-p="${p.name}" value="${p.default}"></label>`
      return `<label>${p.name} <input type="text" data-p="${p.name}" value="${p.default}"></label>`
    })
    .join('\n    ')

  const eventLog = m.events
    .map((e) => `el.addEventListener(${JSON.stringify(e.name)}, ev => log(${JSON.stringify(e.name)} + ': ' + JSON.stringify(ev.detail)));`)
    .join('\n  ')

  // 属性名 -> 类型，供控件回写时按 data-p 精确映射（避免把每个控件的值写给全部属性）
  const typeMap =
    '{' + m.properties.map((p) => `${JSON.stringify(p.name)}:${JSON.stringify(p.type)}`).join(',') + '}'

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${m.className} 演示</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;margin:0;padding:24px;color:#0f172a}
  .panel{display:flex;flex-wrap:wrap;gap:14px;margin:16px 0}
  label{font-size:13px;display:flex;align-items:center;gap:6px;color:#334155}
  input{padding:4px 8px;border:1px solid #cbd5e1;border-radius:6px}
  pre{background:#0f172a;color:#86efac;padding:12px;border-radius:8px;font-size:12px;min-height:20px}
</style>
</head>
<body>
  <h2>${m.className} <small style="color:#64748b">&lt;${tag}&gt;</small></h2>
  <p>${m.description}</p>
  <div class="panel">
    ${controls}
  </div>
  <${tag} id="el"><span slot="icon">★</span></${tag}>
  <pre id="log"></pre>
  <script>
${nativeSource(m).replace(/<\/script/gi, '<\\/script')}
  <\/script>
  <script>
    const el = document.getElementById('el');
    const logEl = document.getElementById('log');
    const log = s => logEl.textContent = s + '\\n' + logEl.textContent;
    ${eventLog}
    function sync(){
      const TYPES = ${typeMap};
      const props = {};
      document.querySelectorAll('[data-p]').forEach(c => {
        const name = c.getAttribute('data-p');
        if (TYPES[name] === 'boolean') props[name] = c.checked;
        else if (TYPES[name] === 'number') props[name] = Number(c.value);
        else props[name] = c.value;
      });
      Object.keys(props).forEach(k => { el[k] = props[k]; });
    }
    document.querySelectorAll('[data-p]').forEach(c => c.addEventListener('input', sync));
    sync();
  <\/script>
</body>
</html>`
}
