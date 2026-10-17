# 架构方案：账单订阅盘点与自动续费本地预警（subscription-audit）

- 对应 innovator：innovator_009_账单订阅盘点自动续费预警.md
- 对应 pm：pm_009_账单订阅盘点自动续费预警.md（结论：可集成，新增独立工具）
- 设计日期：2026-10-17

## 需求回顾与设计依据

用户从微信支付 / 支付宝导出官方账单 CSV，工具在本机解析周期性扣费、聚类为订阅，计算年度/三年成本，标注疑似闲置/重复/涨价，给出官方解约入口与下次扣费提醒（系统通知 + .ics），支持标记保留/取消/观望与报告导出。核心信任点：**财务数据绝不出设备**。PM 已定与 `household-finance` 不重复、只互链，零后端、零资金、M 档、单轮交付。

## 技术方案

### 系统架构（纯前端分层）

```
CSV 文件(可多份/多月)
  └─ lib/csv.ts        零依赖 RFC4180 解析（引号/逗号/换行/转义）+ TextDecoder('gbk'|'utf-8')
  └─ lib/platforms.ts  微信/支付宝账单字段映射（可配置、容错、只取收支明细行、去重）
        ↓ 标准化 TxRecord[]（date/merchant/amountCents/direction/raw）
  └─ lib/subscriptions.ts 订阅聚类引擎（纯函数，核心）
        ├─ 仅支出；商户名归一化（去尾号/订单号/括号备注/空白）
        ├─ 同商户按“近似金额 + 近似周期”聚类（月/季/半年/年）
        ├─ 输出周期、单价、次数、首末扣费、预测下次扣费、累计/年化
        └─ 标注：闲置 / 重复同类 / 涨价 / 试用临近转正
  └─ lib/report.ts     汇总（按商户/类别/月）、可省金额、报告 CSV、打印
  └─ lib/remind.ts     .ics 生成（自写，VEVENT+VALARM）、Notification 权限与调度（页面会话内）
  └─ storage（IndexedDB，复用 reusable-module/indexeddb-kv）：导入批次、订阅决定、备注
        ↓
  index.vue  导入指引 / 订阅清单 / 成本概览 / 决定与待办 / 报告导出
```

大账单解析放入 Web Worker（复用 `reusable-module/worker-post` 传 File），不支持 OffscreenCanvas 与此无关，Worker 仅做 CPU 解析；不支持 Worker 时回退主线程（账单通常 < 数十 MB，可接受）。

### 模块设计

- **csv.ts**：`decodeBuffer(ArrayBuffer):string`（BOM 探测 + gbk 回退）、`parseCsv(text):string[][]`、`parseObjects(text, mapping)`。
- **platforms.ts**：两套内置 `FieldMapping`（微信、支付宝）。策略：定位表头行（含关键列名的行）→ 按列名映射 → 跳过汇总/统计/说明行（无日期或金额非法、或首列命中“微信支付账单/支付宝交易记录/---/导出/共”等）→ 金额单位元转分（整数，避免浮点）。`sniffPlatform` 自动判别，也允许手动指定。多份账单按 `(date,merchant,amount,orderNo)` 去重。
- **subscriptions.ts**：
  - 归一化商户：去 emoji、交易单号、`(…)`/`（…）`备注、`-数字尾号`、连续空白；保留品牌主体。
  - 候选：同归一化商户 ≥2 笔支出。按金额分组（容差 ±8%，且绝对差 ≤3 元，吸收“首月优惠/分/角”），同组内按时间排序估计间隔（相邻间隔中位数，天）。
  - 周期判定：间隔落在 26–35 天→月（30.4）；85–95→季（91.3）；175–190→半年（182.6）；350–380→年（365.25）。间隔变异系数 CV ≤ 0.25 才算规律订阅，否则标记“不规律/可能一次性”不纳入订阅（可在“其他周期扣费”里查看）。
  - 指标：`nextDate = last + avgGap`、`monthlyEquiv`、`annualCents`、`totalCents`、三年 `annual*3`。
  - 标注：
    - **涨价**：同周期金额最大值较最小值上涨 ≥10%。
    - **重复同类**：商户类别/关键词同类（视频会员：爱奇艺/腾讯视频/优酷/B站/芒果；音乐；网盘；健身等）出现 ≥2 个活跃订阅。
    - **闲置**：最近一次扣费距今 > 1.5 个周期仍无取消标记（无使用信号时以“扣费在持续但你可自查”弱提示，文案不夸大为确定闲置）。
    - **试用临近**：名称或备注命中“试用/首月/1元/0元”，且下一次金额显著高于已扣（转正差价）。
  - 全部阈值集中常量、用户可在 UI 改容差并**手动合并/拆分/改周期/忽略**，纠正结果优先（存 IndexedDB）。
- **report.ts**：总年化、订阅数、按类别聚合；“取消可省”=被标记取消项年化之和；导出订阅清单 CSV（带 BOM，Excel 友好）、`window.print()` 打印样式。
- **remind.ts**：生成单个或全部订阅的 `.ics`（UID 用稳定 hash，DTSTART 下次扣费前 1 天 09:00，VALARM -1D；RRULE 按周期），`Blob` 下载导入系统日历；Notification：请求权限，在页面打开期间用 setTimeout 到最近一次扣费前提醒（明确告知“关闭页面后请用 .ics 日历提醒”）。不做后台定时（无后端、SW push 需服务器，刻意不做虚假承诺）。
- **解约指引**：静态数据表 `cancelGuides`（微信：我→服务→钱包→支付设置→自动续费/免密支付；支付宝：我的→设置→支付设置→免密支付/自动扣款），附官方帮助链接（微信支付/支付宝服务中心公开帮助页）。仅指路，不代操作。

### 关键技术路线

- 零新增依赖：CSV 与 GBK 用浏览器原生 `TextDecoder('gbk')`（Chrome/Edge/Safari/Firefox 均支持；Node 单测用 util.TextDecoder 同样支持 gbk）；.ics 自写；聚类纯函数。
- 金额一律用**整数分**（`Math.round(yuan*100)`，展示再除），杜绝浮点误差。
- Worker 解析复用 `reusable-module/worker-post`（File 克隆），解析结果为可结构化克隆的普通数组。
- 纯函数核心（csv/platforms/subscriptions/report/naming of ics）全部可在 Node 单测，不依赖 DOM。

### 盈利模式（接主方案，其余框架配置即开）

freemium + 买断：免费=单份账单、基础订阅识别与年化总览；专业（`multi-account` 多份多月多账户合并去重、`insights` 闲置/重复/涨价/试用智能判定、`remind-export` 提醒待办与 .ics/报告导出）。priceCents 取 **990（¥9.90）**——省钱 ROI 直观、定价低于家庭财务 ¥19.90 的轻工具定位；subscription 月 400/年 3000；usagePack 不设（盘点类按次不合理，可留空）。

## 与 fangzi 现有代码的集成方式

- 新增独立目录 `src/tools/subscription-audit/`（manifest/index.vue/guide.md/lib/*/workers/parse.worker.ts/docs），registry `import.meta.glob` 自动发现，零路由/核心改动。
- 复用：`@/composables/useToolBilling`、`@/composables/useSeo`；相对路径引用仓库根 `reusable-module/indexeddb-kv`、`reusable-module/worker-post`（`../../../../reusable-module/...`，**不可用 `@/reusable-module`**）。
- 沉淀：CSV 解析通用、周期聚类通用，抽到 `reusable-module/bill-csv` 与 `reusable-module/recurring-detect`（供 004/008 与后续账单类复用），更新 reusable README。
- 报告区与 household-finance 仅做静态互链（router link 到 `/#/t/household-finance`），不读写其数据。

## 软硬件/依赖选型（商用授权）

| 项 | 来源 | 许可 | 商用 |
| --- | --- | --- | --- |
| CSV 解析 | 自研 lib/csv.ts | 内部 MIT | 是 |
| GBK 解码 | 浏览器/Node 原生 TextDecoder | 平台内置 | 是 |
| .ics 生成 | 自研 lib/remind.ts | 内部 MIT | 是 |
| 存储 | IndexedDB（indexeddb-kv） | 内部 MIT | 是 |
| Worker 通信 | worker-post | 内部 MIT | 是 |
| ZIP | 不需要 | — | — |

无任何 NC/非商用资源；无 npm 新增依赖。

## 开发方案

Vue 3 `<script setup>` + TS，沿用仓库风格；1 人（独立开发者）。里程碑：①csv+platforms+单测 → ②聚类引擎+单测 → ③存储+UI+计费钩子 → ④提醒/ics/导出 → ⑤build+三视口 E2E+截图+文档+推送。

## 测试方案

- 单测（Node + tsx）：CSV 引号/换行/GBK、两平台映射与脏行跳过、金额转分、去重、商户归一化、月/季/年聚类、CV 过滤、涨价/重复/试用/闲置标注、年化与可省、ics 字段。
- E2E（Playwright，三视口 1280×800 / 834×1112 / 375×812）：上传**自造脱敏**微信+支付宝 CSV → 识别出预期订阅数与金额 → 标记取消后“可省”更新 → 导出 CSV / 下载 .ics 断言内容 → 无横向溢出、0 致命错误。abort sw.js。
- 回归：verify:tools、build、vue-tsc；打开 household-finance 确认互链无影响。

## 实施部署方案

随静态 PWA 走 EdgeOne Pages（push main 自动部署），无环境变量、无服务端。回滚：revert 该工具 commit（独立目录，移除即彻底下线，不影响其它工具与 SW 主清单外的旧缓存，新版 SW 会清理）。

## 风险与反思

- 平台 CSV 列名/版式会变 → 映射做成“关键列名候选数组 + 表头行探测 + 容错”，失败给出明确“未识别格式，请按指引导出”，绝不静默算错。
- 闲置无法仅靠账单确定“没使用” → 用审慎措辞“持续扣费，建议自查是否还用”，避免误导。
- 不做自动解约/免密操作 → 合规且安全，只给官方路径。
- 不做后台推送提醒（需服务器）→ 用 .ics 系统日历承载长期提醒，会话内 Notification 作补充，能力边界如实说明。
- 是否让 fangzi 变复杂：独立工具、仅在报告页互链，不侵入首页与记账工具，复杂度可控。
