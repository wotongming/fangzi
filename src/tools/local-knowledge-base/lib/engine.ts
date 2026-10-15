/**
 * 知识库引擎：编排 解析→分块→嵌入→索引 与 问答检索。
 * BM25 常驻内存（从 IndexedDB 重建）；向量存 IndexedDB。语义模型按源策略懒加载。
 */
import { chunkText, detectFormat, parseDocument, UNSUPPORTED_HINT } from './ingest'
import { BM25 } from './bm25'
import { ensureEmbedder, embedTexts, isEmbedReady, type EmbedProgress } from './embedder'
import { retrieveAndAnswer } from './retrieval'
import {
  listChunks,
  saveDoc,
  saveChunks,
  deleteDoc as dbDeleteDoc,
  listDocs,
  newId
} from './store'
import { orderedSources, selectSource, type ModelSource } from './models'
import type { KBDocument, KBChunk, DocFormat, AnswerResult } from './types'

export interface IngestProgress {
  stage: 'parse' | 'chunk' | 'embed' | 'save'
  message: string
  embed?: EmbedProgress
}

export class KnowledgeEngine {
  private bm25 = new BM25()
  private chunks: KBChunk[] = []
  private sources: ModelSource[] = orderedSources()
  private loaded = false

  /** 从 IndexedDB 重建内存索引（BM25） */
  async hydrate(): Promise<void> {
    if (this.loaded) return
    this.chunks = await listChunks()
    this.bm25.clear()
    for (const c of this.chunks) this.bm25.add(c.id, c.text)
    this.loaded = true
  }

  get chunkCount(): number {
    return this.chunks.length
  }

  get docCount(): Promise<number> {
    return listDocs().then((d) => d.length)
  }

  semanticReady(): boolean {
    return isEmbedReady()
  }

  /** 选定可用模型源（设置页可手动触发；结果用于下载） */
  async pickSources(): Promise<ModelSource[]> {
    const { source } = await selectSource()
    // 把探测到的可用源置顶，其余作为故障切换
    const rest = this.sources.filter((s) => s.id !== source.id)
    this.sources = [source, ...rest]
    return this.sources
  }

  setSources(sources: ModelSource[]): void {
    this.sources = sources
  }

  /**
   * 导入并建索引。
   * @param useSemantic 是否尝试语义嵌入（模型未就绪会先下载）；失败则降级纯 BM25。
   * @returns 降级原因（若有）
   */
  async ingestFile(
    file: { name: string; text: string },
    useSemantic: boolean,
    onProgress?: (p: IngestProgress) => void
  ): Promise<{ doc: KBDocument; degraded?: string }> {
    await this.hydrate()
    const format: DocFormat | null = detectFormat(file.name)
    if (!format) throw new Error(UNSUPPORTED_HINT)

    onProgress?.({ stage: 'parse', message: '解析文档…' })
    const text = parseDocument(file.text, format)
    onProgress?.({ stage: 'chunk', message: '智能分块…' })
    const pieces = chunkText(text)
    if (!pieces.length) throw new Error('文档内容为空，无法建立索引')

    const docId = newId('doc_')
    const doc: KBDocument = {
      id: docId,
      name: file.name,
      format,
      text,
      sizeBytes: new Blob([text]).size,
      chunkCount: pieces.length,
      createdAt: Date.now()
    }

    const chunks: KBChunk[] = pieces.map((t, i) => ({
      id: `${docId}_${i}`,
      docId,
      docName: file.name,
      index: i,
      text: t
    }))

    let degraded: string | undefined
    if (useSemantic) {
      try {
        onProgress?.({ stage: 'embed', message: '准备本地语义模型…' })
        const sources = await this.pickSources()
        await ensureEmbedder(sources, (embed) =>
          onProgress?.({ stage: 'embed', message: '语义嵌入中…', embed })
        )
        const vectors = await embedTexts(pieces, {
          onProgress: (embed) => onProgress?.({ stage: 'embed', message: '语义嵌入中…', embed })
        })
        chunks.forEach((c, i) => {
          c.vector = vectors[i]
          c.embedModel = 'bge-small-zh-v1.5-q8'
        })
      } catch (err) {
        degraded = `语义模型暂不可用，已用关键词检索建立索引：${(err as Error).message ?? err}`
      }
    }

    onProgress?.({ stage: 'save', message: '保存到本地…' })
    await saveDoc(doc)
    await saveChunks(chunks)
    this.chunks.push(...chunks)
    for (const c of chunks) this.bm25.add(c.id, c.text)
    return { doc, degraded }
  }

  async removeDoc(docId: string): Promise<void> {
    await this.hydrate()
    const ids = new Set(this.chunks.filter((c) => c.docId === docId).map((c) => c.id))
    await dbDeleteDoc(docId)
    this.chunks = this.chunks.filter((c) => c.docId !== docId)
    ids.forEach((id) => this.bm25.remove(id))
  }

  async ask(question: string, useSemantic: boolean): Promise<AnswerResult> {
    await this.hydrate()
    const canSemantic = useSemantic && isEmbedReady()
    const embedQuery = canSemantic
      ? async (q: string): Promise<number[]> => (await embedTexts([q], { query: true, batchSize: 1 }))[0]!
      : undefined
    return retrieveAndAnswer(question, { chunks: this.chunks, bm25: this.bm25, embedQuery })
  }
}

export const engine = new KnowledgeEngine()
