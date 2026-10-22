/**
 * photo-sheet-print —— 数据模型。
 */

export interface PhotoItem {
  id: string
  /** 原始文件名 */
  name: string
  /** 归一化后的图片 Blob（已做 EXIF 方向校正与降采样，存 IndexedDB） */
  blob: Blob
  /** 解码后像素宽（旋转前） */
  width: number
  /** 解码后像素高（旋转前） */
  height: number
  /** 展示旋转角度：0 / 90 / 180 / 270 */
  rotation: 0 | 90 | 180 | 270
  /** 备注/学科/日期标签（可空） */
  caption: string
  /** 列表排序序号（越小越靠前） */
  seq: number
  createdAt: string
}

export function newPhotoId(): string {
  return `ph_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}
