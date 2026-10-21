/**
 * excerpt.ts —— 摘录记录模型与导出（纯逻辑，便于单测）。
 */

export interface Excerpt {
  title: string
  url: string
  text: string
  savedAt: number
}

export function normalizeExcerpt(raw: Partial<Excerpt>): Excerpt | null {
  const text = (raw.text ?? '').trim()
  if (!text) return null
  return {
    title: (raw.title ?? '未命名页面').trim() || '未命名页面',
    url: (raw.url ?? '').trim(),
    text,
    savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : Date.now()
  }
}

export function toMarkdown(list: Excerpt[]): string {
  return list
    .map((it) => {
      const d = new Date(it.savedAt).toLocaleString()
      return `### ${it.title}\n\n> ${it.text.replace(/\n/g, ' ')}\n\n来源：${it.url} · ${d}\n`
    })
    .join('\n---\n')
}
