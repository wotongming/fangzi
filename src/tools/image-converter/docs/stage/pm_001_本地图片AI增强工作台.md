# PM 评估报告：本地图片AI增强工作台

- 对应 innovator：innovator_001_本地图片AI增强工作台.md
- 评估日期：2026-10-15
- 结论：**可集成（重构升级原功能）**——整合进现有 `image-converter` 工具

## 与 fangzi 现有功能去重与整合判定

对照 fangzi README 与 `src/tools/` 现有功能清单：现有 `image-converter`（图片格式转换压缩器，buyout ¥29.90）解决「本地图片 PNG/JPEG/WebP 转换 + 压缩 + 改尺寸」，为**单张**处理，纯 Canvas 实现，无 AI、无批量、无工具链。

- **判定重复但有明显区别**：两者同属「本地图片处理」品类，但 innovator_001 提出现有功能未覆盖的**新痛点/新场景**：
  1. **AI 增强能力**：超分（Real-ESRGAN 类 2x/4x）、去噪、去模糊、人脸修复、去背景、老照片上色——image-converter 完全没有。
  2. **批量工作流**：一次处理 200+ 张、文件夹/ZIP 导入、工具链串联（压缩→裁剪→转换→AI 增强）无需重新上传。
  3. **隐私/合规新场景**：摄影师 NDA 客户照片、HR 员工证件照、未发布商品图——「数据不出端 + AI 处理」是新增价值点。
  4. **离线可用**：模型本地缓存后断网可用（image-converter 本身可离线但无模型缓存概念）。
- **整合方案（去重构原功能）**：复用 `image-converter` 的入口、目录（`src/tools/image-converter/`）与 buyout 计费权益，将功能升级为「图片处理工作台」：
  - 保留原有转换/压缩/改尺寸能力与 UI 入口，作为工作台的一个步骤（转换步骤）；
  - 新增「AI 增强」步骤（模型选择：超分/去噪/去背景等，按需动态加载 onnxruntime-web + WebGPU/WASM 推理）；
  - 新增「批量」模式（多文件/文件夹/ZIP 导入、队列处理、ZIP 导出）与「工具链」串联（将原转换作为链路内步骤）。
- **存量数据与配置保护**：经核查 `image-converter/index.vue` 与 manifest 无 IndexedDB/LocalStorage 读写（纯内存处理，设置仅存在组件内 ref，不落盘）；升级后不存在存量数据结构迁移问题。仍需验证点：①原 buyout 权益判定（`useToolBilling('image-converter')`）保持不变，已购用户权益不失效；②原有单张转换交互保留为默认模式，避免老用户找不到原功能。

## 需求真伪判断

- 真需求。证据链：BulkPicTools 宣称 100 万+ 用户（纯本地批量图片工具）、COMBb2 已有付费 Pro（用户评价明确「batch processing alone is worth Pro」「upscaler I can use on client photos without worrying about NDAs」）、Chrome Web Store 已有本地 AI 超分扩展。使用频次：电商/摄影师为周级高频。
- 与 fangzi 用户群匹配：fangzi 现有 image-converter 用户（运营/自媒体/开发者/证件照人群）正是 AI 增强 + 批量处理的目标人群，升级不改变用户画像，仅扩展能力。

## 技术可行性

- 完全可行，围绕 fangzi 现有技术栈（Vue3 + TS + Vite PWA，纯前端）：
  - AI 推理：`onnxruntime-web`（MIT）WebGPU 后端 + WASM 回退；或 `@huggingface/transformers`（Apache-2.0）跑超分/去背景模型；
  - 模型权重：Real-ESRGAN（BSD-3）等，运行时从 Hugging Face 免费下载、`Cache API`/IndexedDB 缓存；
  - 批量：Web Worker + File System Access API；ZIP 导入导出用 `fflate`（MIT，轻量）；
  - 动态 `import()` 加载重型库，避免主包膨胀。
- 技术风险：WebGPU 移动端覆盖不全（约 70% 桌面 + 部分移动），需 WASM/CPU 回退——已在方案中内置。

## 集成成本与侵入性

- 修改范围：仅 `src/tools/image-converter/` 目录内（index.vue 扩展、新增 worker/模型模块）；manifest 关键词与简介扩展（新增「超分/去噪/去背景/批量/AI 增强」等词）；
- 不触碰 Service Worker（vite-plugin-pwa generateSW 自动包含新增静态资源；模型文件运行时下载不预缓存）、不触碰 manifest.webmanifest、不新增路由（工具框架自动发现）；
- 对存量功能影响：原单张转换逻辑保留，增量叠加；风险评估低。

## 架构兼容性

- 与 fangzi「零后端纯前端 PWA + 单点工具 + 原生 CSS」架构完全兼容；不引入 UI 框架；
- onnxruntime-web/fflate 为 MIT 轻量依赖，符合「不引入重型框架」约束；动态 import 保持主包精简；
- 模型按需下载策略符合 EdgeOne Pages 静态托管（运行时外部下载不属于部署包）。

## 平台合规评估

- EdgeOne Pages：静态托管，无服务端函数需求；部署包仅增加 JS/WASM 库（动态加载），合规；
- 无插件商店分发（不进 Chrome Web Store），不涉及商店政策；
- 内容合规：本地图片处理不产生存储/传播，无风险。

## 资金成本

- 零成本可行：onnxruntime-web（MIT）、Transformers.js（Apache-2.0）、Real-ESRGAN 权重（BSD-3，商用友好）、fflate（MIT）、Hugging Face 免费下载；全部为商用友好授权，无「仅限非商业」资源。

## 时间成本与开发难度

- 复杂度：中高（WebGPU 推理集成 + 批量工作流）；
- 独立开发者估算：AI 步骤 MVP 3-4 天、批量/工具链 3-4 天、联调与回归 2-3 天，合计约 8-11 人日。

## 用户真实价值

- 核心痛点：图片 AI 处理需上传云端（隐私风险）+ 单张处理低效 + 云工具收费；
- 使用频次：电商/摄影师/HR 周级高频；
- 对 fangzi 留存/活跃/付费提升：将 image-converter 从低频单张工具升级为高频批量工具，buyout 权益自然延伸，提升付费转化与回头率。

## 市场与竞争

- 竞品：云端图片工具（红海，但上传隐私+单张限制）；COMBb2/zeropng/BulkPicTools（本地路线，已验证付费，但均为独立站，无工具集合生态）；
- 差异化：fangzi 是「工具集合 + 搜索对症」入口，本地 AI 图片处理作为其中一员可获搜索导流，且 buyout 一次买断比订阅更贴合中国用户习惯。

## 盈利方式建议

- 维持 buyout ¥29.90 并升级为「图片处理工作台」权益（AI 增强 + 批量 + 转换全部解锁）；或升级为 freemium：基础转换免费、AI 增强/批量为 buyout/订阅。建议先保持 buyout 平滑升级，观察后调整。

## 结论与依据

- **可集成（重构升级原功能）**：技术纯前端可行、零资金、不破坏存量（无本地存储数据 + 原交互保留 + 权益不变）、平台合规；新痛点（AI 增强、批量、隐私场景）是现有 image-converter 未覆盖的真实高频需求，整合优于另开新工具（避免并列冗余工具）。
