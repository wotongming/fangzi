# 技术沉淀：离线语音转写与会议纪要

- 对应 dev：`docs/stage/dev_004_离线语音转写与会议纪要.md`
- 日期：2026-10-15
- 档位：**H**（本地 WASM 推理 + 运行时加载约 40MB 模型 + 多格式音频解码）。本版交付「可运行 checkpoint + 已验证项 + 明确未完成项」。

> **2026-10-15 真机修复（V1.0.1）：模型改为同源自托管，解决大陆 4G 打不开。**
> 真机（南京移动 4G，访问 `www.fangzi.asia`）点「开始转写」报 `Failed to fetch`：原实现运行时从 **huggingface.co 官方源**拉模型，云端无头环境能连（测试未暴露），但大陆移动网络直连 HuggingFace 被墙。排查确认：ModelScope 小文件接口不带 CORS（仅其大文件 302 到的 `cdn-lfs-cn-1` 带 `*`，但 config/tokenizer 浏览器读不了），不能整仓依赖。**最终方案——同源自托管 + Service Worker 分片合并**，与站点同域、大陆直连、天然离线：
> - 全部模型文件放 `public/mf/Xenova/whisper-tiny/`（`env.allowLocalModels=true; allowRemoteModels=false; env.localModelPath='/mf/'`，transformers 按 `/mf/<modelId>/<file>` 取，本地路径不含 revision 层级）。
> - decoder q8 **30,727,765B（>25MiB）** 切成 `part0/1/2`（15M+15M+727765）随站发布；新增 `public/sw-model-shards.js`（workbox `importScripts` 引入，并开 `skipWaiting/clientsClaim`）拦截 `/mf/`，按 `public/mf/shards.json` 的**精确片数**拉分片合并（精确清单是关键，见踩坑 6/7），合并后写 `fangzi-model-files` Cache。
> - E2E 断言改为直接 fetch 完整 decoder 校验合并字节 **=30,727,765** 且零外部源；重测 **E2E 14/14**（真实转写约 6.1s）、140 单测、17 工具、dist **86MB / 95 文件 / 最大单文件 13.6MiB**。
> 下方早期章节记录的「huggingface.co/hf-mirror 探测」是 V1.0 云端无头阶段的结论，**V1.0.1 起已不适用**，以本块为准。

## 技术选型与理由

| 选型 | 版本 | 理由 | 商用授权 |
|---|---|---|---|
| `@huggingface/transformers` | ^4.3.1 | Transformers.js v4，直接提供 ASR pipeline、q8 dtype、时间戳 chunk、进度回调；动态 import 不进主包 | Apache-2.0，可商用 |
| 内嵌 onnxruntime-web | 1.31.0-dev（随 transformers 私有依赖） | v4 指定的 WASM 推理内核；与顶层 003/图片工具用的 ort ^1.30.0 **隔离并存**，自托管到独立 `public/whisper/` | MIT，可商用 |
| 模型 Xenova/whisper-tiny（多语 q8） | — | 最小多语 Whisper，CPU 单线程可跑；encoder q8 ≈ 10.1MB、decoder(merged) q8 ≈ 30.5MB，运行时 CDN 下载 | 权重 MIT，可商用 |
| 音频解码 | 浏览器原生 `decodeAudioData` + `OfflineAudioContext` | 零依赖支持 wav/mp3/m4a/ogg/flac/webm，统一重采样 16kHz 单声道 | 浏览器原生 |
| 录音 | MediaRecorder | 原生麦克风录制 | 浏览器原生 |
| 存储 | IndexedDB（复用 `reusable-module/indexeddb-kv`） | 历史仅存文字/分段/纪要/元信息，不存音频 | 零依赖 |
| 纪要 | 纯规则抽取（`lib/summarize.ts`） | 零额外大模型、零幻觉、离线可用；生成式纪要列 V1.1 | 自研 |

**依赖隔离与体积决策**：transformers v4 内嵌 ort1.31 与仓库顶层 ort1.30 大版本不同，二者 WASM 产物不通用，故 004 的 ort1.31 plain 版（`ort-wasm-simd-threaded.wasm` 14MB + `.mjs` 24KB）独立放 `public/whisper/`，与 003/图片工具的 `public/onnx/` 互不干扰。decoder q8 ≈ 30.5MB **超过 EdgeOne 单文件 25MiB 上限**，因此模型不随包自托管，改为运行时从模型 CDN 下载 + Service Worker 运行时缓存。

## 关键实现

- **链路**：文件/麦克风 → `decodeTo16k`（原生解码 + OfflineAudioContext 重采样 16k 单声道 Float32）→ ASR pipeline（`return_timestamps` + chunk）→ `toSegments` 生成带时间戳分段 → `summarize` 规则抽取纪要 → `saveRecord` 落 IndexedDB → txt/md/srt 导出。
- **模型源探测（`pickModelHost`）**：依次 HEAD 探测 `huggingface.co` 官方 → `hf-mirror.com`，选第一个能完成 CORS 握手且 6s 内可达的源，官方优先。
- **自托管 WASM（关键）**：`env.backends.onnx.wasm.wasmPaths` 用**对象** `{ mjs, wasm }` 显式指向 plain 版，并 `proxy=false; numThreads=1`，在无 COOP/COEP（无 SharedArrayBuffer）下稳定走主线程单线程 WASM。
- **计费**：接方子统一计费钩子，主方案 freemium（每自然月 3600 秒免费）+ 买断 ¥49.90 不限时；额度按 `fz-lt:used-sec:YYYY-MM` 在本机统计。
- **离线**：vite/workbox `fangzi-ai-models` CacheFirst 规则同时覆盖 `/onnx/`、`/whisper/` 与模型 CDN，首次使用后离线可转写。
- **reusable-module 增强**：`indexeddb-kv` 由模块级单例改为 `Map<dbName, Promise<IDBDatabase>>` 多库缓存，修复「先打开 A 库再打开 B 库会错误复用 A 连接」的多工具隐患；失败删键允许重试，函数签名不变、向后兼容。

## 踩坑记录

1. **hf-mirror 浏览器跨域不可用（curl 假象）**：`curl -H Origin` 时 hf-mirror 看似回显 `access-control-allow-origin`，但无头 Chromium 实际 HEAD/GET 均 `TypeError: Failed to fetch`——其 307 跳转链在浏览器端被 CORS 拦截。**结论：浏览器端以 huggingface.co 官方源为准（实测 HEAD 200 ~665ms、GET 200 ~400ms，模型经 xet-bridge CDN 200 下载）**，hf-mirror 仅作探测兜底；不要再用 curl 结论判断浏览器 CORS。003 的 models.ts 注释称镜像 CORS 可用，浏览器实测并不可靠。

2. **ort 1.31 字符串 wasmPaths 会硬编码 asyncify（本任务最大坑）**：把 `wasmPaths` 设成字符串目录 `'/whisper/'` 时，ort 1.31 主线程工厂（dist `vs()`）无视 numThreads/proxy，硬编码 `import('…/ort-wasm-simd-threaded.asyncify.mjs')`，而该 asyncify wasm **26MB，超 EdgeOne 25MiB 单文件上限且目录中只有 plain 版 → 404，转写永久挂起**。源码定位：仅当 wasmPaths 为对象 `{ mjs, wasm }` 时才用显式 URL（`Kt` 取 `mjs/wasm`，`locateFile` 返回完整 wasm URL）。改为对象指向 plain 14MB 版后，主线程直接 `import .mjs`、locateFile 加载 plain wasm，转写立刻跑通（13s 音频推理约 7.9–8.9s）。备选 jspi(17MB) 未采用。

3. **真实产品 bug：顶部「历史」按钮不切换 tab**：`@click="refreshHistory()"` 只刷新数据未设置 `tab`，导致历史视图永远打不开（记录其实已正确落库）。新增 `goHistory()`（先 `tab='history'` 再刷新）。**该 bug 由 E2E「历史为空」暴露，经 `indexedDB.databases()` 直查确认数据在库、纯为视图切换问题。**

4. **真实产品 bug：波形在结果首次出现 / 切 tab 回来时空白**：转写区用 `v-if="tab==='transcribe'"`，切走再切回 DOM 重建、canvas 复位；而波形只在 `watch(audioUrl)`（且 audioUrl 在「就绪页」就已设置，那时结果 canvas 尚未挂载）与点击/播放时绘制。修复：增加 `watch([current, tab])`，在转写结果出现或切回转写页后用**双 rAF** 等布局完成再 `drawCurrentWave()`。E2E 增加「波形非白像素 ≥1000」硬断言防回归。

5. **E2E 断言自身修正**：`<audio>` 无 `controls` 不占可视盒，`waitForSelector` 默认等「可见」必超时 → 改 `state:'attached'` 并校验 src；多端原用全新 context（独立 IndexedDB 读不到记录）只拍到空历史 → 改同 context 内切视口、打开已存记录截真实结果页。

6. **Service Worker 不接管首开页面（V1.0.1）**：workbox 默认不 `clientsClaim`，新 SW 即使 `activated`，**首次打开的标签 `navigator.serviceWorker.controller` 仍为 null**，此时 `/mf` 完整 decoder 请求直达静态服务器，被 SPA `navigateFallback` 回退成 200 的 `index.html`（990B，`text/html`），onnx 拿到 HTML 解析直接挂起（转写 30s 超时无错误）。修复：workbox 开 `skipWaiting:true + clientsClaim:true`，安装即接管；E2E 先等 `serviceWorker.ready`+controller 再测。

7. **静态回退会污染分片；必须用精确清单且警惕增量构建残留**：
   - 探测式拉分片（一直取到非 200）不可行——不存在的 `.partN` 也被 SPA 回退成 **200 HTML**，被当成第 4 片拼入，合并得到 30,733,705B（恰多 index.html 5,940B）。改为 `shards.json` 声明确定片数 + content-type/首字节 `0x3c('<')` 双保险拒绝 HTML。
   - 一度改了 `public/sw-model-shards.js`、加了 `public/mf/shards.json` 但 dist 里仍是旧文件——`vite build` 非 `emptyOutDir` 且 dist 被运行中的 preview 以 FUSE 挂载占用，清空失败致构建中止。教训：改 public 静态资源后，按端口 kill preview → 干净重建 → 校验 `dist/` 确有新文件，别只看 build 成功。
   - SW 内部 `fetch('.partN')` **不会再触发自身/页面的 request 事件**，故 E2E 无法从页面侧统计到分片请求；正确做法是直接 fetch 完整逻辑文件断言合并字节数。

8. **真机 protobuf parsing failed：客户端缓存了部署竞态下的坏响应（V1.0.2）**：V1.0.1 上线后真机仍报 `Can't create a session. ERROR_CODE 7 … protobuf parsing failed`，但服务端逐文件核查（裸域/www、encoder 10,124,910、decoder 三片 15M+15M+727,765、config 2248、SW 版本）全部正确。判定为**手机端早期某次加载（部署未完成 / SW 刚接管的竞态窗口）把非分片文件的 HTML 回退当 200 写进了 Cache Storage，之后一直命中坏缓存**；V1.0 旧 SW 对非分片文件也无类型/完整性校验。V1.0.2 加固：①缓存名升级 `fangzi-model-files-v2` 一次性作废旧缓存；②`shards.json` 升 v2，分片项带 `{count,size}`，合并后强制校验总字节=30,727,765，不符即抛错；③**所有 /mf 文件（含 encoder/config/tokenizer）统一拒绝 text/html / 首字节 `0x3c`，绝不写入缓存**；④命中缓存时分片文件复核 content-length、任何文件拒绝 HTML，不符即删除重取。复跑 E2E 14/14。

## 验证覆盖

- **档位 H 质量门全绿**：`vue-tsc --noEmit` 0 错；**全量单测 140/14 通过**（本工具 `local-transcribe.test.ts` 14 例覆盖分段/时钟/SRT/合并拆分/规则纪要/额度/导出等纯逻辑）；`npm run verify:tools` = **17 个工具** manifest/注册/示例回归通过；`npm run build` 成功。
- **浏览器真实链路（V1.0.1，实证）**：Playwright + 无头 Chromium（SW 已接管），导入真实 13s 英文 WAV → 原生解码 16k → 自托管 `/whisper` plain WASM 200 → **同源 `/mf` 经 SW 分片合并加载 whisper-tiny q8（decoder 合并字节精确 30,727,765，零 huggingface/镜像请求）** → 真实推理出两段文字稿（命中 dream/nation），用时约 6.1s；时间戳跳转、规则纪要、SRT、额度 0.2/60、历史、波形非白像素均通过。**E2E 14/14 通过。**
- **多端多尺寸**：PC 1280×800、平板 834×1112、手机 375×812，转写空态与结果页横向溢出 Δ 均 ≤1px；移动端播放器换行、波形整行。
- **EdgeOne 免费版限额实测（V1.0.1 同源自托管后）**：`dist` **86MB**（< 5GiB）、**95 个文件**（< 20000）、**最大单文件 13.6MiB**（`ort-wasm-simd-threaded` wasm，< 25MiB）；模型最大 decoder 30.7MB 已切为 15M+15M+0.7M 三片，单文件全部 < 25MiB；26MB asyncify 已在 postbuild 阶段被清理守卫拦截。
- **准确率边界（如实）**：英文近完美（"I have a dream. One day, this nation will rise up, live out the true meaning of its dream."）、chunk 时间戳正确；中文 4.5s 样本 tiny 识别较弱，guide 已明确声明并建议人工校对，base/small 列 V1.1。

### guide 截图有效性验证（均为本轮生产构建后真实页面实拍）

| 文件 | 像素 | 大小 | 内容 | 结论 |
|---|---|---|---|---|
| shot-01-pc-result.png | 1280×800 | 115,661 B | PC 结果页：两段英文稿、已渲染波形+前2秒绿色播放段、纪要、变速、SRT、额度、¥49.90 | 通过 |
| shot-02-pc-history.png | 1280×800 | 86,614 B | PC 历史列表 1 条记录（en / 00:13 / 英文） | 通过 |
| shot-03-tablet.png | 834×1112 | 116,909 B | 平板打开历史记录的文字稿结果页，无横向溢出 | 通过 |
| shot-04-phone.png | 375×812 | 77,446 B | 手机单栏结果页，播放器换行，无横向溢出 | 通过 |

均非 0 字节、PNG 头校验通过、与 guide 引用及文案一致。

- **未覆盖 / 人工复测项**：麦克风 MediaRecorder 录音在无头环境未模拟，建议真机复测；真机独显 Chrome 的长音频推理耗时、Safari 老版本解码兼容性建议上线后抽测。

## 可复用经验

1. **ort 1.31 + Transformers.js v4 自托管 WASM 范式**：无跨域隔离站点统一用「对象 wasmPaths `{mjs,wasm}` 指向 plain 版 + `proxy=false; numThreads=1`」，切勿传字符串目录（会拉 26MB asyncify，撞 25MiB 上限）。已在本工具 `lib/asr.ts` 落地，后续浏览器端 transformers.js 工具可直接照抄。
2. **浏览器 CORS 以真机/无头 fetch 为准，不信 curl**：镜像站 307 跳转在浏览器端可能被 CORS 拦，模型源要做运行时 HEAD 探测 + 多源兜底。
3. **大模型文件绕行 EdgeOne 25MiB**：单文件超限的权重运行时从带 CORS 的 CDN 下载 + SW CacheFirst，不进静态包；WASM 内核选 <25MiB 的 plain 变体自托管。
4. **indexeddb-kv 多库安全**：多工具各自 dbName 时连接必须按 dbName 缓存（已沉淀回 `reusable-module/indexeddb-kv`），避免串用首个连接。
5. **v-if 重建的 canvas 需数据/路由变化后重绘**：用双 rAF 等布局完成，且在 E2E 用「非白像素计数」断言，比仅断言元素存在更能拦住空白画布。

## V1.1 未完成项（明确列出，不留悬空）

Qwen2.5 本地生成式纪要；whisper-base/small 模型可选；说话人分离；ffmpeg.wasm 视频提音轨；术语 initial_prompt（Pro）；批量队列。
