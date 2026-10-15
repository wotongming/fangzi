# worker-post — 安全向 Web Worker 发消息

解决向 Worker `postMessage` 时两个高频报错，零依赖、可在任意 TS 项目使用：

1. **`[object Array] could not be cloned`**：Vue `ref/reactive` 包裹的数组、对象是 Proxy，无法结构化克隆。发送前递归读取属性重建为普通对象/数组，自动剥离 Proxy。
2. **`Value at index 0 does not have a transferable type`**：误把 `File`/`Blob` 放进 transfer list。本模块只自动收集真正的 Transferable（`ArrayBuffer`/`MessagePort`/`ImageBitmap` 等），File/Blob 走结构化克隆。

- 位置：`worker-post/worker-post.ts`
- 授权：MIT（fangzi 内部模块）
- 沉淀日期：2026-10-15（GPU 大数据可视化面板 pipeline 002 沉淀）

## 快速开始

```ts
import { postTo, toWorkerMessage } from '@/reusable-module/worker-post/worker-post'

// 1) 一行发送：自动剥离 reactive Proxy、自动零拷贝转移 ArrayBuffer
postTo(worker, {
  kind: 'buildCsv',
  file,                 // File/Blob：自动走结构化克隆，不会误进 transfer list
  headers: info.headers, // 即使是 Vue reactive 数组也能安全发送
  types: Array.from(info.types),
  xIdx, yIdx
})

// 2) 只净化、不立即发送（需要自定义 transfer 时）
const { data, transfer } = toWorkerMessage(message)
worker.postMessage(data, transfer)
```

## API

| 导出 | 说明 |
|---|---|
| `postTo(worker, message, autoTransfer?)` | 净化并发送；`autoTransfer` 默认 `true`，自动把消息中的 `ArrayBuffer` 零拷贝转移 |
| `toWorkerMessage(message, autoTransfer?)` | 返回 `{ data, transfer }`：纯数据 + 收集到的 Transferable |
| `isTransferable(v)` | 判断是否可放入 transfer list（ArrayBuffer / MessagePort / ImageBitmap / OffscreenCanvas / VideoFrame） |

## 行为约定

- typed array（`Float32Array` 等）原样保留，其底层 `buffer` 自动登记为可转移；**转移后主线程该缓冲会被 neuter**，如主线程仍需使用请传 `autoTransfer=false`。
- 消息内的函数/方法会被剔除（嵌在对象/数组中）；顶层直接传函数会抛错。
- 支持循环引用、`Map`/`Set`/`Date`/`RegExp`、嵌套深度上限 100。
- File/Blob 永远走结构化克隆，**绝不**放入 transfer list。
