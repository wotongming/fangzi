# Ops · PDF 真脱敏（pdf-redact）

## 发布与缓存
- 构建：`npm run build`（产物 dist 133M / 163 文件）。
- pdf worker：`pdf.worker.min-*.mjs`（1.37MB）随 Vite `?url` 自托管到 dist/assets；`pdf.worker.min-*.js`（329KB UMD）为既有其他工具复用。
- SW 预缓存：`vite.config.ts` globPatterns 已含 `mjs`，rebuild 后 `dist/sw.js` 已 grep 命中 `/assets/pdf.worker.min-*.mjs`（=1），断网可加载。

## EdgeOne 限额（发布前/后复核）
- 发布前基线（合成宇宙重平衡后）：dist ~133M。
- 本项后：dist ~133M，新增 pdf.worker.mjs 1.37MB + pdf-lib/pdfjs chunk（pdfjs-dist 本就在依赖内，chunk 已计入）。
- 最大单文件：ort-wasm 13.6MiB < 25MiB；远低于 5GiB / 20000 文件。

## 监控
- 纯本地工具，无后端、无外部请求（E2E 已断言三视口+离线无外部 URL）。
- 报错：pageerror 以 `SW_NOISE`（SW abort）过滤；真删/元数据断言在 E2E 内固化。

## 回滚
纯新增目录 + package.json 两条依赖 + vite.config globPatterns 增 mjs。回滚即 revert 本 commit；不影响既有工具路由与 SW 主策略。
