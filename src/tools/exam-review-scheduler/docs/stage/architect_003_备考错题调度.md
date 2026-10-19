# 架构方案：在职备考个人错题与弱项调度系统（备考错题调度）

- 对应 innovator：innovator_003_备考错题调度.md
- 对应 pm：pm_003_备考错题调度.md（结论：可集成（新增））
- 设计日期：2026-10-20
- 建议目录：`src/tools/exam-review-scheduler/`（路由自动注册为 `/#/t/exam-review-scheduler`）

## 需求回顾与设计依据

innovator 提出的核心闭环：**全来源错题录入 → 科目/章节/考点标签 → 艾宾浩斯间隔重复调度队列 → 弱项热力图 → 模考分数曲线 → 报考/保弃决策看板**；手机端为主（通勤 10 分钟清今日复习队列）、PC 可用；本地优先（IndexedDB）、可离线（通勤地铁无网是核心场景）。

pm 已核定：
- 与 fangzi 现有 27 个工具**无重复**（local-knowledge-base 是"读资料问答"，不是错题调度）；新开独立工具。
- 档位 **M**：多场景链路、IndexedDB 多 store、调度算法、多维聚合；无 WebGPU / 无 WASM 主包 / 无本地大权重强制依赖。
- 边界硬约束：**不做"搜答案"**、不抓取机构题库、不收录出版社版权题目；题目数据全部用户自录。**无 OCR 也必须完整可用**（文字录入是主路径，拍照 OCR 只是 Pro 可选增强、懒加载不进主包）。
- 盈利：freemium，低价买断主方案 + 订阅（框架已具备）。

设计前提：严格复用 fangzi 已验证的 M 档工具骨架（pet-health / tax-deduction / home-medicine / shopping-claim 同款模式）——纯逻辑下沉 `lib/`、视图 `index.vue`、独立 IndexedDB 库、手写内联 SVG 图表、`.ics` 系统日历兜底、计费走 `useToolBilling`。

## 技术方案

### 系统架构

```
浏览器（PWA，离线可用）
├── index.vue（单页工具壳：Tab 导航 [今日队列 | 错题本 | 弱项 | 模考 | 我的]）
│     ├── 视图组件 components/（QueueView / QuestionEdit / HeatmapView / CurveView / DecisionBoard）
│     └── useToolBilling('exam-review-scheduler')（权益判定：免费层 1 项目+50 题）
├── lib/（纯逻辑，可单测，不碰 Vue）
│     ├── models.ts        类型：Project / Question / ReviewLog / MockExam / TagTree
│     ├── scheduler.ts     SM-2/艾宾浩斯间隔调度引擎（核心算法）
│     ├── queue.ts         今日到期队列计算（打开页面时按"今天"重算）
│     ├── weakness.ts      按 科目>章节>考点 聚合正确率/错误频次 → 热力矩阵
│     ├── curve.ts         模考分数趋势与"距目标分差距"计算
│     ├── decision.ts      报考/保弃决策看板（剩余天数×各科预估水平）
│     ├── notify.ts       页面内 Notification（可选）+ .ics 导出（兜底）
│     ├── store.ts         indexeddb-kv 配置与 CRUD 封装
│     └── ocr.ts           【Pro 可选】ONNX 文字识别懒加载封装（默认不加载）
├── IndexedDB：独立库 fangzi-exam-review（projects/questions/reviews/mockExams 四表）
└── SW 预缓存应用外壳（vite-plugin-pwa 自动），队列计算 100% 本地
```

分层职责：`lib/` 全部为纯函数（输入数据 + 当前日期 → 输出），便于 `test/` 直测；组件只做渲染与交互；存储层只负责读写。

### 模块设计

1. **项目（Project）模块**：免费 1 个项目、Pro 多项目（如 CPA-会计 / CPA-审计并行）。项目内含科目→章节→考点三级标签树（用户自建，不预置题库）。
2. **错题录入（Question）模块**：文字录入题干/错因/正解/来源；可选拍照附件（复用 `reusable-module/image-redraw` 压缩长边 1600、去 EXIF 存 IndexedDB Blob，**只作附件不识别**——免费层可用）。考点标签必选其一（从项目标签树选，可新建）。录入即生成首次调度（nextReview=明天，间隔 1 天起步）。
3. **调度队列（scheduler + queue）模块**：复习时用户对每题自评"还记得/模糊/已忘"（映射 SM-2 质量分 0–5），引擎重算下一间隔。今日队列 = 所有 `nextReview <= 今天` 的题，按"逾期天数×权重"排序。**无后台推送**：用户每次打开工具即在前端重算到期队列；这是 PWA 无后端下的确定性方案。
4. **弱项热力图（weakness）模块**：按考点聚合 {错题数、累计复习次数、最近正确率}，正确率 <50% 红色、50–70% 黄、>70% 绿，CSS 色块矩阵（手机端纵向滚动，PC 端表格）。
5. **模考曲线（curve）模块**：记录每次计时模考（日期、科目、得分/满分、用时），手写内联 SVG 折线图 + 目标分参考线；输出"距目标还差 X 分、最近 N 次均正确率趋势"。
6. **决策看板（decision）模块**：输入考试日期与目标分，结合各科弱项考点数与模考趋势，给出"建议保/弃"的**保守提示文案**（如"审计：距考试 45 天，模考均分 52/100，建议今年保会计、审计次年再战"）。**明确免责**：只做数据参考，不承诺通过率。
7. **提醒（notify）模块**：三层兜底——①打开工具时队列顶部红色角标"N 题逾期"；②可选 Notification 本地通知（仅在页面存活时有效）；③导出 `.ics`（VALARM 提前 1 天）到系统日历（subscription-audit / home-medicine 已验证模式，真正长期可靠）。
8. **OCR 拍照识别（ocr.ts，Pro 可选）**：首次点击"拍照识别"才动态 import ONNX 推理栈（`reusable-module/ort-wasm-loader` + hf-mirror 懒加载中文检测+识别模型），识别结果填入题干框由用户确认。失败/未加载时降级为手动粘贴。**模型与 WASM 不进主包、不进 SW 预缓存**。

### 关键技术路线

| 决策点 | 选型 | 理由 |
| --- | --- | --- |
| 框架 | Vue 3.5 + TS + Pinia（现有栈） | 零新增框架 |
| 调度算法 | 自研 SM-2 变体：基础间隔序列 [1,2,4,7,15] 天，质量分驱动间隔倍率 1.3–2.6，重置门槛（质量<3 回 1 天） | 纯日期数学，无依赖；比纯艾宾浩斯曲线更贴合"在职碎片复习"的队列化操作 |
| 图表 | 手写内联 SVG（参考 pet-health 体重曲线） | 不引图表库，chunk 最小 |
| 存储 | `reusable-module/indexeddb-kv`（openIndexedDB + putValue/getAllValues/listByIndex） | 通用封装已验证 |
| 照片附件 | `reusable-module/image-redraw`（Canvas 重绘去 EXIF、长边 1600） | 现成能力 |
| SEO/AEO | `reusable-module/use-seo`（标题/描述/语义化） | 新页面必须 |
| OCR（可选） | onnxruntime-web（**已是依赖**，MIT）+ PPOCRv4-mobile 中文 det+rec 模型（Apache-2.0），hf-mirror 懒加载、SW 缓存 | 同一场景一个引擎一个模型组；不强制、不进主包 |
| 提醒 | 页面角标 + Notification + `.ics` 导出 | PWA 无后端无法可靠后台推送，系统日历是兜底 |

**离线通知能力边界（重要）**：无后端 → Web Push 需要 VAPID 服务端，本工具不做；iOS Safari 对 Web Push 支持受限且需站点级配置。因此方案是"**打开即算到期队列**"为主路径（通勤打开 PWA 自然看到今日任务），`.ics` 导出为系统日历兜底，Notification 仅锦上添花。文档与 UI 文案不得承诺"后台定时推送"。

### 盈利模式（可灵活扩展调整）

接 fangzi 统一计费钩子 `useToolBilling('exam-review-scheduler')`，`manifest.billing` 声明：

- **模式**：`freemium`，买断主方案 **¥8.90（890 cents）**，订阅 月 ¥2.6（260）/ 年 ¥26（2600）（框架已具备，不在本工具重写）。
- 免费层：1 个考试项目、错题 ≤50 道、基础今日队列、手动文字录入。
- 专业层（`canUse('pro')` 统一门）：多项目并行、错题不限量、拍照附件、弱项诊断报告、模考曲线分析、报考决策看板、OCR 拍照识别、导出/导入备份包。
- 其余模式（按次额度等）由 card-billing 框架已具备，默认不开启。

## 与 fangzi 现有代码的集成方式

**零核心改动、零路由改动、零检索改动**（框架 `import.meta.glob` 自动发现）：

1. 新增目录 `src/tools/exam-review-scheduler/`：`manifest.ts`（id/name/category='life'.../keywords/billing）、`index.vue`、`guide.md`、`lib/*.ts`、`components/`、`docs/`。
2. **复用**：`reusable-module/indexeddb-kv`、`reusable-module/use-seo`、`reusable-module/image-redraw`、`reusable-module/ort-wasm-loader`（OCR 用）、`src/composables/useToolBilling.ts`、`.ics` 手写模式（参考 home-medicine/lib/notify.ts）。
3. **修改的现有文件（仅 2 处，均为登记性追加）**：
   - 根 `README.md`：工具清单追加本工具条目（七字段 + 计费 + 位置）。
   - `src/core/sample-queries.ts`：可选追加一条首页浮动提问（expectToolId='exam-review-scheduler'），追加后必须跑 `npm run verify:tools` 保持全绿。
4. **不改动**：router.ts、registry、search、SW 配置、manifest.webmanifest、其它工具目录——PWA 可安装性与离线能力不受影响。
5. 测试：新增 `test/exam-review-scheduler.test.ts`（调度引擎/队列/弱项聚合/曲线纯逻辑）；E2E 脚本 `scripts/e2e-exam-review-scheduler-20261020.mjs` 三视口。

## 软硬件/依赖选型（逐项商用授权）

| 依赖/资源 | 版本 | 许可 | 是否新增 | 用途 |
| --- | --- | --- | --- | --- |
| Vue / vue-router / Pinia | 现有 | MIT | 否 | 框架 |
| TypeScript | 5.9 | Apache-2.0 | 否 | 语言 |
| vite-plugin-pwa / Workbox | 现有 | MIT | 否 | PWA 外壳缓存 |
| indexeddb-kv / use-seo / image-redraw / ort-wasm-loader | 现有（通用模块） | 内部 TS | 否 | 复用 |
| onnxruntime-web | 1.30 | **MIT** | 否（已是依赖） | OCR 推理栈（仅 Pro 懒加载路径） |
| PPOCRv4-mobile det/rec 模型（中文） | mobile 量化版 | **Apache-2.0** | 否（运行时下载，不进包） | OCR 识别；hf-mirror 懒加载+SW 缓存 |
| 其它 | — | — | — | **本工具运行时 npm 依赖新增数为 0** |

零资金：EdgeOne Pages 免费额度静态托管；无 API Key、无付费模型；严禁 NC 授权资源（PPOCR Apache-2.0 可商用，已排除带"研究用途"限制的模型）。

### 本地 AI 选型（OCR 可选增强，非主路径）

- **引擎**：onnxruntime-web（MIT，fangzi 已用于 local-knowledge-base / local-transcribe / pose-fitness-coach），WASM 自托管走 `/wasm` 子入口与 `reusable-module/ort-wasm-loader`。
- **模型**：PPOCRv4-mobile 中文文本检测 + 识别（Apache-2.0 可商用），量化 ONNX 合计约 10–15MB。**同一场景只此一套**（det+rec 组合视为一个 OCR 方案），不并列引入第二套 OCR。
- **加载策略**：首次"拍照识别"按钮点击才动态 import；从 hf-mirror 下载后 Cache Storage / SW 缓存，之后离线可用；下载失败/浏览器不支持 WASM → 静默降级手动录入，主流程（文字录题）永不受影响。
- 若工时紧张，OCR 整体列为 V1.1 选项，V1 手动录入必须完整上线。

## 开发方案

- 语言/环境：TypeScript + Vue 3.5，Node ≥20.19；dev server 热更新调试，交付前一次 `build + preview` 权威验证。
- 人员分工：独立开发者单人。里程碑（M 档，预估 5–7 人日）：
  - **M1（1.5d）**：骨架 + Project/Question CRUD + IndexedDB 四表 + 免费层计数门。
  - **M2（1.5d）**：scheduler.ts 间隔引擎 + 今日队列视图 + 复习自评交互（单测先行）。
  - **M3（1.5d）**：标签树 + 弱项热力图 + 模考记录与 SVG 曲线 + 决策看板文案。
  - **M4（1d）**：.ics 导出 + 导出/导入备份 JSON + OCR 懒加载封装（可选）。
  - **收尾（1d）**：三视口 E2E + 全量质量门 + README/sample-queries 登记。

## 测试方案

- **单元测试（test/exam-review-scheduler.test.ts，≥15 例）**：
  - 间隔引擎：新题起步 1 天；"记得"后间隔按倍率递增；"已忘"重置回 1 天；跨年/月末日期边界。
  - 队列：`nextReview<=今天` 命中、逾期排序、今天多项目合并视图。
  - 弱项聚合：正确率<50% 标红、空考点不出现、标签改名后聚合跟随。
  - 曲线：目标分差距计算、两次模考趋势方向。
- **E2E（scripts/e2e-exam-review-scheduler-20261020.mjs）**：三视口（1280×860 / 834×1112 / 375×812）跑通 建项目→录题→次日到期→复习自评→队列缩短→弱项出现红块→模考入曲线→免费层第 2 项目付费墙。零横向溢出。
- **存量回归（每次交付必跑）**：`npm test`（全量）、`npx vue-tsc --noEmit` 0 错、`npm run verify:tools` 工具数正确（27→28）、`npm run build` 成功；抽查首页搜索"错题"能命中本工具。
- **PWA 回归**：preview 下离线（断网刷新）首页与本工具队列仍可打开；安装到桌面流程不受影响。

## 实施部署方案

- 部署：随 fangzi 主站走 EdgeOne Pages（Git 推送自动构建，现有流水线）；本工具新增 chunk 预估 60–120KB gz，零大资产，远低于 5GiB/20000 文件/25MiB 单文件限额。
- 上线步骤：MR 合入 main → 远端自动构建 → 灰度即全量（静态站无服务端，回滚 = Git revert 重推）。
- 回滚预案：若本工具上线出问题，直接 `git revert` 该工具目录新增提交并重推（自动发现机制下，目录消失即工具下架，不影响其它 27 个工具）。
- 运维监控：无后端；监控 = 用户反馈邮箱（fangziasia@163.com）+ 浏览器控制台人工抽测；用户数据全在本机，版本升级不触发任何服务端迁移。

## 风险与反思

- **用户真的需要吗？** 需要。在职考证人群数千万级，机构 APP 错题本封闭在自家题库里，"纸质讲义/PDF/网课截图的错题无处可去"是被多个经验帖反复确认的真空场景；备考期每天 1–3 次、连续数月，是 fangzi 留存最强的品类之一。
- **会不会把 fangzi 搞复杂？** 不会。单目录自闭环，免费层即可用核心队列，Pro 门清晰；不碰任何存量模块。
- **真能省时间/省钱吗？** 核心价值是把每天 <2 小时的复习时间按"弱项优先"分配，直接提升一次通过率（一次重考=报名费+教材网课数百到数千元+数月时间）。
- **遗留与边界**：①不承诺后台推送（PWA 能力边界，已用"打开即算+系统日历"替代）；②决策看板只是数据参考文案，UI 必须带"仅供参考、不承诺通过率"免责；③OCR 准确率受拍照质量影响，识别结果必须经用户确认后入库，禁止盲写。
