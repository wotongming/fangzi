/**
 * qrcode.ts —— 搬家箱 QR 生成（qrcode-generator，MIT，动态 import 懒 chunk，不进首包）
 * 与 BarcodeDetector 能力探测。不支持扫码的浏览器（Safari/iOS/无头）隐藏扫码按钮，
 * 走「手输/点选箱号」降级路径，主流程不阻塞。
 */
import { payloadForBox, parseBoxPayload } from './models'

export interface BoxQrResult {
  boxId: string
  payload: string
  svg: string
}

/** 动态加载 qrcode-generator 并生成 fz-box:<boxId> 的矢量 SVG（createSvgTag 打印不糊）。 */
export async function renderBoxQrSvg(boxId: string): Promise<BoxQrResult> {
  const mod = await import('qrcode-generator')
  const qrcode = mod.default
  const qr = qrcode(0, 'M') // 自动类型、纠错 M
  qr.addData(payloadForBox(boxId))
  qr.make()
  return { boxId, payload: payloadForBox(boxId), svg: qr.createSvgTag({ scalable: true }) }
}

interface DetectedCode {
  rawValue?: string
}
interface DetectorCtor {
  new (options: { formats: string[] }): { detect(video: HTMLVideoElement): Promise<DetectedCode[]> }
}

function getDetectorCtor(): DetectorCtor | null {
  if (typeof globalThis === 'undefined' || !('BarcodeDetector' in globalThis)) return null
  return (globalThis as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector ?? null
}

/** 当前环境是否支持原生 BarcodeDetector（Chrome/Edge 桌面与安卓 Chrome）。 */
export function isBarcodeDetectorSupported(): boolean {
  return getDetectorCtor() !== null
}

/**
 * 尝试用 BarcodeDetector 从视频帧扫码；返回命中的 boxId。
 * 不支持或识别失败返回 null，调用方走降级（手输/点选箱号）。
 */
export async function detectBoxFromFrame(video: HTMLVideoElement): Promise<string | null> {
  const Ctor = getDetectorCtor()
  if (!Ctor) return null
  try {
    const det = new Ctor({ formats: ['qr_code'] })
    const codes = await det.detect(video)
    for (const c of codes) {
      const id = parseBoxPayload(c.rawValue ?? '')
      if (id) return id
    }
  } catch {
    return null
  }
  return null
}
