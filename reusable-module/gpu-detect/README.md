# gpu-detect — 浏览器 GPU 能力探测与降级

通用、零依赖的 WebGPU/WebGL2 能力探测，内置超时与「只探 adapter」的安全约定，避免在软件渲染/headless 环境踩 Dawn instance 污染的坑。

- 位置：`gpu-detect/gpu-detect.ts`
- 授权：MIT（fangzi 内部模块）
- 沉淀日期：2026-10-15（GPU 大数据可视化面板 pipeline 002 沉淀）

## 快速开始

```ts
import { detectGpu } from '@/reusable-module/gpu-detect/gpu-detect'

const cap = await detectGpu() // 默认 adapter 超时 4s
if (cap.preferred === 'webgpu') {
  // device 在渲染器里自己申请，并 try/catch + 超时降级
  try {
    const device = await withTimeout(adapter.requestDevice(), 8000, 'device 超时')
    return useWebGpu(device)
  } catch {
    return useWebGL2() // 降级
  }
}
if (cap.preferred === 'webgl2') return useWebGL2()
return useCanvas2D()
// cap.webgpuError 可直接作为「当前浏览器不支持 WebGPU，已自动切换兼容后端」的提示文案
```

## API

| 导出 | 说明 |
|---|---|
| `detectGpu(timeoutMs?)` | 异步完整探测，返回 `{ webgpu, webgl2, preferred, webgpuError }` |
| `probeWebGPU(timeoutMs?)` | 只探到 adapter，返回 `{ ok, adapter?, error? }`，**不申请/销毁 device** |
| `hasWebGL2()` | 同步判断 WebGL2 上下文可否创建 |
| `quickGpuGuess()` | 零副作用首屏初判（看 `navigator.gpu` 特性 + WebGL2） |
| `withTimeout(promise, ms, label)` | 给永不 settle 的 Promise 加超时 |

## 铁律

- **不要**在探测阶段 `adapter.requestDevice()` 后 `device.destroy()`：会污染 Dawn 共享 instance，致后续 device 无法上屏（详见 pipeline 002 postmortem 踩坑 2）。
- 探测只回答「有没有可用 adapter」；device 能否真正用于渲染，由渲染器创建链的 try/catch + 超时决定，并保留 WebGL2/Canvas2D 降级。
- 任何 GPU 请求都要带超时：软件渲染下 `requestAdapter/requestDevice` 可能长时间不返回。
