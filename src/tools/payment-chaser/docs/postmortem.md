# postmortem · 自由职业追款助手（payment-chaser · 002）

档位：**L（轻量偏 M）**。纯前端、IndexedDB、pdf-lib 生成 PDF，无 wasm/大模型/Worker。

## 架构
- `src/tools/payment-chaser/`：manifest.ts / index.vue / lib/{models,aging,templates,store,evidence}.ts。
- 纯逻辑下沉 `lib/aging.ts`（账龄分桶、阶段判定、金额格式化、模板变量填充）与 `lib/templates.ts`（三档话术），node 单测覆盖。
- 存储：独立 IndexedDB 库 `fz-payment-chaser-v1`（store `invoices`），写库前 `toRaw` 拍平规避 DataCloneError；不碰任何既有键。
- PDF 证据包：离屏 canvas 用系统字体绘制中文报告页 → JPEG → pdf-lib 排版 A4。**不内嵌中文字体**（避免引入 10MB+ CJK 字体与 fontkit 依赖），中文由浏览器系统字体栅格化，PDF 体积约 90KB；结构化数据同时导 CSV/JSON 供程序校验。
- 计费：`useToolBilling('payment-chaser')`，freemium，买断 ¥19.9 解锁 `unlimited`/`evidence-pdf`。

## 关键决策
- 账龄按本地日历日差（UTC 午夜），已付清不计桶。
- 梯度阶段：<7 礼貌 / <30 正式 / ≥30 最后通牒。
- 选 canvas 栅格化而非内嵌字体：pdf-lib 内嵌 CJK 需 fontkit + 16MB OTF，实测产出 13MB PDF，不可接受；栅格化后 90KB 且中文渲染正确。
- 踩坑：全局样式有 `.tag` chip 类（inline-flex/nowrap），本工具 `.tag` 与之冲突导致手机端横向溢出 365px，改名 `.tagline` 修复。

## 验证覆盖
- 单测 `test/payment-chaser.test.ts` 7 例：daysOverdue、bucket 边界 29/30/59/60/89/90、stage、dashboard 汇总与坏账、centsToYuan 千分位、模板填充、三档话术渲染。全量 `npm test` = **492**。
- `vue-tsc --noEmit` 0；`verify:tools` = **34**；`npm run build` 成功。
- E2E `scripts/e2e-payment-chaser-20261022.mjs` 三视口（1280×860 / 834×1112 / 375×812 移动 UA）全绿：录两笔（逾期45天/未到期）→ 看板待收 ¥11,000、45天落 30–60 桶 → 话术=最后通牒且填客户 → 两次留痕 → 证据包 PDF `%PDF`+`%%EOF`（约 93KB）→ CSV 含客户名与金额 → 断网二次加载数据仍在；零横向溢出、无 pageerror。
- 截图（真实运行、非 0 字节）：
  - `shots/pc-dashboard.png` 95,765B 1280×860
  - `shots/tablet-dashboard.png` 148,199B 834×1112
  - `shots/mobile-list.png` 52,629B 375×812
- EdgeOne：dist 177 MiB / 176 文件 / 最大单文件 24,010,842B（22.9MiB），本工具零大资产，均在 5GiB/20000/25MiB 内。

## 真机待验
- 真实手机微信/系统浏览器下 canvas→PDF 导出与文件保存；
- 大量客户（>500）下列表滚动与看板性能；
- 证据包 PDF 在不同系统字体下中文排版（已栅格化，风险低）。
