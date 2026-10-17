# 架构方案：照片发布前本地隐私清理与脱敏工作台（photo-privacy）

- 对应 innovator：innovator_006_照片发布隐私清理.md
- 对应 pm：pm_006_照片发布隐私清理.md（结论：可集成，新增独立工具，本轮首选）
- 设计日期：2026-10-17

## 需求回顾与设计依据
做一个"照片发布前"的纯本地隐私处理工具：导入照片 → 可视化将泄露的 EXIF（GPS/时间/设备/序列号）→ 一键剥离元数据 → 按需区域打码（人脸/车牌/地址/二维码/屏幕）→ 文件名清洗 → 压缩/格式转换 → 单张或批量打包下载，**全程不出设备**。PM 已确认与 image-converter 痛点相反、独立成工具；批量、高级打码、场景预设付费。

## 技术方案

### 系统架构
纯前端、无后端、离线可用的 PWA 内网页工具（`type:'web'`，`immersive:false`）。分层：

```
index.vue（交互/状态/视图层）
 ├─ composables/usePhotoJob.ts   导入队列、任务编排、额度、进度
 ├─ lib/exif.ts        EXIF/PNG 元数据读取（手写，零依赖）
 ├─ lib/redact.ts      马赛克/模糊/遮罩区域（纯函数，作用于 canvas）
 ├─ lib/naming.ts      文件名清洗/重命名规则（纯函数）
 ├─ lib/process.ts     单图处理管线（decode→定向→打码→重绘剥离→压缩编码）
 ├─ lib/preset.ts      场景预设（二手/晒娃/证件/截图/维权）
 └─ workers/process.worker.ts  批量管线（OffscreenCanvas，降级主线程）
打包：fflate（已在依赖，MIT）；存储：reusable-module/indexeddb-kv（存偏好/预设）
计费：composables/useToolBilling；SEO：reusable-module/use-seo
```

### 模块设计
1. **导入与风险扫描**：`<input type=file accept=image/* multiple>` + 拖拽。对每个文件先读元数据（不解码大图，只读头部字节，快）。展示：文件名、尺寸（能解码时）、将泄露项（GPS 经纬度+可点开看坐标、拍摄时间、设备品牌型号、序列号、软件），无 EXIF 明确标"无定位信息"。HEIC 等不支持格式单独标灰并给"先转 JPEG"提示，不阻断其余。
2. **单图处理管线 process.ts**：
   - `createImageBitmap(file, { imageOrientation:'from-image' })` 解码并自动按 EXIF 定向（避免方向错乱）。
   - 画到 canvas；按用户标记区域应用 redact；需要透明底转 JPEG 时先填白底。
   - `canvas.toBlob(type, quality)` 编码——**重绘天然丢弃全部元数据**（EXIF/XMP/IPTC/PNG text），这是最稳的剥离方式；另提供"仅去元数据不重编码"对 JPEG 用重建文件段方式作为可选（默认重绘，质量/尺寸可控且最彻底）。
   - 输出尺寸（最长边限制）、质量、格式（image/jpeg、image/webp；保留原格式可选 png）。
3. **redact.ts 区域脱敏**：用户在预览图上拖拽矩形/自由涂抹，区域按图像原始分辨率归一化存坐标（缩放不影响精度）。效果：像素马赛克（取 N×N 均值块放大）、高斯模糊（优先 `ctx.filter='blur(px)'`，不支持则盒模糊卷积兜底）、纯色遮罩。多区域、可撤销/删除。不做人脸自动识别（合规与体积），由用户手选。
4. **naming.ts 文件名清洗**：去掉 `IMG_/PXL_/时间戳/序号/微信IMG_/地点` 等可推断信息，可选用前缀+随机/序号重命名（如 `photo-a8f3.jpg`），保留扩展名与实际格式一致。
5. **批量 worker**：大图与多张时在 Worker 用 OffscreenCanvas 跑管线，避免主线程卡死；通过 `reusable-module/worker-post` 的 `postTo` 传 File（自动克隆、不误转移）；逐张回传进度与结果 Blob（Blob 走结构化克隆回主线程）。OffscreenCanvas 不可用时降级主线程异步分批（让出事件循环）。
6. **导出**：单张直接下载；批量用 `fflate.zipSync`/流式打包为一个 ZIP（内存受控：逐张压入，避免同时持有全部大图），包内按预设命名。
7. **场景预设 preset.ts**：二手交易（去EXIF+适度压缩+遮车牌门牌提示）、晒娃、证件（强制遮证件号外区域提示+压缩）、工作截图（强制重绘+文件名清洗）、维权（保留清晰度但去定位）。一键设置打码提示清单/质量/命名，用户仍可手调。

### 关键技术路线
- EXIF：手写 JPEG APP1（`Exif\0\0` → TIFF 头，按 II/MM 字节序解析 IFD0/ExifIFD/GPSIFD 常用 tag：DateTime、Make、Model、Software、SerialNumber、GPSLatitude/Longitude/Ref、ImageWidth/Height、Orientation）；PNG 读 tEXt/iTXt/zTXt 关键键。纯函数、可单测（喂构造 buffer）。
- 剥离：以 Canvas 重编码为主（彻底、跨格式一致、顺带压缩）。
- 不引入任何新的重型依赖；ZIP 复用 fflate；EXIF/CSV 等均自研。
- 数据不落服务器；处理结果仅存内存/对象 URL，离开即释放；偏好存 IndexedDB。

### 盈利模式（接好钩子、按档选配）
主方案 **freemium + 买断/订阅**（与 PM 一致），用统一计费框架配置，不从零实现五模式：
- 免费：去 EXIF/元数据、基础单区域打码、单张处理（或少量张数/日）。
- 付费 featureKey：`batch`（批量不限量 + ZIP）、`redact-pro`（多区域/自由涂抹/模糊/撤销）、`preset`（场景预设+文件名清洗模板）、`quality`（高清/格式批量模板）。
- `mode:'freemium'`，`priceCents` 买断（建议 ¥19.9 与同类对齐或更低，见 dev），配 `subscription`（月/年）与 `usagePack` 按张包（框架已具备，仅配置）。

## 与 fangzi 现有代码的集成方式
- **仅新增**目录 `src/tools/photo-privacy/`：`manifest.ts`、`index.vue`、`guide.md`、`lib/*`、`composables/*`、`workers/*`、`docs/`。注册中心 `import.meta.glob('../tools/*/manifest.ts')` 自动发现，**不改路由/搜索/注册代码**。
- 复用：`@/composables/useToolBilling`、`@/reusable-module/worker-post`、`@/reusable-module/indexeddb-kv`、`@/reusable-module/use-seo`；打包用依赖 `fflate`。
- 沉淀：把"图片解码+安全重绘剥离元数据"的通用纯函数抽到 `reusable-module/image-redraw/`（供后续图片类工具复用），并更新其 README。
- 互链：与 image-converter 在 guide/详情互相引用（"要增强/电商做图→图片处理工作台；要发布前防泄露→本工具"），仅文案链接。
- 不改 image-converter、SW、manifest.webmanifest、外壳；新增 worker 由 Vite 正常打包，SW 预缓存策略沿用现有（worker 属静态资源，体积小）。

## 软硬件/依赖选型（逐项商用授权）
| 选型 | 用途 | 许可/成本 |
| --- | --- | --- |
| 原生 Canvas/createImageBitmap/OffscreenCanvas | 解码/重绘/打码/编码 | 浏览器内置，免费 |
| 自研 exif.ts | 元数据读取 | 自有代码，MIT，零成本 |
| fflate ^0.8.3（**已在 package.json**） | ZIP 打包 | MIT，可商用，免费 |
| reusable-module（worker-post/indexeddb-kv/use-seo） | 通信/存储/SEO | 仓库内部 MIT，免费 |
| EdgeOne Pages 免费版 | 静态托管 | 免费额度内，0 资金 |
无任何仅限非商用（NC/学术）资源；无 AI 模型、无云 API。HEIC 解码 V1 不引入（库体积大、许可需另核），列为后续增强。

### 本地 AI 选型
不涉及本地 AI（不做人脸检测），无需模型/推理引擎。

## 开发方案
- 语言/框架：TypeScript + Vue 3 `<script setup>`，与仓库一致；Vite 打包；Worker 用 `new Worker(new URL(...),{type:'module'})`。
- 环境：现有 Node/npm 工程；无新增依赖。
- 里程碑：①exif+扫描展示 ②单图管线（剥离/压缩/格式/命名）③打码交互 ④批量 worker+ZIP ⑤计费钩子+预设 ⑥单测/E2E/三视口 ⑦文档归档+推送。

## 测试方案
- 单测（毫秒级左移）：
  - exif：构造含已知 GPS/时间/型号的 JPEG buffer 与无 EXIF/PNG buffer，断言解析与字节序、容错（缺 tag/截断不抛）。
  - redact：归一化坐标换算、马赛克块输出与原区域不同、区域外像素不变。
  - naming：清洗规则与扩展名一致性。
  - worker-post 传 File 不报错（沿用其测试范式）。
- 构建：`vue-tsc --noEmit` 0 错误、全量单测通过、`npm run build` 成功、`verify:tools` 工具数 +1。
- E2E（Playwright/Chromium，abort sw）：PC 1280×800 主流程（拖入→看到风险→一键处理→打码→下载单张与 ZIP）；手机 375×812、平板 834×1112 各跑主场景并断言无横向溢出；触摸拖框可操作。
- 回归：image-converter 与其余工具 E2E 不受影响（仅新增目录 + reusable 新增模块，不改旧代码；image-redraw 为新增不替换旧实现）。
- 用真实生成图：脚本用 canvas 生成 JPEG 并注入 EXIF 段，避免网图/占位。

## 实施部署方案
随 main 推送，EdgeOne Pages 自动部署。无环境变量、无后端、无密钥。回滚：该工具为纯新增目录，如需下线仅删除目录或在 manifest 置 status（或从工具集移除），不影响主体；Git 一键 revert 该提交即可。

## 风险与反思
- 用户真的需要吗：发图泄露 GPS/住址是官媒反复提示的普遍风险，受众=每个发图的人，成立。
- 会不会搞复杂：独立工具、不动核心；免费层一键"去元数据"足够简单，高级项折叠。
- 真能省时间/避险吗：把"查信息—去EXIF—截图打码—压缩"合一，且避免被定位/人肉，价值直接。
- 已知边界（写入 guide/FAQ）：V1 支持 jpg/jpeg/png/webp，HEIC/RAW/视频不支持（给转换提示）；不做人脸自动识别；重绘会丢弃色彩配置/缩略图（隐私场景符合预期）；PNG→JPEG 透明底填白；结果为新文件，不覆盖原图。
- iOS Safari：EXIF 定向、toBlob webp 支持差异需真机/兼容测试，不支持 webp 时回退 jpeg。
