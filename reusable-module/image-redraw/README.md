# image-redraw —— 安全解码 / 重绘 / 编码（顺带彻底剥离元数据）

把图片 `解码（自动按 EXIF 定向）→ 等比缩放 → 自定义绘制（如打码）→ 编码为 jpeg/webp/png` 合成一个纯函数。经 Canvas 重绘输出的文件**不含任何 EXIF/XMP/IPTC/PNG 文本元数据**，是最稳妥的隐私剥离方式，同时完成缩放、白底（jpeg）、质量与格式控制。

- 位置：`image-redraw/image-redraw.ts`
- 授权：MIT（fangzi 内部模块）
- 零依赖；`createImageBitmap` 不可用时回退 `HTMLImageElement`；支持传入 `OffscreenCanvas`（Worker 批量）。
- 沉淀日期：2026-10-17（照片隐私清理工作台 pipeline 006 沉淀）

## 快速开始

```ts
import { redrawImage, supportsWebp } from '@/reusable-module/image-redraw/image-redraw'

const { blob, width, height } = await redrawImage(file, {
  outType: supportsWebp() ? 'image/webp' : 'image/jpeg',
  quality: 0.82,
  maxEdge: 2048,
  paint: (ctx, w, h) => applyMasks(ctx, w, h, masks, 'mosaic') // 在最终画布上打码
})
```

## API

| 导出 | 说明 |
| --- | --- |
| `redrawImage(file, opts, canvas?)` | 返回 `{ blob, width, height }`；输出无元数据。`maxEdge` 限最长边，`paint` 做额外绘制 |
| `supportsWebp()` | 当前环境是否支持 webp 编码（旧 Safari 回退 jpeg） |

## 注意

- jpeg 输出会先铺白底（透明像素不变黑）。
- 重绘会丢弃色彩配置文件与内嵌缩略图——隐私/发布场景符合预期。
