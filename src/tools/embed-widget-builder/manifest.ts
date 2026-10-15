import type { ToolManifest } from '@/core/types'

export const manifest: ToolManifest = {
  id: 'embed-widget-builder',
  name: '可嵌入交互组件生成平台',
  tagline: '无代码生成报名表单、满意度反馈、星级评分、价格计算器、倒计时等可嵌入小组件：可视化配置、实时预览，一键导出 Shadow DOM 样式隔离的 Web Component 单文件，复制两段代码嵌入任意站点（React/Vue/WordPress 均可），数据不出端',
  category: 'work',
  type: 'web',
  targetUsers: ['网站主 / 内容创作者', '电商与落地页运营', 'SaaS / 产品团队', '自由开发者 / 代理', '自媒体博主'],
  scenarios: [
    'WordPress / 个人站点想加报名、联系、反馈表单，不想装插件全家桶、不想被框架绑定',
    '落地页 / 商品页需要价格计算器、活动倒计时、问卷收集，无代码配置几分钟上线',
    '要把交互组件发给使用不同技术栈（React/Vue/原生 HTML）的客户站点，要求样式隔离、不打架',
    '不想用 iframe 的样式冲突与性能问题，希望复制一段 <script> 就嵌入即用',
    '收集的数据默认留在本地、可导出 CSV，隐私可控、不强制上云'
  ],
  painPoints: [
    '站点加一个交互组件就要装插件 / 绑框架 / 找开发写代码，成本高、维护累',
    'iframe 嵌入样式冲突、加载慢、移动端体验差',
    '同一组件要在 React、Vue、WordPress 等多个技术栈重复实现',
    'Typeform / Tally / Intercom 等订阅贵，且数据要上传到第三方平台'
  ],
  keywords: [
    '组件生成', '可嵌入组件', '嵌入组件', 'widget', 'web component', 'web components', '自定义元素',
    '表单生成', '问卷', '报名表单', '联系表单', '反馈', '满意度', '评分', '星级评分',
    '计算器', '价格计算器', '倒计时', '公告条', '无代码', '零代码', 'nocode',
    'shadow dom', '样式隔离', '跨框架', 'react 组件', 'vue 组件', 'wordpress 插件',
    '落地页', '网站组件', 'embed', 'embeddable', '数据收集', 'csv 导出', '站点运营'
  ],
  billing: {
    mode: 'freemium',
    currency: 'CNY',
    priceCents: 3990,
    features: [
      { key: 'basic-templates', label: '报名/联系表单、满意度反馈、星级评分 3 类基础模板', free: true },
      { key: 'instances-3', label: '本地保存最多 3 个组件、实时预览、导出单文件脚本', free: true },
      { key: 'pro-templates', label: '价格计算器、活动倒计时 2 类进阶模板', free: false },
      { key: 'unlimited-brand', label: '不限组件数量、自定义品牌色、移除「由方子生成」角标', free: false },
      { key: 'data-export', label: '提交数据 CSV 导出与数据面板', free: false }
    ]
  },
  createdAt: '2026-10-15',
  updatedAt: '2026-10-15',
  version: '1.0.0',
  status: 'stable',
  author: 'fangzi'
}
