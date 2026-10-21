import type { ToolManifest } from '@/core/types'

export const manifest: ToolManifest = {
  id: 'line-light-reader',
  name: '行光阅读器浏览器插件',
  tagline: '专注阅读：逐行冷暖引导色、焦点行高亮、纯净去广告、本地 TTS 朗读与摘录导出',
  category: 'work',
  type: 'plugin',
  targetUsers: ['长文读者', '阅读障碍/注意力分散人群', '技术文档与新闻阅读者'],
  scenarios: ['在长文章上获得逐行引导与焦点行聚焦', '去掉页面广告与干扰聚焦正文', '本地朗读文章并逐句高亮', '选中段落摘录后导出 Markdown/JSON'],
  painPoints: ['网页广告与侧边栏打断阅读', '长文眼睛找不到下一行', '不方便听读技术文档', '摘录来回切换应用'],
  keywords: ['阅读插件', '专注阅读', '行光引导色', '焦点行', '去广告阅读', '阅读障碍字体', 'TTS朗读', '浏览器扩展', 'extension', 'line-light', 'openDyslexic'],
  billing: {
    mode: 'freemium',
    currency: 'CNY',
    priceCents: 4900,
    features: [
      { key: 'guide-focus', label: '引导色 / 焦点行 / 纯净阅读', free: true },
      { key: 'pro-tts-excerpt', label: 'TTS 逐句朗读 / 摘录导出 / Dyslexic 字体（beta 期免费开放）', free: true }
    ]
  },
  createdAt: '2026-10-21',
  updatedAt: '2026-10-21',
  version: '0.1.0',
  status: 'beta',
  plugins: [
    {
      platform: 'browser-chromium',
      packageUrl: '/plugins/line-light-reader/line-light-reader-chrome-0.1.0.zip',
      sha256: '28a171799bd3a4d3ae8ac2f08ee5c905ccf967fdd3a7ffb3569a94a1f3f9ad06',
      sizeBytes: 9127,
      version: '0.1.0',
      minHostVersion: 'Chrome 102 / Edge 102 及以上'
    }
  ]
}
