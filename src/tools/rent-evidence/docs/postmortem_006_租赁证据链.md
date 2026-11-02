# 技术沉淀：租赁证据链（rent-evidence）

- 对应 dev：`docs/stage/dev_006_租赁证据链.md`
- 日期：2026-11-02
- 档位：**M**

## 技术选型与理由
- 纯前端零新依赖：IndexedDB 复用 `reusable-module/indexeddb-kv`；PDF 复用 payment-chaser 已验证的「canvas 中文报告页 → JPEG → pdf-lib」模式，免内嵌中文字体，包体小；pdf-lib 1.17 MIT 已在依赖。
- 时间戳证据可信：拍摄时刻在拍照瞬间（new Date().toISOString()）传入水印函数并烧入像素，UI 不可事后改。

## 关键实现
- `lib/model.ts` 纯函数无 DOM：`classifyResponsibility`（老化/漏水/线路→landlord；摔/砸/钉孔/划痕→tenant；并列或都无→unknown）；`summarizeEvidence` 四段（入住/退租/工单/台账）按时间线排。
- `lib/watermark.ts`：最长边 960px 等比缩、底部 7% 黑条白字 `yyyy-MM-dd HH:mm` + 按可用宽度截断备注。
- IndexedDB 三表 photos/tickets/ledger，独立库 `fz-rent-evidence-v1`，与任何既有键隔离。

## 踩坑记录
- E2E reload 持久化断言首版失败：reload 后 Tab 复位到「交接照片」，断言「押金 ¥3000」文本当然找不到——断言前先点台账/工单 Tab 再查。
- Playwright 启动需显式 `executablePath: CHROMIUM`（来自 `scripts/_gpu-ctx.mjs`），否则默认找错 headless shell 路径。

## 迭代修复（2026-11-02，基于 dc8db90）
- **Bug1 工单照片不预览**：表单内对每个已选 File 用 `URL.createObjectURL` 渲染 84px 缩略图（`.previews .pv`），右上角「×」单张移除并 `revokeObjectURL`；换选/提交成功/组件卸载统一 revoke 防泄漏；保存后卡片缩略图不变。
- **Bug2 PDF 缺照片**：`buildEvidencePdf(rows, photoSections)` 文字页之后追加照片页——`groupPhotosForPdf`（新增纯函数、无 DOM、4 例单测）按入住/退租/报修工单分组，每张照片 A4 等比 contain 绘制 + 系统字体中文图注，canvas→JPEG→embedJpg，不内嵌字体、零新依赖。

## 验证覆盖
- 单测：`test/rent-evidence.test.ts` 13 例（原 9 例 + PDF 照片分组 4 例：入住/退租分组与图注时间戳、报修照按工单归组、未关联组、空照片零分组）。
- 全量 `npm test`：**547 通过 / 0 失败**（基线 543 + 4）。
- `npx vue-tsc --noEmit`：**0 错误**。
- `npm run verify:tools`：**36**（本轮增量未动工具数）。
- `npm run build`：成功。
- Playwright 三视口（1280×860 / 834×1112 / 375×812 移动 UA）：台账 ¥3000 → 工单表单选 2 张图出现 2 个可点×预览（点×后剩 1）→ 保存后卡片缩略图仍在（1）→ 交接照入库 → PDF download 后用 pdf-lib 读回 **pages=3**（1 文字页 + 2 照片页，≥3 断言通过）；reload 后台账/工单/照片跨刷新保留；零横向溢出、无 pageerror、除 blob: 同源预览 URL 外零外链。

### 截图有效性
| 文件 | 视口 | 像素 | 大小（字节） | 结论 |
| --- | --- | ---: | ---: | --- |
| `shots/pc-rent-evidence.png` | 1280×860 | 1280×860 | 86,784 | 交接照列表+水印条可见，通过 |
| `shots/pc-ticket-form.png` | 1280×860 | 1280×860 | 52,739 | 表单内 2 张缩略图+×按钮可见，通过 |
| `shots/pdf-photo-page.png` | PDF 阅读器 | 900×1200 | 120,737 | PDF 3 页缩略图栏可见照片页、「照片证据一」标题，通过 |
| `shots/tablet-rent-evidence.png` | 834×1112 | 834×1112 | 75,881 | 竖屏自适应，通过 |
| `shots/mobile-rent-evidence.png` | 375×812 | 375×812 | 68,595 | iPhone UA 竖屏无溢出，通过 |

### EdgeOne 限额
- dist **184,388,740 B ≈ 175.85 MiB**（< 5GiB）
- 文件数 **184**（< 20000）
- 最大单文件仍为既有 ONNX **24,010,842 B ≈ 22.90 MiB**（< 25MiB，非本工具引入）。

## 可复用经验
- 「证据类」工具的可信核心是：时间戳在采集瞬间烧入像素 + 数据独立库可导出 PDF 备份。
- 中文 PDF 继续走 canvas→JPEG→pdf-lib，不要引几 MB 的中文字体。

## 真机待验
- 手机相机实拍（capture=environment）成像与水印位置；
- 百张照片后 IndexedDB 体积与列表滚动；
- 微信内置浏览器下载 PDF 行为。
