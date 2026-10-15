/**
 * worker-post —— 安全地向 Web Worker 发送消息。
 *
 * 解决两个高频 postMessage 失败（均为结构化克隆 / Transferable 边界问题）：
 *  1) Vue reactive Proxy（ref/reactive 包裹的数组、对象）无法结构化克隆，
 *     报 “[object Array] could not be cloned”。本模块在发送前递归读取属性，
 *     重建为普通对象/数组（Proxy 在读到属性值时即被剥离）。
 *  2) 误把 File / Blob 等非 Transferable 放进 transfer list，
 *     报 “Value at index 0 does not have a transferable type”。
 *     本模块只从消息中自动收集真正的 Transferable（ArrayBuffer 等），
 *     File/Blob 走结构化克隆，绝不进 transfer list。
 *
 * 零依赖（不依赖 Vue），可在任意 TS 项目使用。
 * 授权：MIT（fangzi 内部模块），沉淀自 pipeline 002 GPU 大数据可视化面板。
 */

/** 宿主对象中本身即可被结构化克隆、不应递归展开的类型（构造器名兜底，避免跨 realm 的 instanceof 失效） */
const PASSTHROUGH_CTOR = new Set([
  'File', 'Blob', 'FileList', 'ImageBitmap', 'ImageData',
  'MessagePort', 'AudioData', 'VideoFrame', 'MediaSourceHandle',
  'OffscreenCanvas', 'DOMMatrix', 'DOMPoint', 'DOMQuad', 'DOMRect'
])

function isBufferLike(v: unknown): v is ArrayBuffer {
  return (
    (typeof ArrayBuffer !== 'undefined' && v instanceof ArrayBuffer) ||
    (typeof SharedArrayBuffer !== 'undefined' && v instanceof SharedArrayBuffer)
  )
}

/** 是否为可放入 transfer list 的 Transferable（ArrayBuffer / MessagePort / ImageBitmap 等） */
export function isTransferable(v: unknown): boolean {
  if (isBufferLike(v)) return true
  if (typeof MessagePort !== 'undefined' && v instanceof MessagePort) return true
  if (typeof ImageBitmap !== 'undefined' && v instanceof ImageBitmap) return true
  if (typeof OffscreenCanvas !== 'undefined' && v instanceof OffscreenCanvas) return true
  if (typeof VideoFrame !== 'undefined' && v instanceof VideoFrame) return true
  return false
}

interface PurgeCtx {
  /** 循环引用去重 */
  seen: WeakMap<object, unknown>
  /** 扫描到的可转移对象（自动收集，去重） */
  transfers: unknown[]
  transferSet: WeakSet<object>
}

function collectTransfer(buf: object, ctx: PurgeCtx): void {
  if (!ctx.transferSet.has(buf)) {
    ctx.transferSet.add(buf)
    ctx.transfers.push(buf)
  }
}

/**
 * 递归把任意值净化为“结构化克隆安全”的纯数据：
 * - 剥离 Vue reactive Proxy（重建普通对象/数组）；
 * - 保留 typed array / ArrayBuffer / File / Blob 等可克隆宿主对象；
 * - 自动收集其中的 ArrayBuffer 等 Transferable。
 */
function purge(value: unknown, ctx: PurgeCtx, depth: number): unknown {
  // 基础类型 / null / undefined
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function') {
      // 函数无法跨 Worker 传递：顶层遇到直接抛错，嵌在对象里时由调用处过滤
      throw new Error('worker-post: 消息中包含无法克隆的函数')
    }
    return value
  }

  const v = value as Record<string, unknown>

  // typed array / DataView：原样保留，底层 buffer 自动登记为可转移
  if (ArrayBuffer.isView(v)) {
    collectTransfer((v as unknown as { buffer: ArrayBuffer }).buffer, ctx)
    return value
  }
  if (isBufferLike(v)) {
    collectTransfer(v as unknown as ArrayBuffer, ctx)
    return value
  }

  // 循环引用
  if (ctx.seen.has(v as object)) return ctx.seen.get(v as object)

  // File / Blob / ImageBitmap 等宿主可克隆对象：原样透传（File 不进 transfer）
  const ctorName = (v.constructor && v.constructor.name) || ''
  if (PASSTHROUGH_CTOR.has(ctorName)) {
    if (isTransferable(v)) collectTransfer(v as object, ctx)
    return value
  }

  // Date / RegExp：重新构造，避免 proxy 包装
  if (value instanceof Date) return new Date(value.getTime())
  if (value instanceof RegExp) return new RegExp(value.source, value.flags)

  if (depth > 100) throw new Error('worker-post: 对象嵌套过深（>100 层）')

  // Map：递归键值
  if (value instanceof Map) {
    const m = new Map()
    ctx.seen.set(v as object, m)
    for (const [k, val] of value) m.set(purge(k, ctx, depth + 1), purge(val, ctx, depth + 1))
    return m
  }
  // Set：递归成员
  if (value instanceof Set) {
    const s = new Set()
    ctx.seen.set(v as object, s)
    for (const val of value) s.add(purge(val, ctx, depth + 1))
    return s
  }

  // 数组（含 Vue reactive 数组）：Array.from 读取 + 逐元素净化
  if (Array.isArray(value)) {
    const arr: unknown[] = []
    ctx.seen.set(v as object, arr)
    for (let i = 0; i < value.length; i++) {
      const item = value[i]
      if (typeof item === 'function') continue // 数组里的函数直接跳过
      arr.push(purge(item, ctx, depth + 1))
    }
    return arr
  }

  // 普通对象（含 reactive Proxy）：读取自身可枚举属性重建为 plain object
  const out: Record<string, unknown> = {}
  ctx.seen.set(v as object, out)
  for (const key of Object.keys(v)) {
    const item = v[key]
    if (typeof item === 'function') continue // 方法不带入 Worker
    out[key] = purge(item, ctx, depth + 1)
  }
  return out
}

export interface PlainResult<T = unknown> {
  /** 可直接作为 postMessage 第一个参数的纯数据 */
  data: T
  /** 从消息中扫描到的 Transferable（已去重） */
  transfer: Transferable[]
}

/**
 * 把消息净化为结构化克隆安全数据，并自动收集 Transferable。
 * 默认会把 ArrayBuffer 的所有权转移（零拷贝）；如需保留主线程副本请传 autoTransfer=false。
 */
export function toWorkerMessage<T>(message: T, autoTransfer = true): PlainResult<T> {
  const ctx: PurgeCtx = { seen: new WeakMap(), transfers: [], transferSet: new WeakSet() }
  const data = purge(message, ctx, 0) as T
  return { data, transfer: (autoTransfer ? ctx.transfers : []) as Transferable[] }
}

/** 向 Worker 发送消息：自动剥离 reactive Proxy、自动安全处理 transfer（File 不会误转移） */
export function postTo(worker: Worker, message: unknown, autoTransfer = true): void {
  const { data, transfer } = toWorkerMessage(message, autoTransfer)
  worker.postMessage(data, transfer)
}
