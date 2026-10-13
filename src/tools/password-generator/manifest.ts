import type { ToolManifest } from '@/core/types'

export const manifest: ToolManifest = {
  id: 'password-generator',
  name: '安全密码生成器',
  tagline: '用浏览器加密能力生成高强度随机密码，可定制长度与字符集，全程本地',
  category: 'security',
  type: 'web',
  targetUsers: ['所有需要设置密码的人', '安全运维'],
  scenarios: ['注册新账号想要一个又长又随机的密码', '需要排除易混淆字符（0/O、1/l）生成可读密码', '生成随机口令、PIN 或 Passphrase'],
  painPoints: ['自己想的密码有规律、易被字典攻击', '在线生成器可能记录密码'],
  keywords: ['密码', '随机密码', '强密码', 'password', '生成器', '加密随机', '口令', 'passphrase', '安全', '字符集'],
  billing: { mode: 'free' },
  createdAt: '2026-10-07',
  updatedAt: '2026-10-14',
  version: '1.0.0',
  status: 'stable'
}
