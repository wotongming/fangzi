# reusable-module 通用模块库

跨工具复用的通用功能模块。使用前先查看本 README 与各模块说明，**优先复用、不要重复造轮子**。

## 模块清单

| 模块 | 简介 | 位置 | 状态 |
|---|---|---|---|
| indexeddb-kv | 通用 IndexedDB KV 封装：按 dbName 多库缓存连接、增删改查、清空、按索引范围查询（零依赖 TS）；多工具不同库名互不串用 | `indexeddb-kv/indexeddb-kv.ts` | 2026-10-14 家庭财务管家沉淀；2026-10-15 离线语音转写（pipeline 004）增强多库缓存 |
| use-seo | GEO/AEO 友好元信息注入：动态 Title/Meta + JSON-LD 结构化数据（SoftwareApplication/WebSite），适配 AI 搜索引用 | `use-seo/use-seo.ts` | 2026-10-15 由图片处理工作台（pipeline 001）沉淀 |
| worker-post | 安全向 Web Worker 发消息：自动剥离 Vue reactive Proxy、自动零拷贝转移 ArrayBuffer、File/Blob 走克隆不误转移 | `worker-post/worker-post.ts` | 2026-10-15 由 GPU 大数据可视化面板（pipeline 002）沉淀 |
| gpu-detect | 浏览器 GPU 能力探测与降级：只探 adapter（带超时）不销毁 device，规避 Dawn instance 污染，返回 WebGPU/WebGL2/Canvas2D 推荐 | `gpu-detect/gpu-detect.ts` | 2026-10-15 由 GPU 大数据可视化面板（pipeline 002）沉淀 |
| use-lazy-init | 安全初始化 v-if/异步数据后的 canvas/控制器：post watcher + onMounted 双触发 + 幂等守卫，失败可重试 | `use-lazy-init/use-lazy-init.ts` | 2026-10-15 由 GPU 大数据可视化面板（pipeline 002）沉淀 |
| image-redraw | 通用「安全解码 + 按尺寸重绘 + 编码」纯函数：Canvas 重绘输出天然剥离 EXIF/XMP/IPTC 全部元数据，顺带缩放/EXIF 方向校正/格式与质量控制；createImageBitmap(from-image) 优先、HTMLImage 回退；可传入 OffscreenCanvas 在 Worker 使用，JPEG 自动铺白底 | `image-redraw/image-redraw.ts` | 2026-10-17 由照片隐私清理工作台（pipeline 006）沉淀 |
| bill-csv | 账单/交易类 CSV 通用解析：UTF-8(BOM)→GBK→替换符多级文本解码、RFC4180 表格解析（引号/内嵌逗号换行/转义）、金额元转整数分、多格式日期解析、表头列名精确+模糊定位（零依赖 TS，浏览器原生 TextDecoder） | `bill-csv/bill-csv.ts` | 2026-10-17 由账单订阅盘点（pipeline 009）沉淀 |
| recurring-detect | 周期性交易/订阅识别纯函数：商户名归一 + 金额容差归桶 + 扣费间隔中位数落入月/季/半年/年区间 + 变异系数阈值，输出标准 cadence、次数、年化金额与下次扣费预测 | `recurring-detect/recurring-detect.ts` | 2026-10-17 由账单订阅盘点（pipeline 009）沉淀 |

## 新增模块规范

1. 每个模块一个独立子目录，模块名 kebab-case。
2. 模块目录下放实现文件 + 简短 `README.md`（简介、API、使用示例）。
3. 完成后更新本 README 的模块清单（简介、位置、日期）。
