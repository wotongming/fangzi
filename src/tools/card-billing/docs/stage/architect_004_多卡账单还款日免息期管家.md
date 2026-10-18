# 架构方案：多卡账单日·还款日免息期管家

- 对应 innovator：innovator_004_多卡账单还款日免息期管家.md
- 对应 pm：pm_004_多卡账单还款日免息期管家.md（结论：可集成·新增）
- 设计日期：2026-10-19
- 档位：M（多卡日期引擎/IndexedDB/提醒/测算，无 GPU 无大模型）

## 需求回顾与设计依据
多卡用户账单日/还款日分散易漏还、不知何时刷哪张免息最长、年费刷免易忘。**零授权、不录卡号密码、不碰资金**，纯本地中立测算与提醒。

## 技术方案
### 系统架构
`src/tools/card-billing/`：index.vue（今日/本月看板、卡片、选卡器、年费、测算视图，顶部吸顶 `.seg`）→ `lib/` 纯逻辑 → IndexedDB `fangzi-card-billing` v1（cards/payments/feeYears）。
### 模块设计
- `models.ts`：Card（卡名、尾号后4位可选、账单日 dayOfMonth、还款规则：固定还款日 dayOfMonth 或 `账单日后 offsetDays`、额度、年费规则）、PaymentRecord（已还标记）、FeeYear（年费年度起止、需刷笔数/金额、已刷统计）。
- `cycle.ts`（纯函数，核心）：给定 today 与卡规则，求当前/下一账单周期：本期账单日、还款日、最长/最短免息天数；`interestFreeDays(card, spendDate, today)` 计算某消费日该笔消费到其所在周期还款日的免息天数（跨月/大小月/跨年）；处理账单日当天 0 点归属（规则可配，默认"账单日消费计入下期"）。
- `timeline.ts`：聚合所有卡在某月份的账单日/还款日事件，倒计时、紧急度排序。
- `annual-fee.ts`：按年费年度统计已刷笔数/金额，算还差几笔/金额，临期预警。
- `interest.ts`：全额/最低还款/分期的利息演示公式（日息万分之五为常见值，可编辑，标注以银行账单为准）。
- `store.ts`：IndexedDB + 深度 toRaw（沿用 shopping-claim 修复范式）；`notify.ts`：多级还款/年费 .ics+Notification。
- `manifest.ts`：id `card-billing`、category life、freemium。
### 关键技术路线
确定性日期引擎，纯函数覆盖大量边界并单测；不录敏感卡号（仅卡名/尾号），不代还。
### 盈利模式
freemium：≤2 张卡+基础还款提醒免费；买断/年度解锁不限卡、免息期选卡器、年费刷免、利息测算、多年日历。建议主方案买断（取 PM），订阅位保留。

## 与 fangzi 现有代码的集成方式
新增 `src/tools/card-billing/` 自动注册；遵循 ToolManifest；复用 indexeddb-kv、.ics/通知范式；与 subscription-audit 数据完全独立、不互改；零核心/SW/manifest/路由改动。

## 软硬件/依赖选型
Vue3+TS+Vite（MIT 生态）；IndexedDB、Notification、原生 Blob/.ics；零新增 npm 依赖；无 NC 资源；EdgeOne Pages 免费。

## 开发方案
1 人；里程碑：①cycle 日期引擎+单测 ②卡片 CRUD 与本月时间线/提醒 ③免息期选卡器 ④年费刷免+利息测算 ⑤多端 E2E/文档/推送。

## 测试方案
单测重点：大小月/跨年/2月、账单日固定 vs offset、还款日顺延（遇周末节假日不顺延——信用卡一般不顺延，按规则可配）、免息天数边界、年费年度滚动；vue-tsc 0 错；全量 npm test；三视口 Playwright（手机375重点/834/1280）：建卡→本月还款日倒计时→选卡器给定日期推荐最长免息→年费还差几笔→已还流转→免费层第 3 卡升级门；零横向溢出；verify:tools。

## 实施部署方案
随 main 推送自动部署 EdgeOne；日期规则集中可配置；回滚=回退增量目录提交。

## 风险与反思
合规：金融数据最小化（不录卡号密码/不碰钱/不代查代还），所有金额标注"以银行账单为准"。价值直接（免罚息、用免息、免年费）。避免复杂：首屏只看"最近要还/今天刷哪张"。
