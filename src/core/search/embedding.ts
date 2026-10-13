/**
 * OpenAI 兼容 Embedding 客户端。
 * 任何遵循 POST {baseUrl}/embeddings 协议、返回 {data:[{embedding}]} 的服务均可接入
 * （OpenAI / 各类自托管 bge / 国产兼容网关等）。商用部署请确认所选服务商授权。
 */

import type { AiSearchConfig } from '../types'

export interface EmbeddingResponse {
  data: Array<{ embedding: number[] }>
  model?: string
}

export class EmbeddingError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown
  ) {
    super(message)
    this.name = 'EmbeddingError'
  }
}

export async function createEmbeddings(
  cfg: AiSearchConfig,
  inputs: string[],
  signal?: AbortSignal
): Promise<number[][]> {
  const path = cfg.embeddingsPath ?? '/embeddings'
  const url = cfg.baseUrl.replace(/\/+$/, '') + (path.startsWith('/') ? path : `/${path}`)

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`
      },
      body: JSON.stringify({ model: cfg.model, input: inputs }),
      signal
    })
  } catch (err) {
    throw new EmbeddingError('无法连接向量服务（网络/CORS/超时），已降级为关键词检索', err)
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new EmbeddingError(`向量服务返回 ${res.status}：${detail.slice(0, 200)}`)
  }

  const json = (await res.json()) as EmbeddingResponse
  if (!json.data || !Array.isArray(json.data) || json.data.length !== inputs.length) {
    throw new EmbeddingError('向量服务返回数据格式异常')
  }
  return json.data.map((d) => d.embedding)
}

/** 简单稳定的文本哈希（FNV-1a），用于判断缓存是否失效 */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}
