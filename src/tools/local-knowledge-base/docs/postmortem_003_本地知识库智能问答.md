# 技术沉淀：本地知识库智能问答

- 对应 dev：dev_003_本地知识库智能问答.md
- 日期：2026-10-15
- 档位：**H（WebAssembly 本地 AI / 大文件多源下载）**；本期交付可运行 checkpoint，语义链路已端到端真实验证。

## 技术选型与理由

| 维度 | 选型 | 理由 / 授权 |
|---|---|---|
| 嵌入模型 | `Xenova/bge-small-zh-v1.5` 量化 ONNX（`model_quantized.onnx`，24,010,842 字节 ≈ 24MB，512 维） | 中文检索效果好、体积小、首载快；模型 **MIT**、权重可商用 |
| 推理运行时 | onnxruntime-web **1.30.0 WASM-only**，自托管 `public/onnx/`（沿用 image-converter 范式） | MIT；无服务端、规避 WebGPU 无头兼容坑；SIMD+threads 性能足够 |
| 分词 | **自实现 BERT WordPiece 分词器**（零新增 npm 依赖） | 避免为分词引入整包 @huggingface/transformers；输入 int64 张量自控 |
| 存储 | IndexedDB 三表（documents/chunks/conversations）+ Cache Storage（模型文件） | 复用 `reusable-module/indexeddb-kv`；模型走 Cache 支持流式与离线 |
| 检索 | 向量余弦 + BM25（CJK 一元+二元）经 RRF 融合 | 语义召回 + 关键词精确命中互补；任一不可用自动降级 |
| 答案 | Top-K 片段内按词重叠抽取高相关句 + `[n]` 引用 | 不接生成式 LLM，零幻觉、零 token 成本、可溯源 |
| 模型分发 | hf-mirror → huggingface.co 内置多源 + 自定义 HF 兼容 Base（R2/COS） | HEAD 探测选源、运行时故障切换；合法合规、免费/极低成本 |

漏洞与兼容性：onnxruntime-web 锁定仓库已验证的 1.30.0；未新增任何 npm 依赖（dependencies 仍为 fflate/onnxruntime-web/pinia/vue/vue-router/workbox-window），无新增供应链面。

## 关键实现

- **解析分块**（`lib/ingest.ts`）：按后缀识别 txt/md/csv/html；按标题与长度滑窗切块（默认块长/重叠），保留标题上下文。
- **分词**（`lib/tokenizer.ts`）：BERT basic tokenize（中文按字、标点切分、小写与控制符清洗）→ WordPiece 最长匹配 → 加 `<[BOS_never_used_51bce0c785ca2f68081bfa7d91973934]>/[SEP]`、超长截断；`padBatch` 输出三个 `Int32Array`（分词阶段用，类型友好、可单测）。
- **嵌入**（`lib/embedder.ts`）：WASM 会话创建后，**在 ort 边界把 Int32Array 转 BigInt64Array 并以 `int64` 喂入**（见踩坑 1）；取 `last_hidden_state` 按 attention mask mean-pool → L2 归一化；查询侧加 bge 中文指令前缀。
- **多源下载**（`lib/models.ts`）：`selectSource()` 对各源 HEAD `config.json` 5s 探测排序；`fetchModelFile()` 先查 Cache，未命中则逐源 `ReadableStream` 下载并回报进度，完成后写入 Cache；大小一致性用 **±2%（至少 64KB）** 容差（见踩坑 2）。
- **检索合成**（`lib/retrieval.ts`）：`retrieveAndAnswer()` 有 `embedQuery` 且成功则 RRF 融合，否则纯 BM25；置信度语义通道取最高余弦、BM25 通道取归一化命中强度；答案抽取句子并附 `[n]`，低置信度提示。
- **引擎编排**（`lib/engine.ts`）：hydrate 从 IndexedDB 重建内存 BM25；导入走 解析→分块→（语义）嵌入→落库；语义失败返回 `degraded` 原因，纯 BM25 仍可用。
- **变现**：只接统一计费钩子 + 主方案 freemium/买断 ¥49.90（免费：4 格式、语义小模型、20 文档；Pro：不限文档、自定义模型源），未为五种模式重复造轮子。

## 踩坑记录

1. **ONNX 输入必须 int64（最关键）**：Xenova 导出的 BERT 模型三个输入 `input_ids / attention_mask / token_type_ids` 声明为 `tensor(int64)`。最初按 int32 喂入，`OrtRun` 直接报 `Unexpected input data type. Actual: int32, expected: int64`，且异常被检索层 `catch{}` 静默吞掉，表现为「模型显示就绪、问答却始终走 BM25、chunk 无向量」，极难定位。修复：在 embedder 调用边界转 `BigInt64Array` + `new ort.Tensor('int64', …)`；分词器内部仍保留 Int32Array（便于单测与内存）。**教训：跨模型边界要以 `session.inputNames` / 图声明为准；降级 catch 必须打日志，不能静默。**
2. **模型文件大小不能用过严的等值校验**：最初把 onnx 期望大小写成估算值 23,900,000 且容差仅 4096 字节；真实文件 24,010,842（差约 0.46%），完整下载后被误判「损坏」→ 回退源重试，引发一连串 CORS 报错噪声。修复：期望大小以真实 `Content-Length` 校准，并改为 ±2%（至少 64KB）容差，仍能拦截截断。
3. **无头浏览器多源 CORS 现象**：curl 带 Origin 探测时 hf-mirror 各跳转终点（含 cas-bridge CDN）均正确回显 `Access-Control-Allow-Origin`；但 Chromium 无头环境偶发对个别源预检/缓存报 CORS。多源故障切换 + 官方源兜底保证了最终成功；这些 console 报错是「探测失败→切源」的预期噪声，E2E 已将其与真实功能失败区分。
4. **Vue reactive proxy 不能直接结构化克隆入 IndexedDB**：对话对象经模板响应式化后 `put()` 失败且被问答 catch 吞掉，表现为对话不保存。修复：`saveConversation` 落库前 `JSON.parse(JSON.stringify())` 解包为普通对象。
5. **Playwright 文本选择器误伤**：`text=问答/文档库` 同时命中副标题里的「智能问答」等字样，点到非 tab 元素导致后续全部超时。修复：统一用 `.tabs button { hasText }` 精确选择；弹层关闭用 `.modal-card button.btn-primary`（`text=` 不能拼进 CSS 选择器）。
6. **无效动态导入提示**：embedder 既被 engine 静态引入、又在页面里 `await import()`，rolldown 提示动态导入不产生独立 chunk；改为静态导入（模型权重本就运行时按需下载，wasm 已自托管）。

## 验证覆盖

档位 H，质量门全部通过；数据均为本轮真实重跑所得。

- **类型检查**：`npx vue-tsc --noEmit` → 0 error。
- **单元测试**：本工具 18/18（分词 WordPiece/截断/pad、分块、四格式解析、BM25 中文二元、cosine、RRF、纯 BM25 与注入式语义检索、空库、模型源 URL/非法自定义源过滤）；全量 **126/126** 通过（原 108 + 本工具 18）。
- **构建 / 注册**：`npm run build` 成功、无无效动态导入警告；`npm run verify:tools` → **校验工具数 16，全部 manifest / 插件包 / 示例提问回归通过**（本工具为第 16 个）。
- **E2E（真实 Chromium，脚本 `scripts/e2e-local-knowledge-base.mjs`）14/14**：
  1. 打开工具标题/SEO 正确；2. 关闭语义时 txt/md/csv/html 四格式导入建库；3. 纯 BM25 问答命中合同且带 `[n]`；4. 点引用弹原文弹层；5. 对话自动保存并导出 .md；6. 免费态自定义源禁用、内置源与对象存储说明可见；7. 补到 20 文档后第 21 个被拦截；8. 写 paid freemium-pro 订单重载后解锁、可导入第 21 个；9. **真实从镜像下载 24MB bge q8 模型并初始化成功（约 6s，缓存命中更快）**；10. **语义嵌入建库 + 问答走「语义+关键词检索」（实测置信度 0.61~0.93），chunk 向量 512 维**；11–13. PC/平板/手机三视图口无横向溢出；14. 无实质 console 错误（SW abort、多源探测 CORS 噪声已识别并过滤）。
- **多端多尺寸**：PC 1280×800、平板 834×1112、手机 375×812；文档库与问答页实测无横向溢出，手机端三栏降单栏、按钮可点。
- **EdgeOne 免费版限额**：dist **约 29MiB**（< 5GiB）、**71 个文件**（< 20000）、**单文件最大 13.58MiB**（onnx wasm，< 25MiB）。模型文件不随包分发、运行时下载入 Cache，不占托管存储。
- **截图有效性（均为 build+preview 后真实界面，`docs/shots/`）**：

| 文件 | 像素 | 大小 | 内容一致性 |
|---|---|---|---|
| shot-01-pc-docs.png | 1280×800 | 97,265 B | 通过：文档库/导入 |
| shot-02-pc-chat.png | 1280×800 | 124,287 B | 通过：问答含 `[n]` 引用、语义+关键词 meta（已人工目检） |
| shot-03-pc-settings.png | 1280×800 | 115,768 B | 通过：模型状态与多源设置 |
| shot-04-tablet.png | 834×1112 | 79,869 B | 通过：平板自适应 |
| shot-05-phone.png | 375×812 | 66,518 B | 通过：手机单栏、免费态按钮（已人工目检） |

- **checkpoint 边界（如实说明）**：V1 仅 txt/md/csv/html 解析，pdf.js / mammoth 列 V1.1；V1 不接生成式 LLM（答案为抽取式）；语义模型在本机无头 Chromium 已真实下载+推理验证，但不同网络环境的首源可达性依赖多源切换兜底。

## 可复用经验

- **ONNX 文本嵌入前端范式**：自实现 WordPiece（零依赖）+ Int32 分词、ort 边界转 int64/BigInt64、mean-pool+L2、查询前缀——可直接复用到后续中文/英文 BERT 类本地向量工具。
- **大文件多源 + Cache Storage 下载器**（HEAD 探测选源、流式进度、±2% 校验、故障切换、二次离线）：适用于任何「不放包、运行时拉取公开大模型/wasm/资源」的纯前端工具；自定义源兼容 Cloudflare R2 / 腾讯云 COS 公开桶。
- **语义/关键词双通道降级**：BM25 常驻内存（从 IndexedDB hydrate），语义失败自动回退且不阻断主流程；**降级分支务必 `console.warn` 留痕**，避免「静默失败」拖慢排查（本轮最大耗时点）。
- **响应式 Vue 对象入 IndexedDB 前先解包**为普通对象。
- **E2E 选择器纪律**：tab/按钮用语义化 class 作用域定位，不用会命中多处文案的裸 `text=`；H 档真实链路用「页面状态文案 + IndexedDB 直读 + console 捕获」三重断言，能把「假成功」（模型就绪但向量缺失）当场抓住。
