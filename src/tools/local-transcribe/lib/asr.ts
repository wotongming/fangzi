/**
 * 本地 ASR：Transformers.js v4 运行 Whisper-tiny（q8，MIT 权重）。
 * - 模型**同源自托管**在站点 /mf/Xenova/whisper-tiny/，大陆 4G/WiFi 直连、不依赖 huggingface.co；
 *   超 EdgeOne 25MiB 的 decoder q8（约 30.7MB）构建期切成 .partN，由 Service Worker
 *   （public/sw-model-shards.js）在 /mf/ 请求时透明合并；首次成功后写 Cache，离线可转写。
 * - onnxruntime-web 1.31 的 WASM 自托管在站点 /whisper/，与 003 的 /onnx（ort 1.30）隔离；
 * - 站点未设置 COOP/COEP（无 SharedArrayBuffer），显式 proxy=false，ort 自动回退单线程 WASM，
 *   不破坏 PWA 跨域与可安装性。
 */
import type { AsrProgress } from './types'

/** V1 固定 tiny 多语 q8：体积约 40MB 内、CPU 可跑；base/small 列 V1.1 */
export const MODEL_ID = 'Xenova/whisper-tiny'
export const MODEL_LABEL = 'Whisper tiny（多语言，q8，约 40MB）'

type RawChunk = { timestamp: [number | null, number | null]; text: string }
interface AsrOutput {
  text: string
  chunks?: RawChunk[]
}
type Transcriber = (audio: Float32Array, opts: Record<string, unknown>) => Promise<AsrOutput>

let pipePromise: Promise<Transcriber> | null = null
let envConfigured = false

async function configureEnv(onProgress?: (p: AsrProgress) => void): Promise<void> {
  if (envConfigured) return
  const { env } = await import('@huggingface/transformers')
  // 仅用同源自托管模型：allowLocalModels=true 时 transformers 以 localModelPath + modelId/filename 取文件，
  // 即 /mf/Xenova/whisper-tiny/...；禁用远程，避免在大陆网络去连 huggingface.co 而 Failed to fetch。
  const base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/')
  env.allowLocalModels = true
  env.allowRemoteModels = false
  env.localModelPath = `${base}mf/`
  // 自托管 WASM（import.meta.env.BASE_URL 默认为 '/'）。
  // 关键：ort 1.31 在 wasmPaths 为“字符串目录”时，主线程会硬编码 import
  // ort-wasm-simd-threaded.asyncify.mjs（proxy-worker 专用，其 wasm 26MB 超 EdgeOne 25MiB 限额）；
  // 改为显式 { mjs, wasm } 对象指向无 asyncify 的 plain 版（14MB），
  // 配合无跨域隔离时自动 numThreads=1、proxy=false，走主线程单线程 WASM。
  const dir = `${base}whisper/`
  const wasm = env.backends.onnx.wasm
  if (!wasm) throw new Error('当前 Transformers.js 构建缺少 onnx.wasm 运行时配置')
  wasm.wasmPaths = {
    mjs: `${dir}ort-wasm-simd-threaded.mjs`,
    wasm: `${dir}ort-wasm-simd-threaded.wasm`
  }
  // 无跨域隔离头时不用 worker 代理，避免 SAB 依赖，保证稳定回退单线程
  wasm.proxy = false
  wasm.numThreads = 1
  onProgress?.({ phase: 'download', percent: 0, message: `正在从本站加载 ${MODEL_LABEL}…` })
  envConfigured = true
}

/** 预加载 / 准备模型（设置页可提前触发） */
export async function ensureTranscriber(onProgress?: (p: AsrProgress) => void): Promise<Transcriber> {
  if (pipePromise) return pipePromise
  await configureEnv(onProgress)
  const { pipeline } = await import('@huggingface/transformers')
  onProgress?.({ phase: 'download', percent: 0, message: `正在准备 ${MODEL_LABEL}…` })
  pipePromise = pipeline('automatic-speech-recognition', MODEL_ID, {
    device: 'wasm',
    dtype: 'q8',
    progress_callback: (p: { status?: string; file?: string; progress?: number }) => {
      if (p.status === 'progress' && typeof p.progress === 'number') {
        onProgress?.({ phase: 'download', percent: p.progress, message: `下载模型 ${p.file ?? ''} ${p.progress.toFixed(0)}%` })
      } else if (p.status === 'done') {
        onProgress?.({ phase: 'download', percent: 100, message: `已就绪 ${p.file ?? ''}` })
      }
    }
  }) as Promise<Transcriber>
  try {
    await pipePromise
    onProgress?.({ phase: 'load', percent: 100, message: '模型加载完成' })
  } catch (err) {
    pipePromise = null
    throw new Error('语音模型加载失败（可能是网络/镜像不可达），可稍后重试：' + (err as Error).message)
  }
  return pipePromise
}

export interface TranscribeResult {
  fullText: string
  chunks: RawChunk[]
}

/** 转写一段 16kHz 单声道 PCM；language 省略时自动检测 */
export async function transcribe(
  pcm: Float32Array,
  opts: {
    language?: string // 'chinese' | 'english' | ...（Whisper 语言名）；空=自动
    initialPrompt?: string // 术语偏置（V1 预留）
    onProgress?: (p: AsrProgress) => void
  }
): Promise<TranscribeResult> {
  const onProgress = opts.onProgress
  const pipe = await ensureTranscriber(onProgress)
  onProgress?.({ phase: 'transcribe', percent: 5, message: '正在本地转写…' })

  const genOpts: Record<string, unknown> = {
    return_timestamps: true,
    chunk_length_s: 30,
    stride_length_s: 5,
    // 关闭上文条件，降低长音频被前文带偏、重复复读的概率
    condition_on_previous_text: false,
    // VAD 式切分由模型时间戳 + 后处理完成
    language: opts.language || undefined,
    task: 'transcribe'
  }
  if (opts.initialPrompt && opts.initialPrompt.trim()) genOpts.initial_prompt = opts.initialPrompt.trim()

  let out: AsrOutput
  try {
    out = await pipe(pcm, genOpts)
  } catch (err) {
    throw new Error('转写失败：' + (err as Error).message)
  }
  onProgress?.({ phase: 'done', percent: 100, message: '转写完成' })
  return { fullText: (out.text ?? '').trim(), chunks: out.chunks ?? [] }
}

/** 释放会话（测试 / 切换时） */
export function teardownTranscriber(): void {
  pipePromise = null
}
