# 架构方案：家庭财务管家

- 对应 innovator：innovator_014_家庭财务管家
- 对应 pm：pm_014_家庭财务管家（结论：可集成·新增）
- 设计日期：2026-10-14

## 需求回顾与设计依据
PM 结论可集成（新增）：记账-预算-报表-洞察完整链路，月月复用、付费空间大。作为 fangzi 新 web 工具，纯前端本地实现。

## 技术方案
### 系统架构
新增 `src/tools/household-finance/`，`import.meta.glob` 自动发现，零核心改动。
### 模块设计
- `store.ts`：IndexedDB 数据层（账目、分类、预算、报表缓存）
- `ledger.ts`：记账/聚合/分类纯函数
- `budget.ts`：预算与超支预警
- `report.ts`：报表与趋势（月/年、环比）
- `insight.ts`：省钱洞察（规则引擎 + 可选本地 AI）
- `index.vue`：UI（记账 + 看板 + 预算 + 报表 + 洞察）
### 关键技术路线
IndexedDB 本地存储；快捷记账（语音/拍照 OCR 可选，本地）；报表用轻量图表（确认商用授权）；可选自托管云同步（WebDAV/免费云，加密）。
### 盈利模式
订阅制 Freemium：云同步/高级报表/AI 洞察/多人账本 ¥29.90/月。

## 与 fangzi 现有代码的集成方式
- 新建 `src/tools/household-finance/{manifest.ts,index.vue,store.ts,ledger.ts,budget.ts,report.ts,insight.ts}`
- manifest.ts 关键词：记账/预算/财务/家庭/收支/报表
- 不修改现有文件；PWA 配置、SW 缓存不受影响（数据在 IndexedDB，不破坏 SW 资源缓存策略）

## 软硬件/依赖选型
无重型依赖；IndexedDB 原生；图表可选轻量库（标注商用授权）；云同步为可选自托管；EdgeOne Pages 静态托管；零成本。

## 开发方案
- Vue3 + TS + 原生 CSS；独立开发者；里程碑：①store/ledger+单测 → ②记账/看板 UI → ③预算/报表 → ④洞察/同步 → ⑤verify+登记

## 测试方案
- 单测：记账/分类/预算计算、报表聚合、洞察规则
- 回归：存量功能与 PWA 可识别性保持
- 验收：verify:tools 通过、多端可用、数据本地持久

## 实施部署方案
- 随 fangzi 部署 EdgeOne Pages（Git 推送自动构建）；数据本地 IndexedDB；回滚用版本记录

## 风险与反思
用户真的需要吗？——家庭财务月月刚需，是。风险：记账坚持难、数据量增长——设计快捷记账与本地高效查询。是否搞复杂？——独立新工具零侵入，但链路型功能多，需模块化控制复杂度。
