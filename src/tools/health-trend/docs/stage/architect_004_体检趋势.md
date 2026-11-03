# 架构：体检趋势（health-trend）

## 技术选型
- 纯前端零新依赖；IndexedDB 复用 `reusable-module/indexeddb-kv`，独立库 `fz-health-trend-v1`（表 records）。
- 趋势判定纯函数 `lib/model.ts`（无 DOM，node:test 单测）。
- 趋势图用内联 SVG（polyline+circle），零图表库。
- 复查清单 PDF 复用 canvas 系统字体（"PingFang SC","Microsoft YaHei"）→JPEG→pdf-lib embedJpg，不内嵌字体。

## 模块
- `manifest.ts`：工具注册（自动发现，36→37）。
- `lib/model.ts`：`MetricRecord`、`trendStatus`（ok/climb/abnormal）、`groupByName`、`buildActionList`。
- `lib/store.ts`：allRecords/saveRecord/deleteRecord。
- `index.vue`：录入表单、SVG 趋势卡、复查清单、PDF 导出。

## 存储键
`fz-health-trend-v1`（IndexedDB），不串任何既有键。

## 盈利
Freemium：录入/趋势/预警免费；PDF 导出/多人体检档案为 Pro。
