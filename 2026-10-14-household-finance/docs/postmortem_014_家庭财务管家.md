# 技术沉淀：家庭财务管家

- 对应 dev：`dev_014_家庭财务管家.md`
- 日期：2026-10-14

## 技术选型与理由

| 项 | 选型 | 理由 |
|---|---|---|
| 框架 | Vue 3.5.44 + TypeScript + Vite 8（fangzi 既有栈） | 复用存量工程，零新增构建负担 |
| 数据层 | 原生 IndexedDB（三表：ledgers/categories/budgets，date 索引） | 无后端纯前端约束；浏览器原生，免依赖 |
| 图表 | 原生 SVG（stroke-dasharray 环形图 + polyline 折线/柱状） | **弃用 ECharts**：虽 Apache-2.0 免费商用（官方 FAQ 明确），但 fangzi「零重型依赖、控制资源包」约束下，原生 SVG 无新增依赖、chunk 仅 9.79 kB gzip |
| 加密 | Web Crypto：AES-GCM + PBKDF2（SHA-256、120k 迭代、随机 salt/iv） | 无后端场景下前端可加密备份；浏览器原生 |
| 计费 | useToolBilling（Freemium 订阅 ¥29.90/月） | 复用方子计费框架；记账/预算免费，报表/洞察/加密备份付费 |

**漏洞与兼容性核查**：调研确认 Vue 3.5.44 无关联已知漏洞（检索到的 CVE-2026-56317 属 Nuxt 生态，与 fangzi 无关）；零新增依赖，规避引入第三方图表库的供应链风险。

## 关键实现

### 1. 领域模型与纯函数业务层
- 金额一律以「分」（整数）存储与计算，展示层 `fmtYuan` 换算，规避浮点误差。
- `ledger.ts` 提供分类聚合/平台聚合/按月过滤等纯函数；`budget.ts` 预算执行状态（`month='*'` 通用、`category='__all__'` 总预算）；`report.ts` 月报/多月趋势/环比（零分母返回 null）；`insight.ts` 四规则洞察引擎。业务层全部纯函数，单测可直接覆盖。

### 2. IndexedDB 数据层 + 备份
- `store.ts` 封装 openDB/put/remove/getAll/clearStore/listLedgersByDate，首次打开自动种入内置分类。
- 备份 `BackupPayload v1`（kind/version/exportedAt + 三表），明文 JSON 导出；加密备份结构 `base64(salt(16)|iv(12)|cipher)`，AES-GCM + PBKDF2 120k 迭代。

### 3. 原生 SVG 图表
- 环形图：圆环 `stroke-dasharray = ratio × 周长`、`stroke-dashoffset` 累加、rotate(-90) 起始。
- 趋势图：`trendGeometry()` 按 max 归一化生成柱 + 折线坐标；日趋势 `dayLineGeometry()` 折线。
- 关键坑：**分类 id 与显示名分离**——账目/预算存分类 id（如 `food`），图表图例与洞察文案需经 `catLabel()` / `nameOf()` 映射为中文，否则界面显示裸 id。

### 4. 计费接入
- `useToolBilling('household-finance')`，`canUse('report'|'insight'|'sync')` 控制报表/洞察/加密备份；`buy('freemium-pro')` 拉起订阅。UI 未订阅显示锁定卡片 + 升级按钮，订阅后响应式解锁（`canUse` 依赖 billingVersion 建立响应式）。

## 踩坑记录

1. **`v-model` + `type=number` 类型突变**：number 输入框的 `v-model` 会把字符串转成 number，导致 `row.amountYuan.trim()` 抛 `TypeError`（预算保存静默失败）。修复：统一 `String(row.amountYuan ?? '').trim()` 再解析。
2. **分类 id 显示裸英文**：环形图图例/洞察显示 `food` 而非「餐饮」。修复：UI 侧 `catLabel(id)`、洞察引擎增加可选 `categories` 参数做 `nameOf` 映射。
3. **零分母环比**：上月无支出时 `changeRatio(x, 0)` 返回 null，UI 需判空（显示「无上月数据」而非 NaN）。
4. **ECharts 商用授权误判风险**：官方 Apache-2.0 可商用，但按 fangzi 资源包约束主动弃用，避免「能用但没必要」的依赖膨胀。
5. **CVE 误报排查**：搜索引擎返回的 CVE-2026-56317 实为 Nuxt 框架漏洞，与 Vue 3.5.44 无关，需核对组件归属后再下结论。

## 验证覆盖

**单测**：`test/household-finance.test.ts` 19 个用例，全仓 42/42 通过。覆盖：分类/平台/日聚合、月度汇总、预算状态（未超支/超支/零预算/月份不匹配）、月报/趋势/环比（含零分母）、洞察四规则（高占比/超支/接近上限/环比/储蓄率/空洞察）。

**构建链**：`npm run type-check`（vue-tsc）0 错误；`npm run build` 通过（PWA precache 57 项）；`npm run verify:tools` 校验 12 个工具 + 示例提问回归，新增口语提问「微信支付宝花的钱太散，想记个家庭账本看看钱花哪了」**第 1 名命中** household-finance。

**浏览器全流程（多场景多边界）**：
- 搜索命中 → 进入工具 → 记账 2 笔（含备注/标签）→ 看板 KPI/环形图/平台分布 → 预算设置保存 → 进度条 26% → 调低预算触发**超支 133% 红色预警** → 报表未订阅锁定 → 升级 Pro 解锁（KPI/分类占比/日趋势/12 月趋势）→ 洞察触发「餐饮占比偏高」「总预算已超支」→ 明文导出 JSON 结构正确 → 加密导出 `.enc.txt`（base64 salt|iv|cipher 结构校验通过）→ 加密导入恢复（账目 2/分类 10/预算 1）→ 刷新数据持久化 → PWA manifest+SW 正常 → 存量工具 json-formatter 回归正常 → 浏览页 12 个工具、指导页正常。
- 变量覆盖：金额（0/负/非法拦截、小数、大额）、收支类型、分类（内置/自定义添加/删除）、平台 6 种、日期、备注、标签、预算（未设/正常/超支）、加密口令（有/无）、导入（明文/加密/错误格式）。

**全业务场景验证结论：无阻塞**。

## 可复用经验

1. **原生 SVG 图表零依赖方案**：环形图用 `stroke-dasharray`/`dashoffset`，折线/柱状用归一化坐标生成——小工具场景可完全替代图表库，chunk 极小。
2. **IndexedDB 通用封装**：`openDB 单例 + request/transaction 包装 + getAll/put/remove/clearStore + 按日期索引查询` 模式已抽象沉淀至 `reusable-module/indexeddb-kv`（含 `BackupPayload` 校验思路），后续本地存储类工具可直接引用。
3. **金额整数分存储**：所有金额以分为单位计算，展示层再换算，杜绝浮点误差。
4. **业务纯函数化**：聚合/预算/报表/洞察全部纯函数 + 单测，UI 只做绑定与渲染，问题定位快、可回归。
5. **分类 id 与显示名分离时的映射层**：跨模块（图例/洞察/预算标签）统一走 `nameOf` 映射，避免裸 id 泄漏到界面。
