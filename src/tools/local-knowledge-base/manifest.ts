import type { ToolManifest } from '@/core/types'

export const manifest: ToolManifest = {
  id: 'local-knowledge-base',
  name: '本地知识库智能问答',
  tagline:
    '把合同、研报、笔记、说明书等文档拖进浏览器即可本地建库提问：本地语义模型 + 关键词混合检索，答案附原文引用，数据全程不出设备、首次加载模型后可离线使用；大模型文件支持 hf-mirror / Hugging Face 多源与自带对象存储（Cloudflare R2、腾讯云 COS）。',
  category: 'work',
  type: 'web',
  targetUsers: ['律师 / 法务', '金融 / 投研从业者', '医生 / 科研人员', '政务与内网办公人员', '个人知识管理重度用户'],
  scenarios: [
    '对合同、判决书、尽调底稿提问，材料涉密不能上传任何云端 AI，需要答案附原文出处',
    '对研报、财报、课程资料做语义检索与问答，弱网或出差断网时仍要能用',
    '把多年积累的笔记、Markdown、CSV、网页资料建成本地可问答知识库',
    '政企 / 内网环境无外网，需要首次取到模型后完全离线的文档问答工具',
    '不想按席位 / token 为云端 ChatPDF 类产品持续付费'
  ],
  painPoints: [
    '敏感文档上传公有云有合规红线，但本地缺少好用的个人 RAG 工具',
    '云端文档问答按席位 / token 持续收费，企业私有化部署又昂贵',
    '通用搜索只能关键词匹配，问法一变就找不到；需要语义检索 + 关键词混合',
    '大模型文件体积大、境外源国内下载不稳，首次加载慢且易失败'
  ],
  keywords: [
    '本地知识库', '知识库', '文档问答', '本地 rag', 'rag', '私有知识库', '语义检索', '向量检索',
    '混合检索', 'bm25', '文档检索', '合同问答', '研报问答', '离线问答', '数据不出端', '隐私',
    'embedding', 'bge', '向量数据库', 'indexeddb', 'webgpu', '知识管理', 'pdf 问答', '企业知识库',
    'local knowledge base', 'on device ai', '本地大模型'
  ],
  billing: {
    mode: 'freemium',
    currency: 'CNY',
    priceCents: 4990,
    features: [
      { key: 'formats-basic', label: 'txt / Markdown / CSV / HTML 解析、智能分块与引用溯源', free: true },
      { key: 'semantic-small', label: '本地语义模型（bge-small，约 24MB）+ 关键词混合检索', free: true },
      { key: 'docs-20', label: '本地知识库最多 20 个文档', free: true },
      { key: 'unlimited-docs', label: '文档数量不限、批量导入更大知识库', free: false },
      { key: 'model-source', label: '自定义模型源（自带 Cloudflare R2 / 腾讯云 COS 对象存储）', free: false }
    ]
  },
  createdAt: '2026-10-15',
  updatedAt: '2026-10-15',
  version: '1.0.0',
  status: 'beta',
  author: 'fangzi'
}
