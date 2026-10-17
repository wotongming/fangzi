/**
 * AI 运行时：WASM（CPU）单后端推理。
 * 选型说明：EdgeOne Pages 静态托管对单个部署文件有 25MiB 硬上限，而
 * onnxruntime-web 主入口（ort.bundle）与 WebGPU EP（jsep.wasm ≈27MiB）单文件必然超限；
 * 因此使用 WASM-only 子入口 `onnxruntime-web/wasm`（ort.wasm.bundle）：
 *   ① 只注册 wasm EP，运行时不会加载 jsep/asyncify（主入口会在初始化时无条件 import jsep 引导）；
 *   ② wasm 自托管单文件 ≈13.6MiB < 25MiB，部署合规；
 *   ③ 全浏览器可用（Safari/Firefox 无 WebGPU 也能推理）。
 * wasm 二进制自托管于应用 public/onnx/（与 JS 包同版本 onnxruntime-web 1.30.0），
 * 避免依赖境外 CDN（国内访问不稳定、部分网络被阻断），并可通过 SW 缓存实现二次离线。
 */
import type { AiModelMeta } from './models'
import { configureOrtWasm } from '../../../../../reusable-module/ort-wasm-loader/ort-wasm-loader'

export type Runtime = 'wasm'

/** onnxruntime-web 版本必须与 public/onnx/ 下的 wasm 一致，否则会因内部符号不匹配而初始化失败 */
export const ORT_VERSION = '1.30.0'
/** 自托管 wasm 路径（部署子路径时由 VITE_BASE 自动适配；Node 测试环境无 import.meta.env 时回退根路径） */
const baseUrl = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'
export const ORT_WASM_PATHS = `${baseUrl}onnx/`

export const RUNTIME: Runtime = 'wasm'

export async function detectRuntime(): Promise<Runtime> {
  return RUNTIME
}

export function runtimeLabel(_r: Runtime): string {
  return 'WASM（CPU）'
}

/** 动态加载 onnxruntime-web WASM-only 入口；调用方须保证只在浏览器环境执行 */
export async function loadOrt(): Promise<typeof import('onnxruntime-web')> {
  const ort = await import('onnxruntime-web/wasm')
  // 用 blob: 加载胶水脚本，规避 EdgeOne 对 .mjs 下发 octet-stream 导致的 MIME 导入失败
  await configureOrtWasm(ort)
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
