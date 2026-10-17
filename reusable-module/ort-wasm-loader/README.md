# ort-wasm-loader — onnxruntime-web 胶水脚本 MIME 兼容加载

解决静态托管（腾讯云 EdgeOne Pages 实测）把 ORT 胶水 `ort-wasm-simd-threaded.mjs`
以 `Content-Type: application/octet-stream` 下发，浏览器原生动态 `import()` 触发
严格 MIME 校验而失败的问题：

```
no available backend found. ERR: [wasm] TypeError:
Failed to fetch dynamically imported module: https://<host>/onnx/ort-wasm-simd-threaded.mjs
```

原理：`fetch()` 读取脚本不校验 MIME → 文本包成 `text/javascript` 的 `blob:` URL →
用对象形式 `wasmPaths = { mjs: blobUrl, wasm: 同源 wasm 直链 }`。`.wasm` 本身托管
MIME 正确（`application/wasm`）。非跨域隔离环境 ORT 自动单线程，胶水在主线程运行，
blob 模块无 Worker 派生问题；`crossOriginIsolated` 环境则直接用同源直链。

- 位置：`ort-wasm-loader/ort-wasm-loader.ts`
- 授权：MIT（fangzi 内部模块）
- 沉淀日期：2026-10-18（本地知识库语义后端热修 pipeline 003；同样适用于 image-converter、local-transcribe 的自托管 ORT/WASM）
- 依赖：无

## 快速开始

仓库内工具用相对路径引用（工具 `lib/` 目录上溯四级到仓库根）：

```ts
// src/tools/<tool>/lib/embed.ts
import { configureOrtWasm } from '../../../../reusable-module/ort-wasm-loader/ort-wasm-loader'

const ort = await import('onnxruntime-web/wasm')
await configureOrtWasm(ort)            // 默认目录 ${BASE_URL}onnx/（ort 1.30）
await ort.InferenceSession.create(/* ... */)
```

Transformers.js（env.backends.onnx.wasm）或非默认目录时用 `resolveOrtWasmPaths`：

```ts
wasm.wasmPaths = await resolveOrtWasmPaths({ dir: `${base}whisper/` })
```

## API

| 导出 | 说明 |
|---|---|
| `resolveOrtWasmPaths(opts?)` | 返回可直接赋给 `wasmPaths` 的值：优先 `{ mjs: blob:, wasm: 直链 }`，跨域隔离或失败时回退同源直链对象 |
| `configureOrtWasm(ort, opts?)` | 直接设置 `ort.env.wasm.wasmPaths`，返回 ort，便于一行链式调用 |

opts：`dir`（默认 `${BASE_URL}onnx/`）、`mjsName`、`wasmName`（默认
`ort-wasm-simd-threaded.mjs/.wasm`）。

## 行为约定

- blob URL 按目录缓存、会话期内不回收（Session 整个生命周期都可能用到）。
- 若抓到的是 SPA 回退 HTML（部署缺文件时常见），判定为失败并回退直链，不拿 HTML 冒充 JS。
- fetch 受 Service Worker 控制：二次访问可离线命中缓存后再生成 blob，离线可用。
- 部署侧仍建议在 EdgeOne 控制台为 `.mjs` 配置 `Content-Type: text/javascript`；本方案是不依赖控制台的代码侧兜底。
