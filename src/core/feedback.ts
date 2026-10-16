/**
 * 用户需求反馈投递。
 * - 配置 VITE_FEEDBACK_ENDPOINT（指向 serverless 邮件函数）时：POST 到服务端，由服务端发邮件
 * - 未配置时：写入本地队列绝不丢失，返回 queued，部署时配置函数并调用 retryQueued() 补发
 * 收件人固定为 fangziasia@163.com（在服务端函数中配置 / 兜底）。
 */

import type { FeedbackRequest } from './types'
import { readJSON, writeJSON } from './storage'

const QUEUE_KEY = 'fangzi:feedback-queue'
const TARGET_EMAIL = 'fangziasia@163.com'

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

/** 反馈类型：提新需求 / 优化已有工具 */
export type FeedbackKind = 'new' | 'improve'

/**
 * 构造「系统邮件」反馈链接：自动填收件人、主题与正文模板。
 * 用户点击后由浏览器调起本机默认邮件 App（mailto:），内容不出设备、直达团队邮箱。
 */
export function buildFeedbackMailto(kind: FeedbackKind, query?: string): string {
  const subject =
    kind === 'new' ? '【方子 · 新需求】我希望方子增加：' : '【方子 · 优化建议】关于工具的改进'
  const lines: string[] = []
  if (kind === 'new') {
    lines.push('你好方子团队：')
    lines.push('')
    lines.push('我希望方子能新增一个工具 / 功能。')
    lines.push('')
    lines.push('1. 使用场景（我在什么情况下需要）：')
    lines.push('')
    lines.push('2. 现在遇到的麻烦 / 现有方案的不足：')
    lines.push('')
    lines.push('3. 我希望它能做到：')
    lines.push('')
    lines.push('（可选）我的设备与浏览器：')
    if (query?.trim()) lines.push('', `（我刚才在方子搜索：${query.trim()}）`)
  } else {
    lines.push('你好方子团队：')
    lines.push('')
    lines.push('关于「____________」工具，我有一些优化建议。')
    lines.push('')
    lines.push('1. 我在做什么操作时遇到：')
    lines.push('')
    lines.push('2. 期望的表现：')
    lines.push('')
    lines.push('3. 实际的表现（可附截图 / 录屏）：')
    lines.push('')
    lines.push('（可选）我的设备与浏览器：')
  }
  lines.push('')
  const body = lines.join('\n')
  return `mailto:${TARGET_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

/** 打开系统邮件客户端发送反馈 */
export function openFeedbackMail(kind: FeedbackKind, query?: string): void {
  window.location.href = buildFeedbackMailto(kind, query)
}
