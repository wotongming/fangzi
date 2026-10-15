# 技术沉淀：GPU 大数据可视化面板

- 对应 dev：dev_002_GPU大数据可视化面板.md
- 日期：2026-10-15

## 技术选型与理由

| 维度 | 选型 | 理由 | 商用授权 |
| --- | --- | --- | --- |
| 视图框架 | Vue 3 `<script setup>` + TypeScript | 复用方子 PWA 现有技术栈与工具注册机制，零新增框架 | 随仓库既有依赖（MIT） |
| 一等 GPU 后端 | **WebGPU**（compute shader 原子分桶 + render pipeline 密度着色） | 本批核心 WebGPU 需求；百万点在 GPU 端完成 512×300 网格聚合，CPU 零遍历 | 浏览器原生能力，免费可商用 |
| 兼容 GPU 后端 | **WebGL2**（`gl.POINTS` 顶点直绘，真 GPU） | 覆盖 Firefox/旧版 Chrome/Safari 大量真实用户；实例测得百万点可渲染 | 浏览器原生 |
| 兜底后端 | **Canvas2D**（分桶后上屏） | 极旧环境可降级可用，限 10 万点 | 浏览器原生 |
| 类型定义 | `@webgpu/types ^0.1.74`（devDependency） | 提供完整 WebGPU TS 类型 | **BSD-3-Clause，可商用** |
| 大文件解析 | Web Worker（Blob.stream 分块 + 手写状态机扫描）+ 结果以 **Transferable ArrayBuffer** 回传 | 百万行不阻塞主线程、不 OOM；零第三方解析库 | 原生 |
| 计费 | 方子统一 `useToolBilling` / `billingProvider` | 一套落地免费增值/买断/订阅/用量包/平台分成五模式 | 仓库既有 |
| 懒加载 | WebGPU 渲染器独立 chunk（约 11.6KB / gzip 3.45KB）动态 import | 不用 WebGPU 的用户不下载该代码 | — |

**构建体积**：`gpu-data-viz` 主 chunk 51.85 KB（gzip 19.14 KB），WebGPU chunk 11.60 KB（gzip 3.45 KB）。未引入任何仅限非商业用途的资源。

## 关键实现

### 三后端自动降级链

`lib/render/detect.ts` 探测能力 → `lib/chart.ts` 按 `WebGPU → WebGL2 → Canvas2D` 顺序尝试创建渲染器，任一环节失败/超时即捕获并降级，UI 徽标与提示同步更新，保证任何环境不白屏。

```
detect（只到 requestAdapter，4s 超时）
  └─ chart.init：try WebGPU（建 device 8s 超时）→ catch → WebGL2 → catch → Canvas2D
Renderer 统一接口：setData(xy:Float32Array) / setMode / render(opts) / resize / destroy
```

### WebGPU 网格密度聚合

- 数据归一化坐标以 `Float32Array`（x,y 交错）一次性写入 storage buffer；
- compute pass：每个点映射到 512×300 网格 bin，`atomicAdd` 计数（workgroup 64，max-reduce 256）；
- render pass：按 bin 计数经 viridis 色带映射透明度/颜色着色上屏；热力图再做双线性平滑；
- 折线：另建列均值缓冲，compute 分桶求均值后绘制。

### Worker 流式解析与零拷贝回传

Worker 内手写 CSV/TSV 状态机（支持引号/换行），逐 chunk `scanner.feed`，数值列直写 `Float64Array`；完成后把归一化 `xy`（Float32）与原始 `rawX/rawY`（Float64）的 **buffer 以 Transferable 列表回传**，避免百万级数组的结构化克隆拷贝。

### 交互与坐标

`lib/interact.ts` + `lib/scale.ts` 统一处理 DPR（上限 2）、留白 PAD、滚轮以光标为中心缩放、平移、框选；框选结果回读到当前视图变换，通过分桶索引快速统计选区点数与 X/Y 的 min/avg/max。

## 踩坑记录

1. **canvas 在 `v-if="dataset"` 内导致渲染器永不初始化（致命）**
   两个画布位于 `v-if="dataset"` 的区块，组件 `onMounted` 时 dataset 为空、画布未挂载，初始化函数因拿不到 canvas 提前 return，之后再也不执行——徽标永久停在「正在探测」、FPS 0、画面空白。
   **修复**：改用 `watch(dataset, …, { flush: 'post' })` + `onMounted` 双触发的 `ensureController()`（`initTried` 守卫防重入），初始化后补灌当前 dataset/chart/mode。

2. **能力探测阶段 `requestDevice()` 后 `device.destroy()` 污染 Dawn instance（致命）**
   在无头 SwiftShader（软件 WebGPU）环境，探测时申请并立即销毁 device 会影响共享 instance，导致随后真正渲染用的 device 的 canvas 上屏失效：compute 分桶读回正确、离屏纹理 `copyToBuffer` 读回也正确，唯独 present 上屏报 `A valid external Instance reference no longer exists`，画面空白。
   **修复**：探测只进行到 `requestAdapter()`（加 4s 超时防 hang），device 的真实可用性交给渲染器创建链的 try/catch 超时（8s）降级；渲染器 device 注册 `uncapturederror` 监听。

3. **CSV 文件导入 Worker `postMessage` 两处失败（真实用户链路 bug）**
   - 把 `File` 放进了 `postMessage` 的 transfer list——File 不是 Transferable，报「Value at index 0 does not have a transferable type」。改为结构化克隆（不传第二参数）。
   - `info.headers/types` 来自 Vue reactive `ref`，是 Proxy 数组，无法结构化克隆，报「[object Array] could not be cloned」。在发消息前用 `Array.from(...)` 解包为普通数组。修复后 CSV 文件导入 20K→折线整条链路打通。

4. **TS 5.9 typed array 泛型型变 / Float64Array 溢出**
   统一 `Float32Array<ArrayBuffer>` 类型；`buildDatasetFromTable` 默认 limit 由 `MAX_SAFE_INTEGER` 改为实际行数，避免 `new Float64Array(2^53-1)` 溢出。

5. **无头环境 WebGPU 上屏无法被截图（环境限制，非代码 bug）**
   独立最小「WebGPU 红色清屏」用例在该 headless Chromium + SwiftShader 下，`page.screenshot` 也捕获不到 WebGPU canvas 内容（无 preserveDrawingBuffer 的合成限制）；但 compute 缓冲读回与离屏纹理读回均正确。**结论：验证 WebGPU 计算正确性用缓冲/离屏读回；验证真实可视渲染与交互在无头环境统一强制 WebGL2 降级路径**（模拟不支持 WebGPU 的浏览器，本就是大量用户真实路径）。真机独立显卡正式 Chrome 的 WebGPU 上屏为成熟能力，建议上线后肉眼复核一次。

## 验证覆盖

### 自动化质量门（全绿）

| 检查 | 结果 |
| --- | --- |
| `vue-tsc --noEmit` 类型检查 | 0 错误 |
| 单元测试 `npm test` | **81/81 通过**（其中 002 新增 18 例） |
| 工具检索回归 `verify:tools` | 13 个工具全部通过 |
| 生产构建 `npm run build` | 成功 |
| 端到端 `scripts/e2e-gpu-data-viz.mjs` | **13/13 通过** |

E2E 覆盖：SEO title、SoftwareApplication JSON-LD、示例载入、买断后百万点持续渲染（FPS 读数）、框选统计（实测选区 453,776 点）、PNG 下载、选区 CSV 下载、iframe 嵌入代码、**CSV 文件导入并绘折线**、平板与手机无横向溢出、console 无业务报错。

### 用户变量覆盖（≥90%）

- **渲染后端**：WebGPU（compute/离屏读回验证）、WebGL2（完整可视 E2E）、Canvas2D（兜底代码路径与上限）三档均覆盖；自动降级提示验证。
- **数据来源**：内置示例、CSV 文件导入、粘贴文本三种入口；CSV/TSV/JSON 三类格式由解析单测覆盖（含引号、分隔符、脏值、表头推断）。
- **数据规模**：20K（导入）、500K（免费层）、1M（专业/WebGL2 实测渲染）、后端上限（WebGL2 500 万、Canvas2D 10 万）。
- **视图**：散点密度、热力图、折线均截图确认。
- **交互**：滚轮缩放、按钮 +/−/重置、平移、框选统计、清除选区、双指（移动端视口）。
- **变现五模式**：免费层门控、买断解锁、订阅月/年、用量包、平台分成说明；买断态与权益面板截图确认。
- **视口**：PC 1280×800、平板 834×1112、手机 375×812；`scrollWidth-clientWidth` 实测均为 0px 溢出。

### EdgeOne Pages 免费版限额核查（生产构建产物实测）

| 限额项 | 免费版上限 | 实测值 | 结论 |
| --- | --- | --- | --- |
| 单项目存储总量 | 5 GiB | **28 MiB**（`dist/`） | 远低于上限 ✅ |
| 单项目文件总数 | 20000 | **64 个** | 远低于上限 ✅ |
| 单文件大小 | 25 MiB | **最大 13.58 MiB**（onnxruntime wasm，仓库既有依赖） | < 25 MiB ✅ |

### guide 截图有效性验证（逐张）

均为本次生产构建后在真实运行页面（headless Chromium，WebGL2 路径）由 Playwright `page.screenshot` 实拍，非占位/示意/网图。

| 截图文件 | 像素尺寸 | 大小 | 格式 | 内容一致性 | 结论 |
| --- | --- | --- | --- | --- | --- |
| pc-scatter.png | 1280×1641 | 567,251 B | PNG | PC 散点全页：百万点云+徽标+买断态+五模式权益面板 | 通过 |
| pc-heatmap.png | 1280×1641 | 654,810 B | PNG | 热力图五簇 viridis 密度着色 | 通过 |
| pc-line.png | 1280×1641 | 191,553 B | PNG | 折线视图 | 通过 |
| pc-brush.png | 1280×1723 | 567,516 B | PNG | 框选统计卡片 | 通过 |
| pc-csv-line.png | 1280×1641 | 167,299 B | PNG | CSV 文件导入后折线 | 通过 |
| tablet-scatter.png | 834×1842 | 633,298 B | PNG | 平板散点无横向溢出 | 通过 |
| mobile-scatter.png | 375×2374 | 235,567 B | PNG | 手机纵向自适应布局 | 通过 |
| webgl2-pc-scatter.png | 1280×800 | 220,692 B | PNG | WebGL2 降级百万点首屏 | 通过 |
| webgl2-pc-heatmap.png | 1280×800 | 249,096 B | PNG | WebGL2 热力图 | 通过 |
| webgl2-pc-line.png | 1280×800 | 90,487 B | PNG | WebGL2 折线 | 通过 |
| webgpu-pc-brush.png | 1280×1696 | 188,008 B | PNG | WebGPU 后端徽标+框选统计 DOM（数据层在无头软渲染不可合成，见踩坑 5） | 仅作 DOM/统计佐证 |

> 说明：guide 正文只引用可视层确认有效的截图；`webgpu-*` 一张作为 WebGPU 统计正确性佐证保留，未用于声称上屏效果。

### 全业务场景结论

导入（文件/粘贴/示例）→ 选轴载入 → 三视图型切换 → 缩放/平移/框选统计 → PNG/CSV 导出 → 嵌入代码 → 五模式计费门控，在 PC/平板/手机三端**完整跑通、无阻塞**。

## 已知观察项（建议后续评估，未在本轮擅改）

- `loadSample()` 全量载入（>50 万点这一专业能力）当前依据 `unlocked` 放行，但**未像 CSV 导出那样调用 `consumeIfNeeded()` 扣减每日免费次数**；即免费用户在每日额度内可反复全量载入示例而不扣次（实际消耗发生在导出环节）。是否对"全量载入"本身也计费，属产品口径决策，保守起见本轮未改动，建议产品确认后统一。

## 可复用经验

1. **`v-if` 内的 canvas/第三方控制器初始化**：必须用 `watch(…, {flush:'post'})` 等 DOM 挂载后再 init，并加幂等守卫；不能只在 `onMounted` 里取一次 ref。
2. **WebGPU 能力探测不要提前申请并销毁 device**：只探到 adapter，把 device 创建并入真正的渲染器 try/catch 降级链，避免 Dawn 共享 instance 被污染。
3. **Worker `postMessage` 两个高频坑**：① 只有 ArrayBuffer/MessagePort/ImageBitmap 等才能进 transfer list，File 不行；② Vue reactive Proxy 不能结构化克隆，跨 Worker 边界前用 `Array.from`/`toRaw`/展开成纯对象。
4. **无头软渲染验证 WebGPU 的正确姿势**：计算正确性读 buffer/离屏纹理，可视与交互验证强制 WebGL2；不要用 canvas.toDataURL 或截图对无头 WebGPU 上屏做断言。
5. **降级链要带超时**：软件渲染下 `requestAdapter/requestDevice` 可能长时间不返回，4s/8s 超时是防止卡死的必要兜底。
6. **大数组传输一律 Transferable**：Worker 回传 typed array 时传 `.buffer` 并列入第二参数，可省掉百万级数据的克隆开销。
