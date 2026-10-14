# 架构方案：本地图片AI增强工作台

- 对应 innovator：innovator_001_本地图片AI增强工作台.md
- 对应 pm：pm_001_本地图片AI增强工作台.md（结论：可集成（重构升级原功能））
- 设计日期：2026-10-15

## 需求回顾与设计依据

- 需求（innovator_001）：浏览器本地批量图片处理 + AI 增强（超分/去噪/去背景/人脸修复/上色），数据不出端、离线可用、工具链串联，目标人群为摄影师/电商/HR/自媒体。
- PM 结论：与现有 `image-converter` 重复但有明显区别 → **重构升级原功能**：复用其入口、目录与 buyout 权益，把 AI 增强与批量工作流整合进 image-converter，不另开并列工具。
- 设计前提：不破坏存量（无本地存储数据；保留原单张转换交互；buyout 权益不变）；纯前端零后端；EdgeOne Pages 静态托管；不引入重型框架。

## 技术方案

### 系统架构

```
image-converter/（升级为「图片处理工作台」）
├── index.vue          # 主界面：模式切换（单张/批量）+ 工具链步骤条（转换/压缩/裁剪/AI增强）
├── manifest.ts        # 扩展关键词与简介（新增超分/去噪/去背景/批量/AI增强等）
├── lib/
│   ├── pipeline.ts    # 工具链编排：步骤定义、队列、进度、结果传递（内存 blob 传递，不落盘）
│   ├── batch.ts       # 批量模式：多文件/文件夹(ZIP)导入、并发队列(Web Worker)、ZIP 导出(fflate)
│   ├── worker.ts      # 批量处理 Worker（编解码与基础转换在 Worker 执行，主线程不被阻塞）
│   └── ai/
│       ├── loader.ts  # 动态 import onnxruntime-web / transformers；WebGPU→WASM→CPU 降级探测
│       ├── models.ts  # 模型注册表：Real-ESRGAN(超分,BSD-3)、去噪/去模糊/去背景/上色等，标注下载源与缓存键
│       └── enhance.ts # AI 增强执行：图像张量转换、GPU/CPU 推理、结果合成
```

### 模块设计

- **pipeline 模块**：定义步骤链（如「批量压缩 → 裁剪 → 超分 2x → 导出 ZIP」），每步输入输出为内存 Blob，支持中止/重试/单步预览。
- **batch 模块**：File System Access API 读取文件夹/ZIP（fflate 解压），批量任务队列，进度条与单张状态，ZIP 打包导出。
- **ai 模块**：模型懒加载 + Cache API 缓存；`navigator.gpu` 探测 WebGPU，不支持则 onnxruntime-web WASM 回退；小图档位限制避免显存溢出。
- **数据流**：File → (Worker) 解码 → 转换/增强 → 结果 Blob → 下载/打包；全程内存态，不落盘不联网上传。

### 关键技术路线

- 推理：`onnxruntime-web`（MIT，WebGPU 后端 + WASM 回退）优先；部分模型用 `@huggingface/transformers`（Apache-2.0）实现更省事时采用。
- 模型：Real-ESRGAN（BSD-3）超分/去噪、RemBG 类（去背景，Apache-2.0）、GFPGAN 类（人脸修复）；全部运行时从 Hugging Face 免费下载并缓存。
- 压缩/转换：沿用现有 Canvas 实现 + 新增 Web Worker 编解码。
- 打包：`fflate`（MIT）。
- 全部动态 `import()`，主包不膨胀；SW 不预缓存模型。

### 盈利模式（可灵活扩展调整）

- 维持 buyout ¥29.90（平滑升级为工作台权益：转换+压缩+AI 增强+批量全解锁）；后续可视数据点升级 freemium（基础转换免费、AI 增强/批量付费）。

## 与 fangzi 现有代码的集成方式

- 修改文件：`src/tools/image-converter/manifest.ts`（关键词/简介扩展、版本升 1.1.0）、`src/tools/image-converter/index.vue`（界面扩展，保留原单张流程为默认模式）。
- 新增文件：`src/tools/image-converter/lib/` 下 pipeline.ts / batch.ts / worker.ts / ai/*.ts。
- 复用：`useToolBilling('image-converter')` 权益判定不变；工具框架自动发现，无需改 registry/router/search。
- 不触碰：vite.config.ts PWA 配置、manifest.webmanifest、sw（generateSW 自动收新静态资源；模型运行时下载不进预缓存）。

## 软硬件/依赖选型

| 依赖 | 用途 | 授权 | 商用状态 |
| --- | --- | --- | --- |
| onnxruntime-web | AI 推理 | MIT | 商用友好 ✓ |
| @huggingface/transformers | 部分模型推理 | Apache-2.0 | 商用友好 ✓ |
| Real-ESRGAN 权重 | 超分/去噪 | BSD-3 | 商用友好 ✓ |
| RemBG/GFPGAN 权重 | 去背景/人脸修复 | Apache-2.0 | 商用友好 ✓ |
| fflate | ZIP 解压/打包 | MIT | 商用友好 ✓ |
| Hugging Face | 模型下载（运行时） | 免费 | 商用友好（模型各自授权）✓ |
| EdgeOne Pages | 静态托管 | 免费额度 | 商用友好 ✓ |

## 开发方案

- 语言/框架/环境：TypeScript + Vue3（fangzi 现有栈）；Node ≥ 20.19；本地 `npm run dev`。
- 人员分工：独立开发者单兵，按里程碑推进。
- 里程碑：M1 AI 推理骨架（loader/models/enhance + 单张超分）→ M2 批量与工具链（batch/pipeline/worker/ZIP）→ M3 UI 整合与降级完善 → M4 回归与发布。

## 测试方案

- 策略：单元测试（pipeline 步骤、模型注册表、批量队列）+ 人工回归清单。
- 用例重点：①单张转换与原流程完全一致（不破坏存量）；②批量 200+ 张内存稳定；③无 WebGPU 时 WASM 回退可用；④离线（断网后缓存模型仍在）可用；⑤buyout 权益判定不变。
- 验收标准：`npm run type-check`、`npm test` 通过；回归清单全绿；`npm run verify:tools` 关键词命中（图片 AI 增强相关）。

## 实施部署方案

- 部署架构：EdgeOne Pages 静态托管（同 fangzi 现有流程），构建产物 dist/ 推送部署；模型运行时下载不进部署包。
- 上线步骤：本地 `npm run build` → EdgeOne CLI/Git 推送 → 灰度观察 → 全量。
- 运维监控：EdgeOne 访问统计；工具内错误上报（window.onerror 聚合可选）。
- 回滚预案：git revert 至上一发布版本重新部署；工具级回滚仅影响 image-converter，不影响其他工具。

## 风险与反思

- 用户真的需要吗：是——竞品已付费验证（COMBb2 Pro、Chrome 扩展），且与现有 image-converter 用户群重合。
- 会不会把 fangzi 搞复杂：不会——整合进现有工具目录，不新增并列入口，工具框架零改动。
- 真的能节省时间、资金吗：批量+本地处理省时省订阅费，证据充分。
- 遗留问题：WebGPU 移动端覆盖不全（已有 WASM 回退）；超分大图显存限制（设输入尺寸上限并提示）；待确认：模型体积与首次加载等待的 UX 取舍（提供「按需下载单个模型」而非一次全量）。
