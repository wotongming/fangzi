# 技术沉淀：简历×JD本地匹配与定向优化器

- 对应 dev：dev_001_简历JD本地匹配优化器.md
- 日期：2026-10-16
- 功能档位：**M+**（多场景链路：文件解析 + 本地匹配引擎 + 建议/求职信 + IndexedDB 看板 + 多格式导出；无 GPU/无大模型下载）。质量门（类型检查 / 单测 / 生产构建 / 真实可用）未降级。

## 技术选型与理由

| 选型 | 版本 | 用途 | 许可证 / 商用 |
| --- | --- | --- | --- |
| Vue 3 + TypeScript + Vite(rolldown) | 随仓库 | UI/构建，沿用方子既有技术栈 | 项目既有 |
| pdfjs-dist | ^4.10.38 | 浏览器端 PDF 抽文本 | Apache-2.0，可商用 |
| mammoth | ^1.13.0 | DOCX → 纯文本（只抽文本，不执行宏） | BSD-2-Clause，可商用 |
| IndexedDB（复用 reusable-module/indexeddb-kv） | 仓库内 | 简历版本/看板本地持久化 | 仓库自有 |
| 方子统一计费 useToolBilling | 仓库内 | freemium + 买断钩子 | 仓库自有 |

- PDF worker 2026-10-21 二次热修后由公共模块 `reusable-module/pdfjs-worker` 统一初始化，固化为同源稳定 `/pdfjs/pdf.worker.min.js`（原 Vite `?url` 哈希 `.mjs` 方案废弃），不依赖任何外部 CDN，满足离线/隐私与 EdgeOne 静态托管。
- mammoth 仅引入浏览器子路径 `mammoth/mammoth.browser`；该子路径无独立 TS 类型，补了本地 `lib/mammoth-browser.d.ts`（仅声明用到的 `extractRawText`）。
- 雷达图**自写 SVG 组件**（三维三角形），不引入任何图表库，包体与依赖最小。
- **依赖均为商用友好许可（Apache-2.0 / BSD-2）**，无“仅限非商用”资源，符合零法律风险约束。

## 关键实现

### 分层与纯函数接缝

- `lib/normalize.ts`：全角转半角/小写/空白归一；技能词典「标准名 + 同义词」归并（拉丁词按**词边界**、中文直接包含）；段落/条款切分；内容词项（英文词 + 中文二元 gram，过滤停用词）；学历层次/年限/地点/证书信号。
- `lib/match.ts`：纯函数 `matchResume({resumeText,resumeParagraphs,jdText})`，无副作用、可直接单测。
  - 三维覆盖率：技能 0.5 / 职责 0.3 / 资质 0.2；综合分 = 100×加权覆盖率。
  - 硬门槛：学历（大专1/本科2/硕士3/博士4）、年限、证书、地点；任一不过 `score=min(score,59)`。
  - 职责/资质条款按「负责/主导/参与…」职责动词与「学历/经验/沟通/证书…」资质正则分流。
- `lib/suggest.ts` / `lib/cover-letter.ts`：建议与求职信均为确定性生成，**不接 LLM、不虚构事实**。
- `lib/parse-resume.ts`：PDF/DOCX/TXT 统一解析为 `{text, paragraphs}`，15MB 上限，失败统一抛**中文可操作**错误。
- `lib/store.ts`：独立库 `fz-resume-jd-v1`（resumes/jds/applications），写入前 JSON 深拷贝解 Vue Proxy。
- `lib/export.ts`：Markdown/文本下载、打印为 PDF、看板 CSV（逗号/引号/换行转义 + BOM）。

### 「标准名 vs 同义词」双证据（本轮重要修正）

最初技能命中用同一套别名表，导致“简历写 vue3、没写 Vue”时匹配已算命中、而“补标准名”建议却永远不触发（链路自相矛盾）。重构 `extractSkillEvidence` 为两类证据：

- `exact`：写出标准名；`!exact`：仅同义词/版本别名命中（记录实际别名）。
- 同义词**仍计入能力匹配给分**（人确实会），但进入 `synonymOnly`，由 `buildSuggestions` 生成“在原事实上补全标准名”的可溯源建议，并定位到具体简历段落。

### 计费钩子（只接主方案）

按 M 档“接好钩子、不重写五模式”，仅配置主变现：**freemium 每月 5 次 + ¥49.90 买断**；feature keys：`match-basic`(free)、`unlimited-match`/`suggest-pro`/`cover-pro`/`board-pro`(locked)。免费月额用 localStorage `fz-rj:used:YYYY-MM` 计数；专业能力统一走 `useToolBilling('resume-jd-matcher')`。

### SEO/AEO/GEO

`useSeo` 设置中文标题与描述，覆盖「简历优化/JD匹配/岗位匹配度/求职信/投递看板/resume matcher」等中英关键词；语义化标题与 H3/H4 层级。

## 踩坑记录

1. **mammoth 浏览器子路径缺类型（TS7016）**：主包类型不含 `mammoth/mammoth.browser`，补本地 `.d.ts` 后 vue-tsc 归零。
2. **年限门槛漏检**：原正则在“年…经验”之间只允许固定一个名词，实际是“相关工作/前端开发”等多个字（如“3年以上前端开发经验”），导致 years 门槛完全没生成。改为 `(\d+)\s*年(?:以上)?[^。；;，,\n]{0,10}?经验`，在不跨标点前提下容忍中间修饰字；单测覆盖。
3. **雷达右下/左下标签被画布裁切**：顶点在右侧时文字锚点方向最初写反（写成 start，越出右缘），且单行过长。改为名称/百分比分两行、右侧点文字 `text-anchor:end` 向左收、左侧点 `start` 向右展，并整体内收 4px；重建截图复核三个标签完整。
4. **E2E 英文信断言写错**：岗位名是中文“高级前端工程师”，英文模板不会出现 Engineer；断言改为“英文问候语 + 命中技能”，与模板真实行为一致（非代码 bug）。

## 验证覆盖

档位：**M+**。质量门均通过：

- 类型检查：`npx vue-tsc --noEmit` = **0 error**。
- 单元测试：本工具新增 15 条（归一/技能别名归并/词边界/学历年限地点/匹配打分/硬门槛封顶/远程地点/同义词双证据/建议溯源/中英文求职信/CSV 转义）；**全量 `node --import tsx --test test/*.test.ts` = 186 通过 / 0 失败**（上一基线 171）。
- 生产构建：`npm run build` 成功；postbuild 单文件 25MiB 守卫通过（自动清理 25.6MiB 的 WebGPU wasm）。
- 工具发现：`npm run verify:tools` = **19**（方子第 19 个工具），manifest/示例回归全过。
- 无头 E2E：`scripts/e2e-resume-jd-matcher.mjs`，对真实 `vite preview` 产物跑通：txt 文件导入 → 粘贴 JD → 出分(73)/三维雷达/硬门槛全过/技能命中 → 免费额度计数 → 专业门控 → 写计费 localStorage 模拟买断 → vue3/js 触发补标准名建议（带来源）→ 中文/英文求职信 → 加入看板→状态流转持久化 → **PC(1280×900)/平板(834×1112)/手机(375×812) 三视口无横向溢出**（scrollWidth-clientWidth≤2）。全部断言通过。

### EdgeOne Pages 免费版限额核查

| 项 | 限额 | 实测（构建后 dist） | 结论 |
| --- | --- | --- | --- |
| 单项目存储 | 5 GiB | 107 MiB | ✅ |
| 文件总数 | 20000 | 103 | ✅ |
| 单文件大小 | 25 MiB | 最大 14.31 MiB（whisper onnx 分片，非本工具）；本工具产物 chunk 659.9KB(gzip 198.9KB) | ✅ |

本工具仅新增 pdfjs/mammoth 两个 npm 依赖（进 bundle/chunk），**未向 public 新增大资产**。

### guide 截图有效性验证（真实 build 运行截图，非占位/网图）

| 文件 | 像素 | 大小 | 内容 | 是否通过 |
| --- | --- | --- | --- | --- |
| pc-1-resume-import.png | 1280×900 | 82,189 B | 简历导入页 | ✅ |
| pc-2-match-result.png | 1280×1721 | 183,492 B | 匹配分73/雷达/硬门槛/三维清单 | ✅ |
| pc-3-suggestions.png | 1280×2374 | 388,958 B | 买断后补标准名建议 | ✅ |
| pc-4-cover-letter.png | 1280×991 | 100,236 B | 求职信生成 | ✅ |
| pc-5-board.png | 1280×900 | 57,513 B | 投递看板/状态 | ✅ |
| tablet-1-match.png | 834×1721 | 177,981 B | 平板自适应 | ✅ |
| mobile-1-match.png | 375×2094 | 169,340 B | 手机自适应 | ✅ |

数量符合 M 档（PC 3–6、平板/手机各≥1）；均能正常打开、与 guide 描述一致。

### 覆盖边界与已知限制（如实说明）

- 已覆盖：txt 导入真实文件链、粘贴匹配、免费/买断两态、三维与四类硬门槛（学历/年限/地点/证书逻辑在单测覆盖）、建议/求职信/看板/导出、三视口。
- 未在无头环境实测：**真实二进制 PDF / DOCX 解析渲染**（pdfjs/mammoth 集成与错误文案已写，文件读取链以 txt 走通）；上线前建议人工各传 1 份文字版 PDF、DOCX 复核。
- V1 为离线确定性关键词/同义词通道；architect 设想的 **MiniLM 本地语义余弦通道标注为 V1.1 预留**（`match.ts` 已留融合位），本轮为无人值守可靠性与包体/下载稳定性未引入模型运行时。

## 可复用经验

1. **词典匹配要区分“能力命中”与“关键词命中”**：同义词给匹配分，但用 `exact/alias` 双证据驱动“补标准名”建议，避免匹配与建议自相矛盾——该模式可复用于任何“JD/招标/要求 vs 文本”类合规核对工具。
2. **中文年限/资格抽取**：用“不跨标点的长度受限通配”容忍“X年…经验”中间的修饰语，比枚举名词表稳健。
3. **第三方浏览器子路径缺类型**：优先补最小本地 `.d.ts`，不装不相关的 @types，也不 `declare any` 放过全模块。
4. **三方/雷达标签防裁切**：按顶点方位反方向设 text-anchor + 双行标签，是无图表库 SVG 雷达的通用做法。
5. **无头 E2E 解锁专业功能**：直接向 localStorage 写统一计费 key `fangzi:billing:v1`（一条 paid 的 `freemium-pro` 订单）再 reload，稳定可复现，不必模拟点击支付。

## 2026-10-21 二次热修：EdgeOne `.mjs` MIME 错误致内置 WebView 导入 PDF 必挂

### 根因（生产 `curl -I` 实测）
`https://www.fangzi.asia/assets/pdf.worker.min-<hash>.mjs` 返回 **200 但 `Content-Type: application/octet-stream`**；同站 `.js` chunk 为 `application/javascript`，不存在路径才是 `text/html` SPA fallback。即文件存在、非 404、非哈希错配，而是 **EdgeOne 对 `.mjs` 的 MIME 映射错误**。pdfjs-dist 4.x worker 为 ESM：`new Worker(src, { type: 'module' })` 在华为系统 / WeLink WebView 因 MIME 非 JS 被拒；fake worker 主线程 `import(src)` 再被严格 MIME 拒绝，抛裸英文 `Setting up fake worker failed: Failed to fetch dynamically imported module`。桌面 Chrome 宽松未暴露，真机内置 WebView 必挂。本工具与 `pdf-redact` 是全仓仅有的两个 `getDocument` 消费方，同根因同时受影响。

### 改法
- 删除本工具 `pdfjs-dist/build/pdf.worker.min.mjs?url` 导入，PDF 分支接入公共 `reusable-module/pdfjs-worker`：`configurePdfjs()` 幂等设置稳定 workerSrc，`openPdfDocument()` 包装 `getDocument`，worker/模块加载失败归一为中文「PDF 解析组件加载失败，可重试；若在内置浏览器…用系统 Chrome / Edge 打开」。
- 错误持久展示在 `.err` 区块并提供「重试（重新选择文件）」按钮；file-sniff 的 `%PDF` 魔数 / 0 字节 / HTML 错误页容错保持不回归。
- worker 固化 `public/pdfjs/pdf.worker.min.js`，与 node_modules 源 sha256 一致；SW precache 命中稳定路径，断网可解析。

### 验证（scripts/e2e-pdfjs-worker-20261021.mjs）
- 三视口（1280×860 / 834×1112 / 375×812 移动 UA）投 `application/octet-stream` 合法 `%PDF`，PDF 文本成功提取（VUE/NODE/DOCKER 命中）；全程零旧 `.mjs` 请求；横向溢出 0、无 pageerror。
- 拦截稳定 worker abort：落到中文兜底，无裸英文、无卡死；0 字节 / HTML 错误页出现明确文案与重试按钮；断网二次加载 SW 命中 worker 仍可解析。
- 手机实测截图：`docs/shots/rj-pdfjs-worker-fix-mobile.png`。

### EdgeOne 部署动作
本 `.js` 方案上线后无需为 `.mjs` 加 MIME 规则；发版后到 EdgeOne 控制台刷新 / 预热 CDN 缓存，并 `curl -I https://www.fangzi.asia/pdfjs/pdf.worker.min.js` 复核 `Content-Type: application/javascript`。若将来坚持 `.mjs` 后缀，需在 EdgeOne 给 `*.mjs` 增补 `application/javascript` 规则。

### 真机待验
华为系统浏览器、WeLink / 微信 / QQ 内置 WebView 真实导入文字版 PDF 复测；无头仅以请求拦截模拟 MIME 失败。DOCX 解析仍需上线前人工传一份复核（见上节边界）。
