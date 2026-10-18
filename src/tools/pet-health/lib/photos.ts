/**
 * photos.ts —— 单据/化验单照片：本地压缩、存储配额估算（不做 Worker，单张压缩足够轻）。
 * 复用仓库通用模块 image-redraw（Canvas 重绘，自动去 EXIF、限长边）。
 */
import { redrawImage } from '../../../../reusable-module/image-redraw/image-redraw'
import type { PhotoRecord } from './models'
import { createId } from './models'

export const PHOTO_MAX_EDGE = 1600
export const PHOTO_QUALITY = 0.72

export interface StorageEstimateLike {
  quota?: number
  usage?: number
}

export async function estimateStorage(): Promise<StorageEstimateLike> {
  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    try {
      return await navigator.storage.estimate()
    } catch {
      /* 忽略，返回空 */
    }
  }
  return {}
}

/** 压缩一张图片文件为 JPEG Blob（同时去除元数据）。 */
export async function compressPhoto(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const res = await redrawImage(file, {
    outType: 'image/jpeg',
    quality: PHOTO_QUALITY,
    maxEdge: PHOTO_MAX_EDGE
  })
  return { blob: res.blob, width: res.width, height: res.height }
}

export async function buildPhoto(file: Blob, petId: string): Promise<PhotoRecord> {
  const { blob, width, height } = await compressPhoto(file)
  return {
    id: createId('photo'),
    petId,
    blob,
    mime: 'image/jpeg',
    width,
    height,
    bytes: blob.size,
    createdAt: Date.now()
  }
}

/** 已用照片字节合计。 */
export function totalPhotoBytes(photos: PhotoRecord[]): number {
  return photos.reduce((s, p) => s + (p.bytes || 0), 0)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 存储占用比例（0~1）。浏览器 estimate 的 quota 是源级别配额（含其它站点数据），
 * 仅作「即将占满」的预警参考，不能精确代表本工具用量，UI 需如实说明。
 */
export function usedRatio(est: StorageEstimateLike): number | null {
  if (est.quota && est.usage !== undefined && est.quota > 0) {
    return Math.min(1, est.usage / est.quota)
  }
  return null
}
