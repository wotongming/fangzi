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

## 验证覆盖
- 单测：`test/rent-evidence.test.ts` 9 例（责任初判三类、时间戳补零/非法输入、证据汇总四段/金额换算/空数据、交接清单预置项齐全）。
- 全量 `npm test`：**543 通过 / 0 失败**（基线 534 + 9）。
- `npx vue-tsc --noEmit`：**0 错误**。
- `npm run verify:tools`：**36**（新增独立顶层工具，符合预期 35→36）。
- `npm run build`：成功。
- Playwright 三视口（1280×860 / 834×1112 / 375×812 移动 UA）：台账记账 ¥3000 → 工单责任初判 landlord → 交接照入库 figures=2 → 证据包 PDF download 成功（`租赁证据包_*.pdf`）；reload 后台账/工单跨刷新保留；零横向溢出、无 pageerror。

### 截图有效性
| 文件 | 视口 | 像素 | 大小（字节） | 结论 |
| --- | --- | ---: | ---: | --- |
| `shots/pc-rent-evidence.png` | 1280×860 | 1280×860 | 86,796 | 交接照列表+水印条可见+toast，通过 |
| `shots/tablet-rent-evidence.png` | 834×1112 | 834×1112 | 75,846 | 竖屏自适应，通过 |
| `shots/mobile-rent-evidence.png` | 375×812 | 375×812 | 68,600 | iPhone UA 竖屏无溢出，通过 |

### EdgeOne 限额
- dist **184,383,616 B ≈ 175.85 MiB**（< 5GiB）
- 文件数 **184**（< 20000）
- 最大单文件仍为既有 ONNX **24,010,842 B ≈ 22.90 MiB**（< 25MiB，非本工具引入）。

## 可复用经验
- 「证据类」工具的可信核心是：时间戳在采集瞬间烧入像素 + 数据独立库可导出 PDF 备份。
- 中文 PDF 继续走 canvas→JPEG→pdf-lib，不要引几 MB 的中文字体。

## 真机待验
- 手机相机实拍（capture=environment）成像与水印位置；
- 百张照片后 IndexedDB 体积与列表滚动；
- 微信内置浏览器下载 PDF 行为。
