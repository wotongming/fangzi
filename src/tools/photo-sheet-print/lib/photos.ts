/**
 * photo-sheet-print —— 图片导入与归一化。
 * 不信 file.type：按魔数判定真实图片；复用 image-redraw 做 EXIF 方向校正、降采样与元数据剥离。
 */
import { redrawImage } from '../../../../reusable-module/image-redraw/image-redraw'
import { newPhotoId, type PhotoItem } from './models'

/** 归一化后最长边像素，控制内存与 PDF 体积。 */
export const MAX_EDGE = 1800

const IMAGE_MAGIC: Array<[number[], string]> = [
  [[0xff, 0xd8, 0xff], 'jpeg'],
  [[0x89, 0x50, 0x4e, 0x47], 'png'],
  [[0x47, 0x49, 0x46], 'gif'],
  [[0x52, 0x49, 0x46], 'webp'] // RIFF....WEBP，调用方解码试错
]

export class PhotoRejected extends Error {
  code: 'empty' | 'not-image' | 'decode-failed' | 'read-failed'
  constructor(code: PhotoRejected['code'], message: string) {
    super(message)
    this.code = code
  }
}

function looksImage(buf: ArrayBuffer, name: string): boolean {
  if (buf.byteLength === 0) return false
  const head = [...new Uint8Array(buf.slice(0, 16))]
  for (const [magic] of IMAGE_MAGIC) {
    if (magic.every((b, i) => head[i] === b)) return true
  }
  // WebP: RIFF 开头且 8..11 = WEBP
  if (head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) return true
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'].includes(ext)
}

/** 读取、校验并归一化一个图片 File，返回待入库的 PhotoItem。 */
export async function importPhoto(file: File, caption = ''): Promise<PhotoItem> {
  let buf: ArrayBuffer
  try {
    buf = await file.arrayBuffer()
  } catch (e) {
    throw new PhotoRejected('read-failed', `读取失败：${file.name}（${(e as Error).message}）`)
  }
  if (buf.byteLength === 0) throw new PhotoRejected('empty', `文件是空的（0 字节）：${file.name}`)
  if (!looksImage(buf, file.name)) {
    throw new PhotoRejected('not-image', `这不是图片（可能是网页/错误页）：${file.name}`)
  }
  let result
  try {
    result = await redrawImage(file, { outType: 'image/jpeg', quality: 0.92, maxEdge: MAX_EDGE })
  } catch (e) {
    throw new PhotoRejected('decode-failed', `图片解码失败：${file.name}（${(e as Error).message}）`)
  }
  return {
    id: newPhotoId(),
    name: file.name,
    blob: result.blob,
    width: result.width,
    height: result.height,
    rotation: 0,
    caption: caption.trim(),
    seq: Date.now() + Math.random(),
    createdAt: new Date().toISOString()
  }
}

/** 为图片生成预览 Object URL（组件卸载时统一 revoke）。 */
export function photoUrl(photo: PhotoItem): string {
  return URL.createObjectURL(photo.blob)
}
