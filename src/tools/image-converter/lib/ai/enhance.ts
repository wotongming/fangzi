/**
 * AI 增强执行：
 * - 去背景（MODNet）：@huggingface/transformers 管道，主线程推理（官方 demo 同款，模型约 10MB，proxy=false）
 * - 超分（Real-ESRGAN x4 ONNX）：onnxruntime-web 直接推理，手动 RGB 张量预处理/后处理
 * 全程本地推理；首次使用按需下载模型（transformers 自带 IndexedDB 缓存）。
 */
import { AI_MODELS, type AiModelId } from './models'
import { detectRuntime, loadOrt, runtimeLabel } from './loader'

/** 输入长边上限：防止超分输出过大导致显存/内存溢出（4x 后 = maxDim*4） */
export const UPScaleMaxInput = 512

export interface AiRunResult {
  blob: Blob
  ext: 'png'
  ms: number
  runtime: 'webgpu' | 'wasm'
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v * 255)))
}

function loadImageBlob(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob)
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片解析失败'))
    }
    img.src = url
  })
}

function drawScaled(img: HTMLImageElement, maxDim?: number): HTMLCanvasElement {
  const scale = Math.min(
    1,
    maxDim ? maxDim / img.naturalWidth : 1,
    maxDim ? maxDim / img.naturalHeight : 1
  )
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布上下文')
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas
}

function canvasToBlob(canvas: HTMLCanvasElement, mime = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('导出失败'))), mime)
  })
}

/** RGB [0,1] 输入 → NCHW float32 张量（预处理器） */
function rgbaToNchw(imageData: ImageData): Float32Array {
  const { width: W, height: H, data: src } = imageData
  const rgb = new Float32Array(1 * 3 * H * W)
  const hw = H * W
  for (let i = 0, p = 0; i < src.length; i += 4, p++) {
    rgb[p] = src[i]! / 255
    rgb[hw + p] = src[i + 1]! / 255
    rgb[2 * hw + p] = src[i + 2]! / 255
  }
  return rgb
}

/** NCHW float32 [0,1] → RGBA ImageData（后处理器，通道固定 RGB） */
function nchwToRgba(data: Float32Array, H: number, W: number): ImageData {
  const out = new ImageData(W, H)
  const hw = H * W
  const od = out.data
  for (let p = 0; p < hw; p++) {
    od[p * 4] = clamp255(data[p]!)
    od[p * 4 + 1] = clamp255(data[hw + p]!)
    od[p * 4 + 2] = clamp255(data[2 * hw + p]!)
    od[p * 4 + 3] = 255
  }
  return out
}

interface OrtLike {
  Tensor: new (
    type: 'float32',
    data: Float32Array,
    dims: number[]
  ) => unknown
  InferenceSession: {
    create: (url: string, options: Record<string, unknown>) => Promise<{
      run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: Float32Array; dims: number[] }>>
      release: () => void
    }>
  }
  env: { wasm: { wasmPaths: string } }
}

/**
 * 超分（ort）：输入 RGB [0,1] float32 [1,3,H,W] → 输出 [1,3,4H,4W] → 画布导出 PNG。
 * 推理失败时逐级降级：webgpu → wasm，仍失败抛错由 UI 呈现。
 */
export async function upscale(blob: Blob, onProgress?: (p: number) => void): Promise<AiRunResult> {
  const meta = AI_MODELS.upscale
  const started = performance.now()
  const img = await loadImageBlob(blob)
  const inputCanvas = drawScaled(img, UPScaleMaxInput)
  const ctx = inputCanvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布上下文')
  const rgb = rgbaToNchw(ctx.getImageData(0, 0, inputCanvas.width, inputCanvas.height))
  const [W, H] = [inputCanvas.width, inputCanvas.height]

  let runtime = await detectRuntime()
  const attempts: Array<'webgpu' | 'wasm'> = runtime === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm']
  let lastError: unknown = null
  for (const rt of attempts) {
    runtime = rt
    let session: Awaited<ReturnType<OrtLike['InferenceSession']['create']>> | null = null
    try {
      onProgress?.(0.2)
      const ort = (await loadOrt(rt)) as unknown as OrtLike
      session = await ort.InferenceSession.create(meta.source!, {
        executionProviders: [rt === 'webgpu' ? 'webgpu' : 'wasm'],
        logSeverity: 3
      })
      onProgress?.(0.5)
      const feeds = { [meta.inputName!]: new ort.Tensor('float32', rgb, [1, 3, H, W]) }
      const results = await session.run(feeds)
      onProgress?.(0.85)
      const tensor = results[meta.outputName!]
      if (!tensor) throw new Error(`模型输出缺少 ${meta.outputName}`)
      const N = tensor.dims[0]!
      const C = tensor.dims[1]!
      const OH = tensor.dims[2]!
      const OW = tensor.dims[3]!
      if (N !== 1 || C !== 3) throw new Error(`非预期输出形状：${tensor.dims.join('x')}`)
      const outCanvas = document.createElement('canvas')
      outCanvas.width = OW
      outCanvas.height = OH
      const octx = outCanvas.getContext('2d')!
      octx.putImageData(nchwToRgba(tensor.data, OH, OW), 0, 0)
      onProgress?.(0.95)
      const outBlob = await canvasToBlob(outCanvas)
      return { blob: outBlob, ext: 'png', ms: performance.now() - started, runtime }
    } catch (e) {
      lastError = e
      // webgpu 失败 → 继续 wasm；wasm 失败 → 抛出
    } finally {
      session?.release()
    }
  }
  throw lastError instanceof Error ? lastError : new Error('AI 超分失败')
}

/**
 * 去背景（MODNet）：onnxruntime-web 直接推理（自备预处理）。
 * 预处理按模型 preprocessor_config：shortest_edge=512、尺寸向 32 对齐、
 * 归一化 mean=std=0.5（像素 → [-1,1]），输入张量名 'input'，输出 matte 'output'。
 * 后处理：matte 平滑缩放到原图尺寸，作为原图 alpha 通道导出透明 PNG。
 */
export async function removeBackground(blob: Blob, onProgress?: (p: number) => void): Promise<AiRunResult> {
  const meta = AI_MODELS.bgremove
  const started = performance.now()
  const img = await loadImageBlob(blob)
  const srcW = img.naturalWidth
  const srcH = img.naturalHeight

  // —— 预处理：按模型要求缩放（最短边 512，尺寸 32 对齐）——
  const scale = Math.max(512 / srcW, 512 / srcH)
  const tw = Math.ceil((srcW * scale) / 32) * 32
  const th = Math.ceil((srcH * scale) / 32) * 32
  const inCanvas = document.createElement('canvas')
  inCanvas.width = tw
  inCanvas.height = th
  const ictx = inCanvas.getContext('2d')!
  ictx.drawImage(img, 0, 0, tw, th)
  const { data: src } = ictx.getImageData(0, 0, tw, th)
  // 像素 [0,255] → (v/255 - 0.5) / 0.5 → [-1,1]，CHW
  const hw = tw * th
  const tensor = new Float32Array(3 * hw)
  for (let i = 0, p = 0; i < src.length; i += 4, p++) {
    tensor[p] = src[i]! / 255 - 0.5
    tensor[hw + p] = src[i + 1]! / 255 - 0.5
    tensor[2 * hw + p] = src[i + 2]! / 255 - 0.5
  }

  onProgress?.(0.3)
  let runtime = await detectRuntime()
  const attempts: Array<'webgpu' | 'wasm'> = runtime === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm']
  let lastError: unknown = null
  let matte: Float32Array | null = null
  let outW = 0
  let outH = 0
  for (const rt of attempts) {
    runtime = rt
    let session: Awaited<ReturnType<OrtLike['InferenceSession']['create']>> | null = null
    try {
      onProgress?.(0.4)
      const ort = (await loadOrt(rt)) as unknown as OrtLike
      session = await ort.InferenceSession.create(meta.source!, {
        executionProviders: [rt === 'webgpu' ? 'webgpu' : 'wasm'],
        logSeverity: 3
      })
      const feeds = { [meta.inputName!]: new ort.Tensor('float32', tensor, [1, 3, th, tw]) }
      const results = await session.run(feeds)
      onProgress?.(0.75)
      const out = results[meta.outputName!]
      if (!out) throw new Error(`模型输出缺少 ${meta.outputName}`)
      matte = out.data
      outW = out.dims[2] ?? tw
      outH = out.dims[3] ?? th
      break
    } catch (e) {
      lastError = e
      // webgpu 失败 → 继续 wasm；wasm 失败 → 抛出
    } finally {
      session?.release()
    }
  }
  if (!matte) throw lastError instanceof Error ? lastError : new Error('AI 去背景失败')

  // —— 后处理：matte 缩放回原图尺寸并作为 alpha 通道 ——
  const matteCanvas = document.createElement('canvas')
  matteCanvas.width = outW
  matteCanvas.height = outH
  const mctx = matteCanvas.getContext('2d')!
  const matteImg = mctx.createImageData(outW, outH)
  const md = matteImg.data
  const outHw = outW * outH
  for (let p = 0; p < outHw; p++) {
    const v = clamp255(matte[p]!)
    md[p * 4] = v
    md[p * 4 + 1] = v
    md[p * 4 + 2] = v
    md[p * 4 + 3] = 255
  }
  mctx.putImageData(matteImg, 0, 0)
  // 平滑缩放 matte 到原图尺寸
  const scaled = document.createElement('canvas')
  scaled.width = srcW
  scaled.height = srcH
  const sctx = scaled.getContext('2d')!
  sctx.imageSmoothingEnabled = true
  sctx.imageSmoothingQuality = 'high'
  sctx.drawImage(matteCanvas, 0, 0, srcW, srcH)

  const outCanvas = document.createElement('canvas')
  outCanvas.width = srcW
  outCanvas.height = srcH
  const octx = outCanvas.getContext('2d')!
  octx.drawImage(img, 0, 0)
  const finalImg = octx.getImageData(0, 0, srcW, srcH)
  const matteScaled = sctx.getImageData(0, 0, srcW, srcH).data
  for (let i = 0; i < finalImg.data.length; i += 4) {
    finalImg.data[i + 3] = matteScaled[i]!
  }
  octx.putImageData(finalImg, 0, 0)
  onProgress?.(0.9)
  const outBlob = await canvasToBlob(outCanvas)
  onProgress?.(1)
  return { blob: outBlob, ext: 'png', ms: performance.now() - started, runtime }
}

/** 统一 AI 入口：按模型 id 分发，供工具链步骤调用 */
export async function runAi(model: AiModelId, blob: Blob, onProgress?: (p: number) => void): Promise<AiRunResult> {
  const meta = AI_MODELS[model]
  if (!meta) throw new Error(`未知模型：${model}`)
  const label = `${meta.label} · ${runtimeLabel(await detectRuntime())}`
  void label
  if (model === 'bgremove') return removeBackground(blob, onProgress)
  if (model === 'upscale') return upscale(blob, onProgress)
  throw new Error(`模型 ${model} 暂不支持`)
}
