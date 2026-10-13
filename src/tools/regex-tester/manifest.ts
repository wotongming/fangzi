import type { ToolManifest } from '@/core/types'

export const manifest: ToolManifest = {
  id: 'regex-tester',
  name: '正则表达式测试器',
  tagline: '实时高亮匹配、分组捕获、常用正则模板，本地运行不上传文本',
  category: 'developer',
  type: 'web',
  targetUsers: ['开发者', '测试', '数据处理人员'],
  scenarios: ['写了个正则不确定能不能匹配手机号/邮箱', '需要查看捕获分组内容并逐处高亮', '从常用模板快速生成身份证、URL 等校验规则'],
  painPoints: ['正则语法晦涩、易错且难以调试', '在线正则工具可能把敏感数据上传'],
  keywords: ['正则', '正则表达式', 'regex', 'regexp', '匹配', '捕获分组', '替换', '手机号正则', '校验', 'pattern'],
  billing: { mode: 'free' },
  createdAt: '2026-09-25',
  updatedAt: '2026-10-14',
  version: '1.0.0',
  status: 'stable'
}
