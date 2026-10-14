/**
 * use-seo：为 SPA/PWA 页面注入「GEO/AEO 友好」元信息。
 *
 * 2026 年搜索趋势（GEO/AEO）：
 *  - AI 搜索流量已占全网搜索 45%+，页面目标从「排名」转向「被 AI 引用」
 *  - JSON-LD 结构化数据是 AI 引用高置信信号（约 71% 被 ChatGPT 引用的页面带 schema）
 *  - Google 2026 弃用 Dataset/Q&A 等类型，SoftwareApplication / FAQPage / WebSite / Organization 等 evergreen schema 仍受支持
 *  - 配合语义化 HTML（article/section + 规范 Heading 层级）、Title/Meta Description 自然关键词
 *
 * 用法（Vue）：
 *   useSeo({
 *     title: '图片处理工作台 - 本地AI超分与去背景',
 *     description: '本地图片转换、压缩、批量工具链与 AI 增强...',
 *     type: 'SoftwareApplication',
 *     keywords: ['图片压缩', 'ai超分', ...],
 *     jsonLd: { ... } // 可选，与内置默认合并
 *   })
 *
 * 零依赖（DOM 操作），可单独使用（非 Vue 环境去掉 onUnmounted 分支即可）。
 */
import { onUnmounted } from 'vue'

export interface SeoOptions {
  title: string
  description: string
  /** schema.org 类型：SoftwareApplication / WebApplication / WebSite / Organization 等 */
  type?: string
  keywords?: string[]
  /** 额外的 JSON-LD 字段，与内置默认浅合并 */
  jsonLd?: Record<string, unknown>
  /** 站点级信息（name/url/logo），默认从 document 推断 */
  siteName?: string
}

let injectedCount = 0

function setMeta(name: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute('name', name)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function upsertScript(id: string, text: string): void {
  const old = document.getElementById(id)
  if (old) old.remove()
  const script = document.createElement('script')
  script.type = 'application/ld+json'
  script.id = id
  script.textContent = text
  document.head.appendChild(script)
}

export function useSeo(opts: SeoOptions): void {
  const type = opts.type ?? 'WebApplication'
  const siteName = opts.siteName ?? 'fangzi'
  const url = typeof location !== 'undefined' ? location.href : ''

  document.title = opts.title
  setMeta('description', opts.description)
  if (opts.keywords?.length) setMeta('keywords', opts.keywords.join(','))

  const baseJsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': type,
    name: opts.title,
    description: opts.description,
    applicationCategory: 'UtilityApplication',
    operatingSystem: 'Any',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'CNY' },
    url
  }
  if (opts.keywords?.length) baseJsonLd.keywords = opts.keywords.join(',')
  const merged = { ...baseJsonLd, ...(opts.jsonLd ?? {}) }

  const id = `seo-jsonld-${++injectedCount}`
  upsertScript(id, JSON.stringify(merged))

  // 站点级 WebSite + Organization（同页共存，均 evergreen 类型）
  upsertScript(
    'seo-jsonld-site',
    JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: siteName,
      url: url.split('/').slice(0, 3).join('/') || url
    })
  )

  onUnmounted(() => {
    document.getElementById(id)?.remove()
  })
}
