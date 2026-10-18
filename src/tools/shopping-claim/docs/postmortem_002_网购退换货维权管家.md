# 技术沉淀：网购三包·退换货维权管家

- 对应 dev：dev_002_网购退换货维权管家.md
- 日期：2026-10-18
- 档位：**M**（多场景链路：案件 / IndexedDB / 文件压缩 / 多种导出，但无 GPU、无大模型、无 PDF）

## 技术选型与理由

- **Vue 3 + TypeScript + Vite**，与方子主栈一致，工具通过 `import.meta.glob('src/tools/*/manifest.ts')` 自动发现，新增目录即注册，零路由改动。
- **确定性规则引擎**（`lib/deadline-engine.ts` 纯函数）：日期 + 品类 → 窗口，无大模型、无网络依赖，离线可算、可单测、规则版本化（`lib/rules-cn.ts`，`RULE_VERSION=cn-2026-10-18`）。
- **IndexedDB 自包含数据层**（`lib/store.ts`，库 `fangzi-shopping-claim` v1，stores `cases`/`evidence`，evidence 以 caseId 建索引、Blob 同表存），沿用 pet-health 范式。
- **图片压缩复用 `reusable-module/image-redraw`**（Canvas 重绘，长边 1600、JPEG q0.72、自动去 EXIF），不重复造轮子。
- **ZIP 导出用 `fflate@^0.8.3`（MIT，可商用）**，`zipSync(...,{level:6})`，无新增依赖、无 NC 资源。
- **提醒**：应用内倒计时为主 + 可选 Notification + 导出 `.ics`（VALUE=DATE 全天事件 + VALARM），如实说明移动后台通知不可靠。
- 计费接入统一 `useToolBilling('shopping-claim')`，freemium：features `basic/multi/letters/export`，主方案买断 990 分（¥9.90），另配月 290 / 年 2990 订阅位。

## 关键实现

- `computeWindows(case, today)`：输出 `[{key,label,start,end,daysLeft,state,action,source,note}]`，覆盖 7 天无理由（定作例外 actionable→na）、三包 15 日换货（仅 triplePack15 品类）、保修（`addMonths` 处理跨月/闰年）、价保（可编辑天数，0 不生成）；排序临期优先。质量问题在各窗口 action 中明确「不受 7 日限制」。
- 证据：`序号_类型_时间戳.jpg`（`evidenceFileName`），案件内 seq 连续，清单含录入时刻与原文件名，ZIP 内含 `证据清单.txt`（商品/时效/逐项证据/规则版本/免责）。
- 文书：5 情形 × 3 类型模板拼装，占位以「（未填）」兜底，`hasUnfilledPlaceholder` 自检；12315 文本附「自述草稿、不构成法律意见」。
- 状态机：`case-state.ts` 五状态可前进/回退并追加日志；结果金额整数分。
- 移动端原生体验：顶部吸顶 `.seg` 五段栏（**不做 fixed 底栏**，避免与外壳底部主导航重叠），安全区由外壳统一留白。

## 踩坑记录（本轮 E2E 实际拦住并修复的 3 个 bug）

1. **列表/表单 v-if 分支优先级**：列表 `v-if="view==='board'"` 先命中，`v-else-if="editing"` 的新建表单永不渲染（点击新建无反应）。改为列表 `v-if="view==='board' && !editing"`，表单分支独立 `v-else-if="editing"` 优先于详情。
2. **`type=number` 的 v-model 致 `.trim()` 崩溃**：输入金额后 `form.amountText` 可能是 number/null，`saveCase` 调 `.trim()` 抛 `amountText.trim is not a function`，保存静默失败（与 006 同类坑）。统一 `String(form.amountText ?? '').trim()` 归一化后再交 `yuanToCents`。
3. **reactive Proxy 无法结构化克隆进 IndexedDB**：`moveStatus` 产出的案件含嵌套响应式 logs，`IDBObjectStore.put` 报 `could not be cloned`，表现为状态推进点了没反应、Promise 无 resolve。修复：在数据层 `put` 前做深度 `toRaw`（`toPlain`，递归数组/普通对象，原样保留 Blob/Date/ArrayBuffer/TypedArray）。这是「向 IDB 写 Vue 响应式对象」的通用坑，建议后续沉淀进 reusable-module。

## 验证覆盖

**档位 M。质量门全绿**：`vue-tsc --noEmit` 0 错；全量单测 **252 通过 / 0 失败**（本工具新增 16 个：日期跨月闰年、金额整数分、各窗口状态、定作例外、三包品类、质量通道、窗口排序、状态机进退、5×3 文书无占位、ics、证据文件名、六品类不抛错）；`npm run build` 成功；`npm run verify:tools` **校验工具数 24** 全过。

**三视口 E2E**（`scripts/e2e-shopping-claim-20261018.mjs`，Playwright/Chromium，abort sw）：
- 手机 375（重点）：空态→建案→时效数值断言（无理由/15 日已过、保修剩 348、价保剩 13、含消法依据）→真实 PNG 上传证据（编号 #01、文件名 `01_order_…`、尺寸 800×600）→生成 12315 文本（含商品/订单/投诉对象/免责、无占位）→ZIP 下载（`维权证据包_测试变频空调_2026-10-18.zip`）→状态推进到「② 与商家协商」→规则页含拆封/免责→免费层第 3 案件弹升级门。
- 平板 834 / PC 1280：建案、证据上传全流程。
- **零横向溢出**：`scrollWidth-clientWidth<=2`，6 个检查点（mobile deadline/evidence/letters/progress/free、tablet、pc）全部 ok。

**截图有效性（真实构建后界面，非 0 字节、可打开、内容一致）**：

| 文件 | 像素 | 大小 | 内容 | 结论 |
| --- | --- | --- | --- | --- |
| shot-01-mobile-deadline.png | 375×1481 | 141 KB | 手机时效看板 | 通过 |
| shot-02-mobile-evidence.png | 375×1152 | 90 KB | 证据柜含 #01 | 通过 |
| shot-03-mobile-letters.png | 375×1404 | 120 KB | 12315 文书 | 通过 |
| shot-04-mobile-progress.png | 375×1249 | 82 KB | 进度状态机 | 通过 |
| shot-05-pc.png | 1280×1030 | 103 KB | PC 自适应 | 通过 |
| shot-05-tablet.png | 834×1112 | 99 KB | 平板自适应 | 通过 |

**EdgeOne Pages 免费版限额核查**：dist 总 **131 MB（<5 GiB）**、文件 **125（<20000）**、最大单文件 **22.9 MiB（bge 模型，<25 MiB）**；本工具零大资产，不新增超限文件。

**全业务链路无阻塞**：建案→时效→取证→文书→证据包→进度→规则，专业版与免费层两态均验证通过。

## 可复用经验

- **IDB 写入前深度 toRaw**：任何含 Vue reactive/ref 的对象（尤其嵌套数组）写入 IndexedDB 前必须解除代理且保留 Blob/Date，建议上移为 `reusable-module` 的 `idb-put-raw` 工具。
- **数字输入统一 String 归一**：`type=number` 的 v-model 类型不稳定，涉及 `.trim()`/解析前先 `String(x ?? '')`。
- **v-if/else-if 与独立编辑态冲突**：列表与编辑表单用独立布尔态时，编辑态条件要前置，避免被列表分支吞掉。
- **确定性法规引擎 + 版本号 + 来源 + 免责**：时效类工具不依赖模型即可交付核心价值，规则可维护、可测试、合规边界清晰。
- **工具内不做 fixed 底栏**：方子外壳在 ≤820px 已提供 fixed 底部主导航并留白，工具级导航用顶部吸顶分段栏即可。
