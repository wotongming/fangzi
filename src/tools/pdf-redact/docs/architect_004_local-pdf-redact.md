# Architect · PDF 真脱敏（pdf-redact）

> 档位 M。纯前端、零后端、文件不出设备。

## 目标
发合同/简历/账单前，本地框选敏感区域，做到**真删文字层**（导出后复制/搜索不到原文），并清空作者/标题等元数据。用户痛点是 Mac 预览/系统自带"涂黑"只是视觉遮罩，文字层仍在，存在真实泄露。

## 技术路线与两条删除路线取舍
- **路线 A：内容流算子级精准删除**——用 pdf.js `getTextContent` 定位文字项 bbox，写出时移除落在遮罩矩形内的文本绘制算子，保留矢量与未遮文字。体积小、未遮页可访问性保留。但对子集字体/多 content stream/BT·ET bbox 换算不稳，M 档预算内无法保证稳定可靠。
- **路线 B：含遮页整页光栅化（本版采用，混合）**——无遮页用 pdf-lib `copyPages` 原样保留矢量文字可搜索；**含遮页**用 pdf.js 在 ~150dpi 渲染成位图、画布上盖不透明黑块、整页作为 JPEG 嵌回新 PDF。代价：含遮页文字层随光栅化彻底消失（=真删），该页变图不可选中/不可检索。UI 与文档已明示此代价；扫描件（本就无文字层）同走像素遮罩，无额外损失。

结论：A 在 M 预算内不稳，选 B 保证"真删+未遮可读"可验证交付。后续若需保留含遮页文字检索性，可在路线成熟后增量升级为 A。

## 依赖（版本+许可+CVE）
- `pdfjs-dist@^4.10.38`（Apache-2.0）——已在仓，未动版本；worker 自托管（`?url` 打包），无外链 CDN。
- `pdf-lib@^1.17.1`（MIT）——本版新增，已 `npm install --save`。
- 两者均可商用、无 Copyleft/NC。本编写时无公开高危 CVE。

## 集成点
- 工具自动注册：`src/core/registry.ts` 用 `import.meta.glob('../tools/*/manifest.ts')` 自动发现，零路由改动；verify:tools 由 30→31。
- 计费：复用 `useToolBilling('pdf-redact')`，mode=buyout ¥129（priceCents 12900），`canUse('redact-pro')`/`billing.buy()`，不重写计费框架。
- SW：worker `.mjs` 已在 `vite.config.ts` globPatterns 增列 `mjs`，rebuild 后 sw.js 预缓存含 pdf.worker.mjs，断网可跑。

## EdgeOne 体积
dist 133M/163 文件；新增最大静态 pdf.worker.mjs 1.37MB；全仓最大单文件 ort-wasm 13.6MiB<25MiB。远低于 5GiB/20000 文件/25MiB 单文件限额。

## 回归验证
旧工具不受影响：纯新增目录、未改既有 SW 缓存策略/manifest/icons；npm test 452 绿、verify=31、vue-tsc 0、build 成功、三视口零横向溢出。
