/**
 * 实时预览沙箱：生成自包含 HTML（内联原生组件源码），供 iframe srcdoc 加载。
 * 通过 postMessage 双向通信：父 -> 子 {type:'fz-set-props'} 实时改值；
 * 子 -> 父 {type:'fz-event'} 回传组件派发的自定义事件。全程零网络依赖。
 */
import type { ComponentModel } from './model'
import { tagNameOf } from './model'
import { jsStr } from './code'
import { nativeSource } from './generate/native'

/** 把组件源码安全内联进 <script>：双保险转义闭合序列 */
function inlineScript(source: string): string {
  return source.replace(/<\/script/gi, '<\\/script')
}

function propMeta(m: ComponentModel): string {
  // 注意：这是对象，必须 JSON.stringify，不能用 jsStr（jsStr 内部 String(obj) 会得到 "[object Object]"）
  const meta: Record<string, string> = {}
  for (const p of m.properties) meta[p.name] = p.type
  return JSON.stringify(meta).replace(/</g, '\\u003c')
}

interface ShellOpts {
  /** 额外注入的宿主侧引导脚本（已在函数内包 <script>） */
  bootstrap?: string
  /** 宿主 body 内组件之外的说明/控件 */
  header?: string
}

export function pageShell(m: ComponentModel, opts: ShellOpts = {}): string {
  const tag = tagNameOf(m)
  const source = inlineScript(nativeSource(m))
  const header =
    opts.header ??
    `<p class="hint">这是组件在第三方页面中的真实效果（Shadow DOM 隔离）。用右侧属性面板改值可实时更新。</p>`

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${m.className} 预览</title>
<style>
  body { margin: 0; padding: 20px; background: #f1f5f9; color: #0f172a;
    font-family: system-ui, -apple-system, Segoe UI, sans-serif; }
  .hint { color: #64748b; font-size: 13px; margin: 0 0 14px; }
  .stage { background: #fff; border: 1px dashed #cbd5e1; border-radius: 12px; padding: 24px; display:inline-block; }
  pre#log { margin-top: 14px; font-size: 12px; color: #047857; white-space: pre-wrap; }
</style>
</head>
<body>
  ${header}
  <div class="stage">
    <${tag} id="el">
      <span slot="icon">★</span>
      <small>（默认插槽内容）</small>
    </${tag}>
  </div>
  <pre id="log"></pre>
  <script>${source}<\/script>
  <script>
    (function () {
      var META = ${propMeta(m)};
      var el = document.getElementById('el');
      var log = document.getElementById('log');
      function out(s) { if (log) log.textContent = s + '\\n' + log.textContent; }
      window.__fzApplyProps = function (props) {
        if (!el || !props) return;
        Object.keys(props).forEach(function (name) {
          var t = META[name]; var v = props[name];
          try {
            // 属性 setter 已负责 attribute 反射，这里只赋 JS 属性即可
            // postMessage 传来的试值均为字符串，布尔必须按字面量比较，!!'false' 会错误变 true
            if (t === 'boolean') { el[name] = (v === true || v === 'true'); }
            else if (t === 'number') { el[name] = Number(v); }
            else { el[name] = v == null ? '' : String(v); }
          } catch (e) {}
        });
      };
      ${m.events.map((e) => `el.addEventListener(${jsStr(e.name)}, function (ev) { out('事件 ${e.name}: ' + JSON.stringify(ev.detail)); ${opts.bootstrap ? '' : ''}window.parent && window.parent.postMessage({ __fzWidget: 'event', name: ${jsStr(e.name)}, detail: ev.detail }, '*'); });`).join('\n      ')}
      window.addEventListener('message', function (ev) {
        var d = ev.data;
        if (!d) return;
        if (d.type === 'fz-set-props') window.__fzApplyProps(d.props);
        if (d.type === 'fz-ping') __fzReady();
      });
      // ready 握手：子文档加载可能早于父级监听挂载，故主动重发 + 响应父级 ping，避免竞态
      function __fzReady() {
        try { window.parent && window.parent.postMessage({ __fzWidget: 'ready', tag: ${jsStr(tag)} }, '*'); } catch (e) {}
      }
      __fzReady();
      setTimeout(__fzReady, 120);
      setTimeout(__fzReady, 400);
    })();
  <\/script>
</body>
</html>`
}

/** iframe srcdoc 用预览文档 */
export function previewDoc(m: ComponentModel): string {
  return pageShell(m)
}
