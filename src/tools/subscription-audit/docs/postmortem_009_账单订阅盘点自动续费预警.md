# 技术沉淀：账单订阅盘点与自动续费预警

- 对应 dev：`dev_009_账单订阅盘点自动续费预警.md`
- 日期：2026-10-17
- 档位：M（多文件解析、Worker、IndexedDB、多种导出、三视口页面）

## 技术选型与理由

- **零新增 npm 依赖**：在既有 Vue 3 + Vite + TS 栈内完成，避免包体与供应链风险。
- **CSV 解析**：自研 RFC4180 解析（处理引号、内嵌逗号/换行、双引号转义），沉淀为 `reusable-module/bill-csv`；编码用浏览器原生 `TextDecoder`，先 UTF-8（BOM 探测），失败回退 `gbk`（支付宝账单为 GBK），再失败用替换符兜底。
- **金额**：统一转成**整数分**（`yuanToCents`），全程不做浮点金额运算，展示时再格式化，规避 0.1+0.2 类误差。
- **周期识别**：纯函数聚类（沉淀为 `reusable-module/recurring-detect`）——同名商户归一 + 金额容差归桶 + 间隔中位数落入月/季/半年/年区间 + 间隔变异系数 CV≤0.25，一次性餐饮/购物不会被误判为订阅。
- **解析并发**：大文件走 Web Worker（复用 `reusable-module/worker-post`，File 走克隆、不 transfer），不支持 Worker 时回退主线程。
- **本地存储**：IndexedDB（复用 `reusable-module/indexeddb-kv`，库名 `fz-subscription-audit-v1`）只存**导入批次元信息**与**人工标注 overrides**，不长期保存逐条账单明细，降低敏感数据落盘面。
- **提醒**：长期提醒用标准 `.ics`（VEVENT + RRULE + VALARM，扣费前一天 09:00），交给系统日历；浏览器 `Notification` 仅在页面打开期间补充一次最近扣费提醒。无后端，不做 Web Push。
- **合规边界**：不登录、不碰支付账户、不自动解约，只给微信/支付宝官方帮助入口；不做账单云同步。
- 所有自研代码与所用浏览器 API 均为内置能力，**MIT/原生可商用**，无 NC 非商用授权资源。

## 关键实现

```
CSV 文件(UTF-8/GBK)
  → bill-csv: decodeText + parseCsv + locateHeader（自动跳过说明/合计行）
  → platforms: 微信/支付宝列名映射 → TxRecord[]（金额整数分）
  → recurring-detect: 同名+金额容差+间隔中位数+CV 聚类 → 周期组
  → subscriptions.buildSubscriptions: 展示名众数/类别/平台聚合
        + 标注(price-up/duplicate/idle/trial) + 应用 overrides(决定/周期/忽略/合并)
  → report.summarize: 年/三年/可省/类别/最近扣费
  → 导出：toReportCsv(带 BOM) / buildIcs(RRULE+VALARM)
```

- **去重**：跨文件按订单号 `orderNo` 唯一，同笔账单在多份文件中只计一次。
- **人工决定即时生效**：`setAction/toggleIgnore/changeCadence` 先更新内存 `overrides` 并 `rebuild()` 重算，再异步写 IndexedDB；即使持久化慢或失败，界面金额也立即正确。
- **计费钩子**：`useToolBilling('subscription-audit')`，feature 分 `basic`(free) / `multi-account` / `insights` / `remind-export`，买断 priceCents 990，订阅 400/月、3000/年；未购时仅展示升级入口，不阻断核心识别。
- 与「家庭财务管家」仅做报告层互链，不读写其账本数据。

## 踩坑记录

1. **平台误判（高优先级）**：支付宝表头列「交易创建时间」包含子串「交易时间」，SPECS 原先把微信规则放前面，导致支付宝账单被识别成微信。修复：把**支付宝规则排在微信之前**（代码内已注释原因）。
2. **测试夹具 id 撞车**：两家商户同属 wechat 时，夹具 id 用 `${platform}-${i}` 生成会重复，`buildSubscriptions` 内部按 id 的 Map 互相覆盖。修复：夹具 id / orderNo 加入商户名（`${platform}-${name}-${i}`）。
3. **样式类名与全局冲突**：本工具简介用了类名 `.sub`，被全局订阅卡片样式命中成 `display:flex`，段落文本被当 flex 项拉出大空隙。修复：改名为工具专属 `.sa-sub` 并显式 `display:block;text-align:start`。
4. **标注后金额不更新**：最初 `persist()` 先 `await saveOverrides(IDB)` 再 `rebuild()`，无头环境下首帧读到的仍是旧值。调整为**先内存 rebuild 即时重算、持久化失败仅告警不阻塞**。
5. **GBK 写入**：构造支付宝夹具时 `¥(U+00A5)` 无法用 GBK 编码，金额列去掉货币符号（解析器本就去符号），符合真实导出。
6. **worker 引用路径**：工具内引用仓库根 reusable-module 必须用相对路径，index.vue 位于 `src/tools/<tool>/`，上溯三级到 src、再到根模块，正确为 `../../../reusable-module/worker-post/worker-post`（lib 目录才是上四级）。

## 验证覆盖

- 档位 M；质量门全部通过：
  - 类型检查 `npx vue-tsc --noEmit`：**0 错误**。
  - 全量单测 `node --import tsx --test test/*.test.ts`：**227 / 227 通过**（基线 213 + 本工具 14，含 CSV RFC4180、GBK 回退、金额整数化、日期多格式、商户归一、月付聚类与预测、不规律过滤、微信/支付宝端到端、跨文件订单去重、标注/涨价/试用/决定、BOM 报告、ICS 结构）。
  - 生产构建 `npm run build`：**成功**。
  - `npm run verify:tools`：**校验工具数 22**，manifest/插件包/示例提问回归全部通过。
- **三视口 E2E**（Playwright + Chromium，脚本 `scripts/e2e-subscription-audit-20261017.mjs`，PC 1280×800 / 平板 834×1112 / 手机 375×812）：
  - 同时导入脱敏微信(UTF-8)+支付宝(GBK) 两份账单 → 正确识别 5 个订阅、识别出爱奇艺/腾讯视频/优酷/百度网盘；
  - 概览金额正确（一年合计 ¥1,552.70）；出现「涨价」「同类重复」标注；
  - 展开「如何关闭」有 4 步官方指引且帮助链接为合法 https；
  - 标注「取消」后「可省/年」由 ¥0.00 实时更新为 ¥361.80；
  - 导出报告 CSV、生成 .ics 均触发下载，文件名后缀正确，ICS 含 BEGIN:VCALENDAR/VEVENT/RRULE/VALARM；
  - 存在类别结构与 household-finance 互链；
  - 免费态显示「升级专业版」入口；
  - 三视口均**无横向溢出**（scrollWidth-clientWidth=0），无未过滤的 console.error。
- **EdgeOne Pages 免费版限额核查（dist 实测）**：总量 **约 130 MiB < 5 GiB**；文件数 **119 < 20000**；最大单文件 `ort-wasm-simd-threaded-*.wasm` **13.6 MiB < 25 MiB**（构建脚本已清理 25.6MiB 的 WebGPU asyncify wasm）。全部合规；本工具无大资产。

### guide 截图有效性验证

| 截图文件 | 像素 | 大小 | 对应内容 | 是否通过 |
|---|---|---|---|---|
| pc-1-overview.png | 1280×800 | 118,814 B | PC 导入区/概览卡/订阅清单首屏 | 通过（真实运行截图，非空、可打开、与文案一致） |
| pc-2-cancel-guide.png | 1280×800 | 116,239 B | 展开官方解约指引 | 通过 |
| pc-3-export.png | 1280×800 | 104,259 B | 提醒与导出/类别结构 | 通过 |
| tablet-1.png | 834×1112 | 164,672 B | 平板自适应 | 通过 |
| mobile-1.png | 375×812 | 80,636 B | 手机边到边+底部 Tab+两列卡片 | 通过 |

## 可复用经验

- `reusable-module/bill-csv`：任何需要读取微信/支付宝/银行类 CSV 的工具可直接复用解码、RFC4180 解析、金额整数化、多格式日期、列名模糊定位。
- `reusable-module/recurring-detect`：周期性交易/订阅/分期识别通用（同名归一 + 金额容差 + 间隔中位数 + CV 阈值），输出标准 cadence 与年化/下次预测。
- 纯前端工具处理用户文件时：**金额整数分、内存先生效后持久化、敏感明细不落盘、人工可纠错**，是兼顾准确、体验与隐私的可复用范式。
- 新增工具的 CSS 类名应加工具前缀（如 `sa-`），避免与全局通用类（`.sub`/`.card` 等）冲突——建议后续纳入新增工具脚手架的命名约定。
