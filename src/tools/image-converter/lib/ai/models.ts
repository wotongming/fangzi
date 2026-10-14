/**
 * AI 模型注册表：集中管理模型元数据（下载源、体积、授权、推理通道）。
 * - provider=transformers：走 @huggingface/transformers 管道（自带预处理/缓存）
 * - provider=ort：走 onnxruntime-web 直接推理（需手动预处理/后处理）
 * 全部为商用友好授权（Apache-2.0 / BSD-3-Clause），模型运行时按需下载，不进 SW 预缓存。
 */

export type AiModelId = 'upscale' | 'bgremove'

export type AiProvider = 'transformers' | 'ort'

export interface AiModelMeta {
  id: AiModelId
  label: string
  desc: string
  provider: AiProvider
  /** transformers：HF 模型 id；ort：ONNX 文件直链 */
  source: string
  sizeMB: number
  license: string
  /** ort 模型的输入/输出张量名（模型相关，不可猜） */
  inputName?: string
  outputName?: string
  /** 模型自身放大倍数（ort 超分） */
  scale?: number
}

export const AI_MODELS: Record<AiModelId, AiModelMeta> = {
  upscale: {
    id: 'upscale',
    label: 'AI 超分 4x',
    desc: 'Real-ESRGAN 本地超分：放大 4 倍并修复模糊、噪声、压缩痕迹。',
    provider: 'ort',
    source:
      'https://huggingface.co/deepghs/imgutils-models/resolve/main/real_esrgan/RealESRGAN_x4plus_anime_6B.onnx',
    sizeMB: 18,
    license: 'BSD-3-Clause',
    inputName: 'image.1',
    outputName: 'image',
    scale: 4
  },
  bgremove: {
    id: 'bgremove',
    label: '去背景（抠图）',
    desc: 'MODNet 人像/主体去背景，输出透明 PNG（ONNX 直推，自备预处理）。',
    provider: 'ort',
    source: 'https://huggingface.co/Xenova/modnet/resolve/main/onnx/model_quantized.onnx',
    sizeMB: 11,
    license: 'Apache-2.0',
    inputName: 'input',
    outputName: 'output'
  }
}

export function listAiModels(): AiModelMeta[] {
  return Object.values(AI_MODELS)
}

/** 从源文件名推断模型 id（供外部/测试使用） */
export function inferModel(source: string): AiModelId | null {
  const s = source.toLowerCase()
  if (s.includes('modnet')) return 'bgremove'
  if (s.includes('realesrgan') || s.includes('upscal')) return 'upscale'
  return null
}
