# 技术沉淀：备考错题调度（exam-review-scheduler）

- 对应 dev：`dev_003_备考错题调度.md`
- 日期：2026-10-20
- 档位：M（标准）

## 技术选型与理由

- **框架**：Vue 3.5 + Vite 8 + TS + Pinia + vue-router + vite-plugin-pwa（workbox），与方子全仓一致，零新增运行时 npm 依赖。
- **数据层**：复用 `reusable-module/indexeddb-kv`，独立库 `fangzi-exam-review` v1，四表 projects/questions/reviews/mockExams。
- **调度引擎**：SM-2 变体纯函数 `lib/scheduler.ts`，基准间隔 [1,2,4,7,15]，grade 5/3/1，reps≥5 后 `interval × ease × 1.3` 滚动，ease 下限 1.3；日期统一本地日历日 YYYY-MM-DD + 整数天差，避免时区漂移。
- **图表**：手写内联 SVG 模考曲线 + 目标分虚线，不引入图表库。
- **提醒**：复用 home-medicine 的 .ics 手写思路 + 浏览器 Notification 角标。
- **照片**：Canvas 重绘压缩（长边 1600、JPEG 0.72、去 EXIF）。
- **授权核查**：全部浏览器原生 API 与自研纯函数，无第三方模型权重、无 NC 授权资源、无侵权 IP。OCR（D15）未启用。

## 关键实现

- **纯逻辑下沉 `lib/`**：models / scheduler / queue / weakness / curve / decision / notify / store / photos / ocr 共 10 个模块，组件 `index.vue` 只渲染，便于 node:test 直接单测。
- **三级标签树**：科目→章节→考点嵌套数组，`ensurePoint` 在提交时自动补全分支，必选末级考点才放行。
- **计费门**：`useToolBilling('exam-review-scheduler')`，features = basic(free) / multi-project / unlimited-questions / reports；免费层 1 项目 + 50 题，买断 ¥8.90（890 分）。弱项热力图与模考曲线留在免费层，因为 E2E 要求买断前即可看到红块与曲线。
- **今日队列**：`queue.ts` 按 `isTodayOrBefore(nextReview)` 过滤、逾期天数 desc 排序。
- **弱项聚合**：`weakness.ts` 按考点聚合 review 记录的 hits/wrong，正确率分档红<50%/黄50–70%/绿>70%。
- **导入去重**：`mergeImport` 按 id 已存在则跳过，不覆盖本机更新。

## 踩坑记录

1. **structuredClone(reactive 代理) → DataCloneError（最致命）**：`rate()` 里 `{ ...q, ... }` 展开 Vue reactive 题目对象后，`pointPath` 仍是嵌套 reactive 代理，`toRaw` 只解顶层，IDB `put` 的 structuredClone 直接抛 `DataCloneError: #<Object> could not be cloned`，导致自评后调度状态**静默写库失败**（不报错到 UI）。修复：`pointPath: { ...toRaw(raw.pointPath) }` 单独拍平嵌套对象。**教训：方子内 reactive 对象写 IndexedDB 必须对所有嵌套对象逐一 toRaw/拍平，不能只顶层 toRaw。**
2. **ensurePoint structuredClone(tags) → DataCloneError**：标签树也是 reactive，改用 `JSON.parse(JSON.stringify(tags))` 深拷贝。
3. **复用 image-redraw 触发跨工具 vue-tsc 偶发报错**：本工具 `photos.ts` import `reusable-module/image-redraw` 时，会触发另一个无关工具 photo-privacy 的 canvas getContext 联合重载 TS 报错（基线移走本工具即 0 错）。**有意偏差**：改为内联 Canvas 压缩（行为与 image-redraw 一致），不引入该 import。
4. **移动端模考页横向溢出 106px**：`.card` 内 input 未设 `box-sizing:border-box;width:100%`，默认 input 宽度溢出窄列。补 `.page .card input{width:100%;box-sizing:border-box}` 解决。
5. **E2E 注入 IDB 后 Vue ref 不刷新**：直接 page.evaluate 写 IndexedDB 后，组件内 `questions/reviews` ref 仍是旧值，需 `page.reload()` 让 onMounted 重新加载，断言才生效。

## 验证覆盖

- **档位**：M。
- **单测**：`test/exam-review-scheduler.test.ts` 新增 16 例（间隔递进/ease 上下限/grade<3 重置/日期不漂/queue 排序/weakness 阈值/decision 文案/导入去重等）；`npm test` 全量 **362 pass / 0 fail**。
- **类型**：`npx vue-tsc --noEmit` **0 错**。
- **工具回归**：`npm run verify:tools` **= 28**（含新增浮动提问 expectToolId='exam-review-scheduler'）。
- **构建**：`npm run build` 成功，PWA precache 114 entries。
- **三视口 E2E**（`scripts/e2e-exam-review-scheduler-20261020.mjs`，对 preview 构建产物）：
  - PC 1280×860 / 平板 834×1112 / 手机 375×812，全流程（建项目→录 2 题含标签与照片→IDB 注入到期→队列出现 2 道→已忘 reps 归零间隔 1 天→记得递进 reps=5 interval=60→弱项红块 1 个→2 次模考出 SVG 曲线与目标虚线→决策看板文案+免责→免费第 2 项目弹门→灌题到 50 后第 51 题弹门）全绿；三视口**零横向溢出**、触控目标 ≥44px。
- **截图有效性**：

  | 文件 | 像素 | 大小 | 通过 |
  |---|---|---|---|
  | shot-04-pc.png | 1280×860 | 61 KB | ✅ |
  | shot-04-tablet.png | 834×1112 | 60 KB | ✅ |
  | shot-05-mobile-exam.png | 375×1391 | 101 KB | ✅ |
  | shot-06-mobile-weak.png | 375×812 | 50 KB | ✅ |
  | shot-07-mobile-book.png | 375×887 | 56 KB | ✅ |

- **EdgeOne Pages 免费版限额**（build 后 dist 实测）：
  - 存储总量 **131 MiB**（限额 5 GiB）✅
  - 文件总数 **144**（限额 20000）✅
  - 单文件最大 **22.9 MiB**（限额 25 MiB）✅
  - 本工具仅新增约 30 KB JS + 4 KB CSS、零大资产。

## 可复用经验

- **reactive→IDB 写库模板**：方子内任何把 Vue reactive 对象写入 IndexedDB 的工具，都应对嵌套对象逐一 `toRaw` 或用受控的浅拷贝 + 嵌套拍平，避免 structuredClone 静默失败。此经验可沉淀为 `reusable-module/indexeddb-kv` 的写库前深拍平 helper。
- **纯逻辑 lib/ + node:test**：M 档工具把调度/聚合/日期等纯函数下沉 lib/，组件只渲染，单测无需起浏览器即可覆盖核心算法，E2E 只验证集成与视图。
- **IDB 注入测试数据后必 reload**：无头 E2E 直接写库不会触发组件 ref 更新，需 reload 或手动刷新 ref。
- **OCR 不默认开启**：本次无人值守交付，OCR 无法在无头环境可靠验证，故不默认开启、不在计费里卖未验证能力，仅留 `experimental` 占位与手动录入，如实列为后续项。
