/**
 * 模型注册表 + 多源选择 + 带进度的下载与 Cache Storage 缓存。
 *
 * 源策略（自动故障切换，可自带对象存储/CDN）：
 *   1. 用户自定义 base URL（HF 兼容布局 {base}/{modelId}/resolve/{revision}/{file}）
 *      —— 可指向 Cloudflare R2（10GB 免费、零出口费）或腾讯云 COS+CDN（新客 50GB/6 月免费）公开桶；
 *   2. hf-mirror.com（国内默认，公益 HF 镜像，实测 CORS 按 Origin 回显）；
 *   3. huggingface.co（官方兜底）。
 * 启动时对每个源 HEAD config.json 选第一个可用；文件下载后存 Cache Storage，二次离线可用。
 */

export interface ModelFile {
  /** 模型仓内相对路径 */
  path: string
  /** 期望字节数（用于完整性校验；未知时为 0 不校验） */
  size: number
}

export interface EmbedModelMeta {
  id: string
  /** HF 形态的模型仓 id */
  repo: string
  revision: string
  label: string
  dim: number
  /** bge-zh v1.5 检索指令前缀（仅查询侧） */
  queryPrefix: string
  maxLen: number
  license: string
  sizeMB: number
  files: ModelFile[]
}

/** Xenova/bge-small-zh-v1.5（BAAI bge-small-zh v1.5，MIT，中英文，512 维，量化 23.9MB） */
export const EMBED_MODEL: EmbedModelMeta = {
  id: 'bge-small-zh-v1.5-q8',
  repo: 'Xenova/bge-small-zh-v1.5',
  revision: 'main',
  label: 'bge-small-zh v1.5（本地语义模型，MIT，约 24MB）',
  dim: 512,
  queryPrefix: '为这个句子生成表示以用于检索相关文章：',
  maxLen: 512,
  license: 'MIT',
  sizeMB: 24,
  files: [
    { path: 'config.json', size: 0 },
    { path: 'tokenizer.json', size: 0 },
    { path: 'vocab.txt', size: 0 },
    { path: 'onnx/model_quantized.onnx', size: 24_010_842 }
  ]
}

export type SourceId = 'custom' | 'hf-mirror' | 'huggingface'

export interface ModelSource {
  id: SourceId
  label: string
  /** 拼接文件 URL 的 host（custom 为用户填的完整 base） */
  host: string
  builtin: boolean
}

export const BUILTIN_SOURCES: ModelSource[] = [
  { id: 'hf-mirror', label: 'hf-mirror.com（国内镜像，默认）', host: 'https://hf-mirror.com', builtin: true },
  { id: 'huggingface', label: 'huggingface.co（官方源）', host: 'https://huggingface.co', builtin: true }
]

const SOURCE_PREF_KEY = 'fz-lkb:source-pref:v1'
const CACHE_NAME = 'fz-lkb-models-v1'

export function fileUrl(source: ModelSource, model: EmbedModelMeta, file: string): string {
  return `${source.host.replace(/\/+$/, '')}/${model.repo}/resolve/${model.revision}/${file}`
}

export function loadSourcePref(): { customBase: string; order: SourceId[] } | null {
  try {
    const raw = localStorage.getItem(SOURCE_PREF_KEY)
    return raw ? (JSON.parse(raw) as { customBase: string; order: SourceId[] }) : null
  } catch {
    return null
  }
}

export function saveSourcePref(pref: { customBase: string; order: SourceId[] }): void {
  localStorage.setItem(SOURCE_PREF_KEY, JSON.stringify(pref))
}

/** 按偏好顺序构造候选源（custom 仅在填了合法 URL 时参与） */
export function orderedSources(pref?: { customBase: string; order: SourceId[] } | null): ModelSource[] {
  const p = pref ?? loadSourcePref()
  const out: ModelSource[] = []
  const order = p?.order ?? ['custom', 'hf-mirror', 'huggingface']
  for (const id of order) {
    if (id === 'custom') {
      const base = (p?.customBase ?? '').trim().replace(/\/+$/, '')
      if (/^https:\/\/.+/i.test(base)) {
        out.push({ id: 'custom', label: '自定义对象存储/CDN', host: base, builtin: false })
      }
    } else {
      const b = BUILTIN_SOURCES.find((s) => s.id === id)
      if (b) out.push(b)
    }
  }
  return out.length ? out : BUILTIN_SOURCES
}

/** HEAD 探测某源能否拿到 config.json（跟随跳转、限时） */
async function probeSource(source: ModelSource, timeoutMs = 5000): Promise<boolean> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(fileUrl(source, EMBED_MODEL, 'config.json'), {
      method: 'HEAD',
      signal: ctrl.signal,
      cache: 'no-store'
    })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(t)
  }
}

export interface ProbeResult {
  source: ModelSource
  tested: SourceId[]
}

/** 按候选顺序探测，返回第一个可用源；全不可用时返回最后一个（交由下载报错给用户） */
export async function selectSource(pref?: Parameters<typeof orderedSources>[0]): Promise<ProbeResult> {
  const sources = orderedSources(pref)
  const tested: SourceId[] = []
  for (const source of sources) {
    tested.push(source.id)
    if (await probeSource(source)) return { source, tested }
  }
  return { source: sources[sources.length - 1]!, tested }
}

async function cacheMatch(url: string): Promise<Response | undefined> {
  const cache = await caches.open(CACHE_NAME)
  return cache.match(new Request(url, { method: 'GET' }))
}

/** 大小一致性：允许 ±2%（至少 64KB）以兼容上游重新打包，同时仍能拦截截断/损坏下载 */
function sizeOk(expected: number, actual: number): boolean {
  if (!expected) return true
  const tol = Math.max(64 * 1024, Math.round(expected * 0.02))
  return Math.abs(actual - expected) <= tol
}

async function cachePut(url: string, res: Response): Promise<void> {
  const cache = await caches.open(CACHE_NAME)
  await cache.put(new Request(url, { method: 'GET' }), res.clone())
}

export interface DownloadHandlers {
  onProgress?: (receivedBytes: number, totalBytes: number, file: string) => void
}

/**
 * 取一个模型文件：先查 Cache Storage；未命中则按源顺序下载（首个成功即返回）。
 * 返回 ArrayBuffer（onnx）或文本由调用方按 file 决定。
 */
export async function fetchModelFile(
  model: EmbedModelMeta,
  file: ModelFile,
  sources: ModelSource[],
  handlers: DownloadHandlers = {}
): Promise<{ buf: ArrayBuffer; sourceId: SourceId; cached: boolean }> {
  // 1) 缓存命中（任意源 URL 缓存过即可）
  for (const source of sources) {
    const url = fileUrl(source, model, file.path)
    const hit = await cacheMatch(url)
    if (hit) {
      const buf = await hit.arrayBuffer()
      if (sizeOk(file.size, buf.byteLength)) {
        return { buf, sourceId: source.id, cached: true }
      }
    }
  }
  // 2) 逐源下载
  let lastErr: unknown = null
  for (const source of sources) {
    const url = fileUrl(source, model, file.path)
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const total = Number(res.headers.get('content-length') ?? file.size ?? 0)
      if (!res.body) {
        const buf = await res.arrayBuffer()
        await cachePut(url, res)
        handlers.onProgress?.(buf.byteLength, buf.byteLength, file.path)
        return { buf, sourceId: source.id, cached: false }
      }
      const reader = res.body.getReader()
      const chunks: Uint8Array[] = []
      let received = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          chunks.push(value)
          received += value.length
          handlers.onProgress?.(received, total, file.path)
        }
      }
      const merged = new Uint8Array(received)
      let off = 0
      for (const c of chunks) {
        merged.set(c, off)
        off += c.length
      }
      if (!sizeOk(file.size, received)) {
        throw new Error(`文件大小异常：${file.path} ${received} 与预期 ${file.size} 偏差过大`)
      }
      // 用同一份字节重建 Response 入缓存
      await cachePut(url, new Response(merged, { headers: res.headers }))
      return { buf: merged.buffer, sourceId: source.id, cached: false }
    } catch (err) {
      lastErr = err
    }
  }
  throw new Error(`所有模型源均无法下载 ${file.path}：${(lastErr as Error)?.message ?? lastErr}`)
}

export async function clearModelCache(): Promise<void> {
  await caches.delete(CACHE_NAME)
}

export async function isModelCached(model: EmbedModelMeta, sources: ModelSource[]): Promise<boolean> {
  for (const f of model.files) {
    let any = false
    for (const source of sources) {
      const hit = await cacheMatch(fileUrl(source, model, f.path))
      if (hit) {
        any = true
        break
      }
    }
    if (!any) return false
  }
  return true
}
