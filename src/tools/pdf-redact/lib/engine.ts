/**
 * PDF 真脱敏引擎（浏览器端，文件绝不上传、无后端）。
 *
 * 路线（详见 postmortem_004）：
 *  - 无遮罩页：pdf-lib copyPages 原样复制（矢量文字保留、可选中/可搜索）；
 *  - 含遮罩页：用 pdf.js 把该页渲染成位图（~150dpi），在画布上用不透明黑块盖掉遮罩矩形，
 *    再整页作为 JPEG 图像嵌回——该页文字层随光栅化被彻底删除（getTextContent 再提取不到），
 *    这是"真删"而非"画黑框"。代价：含遮罩页变为图像、不可再选中该页文字（已在 UI 与文档明示）。
 *
 * worker/wasm 全部 Vite 打包后同源自托管（?url），禁止外链 CDN，保证离线可跑。
 */
import * as pdfjsLib from 'pdfjs-dist'
// Vite 把 worker 打成同源静态资源，离线可用（与 resume-jd-matcher 同一范式）
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { PDFDocument } from 'pdf-lib'
import { clampRectToPage, scrubMetadata, type Rect } from './geometry'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

export interface PageInfo {
  index: number
  width: number
  height: number
}

let pdfjsReady = false
async function ensurePdfjs(): Promise<void> {
  if (!pdfjsReady) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl
    pdfjsReady = true
  }
}

/** 打开 PDF（不保留原 buffer 引用之外的上传），返回页数与每页尺寸（pt）。 */
export async function inspectPdf(data: ArrayBuffer): Promise<{ numPages: number; pages: PageInfo[] }> {
  await ensurePdfjs()
  const pdf = await pdfjsLib.getDocument({ data: data.slice(0) }).promise
  const pages: PageInfo[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const p = await pdf.getPage(i)
    const vp = p.getViewport({ scale: 1 })
    pages.push({ index: i - 1, width: vp.width, height: vp.height })
  }
  const numPages = pdf.numPages
  await pdf.destroy()
  return { numPages, pages }
}

export interface BuildResult {
  bytes: Uint8Array
  /** 被光栅化（真删）的页索引列表 */
  redactedPages: number[]
  /** 导出文件大小（字节） */
  outSize: number
}

/**
 * 生成真脱敏新 PDF。
 * @param originalBytes 原始文件字节（只读，不修改）
 * @param masksByPage  每页遮罩矩形（PDF 用户空间 pt，原点左下）
 * @param dpi          含遮罩页光栅化分辨率（默认 150，文字清晰且体积可控）
 */
export async function buildRedactedPdf(
  originalBytes: ArrayBuffer,
  masksByPage: Map<number, Rect[]>,
  dpi = 150
): Promise<BuildResult> {
  await ensurePdfjs()

  // 1) pdf.js：渲染含遮罩页为位图并涂黑块
  const pdf = await pdfjsLib.getDocument({ data: originalBytes.slice(0) }).promise
  const rasterImages = new Map<number, { blob: Blob; w: number; h: number }>()
  const scale = dpi / 72
  for (const [pageIdx, masks] of masksByPage) {
    if (!masks.length) continue
    const page = await pdf.getPage(pageIdx + 1)
    const baseVp = page.getViewport({ scale: 1 })
    const vp = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(vp.width)
    canvas.height = Math.floor(vp.height)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport: vp }).promise
    // 在画布（原点左上）上盖不透明黑块：PDF 坐标 y 自下向上 → 画布 y 自上向下
    ctx.fillStyle = '#000000'
    for (const m of masks) {
      const r = clampRectToPage(m, baseVp.width, baseVp.height)!
      const cx = r.x * scale
      const cw = r.w * scale
      const ch = r.h * scale
      const cy = (baseVp.height - (r.y + r.h)) * scale
      ctx.fillRect(cx, cy, cw, ch)
    }
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.92))
    rasterImages.set(pageIdx, { blob, w: baseVp.width, h: baseVp.height })
  }
  await pdf.destroy()

  // 2) pdf-lib：逐页组装——无遮页矢量复制，含遮页嵌光栅图
  const srcDoc = await PDFDocument.load(originalBytes, { ignoreEncryption: true })
  const outDoc = await PDFDocument.create()
  const redactedPages: number[] = []

  const jpgCache = new Map<number, Uint8Array>()
  for (const [idx, img] of rasterImages) {
    jpgCache.set(idx, new Uint8Array(await img.blob.arrayBuffer()))
  }

  for (let i = 0; i < srcDoc.getPageCount(); i++) {
    if (rasterImages.has(i)) {
      const img = rasterImages.get(i)!
      const jpg = jpgCache.get(i)!
      const embedded = await outDoc.embedJpg(jpg)
      const page = outDoc.addPage([img.w, img.h])
      // pdf-lib 原点左下；整页铺满
      page.drawImage(embedded, { x: 0, y: 0, width: img.w, height: img.h })
      redactedPages.push(i)
    } else {
      const [copied] = await outDoc.copyPages(srcDoc, [i])
      outDoc.addPage(copied)
    }
  }

  // 3) 真删元数据：统一匿名/清空
  const meta = scrubMetadata()
  outDoc.setTitle(meta.Title ?? '')
  outDoc.setAuthor(meta.Author ?? '')
  outDoc.setSubject(meta.Subject ?? '')
  outDoc.setKeywords([])
  outDoc.setCreator(meta.Creator ?? '')
  outDoc.setProducer('')
  const epoch = new Date(0)
  outDoc.setCreationDate(epoch)
  outDoc.setModificationDate(epoch)

  const bytes = await outDoc.save()
  return { bytes, redactedPages, outSize: bytes.length }
}

/** 提取某页全部文本（用于"真删"断言：遮罩页不应再提取到被删文字）。 */
export async function pageText(buf: ArrayBuffer, pageIdx: number): Promise<string> {
  await ensurePdfjs()
  const pdf = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise
  const p = await pdf.getPage(pageIdx + 1)
  const tc = await p.getTextContent()
  const s = tc.items.map((it) => ('str' in it ? it.str : '')).join(' ')
  await pdf.destroy()
  return s
}

/** 读取导出件元数据（用于 E2E/自检断言）。 */
export async function readMeta(data: ArrayBuffer): Promise<Record<string, string>> {
  const doc = await PDFDocument.load(data, { ignoreEncryption: true })
  return {
    Title: doc.getTitle() ?? '',
    Author: doc.getAuthor() ?? '',
    Subject: doc.getSubject() ?? '',
    Keywords: doc.getKeywords() ?? '',
    Creator: doc.getCreator() ?? '',
    Producer: doc.getProducer() ?? ''
  }
}
