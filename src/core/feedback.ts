/**
 * 用户需求反馈投递。
 * - 配置 VITE_FEEDBACK_ENDPOINT（指向 serverless 邮件函数）时：POST 到服务端，由服务端发邮件
 * - 未配置时：写入本地队列绝不丢失，返回 queued，部署时配置函数并调用 retryQueued() 补发
 * 收件人固定为 wotongming@163.com（在服务端函数中配置 / 兜底）。
 */

import type { FeedbackRequest } from './types'
import { readJSON, writeJSON } from './storage'

const QUEUE_KEY = 'fangzi:feedback-queue'
const TARGET_EMAIL = 'wotongming@163.com'

export interface FeedbackResult {
  delivered: boolean
  queued: boolean
  error?: string
}

function endpoint(): string | undefined {
  const e = import.meta.env.VITE_FEEDBACK_ENDPOINT as string | undefined
  return e && e.trim() ? e.trim() : undefined
}

export async function submitFeedback(content: string, query?: string): Promise<FeedbackResult> {
  const trimmed = content.trim()
  if (!trimmed) return { delivered: false, queued: false, error: '内容为空' }
  if (trimmed.length > 2000) return { delivered: false, queued: false, error: '内容过长（上限 2000 字）' }

  const payload: FeedbackRequest = {
    content: trimmed,
    context: {
      query: query?.trim() || undefined,
      ua: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      lang: typeof navigator !== 'undefined' ? navigator.language : undefined
    },
    createdAt: new Date().toISOString()
  }

  const url = endpoint()
  if (!url) {
    enqueue(payload)
    return { delivered: false, queued: true }
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    if (!res.ok) {
      enqueue(payload)
      return { delivered: false, queued: true, error: `服务端 ${res.status}` }
    }
    return { delivered: true, queued: false }
  } catch (err) {
    enqueue(payload)
    return { delivered: false, queued: true, error: err instanceof Error ? err.message : String(err) }
  }
}

function enqueue(item: FeedbackRequest): void {
  const queue = readJSON<FeedbackRequest[]>(QUEUE_KEY, [])
  queue.push(item)
  writeJSON(QUEUE_KEY, queue.slice(-200))
}

export function getQueuedFeedbackCount(): number {
  return readJSON<FeedbackRequest[]>(QUEUE_KEY, []).length
}

/** 网络恢复 / 已配置端点后补发队列 */
export async function retryQueuedFeedback(): Promise<{ sent: number; failed: number }> {
  const url = endpoint()
  if (!url) return { sent: 0, failed: getQueuedFeedbackCount() }
  const queue = readJSON<FeedbackRequest[]>(QUEUE_KEY, [])
  let sent = 0
  const failed: FeedbackRequest[] = []
  for (const item of queue) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item)
      })
      if (res.ok) sent++
      else failed.push(item)
    } catch {
      failed.push(item)
    }
  }
  writeJSON(QUEUE_KEY, failed)
  return { sent, failed: failed.length }
}

export const FEEDBACK_TARGET_EMAIL = TARGET_EMAIL
