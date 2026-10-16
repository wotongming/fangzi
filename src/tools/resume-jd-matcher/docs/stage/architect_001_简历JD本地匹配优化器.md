# 架构方案：简历 × 招聘 JD 本地匹配与定向优化器（resume-jd-matcher）

- 对应 innovator：`innovator_001_简历JD本地匹配优化器.md`
- 对应 pm：`pm_001_简历JD本地匹配优化器.md`（结论：可集成-新增）
- 设计日期：2026-10-16
- 工具 id：`resume-jd-matcher`（方子第 18 个工具，web 类，档位 M+）

## 需求回顾与设计依据
纯前端 PWA 工具：本地解析简历（PDF/DOCX/TXT/粘贴）→ 粘贴 JD → 本地语义+关键词匹配打分、缺失项诊断 → 可采纳的改写建议（不虚构经历）→ 求职信草稿 → 投递看板。数据全程本地（IndexedDB），复用方子已有本地嵌入与模型自托管基建。PM 结论：可集成、零后端、复用 003 本地嵌入。

## 技术方案
### 系统架构
分层（全部在浏览器内）：
- **导入解析层**：PDF→pdfjs-dist（Apache-2.0）抽文本；DOCX→mammoth（BSD-2-Clause，可商用）转纯文本；TXT/粘贴直接读。
- **文本规范化层**：中英文分词/归一（英文 `Intl.Segmenter`+小写化；中文用轻量词典/二元 gram，不引重型分词库）、技能词典（内置常见技能/工具/证书同义词表，可本地扩充）。
- **匹配引擎层**：①关键词通道（技能/职责/资质/硬门槛四维，BM25/覆盖率加权）；②语义通道（本地句向量余弦）。融合为 0–100 匹配分与维度雷达。
- **建议层**：对缺失但“本人经历中疑似具备（同义/近义）”的项给补写建议；求职信用**模板槽位+本人要点检索重组**生成（V1 不接 LLM，避免第二个大模型）。
- **数据层**：简历版本、JD、匹配记录、投递看板 → IndexedDB（复用 `reusable-module/indexeddb-kv`，独立库 `fz-resume-jd-v1`）。
- **导出层**：Markdown / 打印为 PDF（浏览器打印样式），CSV 投递清单。

### 模块设计
`src/tools/resume-jd-matcher/`
- `manifest.ts`、`index.vue`（Tab：我的简历 / 匹配诊断 / 求职信 / 投递看板）
- `lib/parse-resume.ts`（pdf/docx/txt 解析为结构化文本+段落）
- `lib/normalize.ts`（中英归一、技能词典）
- `lib/embeddings.ts`（懒加载本地嵌入，复用 003 模型路径与 /mf 分片；单例、缓存）
- `lib/match.ts`（关键词+语义融合打分、硬门槛核对、缺失/命中清单，纯函数可单测）
- `lib/suggest.ts`（补写建议规则）、`lib/cover-letter.ts`（模板生成）
- `lib/store.ts`（IndexedDB CRUD，基于 indexeddb-kv）、`lib/export.ts`
- `components/*.vue`（得分卡、维度雷达用 Canvas/SVG 自绘，不引图表库）

### 关键技术路线
- 嵌入模型与推理引擎：**复用 003 local-knowledge-base 已验证的 all-MiniLM-L6-v2 类多语向量模型（Apache-2.0）+ @huggingface/transformers v4（Apache-2.0）+ ort（MIT）**，经 /mf 同源自托管 + SW 分片，`allowLocalModels=true/allowRemoteModels=false`。同一模型/引擎全仓只此一套，符合“一场景一选择”。简历/JD 按句/要点切块取均值向量。
- 性能：简历与 JD 文本量小（<10KB），CPU/WASM 即可；向量结果缓存（内容 hash），重复匹配毫秒级。
- 不虚构：建议层只允许“从本人已有经历里选取/重组”，禁止生成无来源经历；UI 明确“请核对真实性”。

### 盈利模式
主方案 Freemium + 买断（与 manifest.billing 对齐）：免费每月匹配 5 个岗位、基础关键词分；买断 ¥49.9（priceCents 4990）解锁不限岗位、语义维度/雷达、补写建议、求职信、投递看板与导出。其余订阅/按量作为框架已具备能力，暂不开启。

## 与 fangzi 现有代码的集成方式
- 新目录 `src/tools/resume-jd-matcher/`，import.meta.glob 自动发现，零核心/路由改动。
- 复用：`reusable-module/indexeddb-kv`、`use-seo`、`use-lazy-init`；模型加载参照 003 与 004 的 /mf + `sw-model-shards.js`（若复用同一嵌入模型，直接共享其目录与 shards.json 条目，不重复占空间）。
- 计费接 `useToolBilling('resume-jd-matcher')`；额度 localStorage key `fz-rj:used:YYYY-MM`。
- 不改 SW 现有策略；如新模型文件 >25MiB 才在 shards.json 增条目（MiniLM 通常 <25MiB，可能无需分片）。

## 软硬件/依赖选型（商用授权）
| 依赖 | 许可 | 用途 |
| --- | --- | --- |
| pdfjs-dist | Apache-2.0 | PDF 抽文本（设 workerSrc 同源） |
| mammoth | BSD-2-Clause（可商用） | DOCX→文本 |
| @huggingface/transformers v4 | Apache-2.0 | 本地嵌入推理 |
| onnxruntime-web（其私有 ort） | MIT | 推理后端 |
| all-MiniLM-L6-v2（多语/中英） | Apache-2.0 | 句向量 |
均免费可商用，无 NC（非商用）资源。

## 开发方案
Vue3+TS+Vite；1 人。里程碑：M1 解析+归一+关键词匹配+得分（可单测）；M2 语义通道+建议+求职信；M3 投递看板+导出+多端。

## 测试方案
- 单测（重点纯逻辑）：normalize 技能归一、match 打分/硬门槛/缺失项、cover-letter 槽位、store 序列化。
- E2E（Playwright）：导入样例简历 PDF/DOCX、粘贴 JD、出分、采纳建议、生成信、看板落库、导出；免费额度→买断解锁（写 `fangzi:billing:v1`）。
- 回归：17 个存量工具 verify:tools + 全量单测；确认 003/004 模型与 SW 不受影响。
- 视口：PC1280、平板834、手机375。

## 实施部署方案
静态随主站 EdgeOne Pages；模型走 /mf。回滚：删除工具目录即下线（自动发现），不动核心。灰度：先上架但首页不主推，观察错误率。

## 风险与反思
用户真的需要吗——需要（付费市场已验证）。会搞复杂吗——控制在 4 Tab、V1 不做截图 OCR/不接第二个 LLM。省时间吗——20–40 分钟→3–5 分钟。风险：双语嵌入对中文 JD 召回质量 → 用关键词通道兜底并允许手改技能表；改写越界 → 严格“只来自本人经历”。
