import type { ToolManifest } from '@/core/types'

export const manifest: ToolManifest = {
  id: 'pose-fitness-coach',
  name: '居家健身摄像头本地纠错教练',
  tagline:
    '打开摄像头即可跟练：端侧姿态模型实时识别 33 个关键点，自动为深蹲、俯卧撑、弓步蹲、臀桥、肩推、平板计数并语音/画面纠错，给出每动作评分、周期训练计划与历史趋势；视频只在本机实时分析，不录制、不上传，首次加载模型后可离线使用。',
  category: 'life',
  type: 'web',
  targetUsers: ['居家健身、无私教的健身爱好者', '想减脂/增肌但担心动作不标准受伤的人', '出差/宿舍/健身房弱网环境跟练的人', '需要动作计数与训练记录、不想买昂贵 AI 健身镜/会员的人'],
  scenarios: [
    '在家做深蹲/俯卧撑，希望有人帮着数次数并提醒“蹲深一点、别膝内扣”',
    '跟练时动作是否标准没人看，担心塌腰、半程导致受伤或白练',
    '弱网/断网或注重隐私，不希望健身视频上传到任何云端',
    '想要一份按目标（减脂/增肌/体态）和器械（无器械/哑铃）生成的周计划并记录进步',
    '用手机后置摄像头放在地上拍侧面，实时看骨架叠加与次数，练完有评分和历史趋势'
  ],
  painPoints: [
    '线下私教贵，线上 AI 健身镜/课程订阅持续收费',
    '多数健身 App 只给视频、不识别“你”的动作，对错全靠自觉',
    '云端姿态分析需要上传摄像头画面，隐私敏感且弱网不可用',
    '自己数次数容易数错、组间休息难以坚持，也看不到长期进步'
  ],
  keywords: [
    '健身', '居家健身', 'AI健身', '姿态识别', '动作计数', '深蹲计数', '俯卧撑计数', '健身教练',
    '私人教练', '动作纠正', '动作纠错', '姿势矫正', '无器械健身', '训练计划', '健身记录',
    'pose detection', 'fitness coach', 'mediapipe', '本地AI', '隐私', '离线健身', '平板支撑',
    '弓步蹲', '臀桥', '肩推', '摄像头健身'
  ],
  billing: {
    mode: 'freemium',
    currency: 'CNY',
    priceCents: 4990,
    features: [
      { key: 'ex-squat', label: '深蹲：摄像头自动计数 + 基础提示', free: true },
      { key: 'ex-pushup', label: '俯卧撑：摄像头自动计数 + 基础提示', free: true },
      { key: 'ex-pro', label: '专业版：弓步蹲 / 臀桥 / 站姿肩推 / 平板支撑', free: false },
      { key: 'coach-pro', label: '实时纠错（膝内扣 / 半程 / 塌腰等）+ 每动作评分', free: false },
      { key: 'plan-pro', label: '按目标与器械生成周期训练计划', free: false },
      { key: 'trend-pro', label: '历史趋势分析与无限训练记录', free: false }
    ]
  },
  createdAt: '2026-10-16',
  updatedAt: '2026-10-16',
  version: '1.0.0',
  status: 'beta',
  author: 'fangzi'
}
