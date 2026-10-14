# 技术沉淀：本地图片AI增强工作台

- 对应 dev：dev_001_本地图片AI增强工作台.md
- 日期：2026-10-15

## 技术选型与理由

| 项 | 选型 | 版本 | 理由与核查 |
| --- | --- | --- | --- |
| 推理引擎 | onnxruntime-web（`/wasm` 子入口） | 1.30.0 | **WASM-only**：主入口/WebGPU EP 的 jsep.wasm≈27MiB 超 EdgeOne Pages 单文件 25MiB 上限；`onnxruntime-web/wasm` 仅注册 wasm EP（运行时零 jsep 加载）、单文件 13.6MiB 合规、全浏览器可用 |
| 超分模型 | Real-ESRGAN x4plus anime 6B（ONNX） | HF 直链 | **BSD-3-Clause，可商用**；input=`image.1`、output=`image`、scale=4 |
| 去背景模型 | MODNet quantized（ONNX） | HF 直链 | **Apache-2.0，可商用**；input=`input`、output=`output` |
| 批量压缩 | fflate | 0.8.3 | 无依赖 ZIP 解压/打包（unzipSync/zipSync） |
| 页面 | Vue 3 + Vite + TS strict | fangzi 现有栈 | 不引入重型框架，增量式集成 |
| 计费 | fangzi `src/core/billing/`（LocalMockProvider） | 现有 | 点即支付演示；`VITE_BILLING_ENDPOINT` 切真实网关 |
| SEO | 动态 title/meta + JSON-LD SoftwareApplication + 语义化 HTML | — | 2026 GEO/AEO 趋势：AI 搜索占比 45%+、约 71% 被引页面带 JSON-LD；Google 弃用 Dataset/Q&A，保留 SoftwareApplication/WebSite/FAQPage 等 evergreen 类型 |
| wasm 部署 | **自托管** `public/onnx/`（仅 simd-threaded 13.6MiB） | — | jsdelivr CDN 在沙箱与国内网络不可达（curl 000），改随应用部署 + SW CacheFirst（cacheName `fangzi-ai-models`，90 天/30 条）；配合构建后清理脚本保证单文件 <25MiB |

**依赖漏洞核查声明**：本环境 `npm audit` 不可用（npmmirror 端点返回 404/501），改为**包版本核查**——onnxruntime-web 1.30.0（官方当前版，无已知高危）、fflate 0.8.3（2023-11 发布，社区无已知 CVE）；已卸载曾被短暂引入的 @huggingface/transformers（见踩坑 2），`package.json` 现仅保留上述两个运行时依赖。

## 关键实现

- `lib/pipeline.ts`：工具链定义 `runChain`（转换→裁剪→AI 步骤→导出，前后均查 `AbortSignal` 支持取消）、`validateChain`（空链/同类重复拒绝）、`deriveExt`（AI 步骤强制 PNG）、`stripExif`。
- `lib/batch.ts`：`fromFileList/fromDirectory/fromZip`（fflate unzipSync）导入，`runBatch` 限流并发（默认 3）逐张跑工具链，`zipResults` 打包。
- `lib/worker.ts`：OffscreenCanvas Worker 做转换压缩，失败自动回退主线程；**源码必须纯 ES5 JS**（曾混 TS 注解导致浏览器 `SyntaxError: Unexpected token ':'`），含 error 监听 + 30s 超时 settled 守卫。
- `lib/ai/`：`models.ts` 模型注册表（provider/source/license/inputName/outputName/scale 元数据，单测校验必填项）；`loader.ts` 运行时探测（WebGPU→WASM 降级）+ 自托管 wasmPaths；`enhance.ts` 两个 ort 直推推理。
- `lib/monetization.ts`：`buildAccessSummary`（unlocked = 买断∨订阅∨用量剩余>0）、`consumeIfNeeded`（买断/订阅后不再扣免费额度）、`purchase`（买断/订阅/用量包三种下单）。
- SEO：`reusable-module/use-seo/use-seo.ts`（新沉淀，MIT）注入动态 title/meta + JSON-LD；`src/composables/useSeo.ts` re-export。
- 变现五模式：免费增值（免费转换+每日 3 张 AI 额度）+ 买断 ¥29.9 + 订阅 ¥9.9/月·¥89/年 + 用量包 ¥9.9/张 + 平台分成 20%，全部在 manifest.billing 与权益面板落地。

## 踩坑记录

1. **jsdelivr CDN 被网络封锁**（沙箱 curl 000）→ 弃用 CDN，wasm 自托管 `public/onnx/` 4 文件 41MB，并同步改 SW runtimeCaching。
2. **@huggingface/transformers v3 background-removal 管道与 Xenova/modnet 不匹配**：报 `input 'image.1' is missing in 'feeds'`，且其 wasm 需从 jsdelivr 动态 import（被封锁）。整体弃用并 `npm uninstall`，改 **ort 直推 MODNet**（自备预处理：shortest_edge=512、32 对齐、mean=std=0.5 归一化 [-1,1]、输入名 `input`、输出 matte 缩放回原图作 alpha）。
3. **两个模型的输入名正好相反**：RealESRGAN 输入是 `image.1`、MODNet 输入是 `input`——用 Node 端 ort 实测确认后修正注册表，浏览器复测通过（曾因此误报 30 分钟）。
4. **Worker 源码混 TS 类型注解** → 浏览器 SyntaxError；重写为 ES5 纯 JS。
5. **Node 测试无 `import.meta.env`** → `ORT_WASM_PATHS`/`billingProvider()` 需防御式读取，否则 TypeError。
6. **计费 provider 是模块单例** → 内存订单/用量跨测试残留，导致用例互相污染；新增 `__resetBillingForTest()` 测试钩子 + `beforeEach` 隔离，并修正两个原本依赖「上一个用例遗留买断订单」的断言。
7. **Node 侧 ort 解析模型需本地文件/绝对 wasmPaths**：相对路径报 ERR_MODULE_NOT_FOUND；验证脚本在项目目录内运行并传绝对路径。
8. **EdgeOne Pages 单文件 25MiB 硬限制（本项目最关键的部署红线）**：上线部署报 `Files size limit exceeded. The maximum size for a single file is 25MiB`，超限文件为 onnx 的 jsep.wasm（27MiB）与 asyncify（25.5MiB）。**责任自省**：pipeline PM 阶段只核到「静态托管、不能跑动态服务端」，未把「单文件 25MiB」这一量化指标与选型的 41MB wasm（含 27MiB 单文件）对账；architect/dev 的选型也未做平台红线核查——这是合规流程缺口，教训是**平台硬限制必须量化到选型单文件**。修复链路：①先尝试删 jsep 保 wasm-only → 失败（ort 主入口初始化无条件 import jsep 引导，jsep 缺失致 wasm EP 也初始化失败）；②再尝试只删 jsep.wasm 保 jsep.mjs → 失败（jsep.mjs 被 import 即 fetch jsep.wasm）；③最终切 **`onnxruntime-web/wasm` WASM-only 子入口**（grep 确认其仅含空回调钩子、零 jsep/asyncify 加载），产物最大单文件 13.6MiB，部署合规，AI 实测去背景 4.4s / 超分 4.7s。新增 `scripts/postbuild-clean-wasm.mjs` 构建后校验单文件上限并清理残留。

## 验证覆盖

- **单元测试**：`npm test` 63/63 通过（image-converter 21 项 + 既有 42 项）。覆盖：pipeline 顺序/中止/deriveExt、batch 导入过滤/ZIP/并发/错误、AI 模型注册表元数据、变现判定（免费额度默认可用、未解锁扣额度、额度耗尽 locked、买断/订阅/用量包解锁、provider.isOwned）。
- **构建与回归**：`vue-tsc --noEmit` + `vite build` 通过；`npm run verify:tools` 12 工具 manifest/插件包/示例提问回归通过。
- **E2E（Playwright + 系统 Chromium）11/11 通过**：SEO title/description/JSON-LD ✓；单张转换+下载 ✓；免费额度内 AI 可用+实际消耗 ✓；AI 去背景链路出结果（步骤日志含「去背景」）✓；买断后解锁且免费额度保留 ✓；批量导入 3 张计数 ✓；批量全任务 done=3/3 ✓；ZIP 导出 ✓。
- **多端多尺寸**：PC 1280×800、平板 834×1112、手机 375×812 三端单张页**无横向溢出**（scrollWidth-clientWidth ≤ 0）；平板/手机批量流程 2 张全部成功。各端典型尺寸（PC ≥1280、平板 768–1024、手机 320–480）覆盖主要业务场景。
- **AI 链路实跑**：去背景（MODNet，WASM CPU）128px 图约 4.4s 出透明 PNG；超分（Real-ESRGAN x4，WASM CPU）32px→128px 约 4.7s 出结果；均无 console error、无 jsep 请求。
- **部署合规**：`npm run build` 内置 postbuild 校验，产物最大单文件 13.6MiB < 25MiB（EdgeOne Pages 限制），jsep/asyncify 零残留。
- **截图有效性验证（guide 引用 6 张，全部真实运行界面）**：

| 截图 | 大小 | 内容 | 通过 |
| --- | --- | --- | --- |
| docs/shots/pc-single-ai.png | 169,241 B (1280×1462) | 单张处理页：AI 去背景勾选、结果卡（步骤「转换压缩→AI 去背景」）、下载 .png、权益面板已买断✓ | ✅ |
| docs/shots/pc-batch-done.png | 175,850 B (1280×1562) | 批量工具链页：3 张任务全部成功、导出 ZIP、ZIP 已生成 1.4KB | ✅ |
| docs/shots/tablet-single.png | 166,885 B (834×1488) | 平板单张结果页（WebP 转换、免费额度 3 张） | ✅ |
| docs/shots/tablet-batch.png | 165,166 B (834×1489) | 平板批量页 2 张完成 | ✅ |
| docs/shots/mobile-single.png | 166,818 B (375×2428) | 手机单张结果页 | ✅ |
| docs/shots/mobile-batch.png | 158,426 B (375×2215) | 手机批量页 2 张完成 | ✅ |

（验证方式：`file` 确认 PNG 格式非 0 字节；Playwright 真实运行截图；逐张 Read 核对 OCR 文本与 guide 描述一致。）

- **无阻塞确认**：单张/批量/变现/SEO/三端布局/AI 双模型全链路无阻塞。

## 可复用经验

1. **ort 直推模式**：模型注册表（input/output 名 + 预处理参数）与推理分离，换模型只改注册表；先用 Node 端 ort 实测模型张量名，避免浏览器端盲试。
2. **wasm 自托管 + SW CacheFirst**：境外 CDN 在国内不可靠；自托管并走 SW 缓存，兼顾部署可控与二次离线。
3. **双 EP 降级**：WebGPU 探测失败自动回退 WASM；注意 proxy Worker 与 WebGPU 不兼容（GPU buffer 不可 transfer），推理须主线程。
4. **免费额度变现**：`freePerDay` 免费层先扣、买断/订阅后免扣，是「免费增值」的最简落地；五种变现模式在 manifest 一处声明。
5. **reusable-module 沉淀**：`use-seo`（GEO/AEO 元信息注入）已入 `reusable-module/` 清单，后续工具可直接复用。
