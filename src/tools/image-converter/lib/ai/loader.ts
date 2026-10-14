/**
 * AI 运行环境探测与运行时加载。
 * - WebGPU：Chrome/Edge 桌面与 Android（onnxruntime-web/webgpu）
 * - WASM：全浏览器兜底（onnxruntime-web 默认）
 * 依据 onnxruntime.ai 官方兼容矩阵：WebGPU 不支持 Safari/Firefox，WASM 全支持。
 * wasm 二进制自托管于应用 public/onnx/（与 JS 包同版本 onnxruntime-web 1.30.0），
 * 避免依赖境外 CDN（国内访问不稳定、部分网络被阻断），并可通过 SW 缓存实现二次离线。
 */
import type { AiModelMeta } from './models'

export type Runtime = 'webgpu' | 'wasm'

/** onnxruntime-web 版本必须与 public/onnx/ 下的 wasm 一致，否则会因内部符号不匹配而初始化失败 */
export const ORT_VERSION = '1.30.0'
/** 自托管 wasm 路径（部署子路径时由 VITE_BASE 自动适配；Node 测试环境无 import.meta.env 时回退根路径） */
const baseUrl = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'
export const ORT_WASM_PATHS = `${baseUrl}onnx/`

let cachedRuntime: Runtime | null = null

export async function detectRuntime(): Promise<Runtime> {
  if (cachedRuntime) return cachedRuntime
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter?: () => Promise<unknown> } }).gpu
    if (gpu?.requestAdapter) {
      const adapter = await gpu.requestAdapter()
      if (adapter) {
        cachedRuntime = 'webgpu'
        return cachedRuntime
      }
    }
  } catch {
    // 无 GPU / 被浏览器策略拦截 → 走 WASM
  }
  cachedRuntime = 'wasm'
  return cachedRuntime
}

export function runtimeLabel(r: Runtime): string {
  return r === 'webgpu' ? 'WebGPU 加速' : 'WASM（CPU）'
}

/** 动态加载 onnxruntime-web；调用方须保证只在浏览器环境执行 */
export async function loadOrt(runtime: Runtime): Promise<typeof import('onnxruntime-web')> {
  const ort = await import(runtime === 'webgpu' ? 'onnxruntime-web/webgpu' : 'onnxruntime-web')
  ort.env.wasm.wasmPaths = ORT_WASM_PATHS
  // 多线程需要 crossOriginIsolated；非隔离环境自动回退单线程，这里不强行开启
  return ort
}

/** 校验模型元数据完整性（供测试与发布前检查） */
export function validateModelMeta(meta: AiModelMeta): { ok: boolean; error?: string } {
  if (!meta.id || !meta.label || !meta.source || !meta.license) return { ok: false, error: '模型元数据缺失必填项' }
  if (meta.provider === 'ort' && (!meta.inputName || !meta.outputName)) {
    return { ok: false, error: 'ort 模型必须声明 inputName/outputName' }
  }
  return { ok: true }
}
