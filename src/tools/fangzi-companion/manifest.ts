import type { ToolManifest } from '@/core/types'

export const manifest: ToolManifest = {
  id: 'fangzi-companion',
  name: '方子助手浏览器插件',
  tagline: '在任意网页划词右键，直接把问题丢给方子搜索对症工具',
  category: 'work',
  type: 'plugin',
  targetUsers: ['方子的高频用户', '遇到问题想立刻搜工具的人'],
  scenarios: ['网页上看到报错或问题，划词右键直接在方子中搜索', '不想来回切换标签页复制问题', '划词调用 AI 解读（高级功能）'],
  painPoints: ['复制问题、打开方子、粘贴搜索的路径太长', '上下文切换打断思路'],
  keywords: ['浏览器插件', '扩展', 'chrome', 'edge', '右键菜单', '划词搜索', 'companion', 'extension', '快捷搜索', '方子助手'],
  billing: {
    mode: 'freemium',
    currency: 'CNY',
    priceCents: 990,
    features: [
      { key: 'context-search', label: '划词右键搜索方子', free: true },
      { key: 'ai-explain', label: '划词 AI 解读', free: false }
    ]
  },
  createdAt: '2026-10-11',
  updatedAt: '2026-10-14',
  version: '0.1.0',
  status: 'beta',
  plugins: [
    {
      platform: 'browser-chromium',
      packageUrl: '/plugins/fangzi-companion/fangzi-companion-chrome-0.1.0.zip',
      sha256: 'b7451dd8f826cf8d793803646447ababed07074834811f7a52636e8293614e4b',
      sizeBytes: 14092,
      version: '0.1.0',
      minHostVersion: 'Chrome 102 / Edge 102 及以上'
    }
  ]
}
