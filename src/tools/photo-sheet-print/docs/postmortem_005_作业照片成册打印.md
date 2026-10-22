# postmortem · 作业照片成册打印（photo-sheet-print · 005）

档位：**M（标准）**。纯前端 Canvas 图像管线 + IndexedDB + pdf-lib，无 wasm/大模型/Worker。

## 架构
- `src/tools/photo-sheet-print/`：manifest.ts / index.vue / lib/{layout,models,photos,store,sheet-pdf}.ts。
- 纯逻辑下沉 `lib/layout.ts`：A4 尺寸与 pt/mm 换算、配置归一化、分页分组、行列单元格矩形、旋转尺寸、contain 适配、页眉高度，全部可 node 单测。
- 复用：`reusable-module/indexeddb-kv`（独立库 `fz-photo-sheet-print-v1`，stores `photos`/`meta`，不碰既有键）；`reusable-module/image-redraw`（EXIF 方向校正、最长边 1800px 降采样、剥离元数据）；`useToolBilling` + `useSeo`。
- 图片校验：不信 `file.type`，按魔数/扩展名识别图片，0 字节/非图片/解码失败给中文提示。

## print vs 离屏 canvas→PDF 取舍（实测结论）
- **浏览器打印（`window.print`）**：预览区用 CSS `@media print` 隐藏操作区、`.sheet` 分页 `page-break-after: always`，由系统打印对话框输出，零额外排版开销；缺点是无头环境会被对话框阻塞，E2E 用 `window.print` 打桩断言被调用。
- **导出 PDF（离屏 canvas + pdf-lib）**：每页 150 DPI 离屏 canvas 绘制（白底、页眉、按单元格 contain 摆放并按角度旋转）→ JPEG → `embedJpg` 排版 A4；不内嵌中文字体（页眉中文由系统字体栅格化进 JPEG），单页约 20–30KB。优点是产物确定、可离线存档、E2E 可自动下载并校验页数。
- 两条能力都保留：打印面向即时出纸，PDF 面向归档与跨设备发送。

## 关键决策与踩坑
- 排序用独立 `seq` 字段（而非 createdAt），左右调换直接交换 seq 并回写 IDB。
- 缩略图 Object URL 在新增/替换/删除/卸载时统一 revoke，避免内存泄漏。
- 移动端固定底部导航/吸顶条会遮挡列表操作按钮，E2E 用 DOM `el.click()` 直接派发，绕过指针命中遮挡。
- pdf-lib 压缩对象流后 PDF 内 `/Type /Page` 文本不可直接正则计数，E2E 改用 `PDFDocument.load().getPageCount()` 取真实页数。

## 验证覆盖
- 单测 `test/photo-sheet-print.test.ts` 10 例：分页取整/空数组、分组、每页张数、配置钳制、mm→pt、纵横尺寸、单元格边界、旋转宽高交换、contain 适配、页眉高度。全量 `npm test` = **505**。
- `vue-tsc --noEmit` 0；`npm run verify:tools` = **35**；`npm run build` 成功。
- E2E `scripts/e2e-photo-sheet-print-20261022.mjs` 三视口（1280×860 / 834×1112 / 375×812 移动 UA）全绿：程序化生成 5 张不同尺寸 PNG 注入 → 每页 2 张预览 3 页 → 旋转/右移/删除生效（剩 4 张）→ `window.print` 打桩调用 1 次 → 导出 PDF `%PDF`+`%%EOF`、pdf-lib 读回 **2 页** → 断网二次加载照片仍在；零横向溢出、无 pageerror。
- 截图（真实构建运行、非 0 字节，已 Read 目检）：

| 文件 | 像素 | 大小 | 结论 |
|---|---|---|---|
| `shots/pc-layout.png` | 1280×860 | 68,577B | 通过：排版设置 + 预览分页可见 |
| `shots/tablet-layout.png` | 834×1112 | 118,544B | 通过：导入/列表/排序删除/备注/配置全链路 |
| `shots/mobile-list.png` | 375×812 | 55,723B | 通过：单列堆叠、无横向溢出、预览可见 |

## EdgeOne 复核
dist 177 MiB / 178 文件 / 最大单文件 24,010,842B（22.9MiB，既有 ONNX 模型）；本工具零 wasm/字体/大素材，主 chunk 极小，未改 SW 预缓存策略，均在 5 GiB / 20000 / 25 MiB 内。

## 真机待验
- 手机相册/拍照真实导入（含 HEIC、长截图、多图批量）在安卓各厂商 WebView 的解码与方向校正。
- 真实打印机/系统「另存为 PDF」的分页与留白；超大图（>4000px）批量导入的内存占用与 OOM。
- 多孩子/学科分组与错题本归档（本轮仅单册 + 备注，未做分册标签体系）。
