# Postmortem · PDF 真脱敏（pdf-redact）

> 档位：**M**（多场景链路 + IDB/文件处理 + WASM/wasm 资源自托管）

## license / CVE / 版本
- pdfjs-dist ^4.10.38（Apache-2.0，仓内既有，未动）；pdf-lib ^1.17.1（MIT，本版新增）。均可商用、无 NC、本编写时无公开高危 CVE。

## 路线取舍与最终实现
A（内容流算子级精准删除）对子集字体/多 stream/BT·ET bbox 不稳，M 档预算内不可靠；**最终用 B（混合）**：无遮页 copyPages 保留矢量可搜索；含遮页 ~150dpi 渲染位图+盖黑块整页嵌回，该页文字层彻底删除。代价：含遮页变图不可选中，UI/文档已明示。

## 真删实证（E2E 输出）
现场生成两页测试 PDF（页1 有 `SECRETBANK ACCT 8899`、页2 仅 `PUBLIC ONLY PAGE TWO`，Author=张三 Secret、Title=Confidential Draft），对页1 秘密区域加遮罩后导出，用 pdf.js `getTextContent` 重新解析导出件：
- `page0=""`（含遮页文字层彻底删除，SECRET/8899 提取不到）；
- `page1="PUBLIC ONLY PAGE TWO"`（未遮页矢量文字完整保留）；
- readMeta Author='' / Title=''（元数据已清空）。
以上三断言在 pc/tablet/mobile/offline 五次均通过。

## worker 自托管与离线（2026-10-21 二次热修后口径）
worker 由公共模块 `reusable-module/pdfjs-worker` 统一初始化，固化为同源稳定路径 `/pdfjs/pdf.worker.min.js`（原 Vite `?url` 哈希 `.mjs` 方案已废弃，详见末节）；public 下 `.js` 命中 SW precache glob，`dist/sw.js` 预缓存清单含该路径，离线 E2E 仍可解析 PDF，且无外部请求。

## EdgeOne 体积
dist ~133M/163 文件；新增最大静态 pdf.worker.mjs 1.37MB；最大单文件 ort-wasm 13.6MiB<25MiB。

## 三视口验证
1280×860 / 834×1112 / 375×812：真删/未遮保留/元数据断言通过、横向溢出 0、无 pageerror；离线通过。

## 截图
- docs/shots/pr-pc-main.png（68593 B）
- docs/shots/pr-mobile-main.png（40578 B）

## 踩坑
pdf-lib setKeywords 收 string[]、无 getInfo()、setCreationDate 需 Date；vue 模板里普通 let draft 会被 vue-tsc 收窄成 never，须用 ref。

## 2026-10-21 热修：华为/WeLink WebView 选 PDF "无反应"
- 根因：accept=application/pdf,.pdf 在华为/WeLink 内置 WebView 下，系统"文件"provider 给的 File.type 为空或 octet-stream，pdf.js 解析失败被 catch 吞成一句"打开失败"，第三方"选择文件"路径异常时 change 静默。
- 改法：接入公共 `reusable-module/file-sniff`，不信 file.type，按 `%PDF` 魔数校验；错误带文件名/实际 type/大小/三态（空/HTML 错误页/非 PDF）；用户取消选择静默，input.value='' 允许重选。
- 验证：三视口 E2E（scripts/e2e-mobile-compat-20261021.mjs）投伪 MIME octet-stream 合法 PDF 断言能加载、投 HTML 错误页断言明确文案；npm test 469 全绿。

## 2026-10-21 二次热修：EdgeOne `.mjs` MIME 错误致内置 WebView 选 PDF 必挂

### 生产证据（用户 `curl -I` 实测，直接采信）
- `https://www.fangzi.asia/assets/pdf.worker.min-yatZIOMy.mjs` → **HTTP 200，`Content-Type: application/octet-stream`**；文件真实存在，不是 404、不是发版哈希错配。
- 同站普通 `.js` chunk → `application/javascript`（正常）；不存在路径 → `text/html`（SPA fallback）。
- 结论：**EdgeOne 对 `.mjs` 的 MIME 映射成了 octet-stream**。pdfjs-dist 4.x worker 是 ESM：先 `new Worker(src, { type: 'module' })`，在华为系统 / WeLink WebView 因 MIME 非 JS 被拒；回退 fake worker 在主线程 `await import(src)` 又被 MIME 严格校验拒绝，抛裸英文 `Setting up fake worker failed: Failed to fetch dynamically imported module`。桌面 Chrome 较宽松/走 worker 路径未暴露，真机内置 WebView 必挂；`pdf-redact` 与 `resume-jd-matcher` 是全仓仅有的两个 `getDocument` 消费方，同根因同时受影响。

### 改法
1. 新增公共模块 `reusable-module/pdfjs-worker/pdfjs-worker.ts`：幂等配置 `GlobalWorkerOptions.workerSrc`，包装 `getDocument`；`isWorkerLoadFailure` 识别 fake worker / 动态导入 / Failed to fetch 特征，`normalizePdfError` 把这类失败归一为中文可重试提示，业务错误原样保留。
2. worker 固化 `public/pdfjs/pdf.worker.min.js`，内容与 `node_modules/pdfjs-dist/build/pdf.worker.min.mjs` sha256 一致（仅文件名不同，1375838 B，sha256 `1baa1844c89c80a5b2797c916e75ab29254be46d8e9cb53cb6364d7aad84be36`）；模块用 `import.meta.env.BASE_URL + 'pdfjs/pdf.worker.min.js'`。EdgeOne 对 `.js` 实测返回 `application/javascript`：`new Worker(url, { type: 'module' })` 按 type 判断、fake worker 的 `import(url)` 只要求 JS 类 MIME，均可加载；稳定名同时消除未来发版哈希 404。
3. 两工具删除各自 `pdfjs-dist/build/pdf.worker.min.mjs?url` 导入，统一接入公共模块；`pdf-redact/index.vue` 预览渲染也改走 `openPdfDocument`。解析失败持久展示具体原因并提供「重试（重新选择 PDF）」按钮，不再用 2.6s 自动消失的 toast。
4. public 下 `.js` 已命中 vite-plugin-pwa `globPatterns`；构建后 `dist/sw.js` 预缓存清单含 `/pdfjs/pdf.worker.min.js`，断网可解析。

### 验证（scripts/e2e-pdfjs-worker-20261021.mjs）
- PC 1280×860 / 平板 834×1112 / 手机 375×812（移动 UA）：两工具投 `type=application/octet-stream` 但 `%PDF` 合法文件均解析成功；全程零请求旧 `.mjs`；横向溢出 0、无 pageerror。
- 路由拦截 `pdfjs/pdf.worker.min.js` abort：两工具均落到中文兜底「PDF 解析组件加载失败，可重试；若在内置浏览器…用系统 Chrome / Edge 打开」，页面无裸英文 `Setting up fake worker failed`、无卡死。
- HTML 错误页 / 0 字节：出现明确错误文案 + 重试按钮。
- 在线缓存后断网二次加载，SW 命中 worker，pdf-redact 仍可解析。

### EdgeOne 部署动作
本 `.js` 方案上线后**无需**在 EdgeOne 为 `.mjs` 加 MIME 规则；但发版后需到 EdgeOne 控制台**刷新 / 预热 CDN 缓存**，并 `curl -I https://www.fangzi.asia/pdfjs/pdf.worker.min.js` 复核 `Content-Type: application/javascript`。若将来坚持使用 `.mjs` 后缀，则需在 EdgeOne 给 `*.mjs` 增补 `Content-Type: application/javascript` 规则。

### 真机待验
华为系统浏览器、WeLink / 微信 / QQ 内置 WebView 上真实选一份文字版 PDF 复测渲染与文本提取；无头环境仅以请求拦截模拟 MIME 失败。
