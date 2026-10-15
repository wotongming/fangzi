import type { WidgetConfig } from './types'
import { widgetSource, widgetTag } from './gen'

/** 完整可独立打开的 HTML（预览 / 下载 demo 同源使用）；preview=true 时组件向 parent 回传提交 */
export function standaloneDoc(cfg: WidgetConfig, preview = false, hostText = ''): string {
  const tag = widgetTag(cfg)
  const attr = ['data-key="' + cfg.id + '"', preview ? 'data-preview="1"' : '']
    .filter(Boolean)
    .join(' ')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(cfg.title || '方子组件')}</title>
<style>
  body{margin:0;padding:28px;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:#f3f4f6;color:#111827;}
  .host-note{max-width:440px;margin:0 auto 14px;font-size:12px;color:#9ca3af;}
  .host{max-width:440px;margin:0 auto;}
  /* 宿主样式：Shadow DOM 内组件不应被这些规则影响 */
  div{border-radius:0;}
</style>
</head>
<body>
${hostText ? '<div class="host-note">' + escapeHtml(hostText) + '</div>' : ''}
<div class="host">
<${tag} ${attr}></${tag}>
</div>
<script>
${widgetSource(cfg)}</script>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m] as string))
}

/**
 * 两段式嵌入代码：①远程/同站脚本；②自定义元素标签。
 * hostBase 为空时给相对路径（脚本与页面同目录），否则给版本化 URL widgets/v1/<id>.js。
 */
export function embedSnippet(cfg: WidgetConfig, hostBase = ''): string {
  const tag = widgetTag(cfg)
  const base = hostBase.trim()
  let src = tag + '.js'
  if (base) {
    const norm = base.replace(/\/+$/, '')
    src = norm + '/widgets/v1/' + cfg.id + '.js'
  }
  return `<script src="${src}" defer></script>\n<${tag} data-key="${cfg.id}"></${tag}>`
}
