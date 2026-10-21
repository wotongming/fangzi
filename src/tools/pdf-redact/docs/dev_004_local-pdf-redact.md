# Dev · PDF 真脱敏（pdf-redact）

## 目录结构
- `src/tools/pdf-redact/manifest.ts` —— buyout ¥129，features basic/redact-pro。
- `src/tools/pdf-redact/index.vue` —— UI：文件载入→canvas 预览→pointer 拖拽框选→masks(Map<pageIdx,Rect[]>)→导出下载 `-redacted.pdf`；挂 `window.__pdfRedact` 测试接缝。
- `src/tools/pdf-redact/lib/geometry.ts` —— 纯函数：rectsOverlap / clampRectToPage / rectHitsItem / normalizeMasks / scrubMetadata / PRIVATE_META_FIELDS。
- `src/tools/pdf-redact/lib/engine.ts` —— pdfjs+pdf-lib 引擎：inspectPdf / buildRedactedPdf / pageText / readMeta。

## 引擎要点
- worker 自托管：`import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'`。
- buildRedactedPdf(buf, masksByPage)：无遮页 copyPages 原样；含遮页 pdf.js ~150dpi render → canvas 盖黑块 → JPEG 嵌回。
- 坐标：PDF 左下原点 → 画布左上，cy=(pageH-(y+h))*scale。
- 元数据清洗：setTitle/setAuthor/setSubject/setCreator/setProducer('')、setKeywords([])、setCreationDate/setModificationDate(new Date(0))。

## 踩坑
- pdf-lib `setKeywords` 收 string[]（非 string）；无 `getInfo()`，读元数据用 getTitle()/getAuthor()…；setCreationDate 需要 Date；index.vue draft 须用 ref 否则 vue-tsc 模板收窄为 never。
- vite.config globPatterns 需含 mjs 才能预缓存 pdf.worker.mjs。

## 本地跑
```
npm run build && npx vite preview --port 4173 --host 127.0.0.1
node scripts/e2e-pdf-redact-20261021.mjs
```
