# 架构 · 001 自动续费退订管家（重构 subscription-audit）

复用 `src/tools/subscription-audit/` 与 IDB `fz-subscription-audit-v1`，新增 `lib/unsubscribe-guides.ts`（本地平台退订步骤 JSON）、`lib/refund-letter.ts`（申诉话术模板）、年度报告视图。存量 stores 结构不变，新字段可选默认值，不做破坏迁移。纯前端、零新依赖，EdgeOne 静态托管。
