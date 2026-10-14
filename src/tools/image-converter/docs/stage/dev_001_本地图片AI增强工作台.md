# 开发详细设计：本地图片AI增强工作台

- 对应 architect：architect_001_本地图片AI增强工作台.md
- 设计日期：2026-10-15

## 需求拆解清单

| 编号 | 需求条目 | 实现方法 | 技术要点 | 涉及模块/文件 | 依赖关系 | 验收要点 |
| --- | --- | --- | --- | --- | --- | --- |
| D01 | 保留原有单张转换/压缩流程 | 不改动原 index.vue 核心转换逻辑，作为工作台「转换」步骤默认模式 | Canvas 编解码 + quality/maxWidth 控制 | index.vue | — | 与原行为完全一致 |
| D02 | WebGPU/WASM 能力探测 | `navigator.gpu` + `requestAdapter` 探测，维护运行环境档位 | 探测失败标记 cpu 档 | lib/ai/loader.ts | D01 | 无 GPU 环境正常降级 |
| D03 | AI 模型注册表与按需下载缓存 | 定义模型元数据（源 URL/体积/缓存键），Cache API 缓存，进度提示 | Real-ESRGAN(超分)/去噪/去背景/人脸修复/上色 | lib/ai/models.ts | D02 | 首次下载有进度，断点续传可用 |
| D04 | 单张 AI 增强执行 | onnxruntime-web 动态加载，图像→张量→推理→合成，WebGPU 优先 | 输入尺寸上限（如 1600px）防显存溢出 | lib/ai/enhance.ts | D02,D03 | 超分 2x 输出正确 |
| D05 | 批量导入（多文件/文件夹/ZIP） | File System Access API + fflate 解压 ZIP | 批量队列上限保护 | lib/batch.ts | D01 | 一次 200+ 张稳定 |
| D06 | 工具链串联 | pipeline 步骤定义（压缩→裁剪→转换→AI 增强→导出），内存 Blob 传递 | 每步可预览/中止/重试 | lib/pipeline.ts | D04,D05 | 链路结果正确 |
| D07 | 批量 Worker 处理 | Web Worker 中执行解码/基础转换，主线程不阻塞 | transferable 传递 | lib/worker.ts | D05 | 批量时 UI 不卡 |
| D08 | ZIP 打包导出 | fflate 打包结果，单张/全部下载 | 文件名规范化 | lib/batch.ts | D06 | 导出的 ZIP 可解压 |
| D09 | manifest 扩展与权益保持 | 更新 manifest 关键词/简介/版本 1.1.0；buyout ¥29.90 不变 | 关键词：超分/去噪/去背景/批量/AI增强/老照片 | manifest.ts | — | verify:tools 命中 |
| D10 | EXIF/GPS 清除 | 导出前剥离元数据（Canvas 重绘天然清除 + 可选 EXIF 库） | 隐私卖点 | lib/pipeline.ts | D08 | 导出图无 GPS |

## 技术选型落地

- 语言/框架：TypeScript + Vue3（现有栈）；推理 onnxruntime-web（MIT）；模型 Real-ESRGAN（BSD-3）/RemBG（Apache-2.0）/GFPGAN（Apache-2.0）；ZIP fflate（MIT）；全部动态 import。
- 托管：EdgeOne Pages（现有）；零成本；全部商用友好授权（已在 architect 表中逐项确认）。

## 模块设计

见 architect_001 系统架构；职责划分：pipeline（编排）、batch（批量与 ZIP）、worker（并行处理）、ai/*（探测/模型/推理）、index.vue（UI 整合，保留原单张模式为默认）。

## 关键实现方法

```ts
// 能力探测（loader.ts）
export async function detectRuntime(): Promise<'webgpu'|'wasm'|'cpu'> {
  if (navigator.gpu) {
    const adapter = await navigator.gpu.requestAdapter()
    if (adapter) return 'webgpu'
  }
  return 'wasm' // onnxruntime-web 自动回退 CPU
}
// 模型缓存（models.ts）
async function ensureModel(id: string, meta: ModelMeta) {
  const cache = await caches.open('fangzi-ai-models')
  let res = await cache.match(meta.url)
  if (!res) { res = await fetch(meta.url); await cache.put(meta.url, res.clone()) }
  return res.arrayBuffer()
}
// 工具链编排（pipeline.ts）
const chain = [{id:'compress',fn:compress},{id:'crop',fn:crop},{id:'upscale',fn:upscale2x}]
for (const step of chain) { blob = await step.fn(blob); report(step.id) }
```

## 文件清单

- 新建：`src/tools/image-converter/lib/pipeline.ts`、`lib/batch.ts`、`lib/worker.ts`、`lib/ai/loader.ts`、`lib/ai/models.ts`、`lib/ai/enhance.ts`
- 修改：`src/tools/image-converter/index.vue`（模式切换与步骤条 UI）、`src/tools/image-converter/manifest.ts`（关键词/版本）
- 其他：`docs/` 下新增升级说明（归档用）

## 开发环境与工具链

- Node ≥ 20.19；`npm install`；`npm run dev`（Vite）；`npm run new:tool` 不适用（改造现有工具）；`npm run verify:tools` 回归。

## 开发步骤与里程碑

- M1（3-4 天）：loader/models/enhance + 单张 AI 增强（超分）可用；
- M2（3-4 天）：batch/pipeline/worker + ZIP 导入导出；
- M3（2-3 天）：UI 整合（模式切换、步骤条、进度）与降级完善；
- M4（2-3 天）：回归测试、manifest 更新、发布准备。

## 代码规范与质量要求

- 遵循 fangzi 现有风格：TS 严格模式、组件用 `<script setup lang="ts">`、manifest 字段完整合法（id 与目录一致、计费自洽）；
- 重型依赖必须动态 `import()`；不得引入 UI 框架；模型文件不得进 SW 预缓存。

## 验收标准

- `npm run type-check` 通过；`npm test` 通过（新增 pipeline/batch 单测）；
- 回归清单：原单张转换流程与升级前一致；buyout 权益判定不变（`useToolBilling('image-converter')`）；
- 批量 200+ 张内存稳定、UI 不卡；无 WebGPU 环境 WASM 降级可用；断网后缓存模型可用；
- `npm run verify:tools` 通过（关键词命中）。
