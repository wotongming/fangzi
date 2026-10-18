# 技术沉淀：宠物健康档案与就医管家

- 对应 dev：dev_006_宠物健康档案与就医管家.md
- 日期：2026-10-18
- 分档：**M（标准档）**——多场景链路、IndexedDB/文件处理/多种输入输出，但无 GPU / 无大模型 / 无实时音视频。

## 技术选型与理由

- **框架**：Vue 3 + TypeScript + Vite，完全复用方子（fangzi）现有技术栈与 `ToolManifest` 自动发现机制（`import.meta.glob` 扫描 `src/tools/*/manifest.ts`），新建独立目录即注册，**不改路由、不改外壳**。
- **本地存储**：独立 IndexedDB 库 `fangzi-pet-health`（version 1），stores：`pets / events / photos / plans`；`events` 建 `petId,date` 索引，`photos / plans` 建 `petId` 索引，支撑级联删除与时间线查询。参照 subscription-audit / household-finance 的独立封装，不引入任何后端与第三方数据库。
- **照片处理**：复用仓库通用模块 `reusable-module/image-redraw`（Canvas 重绘），输出 JPEG、长边 1600、quality 0.72、**去 EXIF**，兼顾省空间与隐私。
- **日历/通知**：`Notification` API + 标准 `.ics` 文件下载（参照 subscription-audit 的 remind 范式）作为移动后台通知不可靠的兜底。
- **档案包加密**：浏览器原生 **Web Crypto**（AES-GCM + PBKDF2，迭代 120000 次），无第三方加密库；同时提供明文包。
- **图表**：体重曲线用**手写内联 SVG**（不引入图表库），零额外依赖、包体最小、完全可控。
- **计费**：接入统一计费框架 `useToolBilling('pet-health')`，主变现方案 **freemium + 买断 ¥12.90**，并配置订阅（月 ¥3.9 / 年 ¥29.9）；5 个 feature key（`basic` 免费，`multi / analysis / summary / export` 付费）。订阅/用量包等模式由框架「配置即可开启」，不重复造轮子。
- **SEO/AEO/GEO**：通过 `reusable-module/use-seo` 注入标题、描述、关键词与语义结构。
- **依赖与合规**：本工具**零新增 npm 依赖**，全部依赖均为方子既有且商用友好；照片/加密/日历均用浏览器原生能力，不存在 NC（非商用）授权资源。无已知漏洞新增面。

## 关键实现

- **纯逻辑下沉到 `lib/`，UI 只负责编排**：`schedule / timeline / cost / summary / models` 全部是无 DOM 纯函数，可被 Node 单测直接覆盖。
  - `schedule.ts`：下次到期日**只按「同一 `planKey` 的最近记录」或「startDate + 周期」顺延**——未关联计划的记录不参与顺延，避免误顺延；逾期/今天/剩余天数一次算出，`allDues` 聚合多宠并按到期升序。
  - `cost.ts`：年度花费按类型汇总且强制「各类之和 = 总额」守恒；药价经 `normalizeMedName`（去空格/括号/规格噪声）归一后聚合，标出最大自录差额。
  - `timeline.ts`：时间线新→旧、体重序列旧→新、相邻体重差（kg 与 %）。
  - `summary.ts`：拼装宠物信息/过敏/既往/时间线/免责声明，空范围有兜底，不编造。
- **金额用整数「分」**：`yuanToCents / fmtYuan` 全链路整数，避免浮点误差。
- **多宠默认照护计划级联**：`createPetWithPlans` 建宠物时按模板写入启用计划；`deletePetCascade` 级联清理事件/计划/照片。
- **医疗合规内嵌**：空态、记录页、就医助手、摘要、我的页多处固定「不诊断、不荐药、不替代兽医、药价为自录、节奏遵兽医」文案，并纳入 E2E 断言。
- **移动端布局**：工具内导航为「宠物切换 + 吸顶分段栏 `.seg`」，不做固定底栏；桌面端（>820px）工具头改为静态，避免与方子外壳吸顶品牌栏双层重叠。

## 踩坑记录

1. **工具固定底栏与方子外壳底部主导航重叠（真实 UI bug）**
   - 现象：手机视口（≤820px）下，方子 `App.vue` 外壳自带 `position:fixed` 底部主导航（开方子/全部工具/使用帮助/设置），工具内原先又自建了一个 fixed `.tabbar`，两者完全重叠；Playwright 点击工具「记一笔」时被外壳 `<a class="tab">` 拦截，58 次重试超时。
   - 根因：工具不应在移动端再放一条与外壳同位置的固定底栏，且外壳已为内容预留 `padding-bottom: calc(var(--tab-h)+var(--sab)+8px)`。
   - 解决：删除工具内 fixed 底栏，把 5 个页签改为顶部**吸顶分段栏**（与宠物切换条合在 `.apphead`），桌面端工具头静态化；E2E 选择器从 `.tabbar button` 同步改为 `.seg button`。改后三视口点击全部可达、零遮挡。

2. **`<input type="number" v-model>` 自动转型导致带金额记录整单保存失败（真实运行时 bug）**
   - 现象：记「就诊 ¥360」点保存，时间线无新增、就医页费用合计读不到，控制台报 `form.amount.trim is not a function`；体重记录（无金额）正常。
   - 根因：Vue 3 对 `type="number"` 的 `v-model` 会把值自动转成 `number`，而代码按字符串调用 `.trim()` 抛异常，`saveEvent` 中断。`vue-tsc` 按模板里 `form.amount` 的字符串类型推断，**拦不住编译器运行时的自动转型**，所以类型门全绿但功能失败。
   - 解决：保存前用 `String(form.amount ?? '')` 归一后再 `yuanToCents` 与空串判断。
   - 教训：对 number 输入框，凡要做字符串操作（trim/正则/空判）必须先 `String()` 归一；这类「类型检查通过但运行时转型」问题只能靠浏览器 E2E 兜住，不能只信 tsc。

## 验证覆盖

- **类型门**：`npx vue-tsc --noEmit` → 0 error（先后修复 weightChange 未用、currentPet 可能 null、cost.ts 误用 dayMs 三处）。
- **单元测试**：新增 `test/pet-health.test.ts` 9 条纯函数用例（周期顺延/逾期/停用/多宠聚合、时间线排序、体重差、花费守恒、药价归一聚合、摘要免责与空兜底、dayMs 当地零点），**9/9 通过**；全量 `npm test` **236/236 通过**，无回归。
- **工具清单回归**：`npm run verify:tools` → 校验工具数 **23**，全部 manifest / 插件包 / 示例提问回归通过。
- **三视口 E2E**：`scripts/e2e-pet-health-20261018.mjs`（Chromium，abort SW 缓存）：
  - 手机 375×812：空态建档→默认照护待办→2 笔体重+1 笔就诊→时间线 3 条→体重曲线 SVG→费用合计 ¥360.00→病情摘要含宠物名与免责→.ics 下载（`fangzi-pet-care.ics`）→免费层第二只宠物弹专业版门；
  - 平板 834×1112 / PC 1280×900：建档、记一笔布局正常；
  - **全部页面 `scrollWidth-clientWidth <= 2`，零横向溢出、零遮挡**；已解锁专业版不出现升级卡。
- **医疗合规断言**：摘要必含「不能替代兽医诊断」、空态/就医页免责、药价「本人实付、不是市场价」均在 E2E 覆盖。
- **EdgeOne Pages 免费版限额核查**（全量构建产物，含其它工具模型）：总体积 **131 MiB < 5 GiB**；文件数 **123 < 20000**；最大单文件 22.9 MiB（既有 bge 模型）< 25 MiB；本工具构建确认的 ort wasm 最大 13.6 MiB；**pet-health 本身零大资产**（手写 SVG、无新增依赖、照片运行时本地生成）。
- **生产构建**：`npm run build` 成功（vue-tsc + vite build + postbuild 清 wasm），preview（127.0.0.1:4173）实测全流程无阻塞。

### guide 截图有效性核验（均为构建后真实运行截图）

| 文件名 | 像素尺寸 | 大小 | 是否通过 |
| --- | --- | --- | --- |
| shot-01-mobile-board.png | 375×812 | 75,590 B | ✅ 待办/宠物切换/分段栏/底部主导航无重叠 |
| shot-02-mobile-timeline.png | 375×812 | 57,988 B | ✅ 时间线列表 |
| shot-04-mobile-care.png | 375×1336（fullPage） | 95,327 B | ✅ 摘要/体重曲线/费用/药价/免责 |
| shot-03-tablet.png | 834×1168（fullPage） | 90,117 B | ✅ 平板自适应 |
| shot-03-pc.png | 1280×1168（fullPage） | 94,402 B | ✅ PC 自适应 |

均为非 0 字节、PNG 格式正确、可正常打开，内容与 guide 引用描述一致。

## 可复用经验

- **工具内不要再造移动端固定底栏**：方子外壳在 ≤820px 已统一提供固定底部主导航并预留安全区空间；工具级页签优先用**吸顶分段栏**，桌面端再按断点切换定位，可彻底避免双层 fixed 冲突。
- **number 输入框字符串操作前先 `String()` 归一**，并对「金额/数字录入→保存」补一条真实浏览器 E2E，专门拦 tsc 拦不住的 v-model 运行时转型。
- **照护/续费类周期顺延只认显式关联键（planKey）**，可避免无关记录把下次到期日算错；纯函数化后单测极易覆盖。
- **金额整数分、照片 Canvas 压缩去 EXIF、Web Crypto 本地加密包、.ics 兜底通知、手写 SVG 趋势图**这一组「零依赖、纯前端、隐私优先」组合，可直接复用到后续生活/健康/记账类工具。
- 业务逻辑（顺延/汇总/摘要/归一）全部下沉 `lib/` 纯函数 + Node 单测，把易出错的规则在毫秒级测掉，浏览器 E2E 只验交互与布局，调试更快、回归更稳。
