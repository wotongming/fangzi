# Ops · 小票本 receipt-vault

## 自托管资源
- public/tesseract/：worker.min.js 124KB、tesseract-core-simd-lstm.wasm 2.86MB、.wasm.js 3.94MB。
- public/tessdata/：chi_sim.traineddata.gz 20.16MB、eng.traineddata.gz 10.92MB。
- 均随站发布（public/ 原样拷贝进 dist）。

## SW 缓存
- 预缓存 glob 未变（js/mjs/css/html/svg/png/ico/woff2/json）。
- 新增 runtimeCaching 一条：`/tessdata/` 与 `/tesseract/` → CacheFirst（cacheName fangzi-tesseract，maxEntries 10，90 天）。
- >5MB 的 traineddata/wasm 不进安装期预缓存，首次识别后被运行时缓存，之后离线可用。

## EdgeOne
- 发布前（004 后）dist ~133M/163 文件；本项后 ~169M/170 文件；最大单文件 chi_sim.gz 20.2MB<25MiB；远低于 5GiB/20000/25MiB。

## 回滚
纯新增目录 + package.json(tesseract.js) + vite.config runtimeCaching 一条。revert 本 commit 即可。
