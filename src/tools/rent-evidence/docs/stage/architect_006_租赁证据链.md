# 架构方案：租赁证据链（rent-evidence）

## 需求
小房东/直租租客：入住交接带时间戳水印拍照 → 租期报修留痕+责任初判 → 押金/租金/维修台账 → 一键导出证据包 PDF。全程本地、照片不上传。

## 技术选型（零新依赖）
- 存储：复用 `reusable-module/indexeddb-kv`，独立库 `fz-rent-evidence-v1`，三表 photos/tickets/ledger。
- 照片：`<input capture="environment">` 拍照 → canvas 缩到最长边 960px → 底部黑条白字烧入拍摄时刻（ISO 记录，不可事后改）→ JPEG 0.82 dataURL 入库。
- PDF：复用 payment-chaser 已验证模式——canvas 系统字体绘中文报告页 → JPEG → pdf-lib 排版 A4，免内嵌中文字体。
- 纯逻辑 `lib/model.ts`（无 DOM）：责任关键词初判、时间戳格式化、证据汇总，可独立单测。

## 模块
- `lib/model.ts`：类型 + classifyResponsibility/formatStamp/summarizeEvidence（纯函数）。
- `lib/store.ts`：IndexedDB CRUD。
- `lib/watermark.ts`：拍照压缩+水印（薄 DOM 壳）。
- `lib/export-pdf.ts`：证据包 PDF + 下载。
- `index.vue`：四 Tab UI（交接照片/报修工单/台账/证据包）。

## 数据模型
- PhotoRecord：id/at(拍摄时刻)/kind(move-in|repair|move-out)/item/note/dataUrl。
- RepairTicket：id/at/title/description/responsibility(landlord|tenant|unknown)/costCents/photoIds。
- LedgerEntry：id/at/kind(deposit|rent|repair|agency|other)/amountCents/note。

## 红线
不改 SW/manifest/icons/路由自动发现/搜索/ToolRunnerView；不串任何既有存储键；照片仅存本机 IndexedDB。
