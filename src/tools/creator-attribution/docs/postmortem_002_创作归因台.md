# 技术沉淀：创作归因台

- 对应 dev：dev_002_创作归因台.md
- 日期：2026-10-20
- **档位：M**（多场景链路、IndexedDB 四表、CSV 解析、多维聚合；无 WebGPU / WASM / 本地模型权重）

## 技术选型与理由

| 选型 | 版本/来源 | 理由 |
| --- | --- | --- |
| Vue 3.5 `<script setup>` + TS + Vite 8 | 仓内既有 | 与 M 档工具同构，零新增依赖 |
| IndexedDB 存储 | `reusable-module/indexeddb-kv` | 独立库 `fangzi-creator-attribution` v1 四表，零后端 |
| CSV 解析 | `reusable-module/bill-csv` | 直接复用 decodeText(UTF-8/GBK)/parseCsv/findColumn/yuanToCents/parseFlexibleDate，零重造轮子 |
| 图表 | 手写内联 SVG 柱状图 | 不引 ECharts，包体零增长 |
| SEO | `reusable-module/use-seo` | SoftwareApplication JSON-LD |
| 计费 | `useToolBilling('creator-attribution')` | freemium + 买断 priceCents=1990（¥19.90），仅接统一钩子 |

商用授权：全部仓内既有 MIT/Apache-2.0 模块，**零新增 npm 依赖、零 NC 授权资源、无侵权 IP**。

## 关键实现

### 四维归因（lib/attribution.ts 纯函数）

`attribute(contents, metrics, accounts, dim)` 纯函数：把每条内容的阅读/收益按维度键 groupBy。
- `tag` 维度下一条内容有 N 个标签，则该内容在每个标签桶各计一条（反映"同时押中多个选题"），单测中用 `美食`(2条)/`探店`(1条) 手算验证。
- 指标：条数/总阅读/总收益(分)/总工时 → 单位收益(元/条)、ROI(元/小时)。
- **除零安全**：`hours > 0 ? revenue/hours : null`，工时为 0 时 ROI 回退 null，UI 显示「—（工时0）」。
- 时段桶 `slotOf()`：`getHours()` 分 6 段（凌晨0–6 / 早间6–10 / 午间10–14 / 下午14–18 / 晚高峰18–21 / 夜间21–24），边界用例单测全覆盖。

### CSV 导入（lib/csv.ts）

`mapCsvColumns()` 用 `findColumn` 模糊定位中文列，缺「标题/发布时间」必需列直接抛错不写入；逐行 `parseFlexibleDate`+`yuanToCents` 转换，缺标题/坏日期行 `skipped++` 跳过；组件侧先弹预览（解析数/跳过数/编码），用户确认后才落库，**追加不覆盖**。

### 金额与数据模型

金额一律整数分（`yuanToCents` / `Math.round(yuan*100)`），展示时 `centsToYuan` 除 100；工时小时（支持 0.5）。

## 踩坑记录

1. **Vue reactive → IndexedDB DataCloneError**：写库前对入参统一 `JSON.parse(JSON.stringify(v))` 深拍平为纯字面量再 `putValue`（index.vue 的 `freeze()`），避免嵌套代理（tags 数组）导致 structuredClone 静默失败。
2. **E2E 重复展开面板**：首次写无头脚本时，对同一条内容连点两次「回收数据」toggle，第二次把已展开面板收起，导致等待 `.mi-body` 超时。改为**幂等**：先查 `.mi-body` 是否已存在，存在则不再点 toggle。
3. **Modal 内多输入框 strict mode**：商单弹层有品牌+备注两个 text input，Playwright `.fill()` 报 strict mode violation，须 `.nth(0)` 精确选取。

## 验证覆盖

- **单测**：`test/creator-attribution.test.ts` 新增 17 例（≥10 达标）：四维聚合手算一致、tag 多标签分摊、format/platform/slot 维度、slot 六桶边界、ROI 工时0回退 null、空数据、金额分元换算、CSV 列模糊定位/缺列报错/错误行跳过/UTF-8 解析、GBK 回退、normalizeLooseTags、priceRange 报价区间、免费限额常量、月报段落。全量 `npm test` = **383 通过**（基线 366 + 本工具 17）。
- **类型/校验**：`npx vue-tsc --noEmit` = **0 错**；`npm run verify:tools` = **29 个工具**通过。
- **构建**：`npm run build` 成功，无报错。
- **三视口真实 E2E**（`scripts/e2e-creator-attribution-20261020.mjs`）：
  - PC 1280×860：建账号→录 2 内容→每条 2 次快照→四维看板 SVG+4 行表→商单报价区间→月报预览→CSV(UTF-8)预览 2 条/跳过 1→导入后 4 条→刷新仍在，全程无 pageerror、零横向溢出。
  - 平板 834×1112、手机 375×812：IDB 注入演示数据后看板渲染，零横向溢出。
  - 免费层：第 4 个账号触发升级墙（弹出「专业版」弹层）。
- **截图有效性**（docs/shots/，已删调试图 diag-fail.png）：

| 文件 | 像素 | 大小 | 通过 |
| --- | --- | --- | --- |
| shot-01-pc-ledger.png | 1280×1478 | 84.6KB | ✅ 真实台账界面 |
| shot-02-pc-board.png | 1280×1079 | 55.9KB | ✅ 归因看板 |
| shot-03-pc-deals.png | 1280×860 | 56.4KB | ✅ 商单报价 |
| shot-04-pc-report.png | 1280×1289 | 136.8KB | ✅ 月报预览 |
| shot-05-tablet.png | 834×1112 | 63.4KB | ✅ 平板自适应 |
| shot-06-mobile-ledger.png | 375×1072 | 69.6KB | ✅ 手机台账 |
| shot-07-mobile-board.png | 375×917 | 56.1KB | ✅ 手机看板 |

- **EdgeOne Pages 免费版限额**（整站 dist）：总大小 **132M < 5GiB** ✅；文件数 **147 < 20000** ✅；单文件最大 **23MiB < 25MiB** ✅。本工具增量约几十 KB，零大资产。

## 可复用经验

- **写 IDB 前深拍平**：方子内任何把 Vue reactive（尤其含数组/嵌套对象）写入 IndexedDB 的工具，统一 `JSON.parse(JSON.stringify(v))` 后再 put，规避 structuredClone 静默失败。
- **E2E 幂等展开**：对可折叠面板做多次操作时，脚本先查展开态再决定是否点击，避免"点开又点关"。
- **纯函数下沉**：聚合/CSV/报告全部放 `lib/*.ts` 不 import Vue，组件薄，单测覆盖核心数值逻辑，无头 E2E 只验证交互与渲染。
- 本工具直接复用 `bill-csv`/`indexeddb-kv`，**未新增 reusable-module**（无跨工具新增价值的纯函数）。
