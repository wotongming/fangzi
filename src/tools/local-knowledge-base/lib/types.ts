/**
 * 本地知识库智能问答 —— 类型定义
 * 数据全部存浏览器本地 IndexedDB，文档内容/提问/向量均不出端。
 */

export type DocFormat = 'txt' | 'markdown' | 'csv' | 'html'

export interface KBDocument {
  id: string
  name: string
  format: DocFormat
  /** 原始解析后的纯文本全文 */
  text: string
  sizeBytes: number
  chunkCount: number
  createdAt: number
}

export interface KBChunk {
  id: string
  docId: string
  docName: string
  /** 文档内序号（从 0 起） */
  index: number
  text: string
  /** L2 归一化后的语义向量；未启用语义模型时缺失 */
  vector?: number[]
  /** 建索引时所用嵌入模型 id，用于模型变更后重建 */
  embedModel?: string
}

export interface Citation {
  chunkId: string
  docId: string
  docName: string
  index: number
  text: string
  score: number
}

export interface AnswerResult {
  /** 合成答案（抽取式，含 [n] 标记） */
  answer: string
  citations: Citation[]
  /** 0~1 置信度，用于低置信提示 */
  confidence: number
  /** 本次检索是否包含语义通道 */
  semantic: boolean
  lowConfidence: boolean
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  at: number
  citations?: Citation[]
  confidence?: number
  semantic?: boolean
}

export interface Conversation {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

/** 模型运行状态（设置页 + 导入流程共用） */
export type EmbedStatus = 'idle' | 'probing' | 'downloading' | 'ready' | 'error' | 'disabled'
