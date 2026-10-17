/**
 * 本地语义嵌入：onnxruntime-web WASM（复用自托管 public/onnx/ 1.30.0）+ 自实现 BERT 分词。
 * bge-small-zh-v1.5 输出 last_hidden_state，按 attention mask 做 mean pooling 后 L2 归一化。
 * 查询侧加检索指令前缀，段落侧不加。
 */
import { BertTokenizer, padBatch, type Encoded } from './tokenizer'
import { EMBED_MODEL, fetchModelFile, type ModelSource } from './models'
import { configureOrtWasm } from '../../../../reusable-module/ort-wasm-loader/ort-wasm-loader'
import type * as OrtType from 'onnxruntime-web'

export interface EmbedProgress {
  phase: 'download' | 'init' | 'embed'
  file?: string
  received: number
  total: number
  done: number
  count: number
}

let tokenizer: BertTokenizer | null = null
let ort: typeof OrtType | null = null
let session: OrtType.InferenceSession | null = null
let loadedModelId: string | null = null

function meanPool(lastHidden: Float32Array, dims: readonly number[], mask: Int32Array): Float32Array {
  const b = dims[0]!
  const seq = dims[1]!
  const h = dims[2]!
  const out = new Float32Array(b * h)
  for (let i = 0; i < b; i++) {
    let valid = 0
    for (let s = 0; s < seq; s++) {
      if (!mask[i * seq + s]) continue
      valid++
      const rowOff = (i * seq + s) * h
      for (let j = 0; j < h; j++) out[i * h + j]! += lastHidden[rowOff + j]!
    }
    const inv = valid ? 1 / valid : 0
    for (let j = 0; j < h; j++) out[i * h + j]! *= inv
  }
  return out
}

function l2Normalize(vectors: Float32Array, h: number): Float32Array {
  const b = vectors.length / h
  for (let i = 0; i < b; i++) {
    let sum = 0
    for (let j = 0; j < h; j++) sum += vectors[i * h + j]! ** 2
    const norm = Math.sqrt(sum) || 1
    for (let j = 0; j < h; j++) vectors[i * h + j]! /= norm
  }
  return vectors
}

export function isEmbedReady(): boolean {
  return !!session && loadedModelId === EMBED_MODEL.id
}

/** 加载/初始化模型（文件全部走 Cache Storage，二次离线） */
export async function ensureEmbedder(
  sources: ModelSource[],
  onProgress?: (p: EmbedProgress) => void
): Promise<void> {
  if (isEmbedReady()) return

  const [vocabBuf, onnxBuf] = await Promise.all([
    fetchModelFile(EMBED_MODEL, EMBED_MODEL.files.find((f) => f.path === 'vocab.txt')!, sources, {
      onProgress: (received, total, file) =>
        onProgress?.({ phase: 'download', file, received, total, done: 0, count: EMBED_MODEL.files.length })
    }),
    fetchModelFile(EMBED_MODEL, EMBED_MODEL.files.find((f) => f.path === 'onnx/model_quantized.onnx')!, sources, {
      onProgress: (received, total, file) =>
        onProgress?.({ phase: 'download', file, received, total, done: 0, count: EMBED_MODEL.files.length })
    })
  ])
  // config/tokenizer.json 也预热入缓存（保证完全离线），缺失不阻塞
  await Promise.all(
    ['config.json', 'tokenizer.json'].map((p) =>
      fetchModelFile(EMBED_MODEL, EMBED_MODEL.files.find((f) => f.path === p)!, sources).catch(() => null)
    )
  )

  tokenizer = new BertTokenizer(new TextDecoder().decode(vocabBuf.buf))

  onProgress?.({ phase: 'init', received: 1, total: 1, done: 0, count: 1 })
  // 与 image-converter 相同的 WASM-only 自托管范式；动态 import 不进主包。
  // 通过通用 ort-wasm-loader 用 blob: 加载胶水脚本，规避 EdgeOne 对 .mjs 下发
  // application/octet-stream 导致的动态 import MIME 失败。
  ort = await configureOrtWasm(await import('onnxruntime-web/wasm'))
  session = await ort.InferenceSession.create(new Uint8Array(onnxBuf.buf), {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all'
  })
  loadedModelId = EMBED_MODEL.id
}

/** 编码一批文本 → 归一化向量数组（分批，避免长文档爆内存） */
export async function embedTexts(
  texts: string[],
  opts: { query?: boolean; batchSize?: number; onProgress?: (p: EmbedProgress) => void } = {}
): Promise<number[][]> {
  if (!session || !tokenizer || !ort) throw new Error('语义模型未加载')
  const batchSize = opts.batchSize ?? 8
  const result: number[][] = new Array(texts.length)
  const prepared = texts.map((t) => (opts.query ? EMBED_MODEL.queryPrefix + t : t))
  for (let start = 0; start < prepared.length; start += batchSize) {
    const batch = prepared.slice(start, start + batchSize)
    const encoded: Encoded[] = batch.map((t) => tokenizer!.encode(t, EMBED_MODEL.maxLen))
    const { inputIds, attentionMask, tokenTypeIds, dims } = padBatch(encoded)
    // Xenova 导出的 BERT ONNX 三个输入均为 int64；ort 需 BigInt64Array
    const toI64 = (a: Int32Array): BigInt64Array => {
      const out = new BigInt64Array(a.length)
      for (let i = 0; i < a.length; i++) out[i] = BigInt(a[i]!)
      return out
    }
    const feeds = {
      input_ids: new ort.Tensor('int64', toI64(inputIds), [...dims]),
      attention_mask: new ort.Tensor('int64', toI64(attentionMask), [...dims]),
      token_type_ids: new ort.Tensor('int64', toI64(tokenTypeIds), [...dims])
    }
    const out = await session.run(feeds)
    const hidden = out.last_hidden_state as unknown as { data: Float32Array; dims: readonly number[] }
    if (!hidden) throw new Error('模型输出缺少 last_hidden_state')
    const pooled = l2Normalize(meanPool(hidden.data, hidden.dims, attentionMask), hidden.dims[2]!)
    const h = hidden.dims[2]!
    for (let i = 0; i < batch.length; i++) {
      result[start + i] = Array.from(pooled.subarray(i * h, (i + 1) * h))
    }
    opts.onProgress?.({ phase: 'embed', received: 1, total: 1, done: Math.min(start + batchSize, prepared.length), count: prepared.length })
  }
  return result
}

export function teardownEmbedder(): void {
  session = null
  tokenizer = null
  ort = null
  loadedModelId = null
}
