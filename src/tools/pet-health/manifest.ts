import type { ToolManifest } from '@/core/types'

export const manifest: ToolManifest = {
  id: 'pet-health',
  name: '宠物健康档案与就医管家',
  tagline: '多宠健康时间线、疫苗驱虫提醒、体重曲线、病情摘要与自记药价，全程只存在你手机里',
  category: 'life',
  type: 'web',
  targetUsers: ['养猫养狗的养宠人', '多宠家庭', '常带宠物就医的主人', '担心漏接种漏驱虫的人', '想留存病历和就医花费的人'],
  scenarios: [
    '每月驱虫、每年疫苗怕忘记，想在一个地方看到下次该做什么、有没有逾期',
    '带宠物看医生时，想快速说清症状从什么时候开始、用过什么药、既往病史和过敏',
    '想把化验单、处方、疫苗本拍照存档，急诊时能立刻翻出完整病史',
    '同一种药不同医院价格差很多，想自己记下每次买价，换医院时有个参照',
    '想记录体重变化和全年养宠花费，换机或家人协作时能打包带走档案'
  ],
  painPoints: [
    '照护节点多，疫苗驱虫复诊容易漏',
    '就诊时讲不清症状时间线和既往用药',
    '纸质疫苗本和化验单容易丢、翻不到',
    '宠物医疗同病同药不同价，缺少自己的价格记录',
    '不愿意把宠物和家庭健康信息传到云端订阅服务'
  ],
  keywords: [
    '宠物',
    '养猫',
    '养狗',
    '宠物健康',
    '宠物档案',
    '疫苗',
    '驱虫',
    '疫苗本',
    '宠物病历',
    '就诊记录',
    '宠物用药',
    '体重记录',
    '宠物体重',
    '养宠花费',
    '宠物医院',
    '化验单',
    '复诊提醒',
    '多宠',
    '病情摘要',
    'pet',
    'pet health',
    '宠物就医'
  ],
  billing: {
    mode: 'freemium',
    currency: 'CNY',
    priceCents: 1290,
    features: [
      { key: 'basic', label: '单宠档案、健康记录与照护提醒', free: true },
      { key: 'multi', label: '多只宠物档案与切换', free: false },
      { key: 'analysis', label: '体重曲线与养宠花费分析', free: false },
      { key: 'summary', label: '一键生成给兽医的病情摘要', free: false },
      { key: 'export', label: '家庭档案包导出/导入（含照片）', free: false }
    ],
    subscription: { priceCentsPerMonth: 390, priceCentsPerYear: 2990 }
  },
  createdAt: '2026-10-18',
  updatedAt: '2026-10-18',
  version: '1.0.0',
  status: 'beta'
}
