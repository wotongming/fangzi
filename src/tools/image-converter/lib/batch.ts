/**
 * 批量模式：
 * - 多文件 / 文件夹（webkitdirectory）/ ZIP（fflate 解压）导入
 * - 异步并发队列（限流），逐项执行工具链，实时进度
 * - 结果 ZIP 打包导出
 */
import { unzipSync, zipSync } from 'fflate'

export interface BatchItem {
  id: string
  file: File
  name: string
}

export type BatchStatus = 'idle' | 'running' | 'done' | 'error'

export interface BatchTask {
  item: BatchItem
  status: BatchStatus
  error?: string
  result?: { blob: Blob; ext: string }
  ms?: number
}

export interface BatchCallbacks {
  onProgress?: (done: number, total: number) => void
  onItem?: (task: BatchTask, index: number) => void
}

function genId(): string {
  return Math.random().toString(36).slice(2, 10)
}

/** 从 FileList（多选）构建批量项 */
export function fromFileList(list: FileList | null): BatchItem[] {
  if (!list) return []
  return Array.from(list)
    .filter((f) => f.type.startsWith('image/'))
    .map((f) => ({ id: genId(), file: f, name: f.name }))
}

/** 从「文件夹」输入构建批量项（webkitdirectory 的 File 带 webkitRelativePath） */
export function fromDirectory(files: File[]): BatchItem[] {
  return files
    .filter((f) => f.type.startsWith('image/'))
    .map((f) => ({ id: genId(), file: f, name: f.webkitRelativePath || f.name }))
}

/** 解压 ZIP 并提取其中的图片文件（fflate，MIT） */
export async function fromZip(file: File): Promise<BatchItem[]> {
  const buf = new Uint8Array(await file.arrayBuffer())
  const entries = unzipSync(buf)
  const items: BatchItem[] = []
  for (const [path, data] of Object.entries(entries)) {
    const clean = (path.split('/').pop() ?? path).split('\\').pop() ?? path
    if (!/\.(png|jpe?g|webp|gif|bmp)$/i.test(clean)) continue
    items.push({ id: genId(), file: new File([data], clean, { type: mimeFromExt(clean) }), name: clean })
  }
  return items
}

export function mimeFromExt(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase()
  return (
    {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      gif: 'image/gif',
      bmp: 'image/bmp'
    }[ext ?? ''] ?? 'application/octet-stream'
  )
}

function sanitize(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_')
}

/** 结果 ZIP 打包导出（fflate） */
export async function zipResults(items: { name: string; blob: Blob }[]): Promise<Blob> {
  const all: Record<string, Uint8Array> = {}
  for (const it of items) {
    all[sanitize(it.name)] = new Uint8Array(await it.blob.arrayBuffer())
  }
  return new Blob([zipSync(all)], { type: 'application/zip' })
}

/** 限流并发执行：concurrency 默认 2（避免同时跑多个 AI 模型拖垮浏览器） */
export async function runBatch(
  items: BatchItem[],
  worker: (item: BatchItem, index: number) => Promise<{ blob: Blob; ext: string }>,
  opts: { concurrency?: number; cb?: BatchCallbacks }
): Promise<BatchTask[]> {
  const concurrency = Math.max(1, opts.concurrency ?? 2)
  const cb = opts.cb
  const tasks: BatchTask[] = items.map((item) => ({ item, status: 'idle' as const }))
  const total = items.length
  let done = 0
  let cursor = 0

  async function runOne(index: number) {
    const task = tasks[index]!
    task.status = 'running'
    const t0 = performance.now()
    try {
      const r = await worker(task.item, index)
      task.result = r
      task.ms = performance.now() - t0
      task.status = 'done'
    } catch (e) {
      task.status = 'error'
      task.error = e instanceof Error ? e.message : String(e)
    }
    done++
    cb?.onItem?.(task, index)
    cb?.onProgress?.(done, total)
  }

  async function pump() {
    while (cursor < total) {
      const next = cursor++
      await runOne(next)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => pump()))
  return tasks
}
