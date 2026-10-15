/**
 * 离线语音转写与会议纪要 —— 领域类型（V1 checkpoint）
 */

/** 一段带时间戳（秒）的转写文本 */
export interface Segment {
  /** 起始秒 */
  start: number
  /** 结束秒；模型可能对最后一段返回 null，落库前按音频时长兜底 */
  end: number
  text: string
}

/** 抽取式本地纪要（V1：纯规则抽取，不接生成式 LLM） */
export interface ExtractiveSummary {
  /** 一句话摘要 */
  headline: string
  /** 关键要点（原文句子） */
  keyPoints: string[]
  /** 待办 / 行动项（命中行动词的原文句子） */
  actionItems: string[]
  /** 已做决定（命中决定词的原文句子） */
  decisions: string[]
}

/** 一条历史转写记录（IndexedDB 持久化） */
export interface TranscriptRecord {
  id: string
  title: string
  /** 音频时长（秒） */
  durationSec: number
  /** 来源文件名或「麦克风录音」 */
  sourceName: string
  /** 语言提示 */
  language: string
  /** 合并后的完整文本 */
  fullText: string
  segments: Segment[]
  summary: ExtractiveSummary | null
  createdAt: number
  updatedAt: number
}

/** 转写过程对外暴露的进度事件 */
export interface AsrProgress {
  phase: 'load' | 'download' | 'transcribe' | 'done' | 'error'
  /** 0~100；download 阶段为模型下载百分比，transcribe 阶段为粗略进度 */
  percent: number
  message: string
}

export type ExportFormat = 'txt' | 'md' | 'srt'
