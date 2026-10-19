import type { ToolManifest } from '@/core/types'

export const manifest: ToolManifest = {
  id: 'exam-review-scheduler',
  name: '备考错题调度',
  tagline: '把纸质讲义/PDF/网课截图里的错题录进来，按艾宾浩斯间隔自动排复习队列，弱项热力图+模考曲线帮你把时间花在最该补的考点',
  category: 'life',
  type: 'web',
  targetUsers: [
    '在职考证人群（CPA/法考/教资/一建等）',
    '考研复习党',
    '高三/专升本等需要刷错题的学生',
    '错题散落在纸质书和 PDF 里、不知道今天该复习什么的人',
    '担心机构 App 把错题锁在自家题库、想自己掌控数据的人'
  ],
  scenarios: [
    '通勤地铁 10 分钟，想知道今天有哪些错题到点该复习了',
    '纸质讲义/PDF/网课截图里的错题无处归类，想按科目章节考点录进去',
    '复习过的题很快又忘，想按遗忘曲线自动安排下次复习时间',
    '想知道自己哪些考点最弱、该优先补哪里',
    '想记录每次计时模考分数，看看离目标分还差多少、要不要今年报考',
    '换手机/重装浏览器时，想把错题本完整导出带走'
  ],
  painPoints: [
    '错题散落在纸质书、PDF、网课截图里，没有统一归档',
    '不知道今天该复习哪些题，全凭感觉翻书效率低',
    '复习过的题间隔没安排好，记住的又忘',
    '不知道自己真正的弱项考点在哪，平均用力浪费时间',
    '机构错题本锁在自家题库里，无法收录自己的纸质题',
    '错题数据存在云端，在职备考资料隐私不放心'
  ],
  keywords: [
    '错题本',
    '错题',
    '错题整理',
    '艾宾浩斯',
    '间隔重复',
    '间隔复习',
    '复习计划',
    '复习提醒',
    '模考',
    '模考分数',
    '弱项',
    '薄弱考点',
    '备考',
    '考证',
    '考研',
    '考公',
    'CPA',
    '法考',
    '教资',
    '刷题',
    '错题调度',
    '遗忘曲线'
  ],
  billing: {
    mode: 'freemium',
    currency: 'CNY',
    priceCents: 890,
    features: [
      { key: 'basic', label: '单考试项目、错题录入、今日复习队列、弱项热力图与模考曲线', free: true },
      { key: 'multi-project', label: '多个考试项目并行管理（免费仅 1 个）', free: false },
      { key: 'unlimited-questions', label: '错题数量不限（免费 50 道）', free: false },
      { key: 'reports', label: '报考/保弃决策看板与全库导出/导入备份', free: false }
    ],
    subscription: { priceCentsPerMonth: 260, priceCentsPerYear: 2600 }
  },
  createdAt: '2026-10-20',
  updatedAt: '2026-10-20',
  version: '1.0.0',
  status: 'beta'
}
