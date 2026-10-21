import type { ToolManifest } from '@/core/types'

export const manifest: ToolManifest = {
  id: 'pdf-redact',
  name: 'PDF 真脱敏',
  tagline: '发合同/简历/账单前本地框选敏感信息，真删文字层（不是画黑框、导出后复制不出）并清空作者/标题等元数据，文件全程不上传',
  category: 'life',
  type: 'web',
  targetUsers: ['律师/法务', 'HR', '财务', '咨询顾问', '小公司老板', '猎头', '需要对外分享 PDF 的人'],
  scenarios: [
    '把合同模板发给对方前，涂黑自己公司的银行账号/法定代表人身份证号',
    '把简历包给猎头前，隐藏候选人当前薪资/手机号',
    '对外发财报/发票前抹掉未公开科目，并不留作者、修改记录等元数据',
    '担心在线 PDF 工具把含客户信息的文件上传到第三方服务器',
    '用 Mac 预览/Windows 自带涂黑后，发现文字层还在、另存就能看到原文'
  ],
  painPoints: [
    '系统自带涂黑只是视觉遮罩，文字层仍在，对方复制/搜索能看到原文，是真实泄露事故源',
    'Adobe Acrobat Pro 脱敏贵且"标记-应用"流程繁琐易忘',
    '在线 PDF 工具要把合同/简历上传云端，律所/HR/财务合规不允许',
    'PDF 残留作者/修改记录/GPS 等元数据，外发前需要一键清掉'
  ],
  keywords: [
    'pdf脱敏', 'pdf打码', 'pdf去除文字', 'pdf真删', 'pdf遮罩', 'pdf元数据清理', '去除pdf作者',
    '合同脱敏', '简历脱敏', '隐私', '本地处理', '不上传', '不上云', 'redact pdf',
    'pdf redaction', 'remove metadata', '法务工具', 'hr工具'
  ],
  billing: {
    mode: 'buyout',
    currency: 'CNY',
    priceCents: 12900,
    features: [
      { key: 'basic', label: '每次 ≤3 页、框选遮罩、元数据清空', free: true },
      { key: 'redact-pro', label: '不限页数 / 多区域 / 批量页', free: false }
    ]
  },
  createdAt: '2026-10-21',
  updatedAt: '2026-10-21',
  version: '1.0.0',
  status: 'stable',
  author: 'fangzi'
}
