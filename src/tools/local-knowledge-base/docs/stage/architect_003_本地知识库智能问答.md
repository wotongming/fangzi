# 架构方案：本地知识库智能问答

- 对应 innovator：innovator_003_本地知识库智能问答.md
- 对应 pm：pm_003_本地知识库智能问答.md（结论：可集成（新增））
- 设计日期：2026-10-15

## 需求回顾与设计依据

- 需求（innovator_003）：数据不出端的本地 RAG 问答——文档解析、分块、嵌入、检索、生成全在设备完成，答案附引用溯源，离线可用；目标人群法律/金融/医疗/科研/政务/个人知识管理用户。
- PM 结论：与现有功能无重复（fangzi 的向量搜索服务于工具检索，非用户文档），纯前端可行，freemium。
- 设计前提：零后端、纯前端、EdgeOne Pages、模型运行时下载（不进部署包）、不破坏 PWA 识别性、全部商用友好授权。

## 技术方案

### 系统架构

```
src/tools/local-knowledge-base/
├── manifest.ts        # 元数据（关键词：知识库/文档问答/RAG/本地/隐私/离线/检索）
├── index.vue          # 主界面：文档管理（导入/列表/删除）+ 问答对话（引用跳转）+ 设置（模型档位/知识库）
└── lib/
    ├── ingest/        # 文档解析与分块
    │   ├── pdf.ts     # pdf.js 动态加载（Apache-2.0）
    │   ├── docx.ts    # mammoth 动态加载（BSD-2，docx→文本）
    │   └── text.ts    # txt/md/csv/html 原生解析 + 分块（按段落/大小/重叠）
    ├── embed/         # 本地嵌入：Transformers.js 动态加载，Qwen3-Embedding 小量化版（INT8）
    ├── index/         # 向量索引：IndexedDB（复用 reusable-module/indexeddb-kv），余弦+BM25 混合检索
    ├── generate/      # 本地生成：WebLLM 或 Transformers.js 跑 Qwen2.5-0.5B/1.5B（INT4），流式输出
    ├── models.ts      # 模型注册表（下载源、缓存键、体积、档位、设备探测 NPU/GPU/CPU）
    └── worker.ts      # 解析/嵌入/检索 Worker（长任务不阻塞 UI）
```

### 模块设计

- **ingest**：拖入/文件夹导入多格式文档 → 文本抽取 → 智能分块（按结构标题优先、窗口重叠 10%）；图片 OCR 作为 V2 能力（tesseract.js）。
- **embed**：本地 embedding 模型生成向量（首次下载 ~100-500MB，进度+断点续传），缓存于 IndexedDB（内容哈希去重，模型变更可 reembed）。
- **index**：向量 + BM25 混合检索（RRF 融合），返回 Top-K 片段与相似度；低置信度（< 阈值）标注「⚠ 仅供参考」。
- **generate**：本地小模型流式生成答案，prompt 注入检索片段与引用标记；回答附 `[1][2]` 引用，点击跳转原文段落。
- **数据流**：文档 → 解析分块 → 嵌入 → 索引（IndexedDB）→ 提问 → 检索 Top-K → 本地 LLM 生成 → 溯源展示。

### 关键技术路线

- 推理栈：`@huggingface/transformers`（Apache-2.0）+ onnxruntime-web（MIT），优先 WebGPU，降级 WASM/CPU；
- 模型：Qwen3-Embedding-0.6B（Apache-2.0，INT8）嵌入；Qwen2.5-0.5B/1.5B（Apache-2.0，INT4）生成；从 Hugging Face 免费下载；
- 存储：IndexedDB（复用现有 indexeddb-kv 模块）存向量与文档元数据；
- 全部重型依赖动态 `import()`，不进 SW 预缓存。

### 盈利模式（可灵活扩展调整）

- freemium：免费（文档数 ≤ 20、0.5B 模型档）；Pro（buyout ¥49.90 或订阅）解锁多格式/1.5B 模型/跨文档对比/团队共享；后续企业内网部署版授权（对标 WPS 599/人/年下探个人市场）。

## 与 fangzi 现有代码的集成方式

- 新增 `src/tools/local-knowledge-base/`，工具框架自动发现；
- 复用 `reusable-module/indexeddb-kv.ts`（IndexedDB KV 封装）与 `useToolBilling('local-knowledge-base')`；
- 不修改现有文件；不触碰 SW/manifest/路由。

## 软硬件/依赖选型

| 依赖 | 用途 | 授权 | 商用状态 |
| --- | --- | --- | --- |
| pdf.js | PDF 解析 | Apache-2.0 | 商用友好 ✓ |
| mammoth | docx 解析 | BSD-2 | 商用友好 ✓ |
| @huggingface/transformers | 嵌入/生成推理 | Apache-2.0 | 商用友好 ✓ |
| onnxruntime-web | 推理后端 | MIT | 商用友好 ✓ |
| Qwen2.5 / Qwen3-Embedding | 模型权重 | Apache-2.0 | 商用友好 ✓ |
| Hugging Face | 模型下载（运行时） | 免费 | 商用友好 ✓ |
| EdgeOne Pages | 静态托管 | 免费额度 | 商用友好 ✓ |

## 开发方案

- 语言/框架/环境：TypeScript + Vue3 + Vite（现有栈）；Node ≥ 20.19。
- 里程碑：M1 解析分块 + IndexedDB 存储 → M2 本地嵌入 + 检索 → M3 本地生成 + 溯源 UI → M4 模型缓存/降级/Pro 权益。

## 测试方案

- 策略：单元测试（分块算法、检索排序、置信度阈值）+ 浏览器实测（断网离线、CPU 降级、大文档）。
- 用例重点：①100 页 PDF 导入成功且索引可检索；②提问命中片段带正确引用；③断网后问答可用（模型已缓存）；④低置信度正确提示；⑤freemium 权益（文档数/模型档）正确判定。
- 验收标准：`npm run type-check`、`npm test`、`npm run build` 通过；存量工具回归正常。

## 实施部署方案

- 部署架构：EdgeOne Pages 静态托管；模型运行时下载不进部署包（首次下载 1.5-3GB 需进度/续传提示）。
- 上线步骤：`npm run build` → EdgeOne 推送 → 灰度 → 全量；README 工具清单登记。
- 运维监控：模型下载失败率、问答耗时（本地打点可选上报）；EdgeOne 访问统计。
- 回滚预案：git revert + 重部署；工具级回滚不影响其他工具。

## 风险与反思

- 用户真的需要吗：是——企业私有化 RAG 高价验证、个人本地 RAG App 已上线收费。
- 会不会把 fangzi 搞复杂：不会——单工具 + 框架零改动；但模型体积大，需「按需下载」而非默认全量，避免新用户被首次加载吓退。
- 真的能节省时间、资金吗：秒级检索 + 免云订阅，依据充分。
- 遗留问题：浏览器内存限制（建议 ≥8GB，提供 0.5B 低配档）；待确认：首次模型下载策略（引导式按需下载）、OCR 是否进 V1、团队共享的数据结构与权限（V2）。

---

## 补充决策（2026-10-15，按用户指示：大模型文件探索云厂商对象存储 / 公共 CDN）

### 约束实测

- **EdgeOne Pages 单文件 25 MiB 硬上限**：模型不进部署包（bge-small-zh 量化模型 23.9 MiB 也过于贴线，且随版本增长有超限风险）。
- 本机（南京）实测各源连通性与 CORS：
  - `hf-mirror.com`：可达（HTTP 200），CORS 按请求 `Origin` 回显（浏览器可用），Xenova ONNX 仓库全量镜像，免费、免账号；
  - `www.modelscope.cn/.../resolve/...`：可达且 `Access-Control-Allow-Origin: *`，但其 `BAAI/bge-small-zh-v1.5` 仓库**只有 PyTorch 权重、无 ONNX**，V1 不作为嵌入源（V2 上 Qwen 时再选带 ONNX 的仓库）；
  - `huggingface.co` 直连：可达（307 跳 CDN），作为海外/官方兜底。

### 多源模型分发（自动故障切换 + 可自带对象存储）

设置页「模型源」有序列表，启动时对每源 `HEAD config.json`（5s 超时）选第一个可用，选择结果缓存 localStorage：

1. **自定义源（用户自备对象存储/CDN）**：按 HF 兼容布局 `{base}/{modelId}/resolve/{revision}/{file}` 放置即可：
   - **Cloudflare R2（推荐海外/零出口费）**：10 GB-月存储免费、Class A 100 万次/月、Class B 1000 万次/月免费、**出口流量 $0（zero egress）**；公开 bucket + 自定义域 + CORS 允许全部来源；
   - **腾讯云 COS + CDN（用户已在腾讯生态）**：新客 50 GB 标准存储 6 个月免费，之后约 ¥0.1/GB/月；CDN 回源 0–10 GB 免费、超出 ¥0.15/GB；可由 EdgeOne 接 COS 源；
2. **hf-mirror.com**（默认，国内）；
3. **huggingface.co**（官方兜底）。

模型文件（config.json / vocab.txt / onnx/model_quantized.onnx）下载后写入 **Cache Storage**（校验字节数），二次使用完全离线；下载走 ReadableStream 上报进度。

### V1 模型选型（checkpoint）

- **嵌入**：`Xenova/bge-small-zh-v1.5`（BAAI bge-small-zh v1.5，**MIT**，model_quantized 23.9 MB，512 维，中英文检索强）。推理用仓库既有 **onnxruntime-web 1.30.0 WASM-only 子入口 + 自托管 `public/onnx/`**（复用 image-converter 验证过的 loader 范式）；**自实现 BERT WordPiece 分词器**（vocab.txt 109KB），**零新增 npm 依赖**。查询侧加 bge 中文检索指令前缀，段落侧不加；mean pooling + L2 归一化。
- **生成**：V1 **不引入 LLM**（0.5B q4 约 400 MB，无头/低配不现实，且违背省时原则）；答案由「Top-K 片段中抽取高相关句子 + `[n]` 引用」合成，无模型也能完整闭环。V2 再以 WebLLM 接 Qwen2.5-0.5B-Instruct（Pro，源策略同上）。
- **检索**：向量余弦 + BM25（CJK 二元组分词，不依赖模型）经 RRF 融合；**模型未下载/失败时自动降级为纯 BM25 关键词检索**并在 UI 明示，功能不阻塞。
- **解析**：V1 原生支持 txt / markdown / csv / html（DOMParser）；pdf.js（Apache-2.0）/ mammoth（BSD-2）动态导入列为 V1.1。
- 档位：H，本轮按 checkpoint 交付「可运行全链路 + 已验证项 + 明确未完成项」（LLM 生成、PDF/docx 解析、Worker 化嵌入为后续里程碑）。
