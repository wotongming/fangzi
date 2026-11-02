import type { ToolManifest } from '@/core/types'

export const manifest: ToolManifest = {
  id: 'rent-evidence',
  name: '租赁证据链',
  tagline: '小房东/租客入住交接带时间戳水印拍照、报修工单归责、退租同位置对比、押金维修台账，一键导出证据包 PDF，照片不上传',
  category: 'life',
  type: 'web',
  targetUsers: ['个人小房东', '直租租客', '合租室友', '调解/维权场景当事人'],
  scenarios: [
    '入住交接时按墙面/地板/家电逐项拍照，烧入拍摄时间戳，双方留基准',
    '租期内漏水/损坏报修，照片+文字留痕，自动初判自然老化还是人为损坏',
    '退租时同位置再拍，对比入住基准照；押金/租金/维修费记台账，争议时一键导出证据 PDF'
  ],
  painPoints: [
    '微信照片无时间水印、散落在对话里，举证时找不到',
    '自然损耗 vs 人为损坏各执一词，缺过程证据',
    '押金/维修费用翻聊天记录对不上账'
  ],
  keywords: ['租房', '房东', '租客', '押金', '退租', '交接', '报修', '证据', '时间戳拍照', '租赁纠纷', '维权', '本地', '不上传'],
  billing: {
    mode: 'freemium',
    currency: 'CNY',
    priceCents: 2900,
    features: [
      { key: 'basic', label: '交接水印拍照、报修工单、台账、证据 PDF 导出（本地产额内）', free: true },
      { key: 'pro', label: '多套房分组管理、批量同角度对比标注', free: false }
    ]
  },
  createdAt: '2026-11-02',
  updatedAt: '2026-11-02',
  version: '1.0.0',
  status: 'stable',
  author: 'fangzi'
}
