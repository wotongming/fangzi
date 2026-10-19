import type { ToolManifest } from '../../core/types'

/**
 * 莫比环 MÖBIUS —— 一指翻转 3D 莫比乌斯环带跑酷
 */
export const manifest: ToolManifest = {
  id: 'mobius-runner',
  name: '莫比环 MÖBIUS',
  tagline: '一指翻转的 3D 莫比乌斯光带跑酷：穿过半扭转，正反面会真正对调',
  category: 'life',
  type: 'web',
  targetUsers: ['通勤碎片时间想放空一局的人', '喜欢单指超休闲游戏的玩家', '偏爱炫光/几何/跑酷视觉的用户'],
  scenarios: [
    '排队、午休、通勤时想玩一局几十秒到几分钟、点开即玩的全屏小游戏',
    '想体验新鲜 3D 几何玩法：莫比乌斯环每转一圈正反面会对调',
    '不想注册登录、不想被广告打断，希望离线也能玩、分数保存在本机'
  ],
  painPoints: [
    '普通跑酷玩法陈旧，缺少真正利用 3D 几何的新鲜机制',
    '小游戏广告多、要联网、引导繁琐，不能秒开秒玩',
    '高分依赖本地存档丢失或被上传，缺乏隐私感'
  ],
  keywords: [
    '莫比环', '莫比乌斯', 'mobius', '3d跑酷', '跑酷', '一指', '单指',
    '翻转', '光带', '炫光', '全屏小游戏', '超休闲', 'hypercasual', 'three.js', '几何游戏',
    '解压', '摸鱼', '离线游戏', '无尽跑酷'
  ],
  billing: {
    mode: 'freemium',
    currency: 'CNY',
    priceCents: 1290,
    features: [
      { key: 'core', label: '完整核心玩法：无限跑酷、连击倍率、半扭转环带、本地最高分', free: true },
      { key: 'revive', label: '每局限一次「光盾续命」', free: false },
      { key: 'themes', label: '炫彩主题皮肤包（极光/熔火/幽紫）', free: false },
      { key: 'trail', label: '专属流光拖尾与徽章', free: false },
      { key: 'future-modes', label: '后续新增模式与关卡（持续更新）', free: false }
    ]
  },
  createdAt: '2026-10-19',
  updatedAt: '2026-10-19',
  version: '1.0.0',
  status: 'beta',
  immersive: true,
  author: 'fangzi'
}

export default manifest
