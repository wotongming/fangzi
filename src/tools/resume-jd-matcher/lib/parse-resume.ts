/**
 * 简历文件解析为纯文本 + 段落。
 * - PDF：pdfjs-dist（Apache-2.0），worker 走公共模块固化同源 `/pdfjs/pdf.worker.min.js`，不依赖 CDN；
 * - DOCX：mammoth（BSD-2-Clause，可商用）只抽文本，不执行宏/不取样式；
 * - TXT/MD：直接按文本读取；其他类型拒绝并给可操作提示。
 */
import mammoth from 'mammoth/mammoth.browser'
import { splitParagraphs } from './normalize'
import type { ParsedText } from './types'
import { sniffFile } from '../../../../reusable-module/file-sniff/file-sniff'
import { openPdfDocument, configurePdfjs } from '../../../../reusable-module/pdfjs-worker/pdfjs-worker'

configurePdfjs()

const MAX_BYTES = 15 * 1024 * 1024

export function parsePlainText(text: string): ParsedText {
  return { text, paragraphs: splitParagraphs(text) }
}

async function parsePdf(file: File): Promise<ParsedText> {
  const buf = await file.arrayBuffer()
  const pdf = await openPdfDocument(buf)
  const parts: string[] = []
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo)
    const content = await page.getTextContent()
    const text = content.items
      .map((it) => ('str' in it ? (it as { str: string }).str : ''))
      .join('')
      .replace(/\u0000/g, ' ')
    parts.push(text)
  }
  await pdf.destroy()
  const text = parts.join('\n').replace(/[ \t]+/g, ' ').trim()
  if (!text) throw new Error('未能从该 PDF 提取到文字，可能是扫描件/图片版 PDF，请改用文字版 PDF 或直接粘贴简历文本。')
  return parsePlainText(text)
}

async function parseDocx(file: File): Promise<ParsedText> {
  const buf = await file.arrayBuffer()
  const result = await mammoth.extractRawText({ arrayBuffer: buf })
  const text = (result.value || '').trim()
  if (!text) throw new Error('未能从该 Word 文档提取到文字，请确认是 .docx（旧版 .doc 请另存为 .docx 或直接粘贴文本）。')
  return parsePlainText(text)
}

export async function parseResumeFile(file: File): Promise<ParsedText> {
  if (file.size > MAX_BYTES) {
    throw new Error(`文件过大（>${Math.round(MAX_BYTES / 1024 / 1024)}MB），请使用文字精简版简历。`)
  }
  if (file.size === 0) throw new Error(`文件是空的（0 字节）：${file.name}`)
  // 安卓各文件 provider 的 File.type/扩展名不可信：读前若干字节嗅探真实类型
  const head = await file.slice(0, 512).arrayBuffer()
  const { kind } = sniffFile(head, file.name)
  const name = file.name.toLowerCase()
  if (kind === 'pdf' || name.endsWith('.pdf')) return parsePdf(file)
  if (kind === 'unknown' && (kind as string) === 'unknown' && (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || name.endsWith('.docx'))) return parseDocx(file)
  if (name.endsWith('.docx')) return parseDocx(file)
  if (kind === 'html') throw new Error('这不是简历文件，而是一个网页/错误页（可能是导出失败），请重新导出后再上传。')
  if (name.endsWith('.txt') || name.endsWith('.md') || file.type.startsWith('text/')) {
    return parsePlainText(await file.text())
  }
  throw new Error(`暂不支持该文件（实际类型=${file.type || '未知'}，${(file.size / 1024).toFixed(0)}KB）：${file.name}。请上传 PDF / DOCX / TXT，或直接把简历内容粘贴到文本框。`)
}
