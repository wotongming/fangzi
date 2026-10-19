# 架构方案：个税专项附加扣除·年度汇算助手

- 对应 innovator：innovator_001_个税专项附加扣除汇算助手.md
- 对应 pm：pm_001_个税专项附加扣除汇算助手.md（结论：可集成·新增）
- 设计日期：2026-10-19

## 需求回顾与设计依据
工薪家庭在七项专项附加扣除上的条件判断、错误预检、夫妻分摊、资料留存与年度节点痛点。纯前端、零资金、合规免责。

## 技术方案
### 系统架构
PWA 内独立工具 `src/tools/tax-deduction/`：UI（index.vue，多视图）→ 纯逻辑 `lib/` → IndexedDB 本地库 `fangzi-tax-deduction` v1（stores: profiles/items/docs）。无网络、无后端。
### 模块设计
- `rules-cn.ts`：七项扣除规则表（额度、适用条件、分摊可选比例、留存材料、RULE_VERSION 如 `cn-2026-10`），集中可维护、逐条带来源。
- `models.ts`：类型 + 货币（整数分）/日期工具。
- `validator.ts`（纯函数）：对录入项输出错误/警告（同子女合计>100%、配偶父母作被赡养人、贷款与租金并存、毕业未终止、被赡养人未满60等）。
- `split-plan.ts`：可分摊项的夫妻组合枚举与扣除额比较（只比扣除额，提示按各自边际税率选择）。
- `estimate.ts`：应纳税所得额区间→累进税率表，估算少缴/应补区间（显著标注估算）。
- `store.ts`：IndexedDB，含深度 toRaw（复用 shopping-claim 教训），写入前解除 Vue Proxy、保留 Blob/Date。
- `docs.ts`：资料留存清单（按项、留存 5 年到期）；`notify.ts`：.ics+Notification 节点提醒。
- `manifest.ts` / `index.vue`（视图：总览看板、各项录入、校验结果、夫妻方案、资料清单、时间线）。
### 关键技术路线
确定性规则引擎（无大模型、可单测）；Web Crypto 可选加密留存材料；顶部吸顶 `.seg`，无 fixed 底栏。
### 盈利模式
freemium：单一项+基础校验免费；买断/年度解锁七项完整校验、夫妻方案、多年资料留存与加密导出、提醒。`useToolBilling('tax-deduction')`。

## 与 fangzi 现有代码的集成方式
新增独立目录，经 `import.meta.glob('src/tools/*/manifest.ts')` 自动注册；类型遵循 `src/core/types.ts` ToolManifest；复用 .ics/通知范式与 indexeddb-kv；与 year-bonus-tax 仅关键词互链。不改核心、SW、manifest、现有路由。

## 软硬件/依赖选型
Vue3+TS+Vite（现有，MIT 生态）；IndexedDB、Web Crypto、原生 Notification/ICS（浏览器内置，免费可商用）；零新增 npm 依赖；无 NC 资源；托管 EdgeOne Pages 免费额度。

## 开发方案
1 人；里程碑：规则表+校验纯函数与单测 → 录入与方案 UI → 资料留存/加密/提醒 → 多端 E2E 与文档。

## 测试方案
单测：规则边界（年龄60、子女学籍起止、独/非独生分摊、贷款租金互斥、跨年度）、validator 各错误码、split-plan 组合、estimate 区间；vue-tsc 0 错；三视口 E2E（手机375重点/平板/PC）零横向溢出；回归 verify:tools。

## 实施部署方案
随 main 推送自动部署 EdgeOne Pages；规则更新改 RULE_VERSION 并在更新日志注明；回滚=回退提交（纯增量目录）。

## 风险与反思
用户真需要：年度刚需、直接关联退补税。不把 app 搞复杂：向导式分步、默认折叠高级项。合规：不代申报、不构成税务意见、以税务机关为准；规则口径仅引用官媒/官方公开信息并版本化。
