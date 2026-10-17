/**
 * batch.ts —— 批量编排：优先 Worker（OffscreenCanvas），不可用回退主线程；
 * 结果用 fflate 打包 ZIP（MIT，已在依赖）。逐张处理、逐张释放，控制内存。
 */
import { zipSync } from 'fflate'
import { postTo } from '../../../../reusable-module/worker-post/worker-post'
import { processImage, type OutMime } from './process'
import type { Mask, RedactMode } from './redact'
import type { ProcessRequest, ProcessResponse } from '../workers/process.worker'

export interface BatchInput {
  id: number
  file: File
  masks?: Mask[]
}

export interface BatchOutput {
  id: number
  blob: Blob
  width: number
  height: number
  error?: string
}

export interface BatchOptions {
  outType: OutMime
  quality: number
  maxEdge: number
  redactMode: RedactMode
}

export function supportsBatchWorker(): boolean {
  return typeof OffscreenCanvas !== 'undefined' && typeof Worker !== 'undefined'
}

let worker: Worker | null = null
let seq = 0

function getWorker(): Worker | null {
  if (worker) return worker
  try {
    worker = new Worker(new URL('../workers/process.worker.ts', import.meta.url), { type: 'module' })
    return worker
  } catch {
    worker = null
    return null
  }
}

function runInWorker(input: BatchInput, o: BatchOptions): Promise<BatchOutput> {
  const w = getWorker()
  if (!w) return runOnMain(input, o)
  const id = ++seq
  return new Promise<BatchOutput>((resolve) => {
    const handler = (e: MessageEvent<ProcessResponse>) => {
      if (e.data.id !== id) return
      w.removeEventListener('message', handler)
      if (e.data.ok) resolve({ id: input.id, blob: e.data.blob, width: e.data.width, height: e.data.height })
      else resolve({ id: input.id, blob: new Blob(), width: 0, height: 0, error: e.data.error })
    }
    w.addEventListener('message', handler)
    const req: ProcessRequest = {
      id,
      file: input.file,
      outType: o.outType,
      quality: o.quality,
      maxEdge: o.maxEdge,
      masks: input.masks ?? [],
      redactMode: o.redactMode
    }
    postTo(w, req)
  })
}

async function runOnMain(input: BatchInput, o: BatchOptions): Promise<BatchOutput> {
  try {
    const r = await processImage(input.file, {
      outType: o.outType,
      quality: o.quality,
      maxEdge: o.maxEdge || undefined,
      masks: input.masks ?? [],
      redactMode: o.redactMode
    })
    return { id: input.id, blob: r.blob, width: r.width, height: r.height }
  } catch (err) {
    return { id: input.id, blob: new Blob(), width: 0, height: 0, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 串行处理（让出事件循环以更新进度），避免同时解码多张爆内存 */
export async function runBatch(
  inputs: BatchInput[],
  o: BatchOptions,
  onProgress?: (done: number, total: number, current: BatchOutput) => void
): Promise<BatchOutput[]> {
  const useWorker = supportsBatchWorker()
  const out: BatchOutput[] = []
  for (let i = 0; i < inputs.length; i++) {
    const r = useWorker ? await runInWorker(inputs[i]!, o) : await runOnMain(inputs[i]!, o)
    out.push(r)
    onProgress?.(i + 1, inputs.length, r)
  }
  return out
}

/** 打包成功结果为 ZIP */
export async function packZip(items: { name: string; blob: Blob }[]): Promise<Blob> {
  const all: Record<string, Uint8Array> = {}
  const used = new Set<string>()
  for (const it of items) {
    let name = it.name
    // 防重名
    if (used.has(name)) {
      const dot = name.lastIndexOf('.')
      const stem = dot > -1 ? name.slice(0, dot) : name
      const ext = dot > -1 ? name.slice(dot) : ''
      let n = 1
      while (used.has(`${stem}-${n}${ext}`)) n++
      name = `${stem}-${n}${ext}`
    }
    used.add(name)
    all[name] = new Uint8Array(await it.blob.arrayBuffer())
  }
  return new Blob([zipSync(all)], { type: 'application/zip' })
}
