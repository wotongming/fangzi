# Dev · 小票本 receipt-vault

## 目录
- manifest.ts：freemium，priceCents 4900（Pro ¥49/年），features basic/pro。
- index.vue：选图→ocrImage→parseReceipt→可编辑表单→saveReceipt→列表/汇总/导出 CSV；挂 window.__receiptVault 测试接缝。
- lib/ocr.ts：单例 worker，chi_sim+eng，自托管三路径。
- lib/extract.ts：parseDate/parseAmount/parseTax/parseMerchant/parseReceipt/csvCell/toCsv/summarizeByCategory（纯函数）。
- lib/store.ts：indexeddb-kv，db=fz-receipt-vault-v1。

## 本地跑
```
npm run build && npx vite preview --port 4173 --host 127.0.0.1
node scripts/e2e-receipt-vault-20261021.mjs
```
## 踩坑
- workbox maximumFileSizeToCacheInBytes=5MB，>5MB 的 gz/wasm 不能进 glob（会 build 硬错），改走 runtimeCaching。
- 移动端 .rv-form 两列溢出：媒体查询写在 .rv-form 基础规则之前会被覆盖，须放样式末尾。
