import type { ToolManifest } from '@/core/types'

export const manifest: ToolManifest = {
  id: 'json-formatter',
  name: 'JSON 格式化校验器',
  tagline: '一键美化/压缩/转义 JSON，定位语法错误，支持树形浏览，纯本地处理',
  category: 'developer',
  type: 'web',
  targetUsers: ['开发者', '测试', '产品与运营'],
  scenarios: ['接口返回的 JSON 挤成一团，想格式化看结构', '怀疑 JSON 有语法错误，需要定位到具体行列', '在美化、压缩、Unicode 转义之间互相转换'],
  painPoints: ['JSON 报错只提示位置不直观，肉眼难排查', '敏感数据不敢粘贴到不明在线工具'],
  keywords: ['json', '格式化', '美化', '压缩', '校验', '语法错误', '转义', 'unicode', '树状', 'pretty', '接口数据'],
  billing: { mode: 'free' },
  createdAt: '2026-09-26',
  updatedAt: '2026-10-14',
  version: '1.0.0',
  status: 'stable'
}
