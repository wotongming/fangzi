import type { ToolManifest } from '@/core/types'

export const manifest: ToolManifest = {
  id: 'resume-jd-matcher',
  name: '简历×JD本地匹配与定向优化器',
  tagline:
    '把简历（PDF/Word/粘贴）和招聘 JD 都留在本机：自动抽取技能并核对学历/年限/地点/证书硬门槛，给出 0–100 匹配分、命中与缺失清单，只基于你本人经历生成可溯源的改写建议与求职信草稿，并管理投递看板；全程离线、不上传，支持 Markdown/PDF/CSV 导出。',
  category: 'work',
  type: 'web',
  targetUsers: ['正在找工作/跳槽、要投大量岗位的求职者', '应届生与转行人群，需要对照 JD 改简历', '猎头/职业咨询师帮客户快速评估匹配度', '注重隐私、不愿把简历上传到云端求职工具的人'],
  scenarios: [
    '看到心仪岗位，想先知道简历和 JD 到底匹配多少分、差在哪',
    'JD 要求一堆技能/学历/年限，想快速核对自己是否过硬性门槛',
    '投每个岗位前要针对性改简历、写求职信，但不想从零编',
    '同时投递多家公司，需要本地看板跟踪待投/已投/面试/offer',
    '简历含个人信息，不希望上传到不明云服务'
  ],
  painPoints: [
    '海投命中率低，不知道简历与岗位差距，盲目投递浪费时间',
    '人工逐条比对 JD 与简历耗时（20–40 分钟/岗），易漏看硬门槛',
    '在线简历优化工具要上传简历，隐私与个人信息有泄露风险',
    '通用模板求职信千篇一律，缺乏与本人真实经历的对应',
    '投递公司多、状态杂，靠记忆/表格跟踪容易错过跟进时间'
  ],
  keywords: [
    '简历优化', '简历匹配', 'JD匹配', '岗位匹配度', '求职', '找工作', '跳槽', '简历修改',
    '简历诊断', '求职信', 'cover letter', '投递管理', '求职看板', '技能匹配', '硬门槛',
    '简历解析', 'pdf简历', 'docx简历', 'ATS', '简历关键词', '应届生求职', '转行',
    'resume', 'job description', 'resume matcher', '离线', '隐私'
  ],
  billing: {
    mode: 'freemium',
    currency: 'CNY',
    priceCents: 2990,
    features: [
      { key: 'match-basic', label: '每月 5 个岗位：本地解析简历 + 关键词匹配分 + 硬门槛核对', free: true },
      { key: 'unlimited-match', label: '专业版：不限岗位数量，解锁技能/职责/资质三维诊断', free: false },
      { key: 'suggest-pro', label: '基于本人经历的可溯源改写建议（不虚构）', free: false },
      { key: 'cover-pro', label: '中英文求职信草稿生成与编辑导出', free: false },
      { key: 'board-pro', label: '投递看板（状态流转/跟进提醒）与 CSV 导出', free: false }
    ]
  },
  createdAt: '2026-10-16',
  updatedAt: '2026-10-16',
  version: '1.0.0',
  status: 'beta',
  author: 'fangzi'
}
