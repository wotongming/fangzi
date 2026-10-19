# 技术沉淀：个税专项附加扣除汇算助手

- 对应 dev：dev_001_个税专项附加扣除汇算助手.md
- 日期：2026-10-19
- 工具 id / 目录：`tax-deduction` / `src/tools/tax-deduction/`
- 档位：**M（标准档）**——多场景链路（录入→预检→分摊→估算→资料/提醒）、IndexedDB 持久化、文件导出、多输入形态；无 GPU / 无大模型。

## 技术选型与理由

- **Vue 3 + TypeScript + Vite**：与 fangzi 主栈一致，工具经 `manifest.ts` 被 `src/core/registry.ts` 自动发现，`verify:tools` 动态遍历目录，新增后工具数 25→26，无需改注册表。
- **零新增 npm 依赖**：金额用整数分纯函数计算；加密用浏览器原生 **Web Crypto（PBKDF2 100000 次 + AES-GCM 256）**；日历用手写 **iCalendar(.ics)**；存储用原生 **IndexedDB**。全部商用友好、无 NC 授权风险，契合零资金与合规约束。
- **计费只接主方案钩子**：freemium（免费 1 项，专业版买断 ¥6.90；订阅月 ¥1.90 / 年 ¥19 备选），复用 `useToolBilling('tax-deduction')` 的 `canUse / priceText / buy('freemium-pro')`，不重复造计费框架。
- **规则集中常量化**：七项额度、起止年份、留存年数全部收敛在 `lib/rules-cn.ts`（`RULE_VERSION='cn-2026-10'`、`RULE_SINCE_YEAR=2023`、`KEEP_YEARS=5`），每年税季只改一处；金额单位统一“整数分”，杜绝浮点误差。

## 关键实现

- **纯逻辑分层（可单测、无 DOM 依赖）**：
  - `models.ts`：类型 + `yuanToCents/yuan/monthlyToAnnual/uid`（0.5 分摊用 `Math.floor(全年/2)` 保证整数）。
  - `deduction.ts`：单条/分项/合计年度扣除额，七项各走独立分支（大病医疗 1.5 万起、8 万封顶据实；租金三档；非独生赡养 1500 封顶）。
  - `validator.ts`：分级 `error/warn/info` 预检，覆盖同子女比例>100%、毕业未终止、学历超 48 月、职业资格重复、房贷/租金互斥、配偶父母、未满 60、非独生超 1500、兄弟姐妹合计、多老人翻倍等高频风险；空清单只给 EMPTY 提示不误报。
  - `split-plan.ts`：可分摊项按**全额**重算后生成 本人100% / 各50% / 配偶100% 三方案，家庭合计恒定，并单列不可分摊固定额；提示“让边际税率高的一方多扣”。
  - `estimate.ts`：综合所得年度七级超额累进表 + 速算扣除数，`estimateSaving` 正确处理**跨档**（扣除把应纳税所得额压入更低档）与压到 0 后不再退税（`saturated`）。
  - `docs.ts / notify.ts / crypto.ts / store.ts`：留存清单（+5 年）、三节点 .ics、口令加密备份、IndexedDB items 表（year/kind 索引，写库前深度 `toRaw` 解 Proxy）。
- **UI（`index.vue`）**：顶部吸顶 `.seg` 六段（总览/扣除项/校验/夫妻方案/估算·资料/说明），表单随项目类型动态显隐；免费 1 项门与专业版升级卡；强免责在总览与说明常驻。遵守“工具内不放 fixed 底栏、toast 用 fixed bottom:5.2rem”的外壳约定。
- **SEO/AEO**：`useSeo` 写入 title / description / keywords / WebApplication，覆盖“个税、专项附加扣除、年度汇算、退税、夫妻分摊、资料留存”等检索词。

## 踩坑记录

1. **TS5 对 `Uint8Array<ArrayBufferLike>` 与 Web Crypto `BufferSource` 不兼容**：`crypto.subtle.deriveKey/encrypt/decrypt` 报“缺 resize/transfer，可能是 SharedArrayBuffer”。对传入的 salt/iv/data 显式断言为 `BufferSource` 后通过（运行时本就是普通 ArrayBuffer）。
2. **E2E 首跑两处“预期值”写错（代码是对的）**：① 夫妻方案按全额（非本人当前份额）重算，两子女 + 房贷家庭合计应为 60000 而非 48000；② 估算输入默认 180000（10% 档），省 12000，要显式填 200000 才能验证跨档省 14000。修正断言/补填输入后通过。这也反向验证了跨档计算正确。
3. **noUncheckedIndexedAccess**：取税率表末档需 `BRACKETS[len-1]!`；顺手删除未使用的 `StoreName` 类型。

## 验证覆盖

- 档位 M 质量门（均在仓库内实跑）：
  - `npx vue-tsc --noEmit`：**通过，0 错误**。
  - `npm test`：全量 **289 通过 / 0 失败**（本工具新增 25 个纯逻辑单测，覆盖七项额度、分摊封顶、互斥、各类校验码、夫妻三方案、跨档/压零退税、资料清单 +5 年）。
  - `npm run build`（vue-tsc + vite build + postbuild 清 wasm）：**成功**。
  - `npm run verify:tools`：工具数 **26**，manifest / 插件包 / 示例提问回归全部通过。
  - Playwright 三视口 E2E（`scripts/e2e-tax-deduction-20261019.mjs`，preview :4173）：**全部通过**，无 pageerror，三视口 `scrollWidth==clientWidth` 零横向溢出。
- 多端多场景（视口 PC 1280×860 / 平板 834×1112 / 手机 375×812）：
  - 免费态：空态→建 1 个子女（合计 24000.00）→第 2 项被升级门 toast 拦截。
  - 专业态：建 4 项（两子女含 50%、房贷、独生赡养）合规 0 风险；加租金触发 `LOAN_RENT_CONFLICT`，删除恢复；夫妻三方案全额合计 60000、各50%=30000；估算 200000 起跨档省 14000；资料清单 3 类；全年合计 84000；说明页含“不代申报/税务机关”免责。
- EdgeOne Pages 免费版限额核查（构建产物实测）：
  - 存储总量 **约 131 MiB < 5 GiB**；文件总数 **129 < 20000**；单文件最大 **约 22.9 MiB（bge 模型 onnx，24010842 字节）< 25 MiB**。本工具 chunk：`tax-deduction-*.js` 约 36 KiB、CSS 约 4.7 KiB，不引入超限资产。**结论：全部在限额内。**
- guide 截图有效性验证（均为生产 build 后 preview 真实截图，非 0 字节、PNG 可正常打开、内容与文案一致）：

| 截图文件 | 像素 | 大小 | 是否通过 |
| --- | --- | --- | --- |
| shot-01-pc-overview.png | 1280×992 | 116293 B | ✅ |
| shot-02-pc-edit-form.png | 1280×877 | 63499 B | ✅ |
| shot-03-pc-check-clean.png | 1280×860 | 62327 B | ✅ |
| shot-04-pc-check-conflict.png | 1280×860 | 63621 B | ✅ |
| shot-05-pc-split.png | 1280×860 | 89886 B | ✅ |
| shot-06-pc-estimate-docs.png | 1280×1148 | 145131 B | ✅ |
| shot-07-mobile-overview.png | 375×990 | 85326 B | ✅ |
| shot-08-tablet-overview.png | 834×1112 | 101762 B | ✅ |

## 可复用经验

- **金额整数分 + 集中规则常量 + 纯函数分层**：凡涉及金额/政策档位的工具，都可沿用 `models(单位换算) → 业务计算 → 校验 → 估算` 的无 DOM 分层，毫秒级单测即可拦住算错，不必靠截图。
- **跨档税额测试范式**：税额断言要同时覆盖“档内=扣除额×边际税率”和“跨档/压到 0”两类，避免用默认输入恰好落在同一档导致漏测。
- **Web Crypto + TS5**：PBKDF2/AES-GCM 入参对 `BufferSource` 做显式断言，可一次性消除 `ArrayBufferLike/SharedArrayBuffer` 类型噪音。
- **freemium 钩子**：免费额度门放在“新增动作”入口（toast 拦截不进表单），专业能力用 `canUse` 分 tab/卡控制，既不破坏免费主流程也不留半成品入口。
