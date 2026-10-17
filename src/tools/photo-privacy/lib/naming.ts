/**
 * naming.ts —— 文件名清洗 / 安全重命名（纯函数，可单测）。
 *
 * 去掉能推断拍摄时间、设备、地点、序号的片段，默认生成不含隐私的随机名；
 * 保证扩展名与实际输出格式一致、批量不重名。
 */

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/png': 'png'
}

export function extForMime(mime: string): string {
  return EXT_BY_TYPE[mime] ?? 'jpg'
}

/** 原始文件名 -> 去除品牌/时间戳/序号/微信等痕迹的“安全基名”（不含扩展名） */
export function stripName(original: string): string {
  let base = original.replace(/\.[^.]+$/, '')
  base = base
    // IMG_20260101_120000 / PXL_20260101 / DSC / 微信图片_20260101 / mmexport / Screenshot_日期
    .replace(/^(IMG|PXL|DSC|DSCN|DCIM|MMEXPORT|微信图片|图片|Screenshot|ScreenShot|Photo|PANO|Burst)[_\-\s]*/i, '')
    // 日期（可带分隔符）+ 紧跟的时分秒，一次性吃掉；用数字断言而非 \b（下划线也算单词字符，\b 会漏配）
    .replace(
      /(?<![0-9])(19|20)\d{2}[-_.年/]?(0[1-9]|1[0-2])[-_.月/]?([0-3]\d)(?![0-9])[ _\-.]?(([01]?\d|2[0-3])[ _:.]?[0-5]\d([ _:.]?[0-5]\d)?)?/g,
      ''
    )
    .replace(/(?<![0-9])([01]?\d|2[0-3])[:_.]?[0-5]\d([:_.]?[0-5]\d)?(?![0-9])/g, '')
    .replace(/(?<![0-9])\d{3,}(?![0-9])/g, '') // 连续序号
    .replace(/[（(].*?(gps|location|位置|定位).*?[)）]/gi, '')
    .replace(/[_\-\s]+$/g, '')
    .trim()
  // 清洗后若为空或仅剩符号，退回中性名
  if (!base || /^[_\-.\s]+$/.test(base)) base = 'photo'
  return base
}

function rand4(): string {
  // 4 位足够在单批数百张内防碰撞，且不携带时间信息（不使用时间戳）
  const s = Math.floor(Math.random() * 0x10000).toString(16)
  return s.padStart(4, '0')
}

export interface RenameOptions {
  /** 是否清洗（false 时保留安全化后的原基名） */
  clean?: boolean
  /** 统一前缀，如 erp、secondhand；为空用 photo */
  prefix?: string
  /** 是否加随机后缀防碰撞、去序号 */
  random?: boolean
  /** 同批内保证唯一 */
  used?: Set<string>
}

/** 生成最终文件名（含扩展名），mime 决定真实扩展名 */
export function safeName(original: string, mime: string, opts: RenameOptions = {}): string {
  const ext = extForMime(mime)
  const prefix = (opts.prefix || '').trim()
  let stem: string
  if (opts.clean === false) {
    stem = stripName(original)
  } else {
    stem = prefix || 'photo'
  }
  const used = opts.used ?? new Set<string>()
  let candidate = opts.random === false ? `${stem}.${ext}` : `${stem}-${rand4()}.${ext}`
  let guard = 0
  while (used.has(candidate) && guard < 10000) {
    candidate = `${stem}-${rand4()}.${ext}`
    guard++
  }
  used.add(candidate)
  return candidate
}
