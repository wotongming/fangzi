# 开发详细设计：简历 × 招聘 JD 本地匹配与定向优化器（resume-jd-matcher）

- 对应 architect：`architect_001_简历JD本地匹配优化器.md`
- 设计日期：2026-10-16

## 需求拆解清单
| 编号 | 需求条目 | 实现方法 | 技术要点 | 涉及模块/文件 | 依赖 | 验收要点 |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | 工具骨架与计费 | `npm run new:tool: resume-jd-matcher web "简历JD匹配"`，填 manifest（分类工作、关键词、billing freemium+买断4990、月免5次） | import.meta.glob 自动发现；useToolBilling | manifest.ts/index.vue | 框架 | verify:tools 通过；免费/买断态正确 |
| R2 | 简历导入解析 | PDF 用 pdfjs-dist（workerSrc 同源）、DOCX 用 mammoth.extractRawText、TXT/粘贴直读；按段落切分 | 大文件分块、失败给明确错误；不执行宏 | lib/parse-resume.ts | pdfjs,mammoth | 样例 PDF/DOCX/TXT 文本与段落正确 |
| R3 | 文本归一与技能词典 | 中英小写/去标点；Intl.Segmenter 分句；内置技能同义词表（可本地增改） | 词典 JSON 独立、可扩展；中文二元 gram 兜底 | lib/normalize.ts, data/skills.ts | 无 | 同义词归并、大小写/全半角正确 |
| R4 | 本地嵌入（复用） | 懒加载共享 MiniLM 模型（/mf，allowLocal/禁远程），句向量缓存 by hash | 单例、Web Worker 内推理不阻塞 UI；复用003/004 SW 分片 | lib/embeddings.ts | transformers v4/ort | 首次加载后离线可用；重复匹配走缓存 |
| R5 | 匹配引擎（纯函数） | 关键词四维（技能/职责/资质/硬门槛）覆盖率+BM25；语义余弦；融合 0–100 与维度分；硬门槛（学历/年限/地点）核对 | 权重集中配置；输出命中/缺失/硬门槛 | lib/match.ts | R3,R4 | 单测：构造用例得分/缺失/门槛判定 |
| R6 | 改写建议（不虚构） | 仅从本人经历检索同义/近义要点，给“可采纳/忽略”的前后对照；禁止无来源生成 | 建议必须带来源段落 id | lib/suggest.ts | R3,R5 | 每条建议可溯源；无凭空经历 |
| R7 | 求职信生成 | 模板槽位（岗位/公司/命中要点/本人亮点）+检索本人要点填充；中英模板 | 纯模板，无 LLM；可编辑导出 | lib/cover-letter.ts | R5 | 生成信含岗位与3个匹配点，可编辑 |
| R8 | 数据存储 | IndexedDB 库 fz-resume-jd-v1：简历版本/JD/匹配/投递记录 | 复用 indexeddb-kv；结构化、版本号 | lib/store.ts | indexeddb-kv | 刷新后数据在；并发不丢 |
| R9 | 投递看板 | 公司/岗位/匹配分/状态(待投/已投/面试/offer/拒)/日期/下次跟进，本地 CRUD+筛选 | 状态机、按状态分组 | components/Board.vue | R8 | 增改查、状态流转、筛选正确 |
| R10 | 导出 | 简历/信导出 Markdown 与打印PDF；看板导出 CSV | 打印样式表；CSV 转义 | lib/export.ts | 无 | 文件内容/编码正确，CSV 逗号转义 |
| R11 | 多端与 SEO | PC/平板/手机布局；use-seo 注入 title/meta/JSON-LD | 语义化标签、canonical | index.vue, use-seo | — | 三视图无横向溢出 |

## 技术选型落地
Vue3+TS+Vite+Pinia；pdfjs-dist(Apache-2.0)、mammoth(BSD-2)、@huggingface/transformers v4(Apache-2.0)+ort(MIT)、MiniLM 多语(Apache-2.0)；全部免费可商用。推理放 Worker；存储 IndexedDB；零后端。

## 模块设计
单向数据流：`import → normalize → (keywords, embeddings) → match → suggest/cover → store/export`。match.ts 为无副作用纯函数，输入 NormalizedResume+NormalizedJD，输出 MatchResult，便于单测。

## 关键实现方法（伪代码）
```
match(resume, jd):
  rKw = extractSkills(resume); jKw = extractSkills(jd)
  cov  = weightedCoverage(rKw, jKw.dims)          // 技能/职责/资质
  sem  = cosine(embed(resume.bullets), embed(jd.req))
  hard = checkHardGates(resume, jd.gates)         // 学历/年限/地点
  score = clamp(0.6*cov + 0.4*sem)*100
  return {score, dims, missing: jKw-rKw, gates:hard}
suggest(resume, missing):                          // 只返回有来源项
  -> missing.map(m => findInResumeBySynonym(m,resume)).filter(Boolean)
```

## 文件清单
新建：`src/tools/resume-jd-matcher/{manifest.ts,index.vue,lib/*.ts,components/*.vue,data/skills.ts,docs/}`、`test/resume-jd-matcher.test.ts`；可能在 /mf 增 MiniLM（若 003 已同模型则共享，不重复）。
修改：仅 README 增加第 18 工具条目；不改核心/路由/SW 策略。

## 开发环境与工具链
Node≥20.19；现有 npm 脚本；`npx vue-tsc --noEmit`、`node --import tsx --test test/*.test.ts`、`npm run build`、`verify:tools`。

## 开发步骤与里程碑
M1 R1–R3、R5(关键词)、单测；M2 R4 语义+R6+R7；M3 R8–R11 看板/导出/多端/E2E。

## 代码规范与质量要求
与仓库一致：组合式 API、TS 严格、四级相对引用 reusable-module；无 any 兜底核心逻辑；错误信息中文可操作；不自由发挥、可回退。

## 验收标准
- 类型 0 错；新增单测全过、全量单测无回归；verify:tools 工具数 +1；
- E2E：PDF/DOCX 导入→出分→缺失项→采纳建议→生成信→看板→导出全链路；买断解锁生效；
- 离线（模型已缓存）可完整跑一次；三视图无溢出；存量 17 工具回归通过；dist 无超 25MiB 单文件（模型分片除外且已合规）。
