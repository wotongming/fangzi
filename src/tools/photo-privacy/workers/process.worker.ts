/**
 * process.worker.ts —— 批量处理 Worker（OffscreenCanvas）。
 * 由 Vite 以 ES module worker 打包；不支持时调用方回退主线程。
 */
/// <reference lib="webworker" />
import { redrawImage } from '../../../../reusable-module/image-redraw/image-redraw'
import { applyMasks, type Mask, type RedactMode } from '../lib/redact'
import type { OutMime } from '../lib/process'

export interface ProcessRequest {
  id: number
  file: File
  outType: OutMime
  quality: number
  maxEdge: number
  masks: Mask[]
  redactMode: RedactMode
}
export type ProcessResponse =
  | { id: number; ok: true; blob: Blob; width: number; height: number }
  | { id: number; ok: false; error: string }

let canvas: OffscreenCanvas | null = null

self.onmessage = async (e: MessageEvent<ProcessRequest>) => {
  const req = e.data
  try {
    if (!canvas) canvas = new OffscreenCanvas(1, 1)
    const res = await redrawImage(
      req.file,
      {
        outType: req.outType,
        quality: req.quality,
        maxEdge: req.maxEdge || undefined,
        paint: (ctx, w, h) => {
          if (req.masks && req.masks.length) applyMasks(ctx, w, h, req.masks, req.redactMode)
        }
      },
      canvas
    )
    const msg: ProcessResponse = { id: req.id, ok: true, blob: res.blob, width: res.width, height: res.height }
    ;(self as DedicatedWorkerGlobalScope).postMessage(msg)
  } catch (err) {
    const msg: ProcessResponse = { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) }
    ;(self as DedicatedWorkerGlobalScope).postMessage(msg)
  }
}
