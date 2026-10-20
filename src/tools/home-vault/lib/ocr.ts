/**
 * ocr.ts —— 【实验 / 即将支持】拍照文字识别占位模块。
 *
 * 本次 V1 交付：OCR **默认不启用**（无人值守环境无法可靠验证模型拉取与识别准确率），
 * 不挂计费、不卖未验证能力；主路径为「拍照存凭证 + 手动录入」，完全不依赖本模块。
 *
 * 后续 V1.1 计划（默认关闭、不进主包）：
 *  - 仅在用户点击「拍照识别」时动态 import onnxruntime-web（仓库已装，MIT）；
 *  - 从 hf-mirror 懒加载 PPOCRv4-mobile det+rec（Apache-2.0 可商用）；
 *  - 识别结果填入购买日期/金额/商家/保修截止，必须经用户确认后才入库；
 *  - 下载失败 / WASM 不可用 → 静默回退手动录入，主流程永不受阻。
 */

export const OCR_STATUS = 'experimental' as const
export const OCR_NOTICE =
  '拍照文字识别（OCR）为实验能力，即将上线；当前可先拍照存为凭证并手动录入购买信息。'
