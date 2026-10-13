import type { ToolManifest } from '@/core/types'

export const manifest: ToolManifest = {
  id: 'file-hash-check',
  name: '文件哈希校验器',
  tagline: '本地计算文件 MD5/SHA1/SHA256，校验下载文件是否被篡改',
  category: 'security',
  type: 'web',
  targetUsers: ['所有下载软件/插件的用户', '开发者', '运维'],
  scenarios: ['下载了安装包，想核对官网 SHA256 是否一致', '怀疑文件被篡改或传输损坏', '需要为自己分发的文件生成校验值'],
  painPoints: ['命令行 sha256sum 对普通用户不友好', '担心在线工具偷偷上传文件'],
  keywords: ['哈希', 'sha256', 'md5', 'sha1', '校验', '完整性', '指纹', 'checksum', '文件被篡改', '数字摘要', '校验和'],
  billing: { mode: 'free' },
  createdAt: '2026-10-06',
  updatedAt: '2026-10-14',
  version: '1.0.0',
  status: 'stable'
}
