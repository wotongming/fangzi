import type { ToolManifest } from '@/core/types'

/** 免费层可登记的扣除项数量（含），超出需专业版 */
export const FREE_ITEM_LIMIT = 1

export const manifest: ToolManifest = {
  id: 'tax-deduction',
  name: '个税专项附加扣除汇算助手',
  tagline: '七项专项附加扣除引导录入与易错预检，夫妻分摊方案比较，退税区间估算与资料 5 年留存清单；只做规则参考、不代申报，数据全程只存本机',
  category: 'life',
  type: 'web',
  targetUsers: [
    '有子女教育/婴幼儿照护扣除的工薪父母',
    '有首套房贷或租房、需在利息与租金间二选一的人',
    '独生子女与非独生子女、需填报赡养老人扣除的人',
    '每年 12 月确认、次年 3–6 月汇算怕填错的工薪族',
    '夫妻双方想比较分摊比例、用足扣除的家庭'
  ],
  scenarios: [
    '12 月确认次年专项附加扣除前，逐项核对条件与扣除比例',
    '年度汇算前做一次易错预检，避免超额超比例或毕业未终止',
    '夫妻在子女教育/婴幼儿/房贷上比较 100% 与各 50% 的分摊',
    '估算本年专项附加扣除大概能少缴多少税',
    '按项目整理需要留存 5 年备查的资料并导出加密备份、设置节点提醒'
  ],
  painPoints: [
    '七项规则多且每年微调，普通人看不懂、易漏填',
    '同一子女合计比例超 100%、毕业未终止、配偶父母误填等错误易触发风险',
    '夫妻如何分摊最省不清楚，个税 App 只负责填报不做家庭方案与预检',
    '房贷利息与租金二选一、非独生分摊上限等条件容易搞错',
    '证明资料需留存 5 年却不知留什么，敏感税务信息又不敢上传第三方'
  ],
  keywords: [
    '个税',
    '个人所得税',
    '专项附加扣除',
    '年度汇算',
    '汇算清缴',
    '退税',
    '补税',
    '子女教育',
    '3岁以下婴幼儿照护',
    '继续教育',
    '大病医疗',
    '住房贷款利息',
    '住房租金',
    '赡养老人',
    '独生子女',
    '夫妻分摊',
    '扣除比例',
    '12月确认',
    '资料留存',
    '个税App'
  ],
  billing: {
    mode: 'freemium',
    currency: 'CNY',
    priceCents: 690,
    features: [
      { key: 'basic', label: `任 1 项扣除的录入与基础规则校验`, free: true },
      { key: 'multi', label: '七项多项同时管理、完整易错预检与年度合计', free: false },
      { key: 'split', label: '夫妻分摊方案（100% / 各 50%）扣除额对比', free: false },
      { key: 'pro', label: '退税区间估算、加密备份导出与 .ics 年度节点提醒', free: false }
    ],
    subscription: { priceCentsPerMonth: 190, priceCentsPerYear: 1900 }
  },
  createdAt: '2026-10-19',
  updatedAt: '2026-10-19',
  version: '1.0.0',
  status: 'beta'
}
