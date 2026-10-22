import type { ToolManifest } from '@/core/types'

/** 免费版可导入照片张数（含），超出需买断 */
export const FREE_PHOTO_LIMIT = 10

export const manifest: ToolManifest = {
  id: 'photo-sheet-print',
  name: '作业照片成册打印',
  tagline: '把群里随手拍的作业/试卷照片批量整理成 A4 成册：多图导入、旋转排序、每页张数/边距/纵横排版，本地预览后打印或导出 PDF，照片不上传',
  category: 'life',
  type: 'web',
  targetUsers: [
    '每天要整理群里作业照片的双职工家长',
    '想把试卷/作业按学科日期归档、留存错题的家长',
    '需要把多张手机照片拼成一页 A4 省纸打印的人',
    '在意照片隐私、不愿上传到云端排版工具的人'
  ],
  scenarios: [
    '老师在群里发了十几张作业照片，想拼成几页 A4 一次打印出来',
    '手机里照片方向歪了、顺序乱了，想旋转排好再成册',
    '想自定义每页放几张、横向还是纵向、留多大边距',
    '想先在预览里看清分页和留白，再打印或导出成 PDF 存档',
    '想把这学期的试卷/错题整理成一册，本地保存不上传'
  ],
  painPoints: [
    '照片散在微信群，一张张下载排版太费时间',
    '手机自带相册没有多图拼 A4、分页成册能力',
    '在线拼图工具要登录、要上传照片，隐私不放心',
    '打印出来才发现方向反了、页边距太挤、图被裁掉',
    '不知道一共几页、每页几张，临时排版反复试错'
  ],
  keywords: [
    '作业打印',
    '试卷打印',
    '照片成册',
    'A4 排版',
    '多图拼版',
    '错题本',
    '家庭打印',
    '照片整理',
    '本地排版',
    'pdf 导出',
    '家长',
    '错题归档',
    'sheet print',
    'photo collage',
    '作业照片'
  ],
  billing: {
    mode: 'freemium',
    currency: 'CNY',
    priceCents: 1500,
    features: [
      { key: 'basic', label: `最多 ${FREE_PHOTO_LIMIT} 张照片、基础 A4 成册排版与本地预览`, free: true },
      { key: 'unlimited', label: '不限照片张数、多页成册、排序/旋转/删除与分组备注', free: false },
      { key: 'high-res-pdf', label: '高清 PDF 导出（150 DPI）与浏览器整册打印', free: false }
    ]
  },
  createdAt: '2026-10-22',
  updatedAt: '2026-10-22',
  version: '1.0.0',
  status: 'beta'
}
