# 架构 · 002 自由职业追款助手

## 设计依据
引用 innovator_002 与 pm_002（干净新增，B2B 应收催收链路，付费意愿最强）。

## 技术方案
纯静态 PWA，无后端。`src/tools/payment-chaser/`：
- `manifest.ts`：type web，freemium。
- `lib/aging.ts`（纯函数）：daysOverdue / bucketOf / stageOf / buildDashboard / centsToYuan / fillTemplate。
- `lib/templates.ts`：三档梯度话术。
- `lib/store.ts`：独立 IDB `fz-payment-chaser-v1`，store invoices。
- `lib/evidence.ts`：canvas 栅格化中文报告 → pdf-lib A4 PDF；CSV/JSON 导出。
- `index.vue`：台账表单 / 账龄看板 / 话术面板 / 时间线留痕 / 导出。

## 选型（均已在仓库，零新依赖）
- pdf-lib（MIT，已在）；IndexedDB 原生；Date 本地日历日；useToolBilling；useSeo。
- 不内嵌中文字体：canvas 系统字体栅格化 → JPEG → PDF，避免 10MB+ CJK 字体与 fontkit。

## 集成方式
glob 自动注册，不改 ToolRunnerView/registry/路由；独立 IDB 库；无 SW 改动（无 wasm/大模型）。

## 测试
纯逻辑 node 单测 + Playwright 三视口 E2E（台账→看板→话术→留痕→PDF/CSV→断网）。

## 部署
EdgeOne Pages 静态托管，随主仓构建；无后端、无环境变量。
