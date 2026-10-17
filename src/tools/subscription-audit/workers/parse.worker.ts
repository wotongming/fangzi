/**
 * parse.worker.ts —— 账单解析 Worker（CPU 解析不阻塞 UI）。
 * File 经 worker-post 安全克隆传入；不支持 Worker 时调用方回退主线程。
 */
/// <reference lib="webworker" />
import { parseBillFile, type FileParseOutcome } from '../lib/parse'
import type { Platform } from '../lib/platforms'

export interface ParseWorkerRequest {
  id: number
  file: File
  account: string
  force?: Platform
}
export type ParseWorkerResponse =
  | { id: number; ok: true; outcome: FileParseOutcome }
  | { id: number; ok: false; error: string }

self.onmessage = async (e: MessageEvent<ParseWorkerRequest>) => {
  const req = e.data
  try {
    const outcome = await parseBillFile(req.file, req.account, req.force)
    const res: ParseWorkerResponse = { id: req.id, ok: true, outcome }
    ;(self as unknown as Worker).postMessage(res)
  } catch (err) {
    const res: ParseWorkerResponse = { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) }
    ;(self as unknown as Worker).postMessage(res)
  }
}
