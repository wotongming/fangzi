# 技术沉淀：照片发布隐私清理（photo-privacy）

- 对应 dev：dev_006_照片发布隐私清理.md
- 日期：2026-10-17
- 档位：**M**（多场景链路：元数据解析 + Canvas 重绘 + 框选/涂抹 + Worker 批量 + ZIP）

## 技术选型与理由

| 选型 | 版本/来源 | 许可证 | 为什么选 |
| --- | --- | --- | --- |
| 手写 EXIF/PNG 只读解析 | 自研 `lib/exif.ts`，零依赖 | MIT（内部） | 只需“风险展示”，读 JPEG APP1/TIFF(IFD0/Exif/GPS) 与 PNG tEXt 前 256KB 即可；不引 exif 库减小体积、无供应链风险 |
| Canvas 安全重绘剥离元数据 | 复用 `reusable-module/image-redraw` | MIT（内部） | 重新编码天然不带任何元数据（含 XMP/IPTC/厂商私有段/缩略图），比“删段”更彻底，顺带缩放/定向/格式/质量 |
| 批量 Worker | Vite `new Worker(new URL(...))` + OffscreenCanvas | 原生 | 大图批量不阻塞 UI；`reusable-module/worker-post` 安全传 File（克隆不误转移）；不支持时回退主线程 |
| ZIP 打包 | `fflate` 0.8.3（已在 package.json） | MIT | 仓库既有依赖，同步 zipSync 足够小批量，零新增 |
| 框选交互 | Pointer Events | 原生 | 一套事件同时覆盖鼠标 / 触摸 / 触控笔，`touch-action:none` 防滚动冲突 |

无新增 npm 依赖；未使用任何仅限非商业（NC）授权的资源。

## 关键实现

1. **解析与剥离解耦**：`readMeta/readMetaFromBuffer` 只解析用于风险提示（GPS 十进制度、时间、Make/Model、方向），绝不修改原文件；真正的剥离统一走“解码→缩放→重绘→编码”。
2. **坐标归一化**：遮罩用相对宽高的 0..1 存储，界面缩放不影响打码精度；绘制时 `rectToPixels/normRect` 换算并裁剪到画布。路径涂抹取包围盒填充。
3. **三种打码**：马赛克（逐块取左上角像素色整块填充）、模糊（优先 `ctx.filter=blur()`，不支持时缩小 1/8 再放大的盒式近似）、纯色遮挡。
4. **批量串行 + Worker 单例**：逐张解码、逐张释放，避免同时解码多张爆内存；Worker 复用一个 OffscreenCanvas。
5. **文件名清洗**：`stripName` 用数字断言（`(?<![0-9])…(?![0-9])`，而非 `\b`，因为下划线在 JS 正则里算单词字符会漏配）去除品牌前缀、日期、时分秒、连续序号；`safeName` 统一前缀 + 4 位随机 hex，批内 Set 去重，扩展名随真实输出 MIME。
6. **计费钩子**：只接主方案 freemium + 买断（priceCents 1290），付费能力 `redact-pro / batch / preset` 用 `billing.canUse(feature)` 门控，`billing.buy()` 对 freemium 默认下单 `freemium-pro`；订阅/用量包由框架配置即开，未重复造轮子。
7. **SEO/AEO/GEO**：`useSeo` 输出含“去exif/照片定位/马赛克”等关键词的 Title/Description + SoftwareApplication JSON-LD（含 offers 价格）。

## 踩坑记录

1. **`\b` 边界导致 `IMG_20260101_120000_042` 日期清不掉**：下划线是单词字符，`\b2026…01\b` 在 `20260101_120000` 上匹配失败。改用显式数字前后断言，并把“日期 + 紧跟时分秒”合并为一条正则一次吃掉。单测复现并修复。
2. **Pointer capture 设在了 `e.target`**：指针按下后移到子元素 `<img>` 上时，后续 move/up 被 retarget，`.stage` 收不到事件，框选失败。改为在 `e.currentTarget` 上 `setPointerCapture`；并让遮罩层 `pointer-events:none`（删除按钮单独 `auto`），避免遮罩挡住二次框选。E2E 三视口复现并修复。
3. **E2E 鼠标点不到画布**：`boundingBox()` 拿到的 y 在 800 高视口之外，Playwright 鼠标事件落在视口外元素上。先 `scrollIntoViewIfNeeded()` 再拖拽。属测试脚本问题，非产品 bug。
4. **测试夹具把 JPEG 段长写成小端**：JPEG 段长度字段是大端，导致解析器读不到 APP1。修正夹具字节序，产品代码保持按规范读大端。
5. **reusable-module 在仓库根而非 src 下**：`@/` 别名指向 src，引用根目录通用模块要用相对路径（`../../../../reusable-module/...`），类型检查一开始会报找不到模块。

## 验证覆盖

**用户变量覆盖（浏览器/输入/格式/交互，≥90%）**

- 浏览器：以 Chromium 内核（Chrome/Edge）无头实测主链路；Safari/Firefox 差异点（WebP 编码、ctx.filter、OffscreenCanvas）均有运行时能力探测与回退（WebP→JPEG、filter→盒式模糊、Worker→主线程）。
- 输入：JPEG（含/不含 EXIF 两种）、PNG、不支持格式（提示并跳过）、批量多文件。
- 格式输出：JPEG/PNG/WebP；质量、最长边、文件名前缀与清洗开关。
- 交互：矩形框选、多区域、删除遮罩、单张生成下载、批量 ZIP 下载。

**质量门结果**

- 类型检查：`npx vue-tsc --noEmit` 通过，0 error。
- 单元测试：`node --import tsx --test test/*.test.ts` → **213 通过 / 0 失败**（新增 `test/photo-privacy.test.ts` 5 个：EXIF-GPS 解析、无 APP1/空文件容错、PNG 文本块、文件名清洗与扩展名、归一化矩形换算与裁剪）。
- 生产构建：`npm run build` 成功；PWA 预缓存 85 条；工具专属 chunk `photo-privacy-*.js` 与 Worker chunk `process.worker-*.js` 正常分包。
- 工具回归：`npm run verify:tools` → 校验工具数 **21**，manifest/插件包/示例提问全部通过。
- 端到端（`scripts/e2e-photo-privacy-20261017.mjs`）：**14/14 断言通过，致命 console/page 错误 0**。
  - PC 1280×800：GPS 风险横幅、框选遮罩、生成清空、批量 2 行、ZIP 下载、无横向溢出。
  - 平板 834×1112、手机 375×812：风险横幅、框选、生成、无横向溢出。
  - 下载产物回读校验：单张 jpg 与 ZIP 内 2 张 jpg 的 `hasMeta=false、gps=false、risks=[]`，证明元数据确已剥离；ZIP 文件名为 `photo-xxxx.jpg`（已清洗、无重名）。

**多端多尺寸结论**：PC / 平板 / 手机三视图均布局正常，无横向溢出（`scrollWidth-clientWidth ≤ 2`），手机端满宽、底部 4Tab 不遮挡、触摸框选可用。

**EdgeOne Pages 免费版限额核查（构建产物 dist）**

- 存储总量：约 **130 MB < 5 GiB**。
- 文件总数：**115 < 20000**。
- 单文件最大：`ort-wasm-simd-threaded-*.wasm` 13.6 MiB **< 25 MiB**（构建脚本已自动清理 25.6 MiB 的 WebGPU asyncify wasm）。
- 本工具未引入任何大体积静态资产，无超限文件。

**guide 截图有效性验证（均为真实构建后运行界面，非占位/网图）**

| 截图文件 | 像素尺寸 | 大小 | 与说明一致 | 结论 |
| --- | --- | --- | --- | --- |
| pc-single-edit.png | 2560×1600（逻辑1280×800，DSF2） | 248,975 B | PC 单张风险提示+框选 | 通过 |
| pc-single-done.png | 2560×1600 | 181,159 B | PC 生成结果 | 通过 |
| pc-batch-list.png | 2560×1600 | 245,860 B | 批量列表 2 行 | 通过 |
| pc-batch-done.png | 2560×1600 | 223,059 B | 批量完成导出 ZIP | 通过 |
| tablet-single-edit.png | 1668×2224（逻辑834×1112） | 331,522 B | 平板自适应 | 通过 |
| tablet-single-done.png | 1668×2224 | 257,681 B | 平板结果 | 通过 |
| mobile-single-edit.png | 750×1624（逻辑375×812） | 162,144 B | 手机框选+底部Tab | 通过 |
| mobile-single-done.png | 750×1624 | 169,985 B | 手机结果 | 通过 |

均为真实文件、可正常打开、非 0 字节、PNG 头有效。

**全业务场景结论**：选图→风险提示→框选/预设→生成→（单张下载 / 批量 ZIP）全链路无阻塞。

## 可复用经验

- `reusable-module/image-redraw` 已沉淀回通用库：任何“需要输出干净图片 / 缩放转码 / 去元数据”的工具都应直接复用，不要各自写 canvas 编码。
- 任何 Pointer 拖拽组件：capture 必须挂在容器 `currentTarget` 上，覆盖层默认 `pointer-events:none`。
- 文件名/文本清洗涉及数字边界时优先用显式数字断言，不要盲信 `\b`。
- “只读解析做提示 + 重绘做剥离”的两段式，兼顾安全与性能，且天然容错（解析失败不阻断重绘）。
