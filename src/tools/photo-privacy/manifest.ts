import type { ToolManifest } from '@/core/types'

export const manifest: ToolManifest = {
  id: 'photo-privacy',
  name: '照片隐私清理工作台',
  tagline: '发图前本地一键清除照片 GPS/拍摄设备等 EXIF 隐私，手选区域马赛克/模糊打码、清洗文件名并压缩，图片全程不出设备',
  category: 'life',
  type: 'web',
  targetUsers: ['二手交易卖家', '房东', '家长（晒娃）', '求职者', '自媒体与运营', '维权留证者', '经常在群里/社交平台发图的人', '注重隐私的用户'],
  scenarios: [
    '在二手平台/卖房群发布带门牌、票据的照片前，想去掉拍摄定位并打码敏感信息',
    '晒娃、晒机票证件、发原图给陌生人前，担心 GPS 与设备信息泄露被定位',
    '工作截图含姓名/电话/地址/订单号，需要框选马赛克后再发群',
    '一次要发多张图，希望批量去隐私、统一压缩并打包，逐张处理太麻烦',
    '担心文件名里的时间、地点、序号暴露信息，需要清洗重命名'
  ],
  painPoints: [
    '原图 EXIF 携带精确 GPS、拍摄时间、设备型号甚至序列号，发原图可能被定位人肉',
    '在线“去 EXIF”工具要把照片上传到陌生服务器，反而更不安全',
    '打码要另找 App、压缩要再找工具，链路割裂、逐张处理费时',
    '截图里的手机号、地址、二维码、订单号容易忘记遮挡',
    '批量发图时文件名中的时间戳、地点、序号会泄露额外信息'
  ],
  keywords: [
    '照片隐私', '去exif', '清除exif', '去除定位', 'gps信息', '照片去信息', '原图定位', '防止泄露',
    '马赛克', '打码', '涂鸦遮挡', '模糊处理', '涂抹', '遮车牌号', '遮二维码', '截图打码',
    '文件名清洗', '批量打码', '隐私保护', '发朋友圈', '二手交易发图', '晒娃', '证件照遮挡',
    'remove exif', 'metadata', 'photo privacy', '本地处理', '不上传', '信息脱敏'
  ],
  billing: {
    mode: 'freemium',
    currency: 'CNY',
    priceCents: 1290,
    features: [
      { key: 'strip', label: '元数据/GPS 一键清理、单张处理', free: true },
      { key: 'redact-pro', label: '多区域 / 自由涂抹 / 模糊打码', free: false },
      { key: 'batch', label: '批量不限量与 ZIP 打包', free: false },
      { key: 'preset', label: '场景预设与文件名清洗高级模板', free: false }
    ],
    subscription: { priceCentsPerMonth: 500, priceCentsPerYear: 3900 },
    usagePack: { priceCentsPerUnit: 100, unit: '张', freePerDay: 5 }
  },
  createdAt: '2026-10-17',
  updatedAt: '2026-10-17',
  version: '1.0.0',
  status: 'stable',
  author: 'fangzi'
}
