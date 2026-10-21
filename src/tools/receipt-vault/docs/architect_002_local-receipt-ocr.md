# Architect · 小票本 receipt-vault

> 档位 M。纯前端本地 OCR、零后端。

## 目标
拍小票/发票 → 本地 OCR → 抽字段（商家/日期/金额/税额）→ 人工校对 → 按项目挂账 → 导出 CSV 报销报税。隐私合规：图片不上传。

## 技术选型
- **OCR 引擎**：tesseract.js@5.1.1（Apache-2.0），Web Worker 内识别，不阻塞 UI。
- **资源自托管**（禁外链 CDN）：
  - `public/tesseract/worker.min.js`（124KB）
  - `public/tesseract/tesseract-core-simd-lstm.wasm`（2.86MB）+ `.wasm.js` glue（3.94MB）
  - `public/tessdata/chi_sim.traineddata.gz`（20.16MB）+ `eng.traineddata.gz`（10.92MB）
- 配置 `workerPath=/tesseract/...`、`corePath=/tesseract/tesseract-core-simd-lstm.wasm.js`、`langPath=/tessdata`。
- 语言只引 chi_sim+eng，不塞多语。

## 缓存策略
- worker.min.js(124KB)/core glue(3.94MB)<5MB 由 workbox glob 预缓存；core wasm 2.86MB、traineddata gz（10.9/20.2MB）超 5MB 不进预缓存，新增 runtimeCaching 规则 `/tessdata/` 与 `/tesseract/` 走 CacheFirst（fangzi-tesseract 缓存，90 天），首次识别后离线复用。

## 数据
独立 IndexedDB 库 `fz-receipt-vault-v1`（store=receipts），复用 reusable-module/indexeddb-kv；不动任何既有 localStorage/IDB 键。

## EdgeOne
新增 ~34MB（traineddata+wasm）；dist 169M/170 文件；最大单文件 chi_sim.gz 20.2MB<25MiB。

## 去重
image-converter/photo-privacy 无 OCR；home-vault 只归档不抽字段。新增独立工具。
