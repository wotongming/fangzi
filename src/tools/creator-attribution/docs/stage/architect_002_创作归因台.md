# 架构方案：独立创作者跨平台内容复盘与收益归因台

- 对应 innovator：innovator_002_创作归因台.md
- 对应 pm：pm_002_创作归因台.md（结论：**可集成（新增独立工具）**）
- 设计日期：2026-10-20
- 建议目录：`src/tools/creator-attribution/`
- 档位：M（多场景链路、IndexedDB 多 store、CSV 解析、多维聚合；无 WebGPU / 无 WASM / 无主流程本地模型权重）

## 需求回顾与设计依据

**innovator 核心主张**：粉丝 5 千–50 万的独立小创作者同时运营 3–5 个平台，每周要逐平台后台手抄阅读/播放/收益凑一张 Excel（73% 每天花 1–3 小时手动同步，18% 因数据错漏策略误判）；企业级矩阵工具（新榜/蚁小二）年费数千且重"分发"，面向小创作者的"本地优先、手动轻录入、聚焦归因决策"是空白。链路：发布台账 → 数据回收 → 四维归因 → 选题/商单决策。

**pm 结论与边界**：
1. 与现有 27 个工具无重复（`household-finance` 是家庭收支、`subscription-audit` 是账单续费、`gpu-data-viz` 是通用可视化），**新开独立工具**。
2. **不做自动 API 拉取**：小创作者拿不到抖音/小红书/B站开放平台 API 权限（需企业资质），innovator 明确"手动/截图 OCR/CSV 导入"——本工具数据来源仅为**本地手动录入 + CSV 批量导入**，零云端依赖、零平台合规风险。
3. 纯前端 IndexedDB 可跑通、零资金、低侵入；数据全程本机。

**设计前提**：通过 fangzi 工具自动发现框架新增一个目录，零路由/零注册表/零 SW 改动。

## 技术方案

### 系统架构

```
浏览器 (Chrome/Edge/Firefox/Safari)
  └─ Vue 3.5 SPA (vue-router 自动路由 /#/t/creator-attribution)
       └─ src/tools/creator-attribution/   ← 全部新代码封闭在本目录
            ├─ manifest.ts      工具元数据 + billing
            ├─ index.vue       页签编排（台账/归因/商单/报告）
            ├─ lib/
            │   ├─ types.ts     Account / Content / MetricSnapshot / Deal
            │   ├─ store.ts     IndexedDB CRUD（复用 reusable-module/indexeddb-kv）
            │   ├─ csv.ts       CSV 导入解析（复用 reusable-module/bill-csv）
            │   ├─ attribution.ts 四维归因纯函数（可单测）
            │   ├─ report.ts    月度经营报告 Markdown 生成
            │   └─ export.ts    downloadMarkdown/CSV 下载
            └─ components/
                ├─ LedgerView.vue       发布台账 + 手动录入
                ├─ MetricsInput.vue     数据回收轻录入（挂在内容条目下）
                ├─ AttributionBoard.vue  四维归因看板（手写 SVG 柱/折线）
                ├─ DealBook.vue          商单记录与报价参考
                └─ MonthlyReport.vue      月度经营报告
  └─ IndexedDB: fangzi-creator-attribution (v1)
       ├─ accounts   平台账号
       ├─ contents   内容台账条目
       ├─ metrics     数据回收快照（一条内容可多次回收）
       └─ deals      商单记录
```

### 模块设计

| 模块 | 职责 | 数据流 |
| --- | --- | --- |
| 账号 accounts | 维护"平台 + 账号名"（如 抖音@A、小红书@B） | 录入 → accounts 表 → 台账/归因按账号分组 |
| 发布台账 contents | 每条内容 30 秒录入：所属账号/标题/主题标签/形式(图文\|视频\|播客)/发布时间/投入工时 | 录入/CSV 导入 → contents 表 |
| 数据回收 metrics | 对某条内容做数据快照：阅读/播放/涨粉/分成收益/商单收入；一条内容可多次回收（如发布后 7 天、30 天各一次） | 手动/CSV → metrics 表（contentId 软关联） |
| 四维归因 attribution | 按**主题 / 形式 / 平台 / 发布时段**聚合：单位收益（收益/条）、收益每工时（ROI）、累计阅读/播放 | 读 contents+metrics → 纯函数 groupBy → 看板 |
| 商单 deals | 记录每条商单：品牌/日期/金额/转化/复购；近 30 天报价参考区间 | 录入 → deals 表 → 报价参考 |
| 月度报告 report | 一键导出"本月收入构成 + TOP3 赚钱内容 + 下月策略"Markdown | 读全表 → report.ts 模板 → 下载 |

**关键设计决策**：
- **收益与工时口径**：金额一律整数分（`yuanToCents`），工时小时（支持 0.5）；ROI = 该组收益合计 / 该组工时合计（元/小时），工时为 0 时只展示"单位收益/条"避免除零。
- **时段分桶**：发布时间按小时分 6 段（凌晨 0–6 / 上午 6–12 / 下午 12–18 / 晚高峰 18–24 各再细分），用 `new Date(publishedAt).getHours()` 纯函数分桶。
- **CSV 导入**：列名模糊定位（`bill-csv.findColumn`），容错"标题/平台/发布时间/阅读量/收益元"等常见中文列；导入为追加、不覆盖已有；导入前预览解析行数与失败行。

### 关键技术路线

1. **存储**：`reusable-module/indexeddb-kv`，独立库 `fangzi-creator-attribution`，v1 四表。
2. **CSV 解析**：直接复用 `reusable-module/bill-csv`（`decodeText` UTF-8/GBK 回退、`parseCsv` RFC4180、`findColumn` 列名模糊定位、`yuanToCents` 元→分、`parseFlexibleDate` 多格式日期），**不重复造轮子、零新增依赖**。
3. **归因聚合**：纯 JS `reduce/groupBy`，全部下沉 `lib/attribution.ts` 可单测。
4. **图表**：手写内联 SVG 柱状图/折线图（与仓内 M 档工具一致的零依赖范式），不引 ECharts。
5. **SEO**：`useSeo`（`@/composables/useSeo`）注入 SoftwareApplication JSON-LD。
6. **截图 OCR（远期 V1.1，不进本次主包）**：若后续加"截图读数"，按统一约束从 hf-mirror 懒加载 Apache-2.0 可商用小模型（如 TrOCR-base 类），首次使用才下载、Cache Storage 缓存；免费版降级为手动录入。**本次 V1.0 不打包任何模型权重**。

### 盈利模式（freemium + 买断，衔接 card-billing 统一钩子）

沿用 fangzi 统一计费 `src/core/billing/`（LocalMock 默认本机演示；`VITE_BILLING_ENDPOINT` 切真实收银台）。本工具只接统一钩子 + 配 1 个主变现方案 = freemium 内嵌买断，**低价档、与现有工具对齐**：

`manifest.ts` billing：
```ts
billing: {
  mode: 'freemium', currency: 'CNY', priceCents: 1990,   // ¥19.90 买断
  features: [
    { key: 'ledger-basic', label: '免费：最多 3 个账号 / 30 条内容台账 + 手动录入', free: true },
    { key: 'unlimited-account', label: '专业版：不限账号与内容条数', free: false },
    { key: 'csv-import', label: '专业版：CSV 批量导入历史数据', free: false },
    { key: 'attribution-board', label: '专业版：主题/形式/平台/时段四维归因看板', free: false },
    { key: 'deal-book', label: '专业版：商单记录与报价参考区间', free: false },
    { key: 'monthly-report', label: '专业版：月度经营报告 Markdown 导出', free: false }
  ]
}
```

**免费层降级**：账号数 >3 或内容 >30 时写入拦截并显示升级墙（复用 `.gate` 与 `billing.buy('freemium-pro')`）；CSV 导入/四维看板/商单/月报为 pro 功能。其余订阅/用量包/平台分成**框架已具备、配置即可开启**，本次不逐一配置。

## 与 fangzi 现有代码的集成方式

| 事项 | 真实路径 / 做法 |
| --- | --- |
| 工具目录 | 新建 `src/tools/creator-attribution/`（可先用 `npm run new:tool -- creator-attribution web "创作者内容归因台"` 生成骨架，再补全） |
| 自动发现 | `src/core/registry.ts` 通过 `import.meta.glob('../tools/*/manifest.ts')` 自动收录，**零注册表/路由改动** |
| 复用通用模块 | `reusable-module/indexeddb-kv`、`reusable-module/bill-csv`、`reusable-module/use-seo`（页面层用 `@/composables/useSeo`） |
| 计费钩子 | `const billing = useToolBilling('creator-attribution')`；`billing.canUse('unlimited-account').allowed`、`billing.buy('freemium-pro')` |
| 首页卡片/搜索 | manifest 写好 keywords/scenarios/painPoints 后自动进检索索引；首页浮动提问按需在 `src/core/sample-queries.ts` 加一条（非必须） |
| SW / manifest.webmanifest | 零改动，新 chunk 由 vite-plugin-pwa 自动预缓存 |
| 根 README | 开发完成后在工具清单追加本工具七字段条目（开发者阶段执行） |

## 软硬件/依赖选型（逐项标注商用授权）

| 依赖/资源 | 用途 | 授权 | 商用结论 |
| --- | --- | --- | --- |
| Vue 3.5 / Vite 8 / TS / Pinia / Vue Router | 框架（仓内已有） | MIT / Apache-2.0 | ✅ |
| vite-plugin-pwa / Workbox | PWA 离线 | MIT | ✅ |
| `reusable-module/indexeddb-kv` | 本地 KV | 内部 MIT | ✅ |
| `reusable-module/bill-csv` | CSV 解析 | 内部 MIT、零第三方 | ✅ |
| `reusable-module/use-seo` | 元信息/JSON-LD | 内部 MIT | ✅ |
| 手写 SVG 图表 | 归因看板 | 无第三方 | ✅ |
| EdgeOne Pages 免费版 | 静态托管 | 免费额度可商用 | ✅ |

**结论**：V1.0 **零新增 npm 依赖**，全部仓内已有或零依赖手写，杜绝 NC 授权与侵权 IP。

### 本地 AI 选型（V1.0 不启用，仅登记远期）

V1.0 主流程**不引入任何本地 AI 模型**（纯手动录入 + CSV + 规则聚合）。远期 V1.1 截图 OCR 若启用，单场景单模型单引擎：候选 TrOCR-base（Apache-2.0）+ onnxruntime-web（MIT，仓内已有），首次从 hf-mirror 懒加载、Cache Storage 缓存、不进主包、不预缓存；严禁选用 NC 授权模型。免费版在 OCR 未加载时降级为手动录入。

## 开发方案

- TS + Vue 3 `<script setup>`，纯逻辑下沉 `lib/*.ts` 可单测。
- 独立开发者单人，里程碑：
  - M1（1.5d）：types/store 四表 CRUD + 账号/台账视图。
  - M2（1d）：metrics 数据回收 + CSV 导入（bill-csv 接入 + 预览）。
  - M3（2d）：attribution 四维聚合 + AttributionBoard 看板。
  - M4（1d）：deals 商单 + MonthlyReport 导出。
  - M5（1d）：manifest/SEO/README + 全量质量门 + 三视口验证。

## 测试方案

- 单测 `test/creator-attribution.test.ts`：四维 groupBy 聚合正确性（含除零、空工时、跨平台同标题去重）、CSV 列名模糊定位与元→分/日期解析、账号/条数限额拦截、月报模板拼装；仓内全量单测基线不回退。
- 质量门：`npx vue-tsc --noEmit` 0 错；`npm run verify:tools` 通过（工具数 27→28，示例提问回归）。
- 无头 E2E：建账号→录台账→录数据→看板出图→免费层第 4 账号升级墙→CSV 导入→月报导出；PC/平板/手机三视口零横向溢出。
- 存量回归：本工具为新增，不影响任何现有工具；仍需复跑全量 `npm test` 与 `npm run verify:tools` 确认无连带破坏。

## 实施部署方案

- 随 fangzi 主体走 EdgeOne Pages（Git push main → 自动构建），无独立部署。增量约 80–150KB gz，合规。
- 上线：合并 main → EdgeOne 构建 → 用户刷新生效；IndexedDB `fangzi-creator-attribution` v1 首次打开即建库。
- 回滚：Git revert → 重新构建。本工具为全新库，回滚不影响任何存量数据（旧用户无该库数据）。

## 风险与反思

- **用户真的需要吗？** 需要。掘金白皮书 73% 创作者每天手动同步 1–3 小时、65% 月收入低于 5000，痛点真实且高频（发布日天天录、每周复盘）。
- **会不会把 fangzi 搞复杂？** 不会。新工具独立目录、独立路由，首页只是多一张卡片；不影响现有 27 工具。
- **真能省时间/增收吗？** 每周 1–3 小时制表压缩到 20 分钟；归因直接导向"下周主攻什么主题/哪个平台/商单报多少"，一次正确决策价值远超 ¥19.90。
- **遗留待确认**：①截图 OCR 列 V1.1；②"一条内容多平台累计表现"的跨账号合并展示列增强；③小团队共享为远期，本期纯单机。
