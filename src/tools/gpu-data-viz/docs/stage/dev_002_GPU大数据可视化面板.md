# 开发详细设计：GPU大数据可视化面板

- 对应 architect：architect_002_GPU大数据可视化面板.md
- 设计日期：2026-10-15

## 需求拆解清单

| 编号 | 需求条目 | 实现方法 | 技术要点 | 涉及模块/文件 | 依赖关系 | 验收要点 |
| --- | --- | --- | --- | --- | --- | --- |
| D01 | CSV/JSON 流式解析 | 分块读取（FileReader/流式），Web Worker 解析，typed array 存储 | 首行表头、类型推断 number/date/string | lib/load.ts | — | 100 万行解析内存 < 400MB |
| D02 | 能力探测与降级决策 | `navigator.gpu`→WebGL2→Canvas2D 探测 | 档位决定渲染后端与数据量上限提示 | lib/render/detect.ts | D01 | 无 GPU 环境正常降级 |
| D03 | WebGPU 渲染管线 | compute shader binning（hexbin/线性）+ vertex buffer 绘制 | 数据常驻 GPU；缩放时重 binning | lib/render/webgpu.ts | D02 | 100 万点 ≥55fps |
| D04 | WebGL 回退管线 | 同一交互接口，GLSL 实现 binning/绘制 | 与 WebGPU 输出一致 | lib/render/webgl.ts | D02 | 100 万点可用 |
| D05 | Canvas 兜底 | 小数据量（<10 万点）Canvas2D 直绘 | 简单可靠 | lib/render/canvas.ts | D02 | 可用即可 |
| D06 | 交互（缩放/平移/框选/刷选） | 相机矩阵 + 刷选矩形 → GPU viewport 参数更新 | 交互延迟 < 100ms | lib/interact.ts | D03,D04 | 刷选高亮正确 |
| D07 | 图型支持 | 折线(density line)/散点(hexbin)/热力/K线+成交量/多通道波形 | 首版折线+散点+热力 | lib/render/*.ts | D03 | 三图型可切换 |
| D08 | 导出 | Canvas 快照 PNG；筛选结果 CSV | 文件名含时间戳 | lib/export.ts | D06 | 导出文件可打开 |
| D09 | 计费接入 | freemium：免费 50 万点；Pro 解锁全量 | `useToolBilling('gpu-data-viz')` | index.vue | D01 | 权益判定正确 |

## 技术选型落地

- 语言/框架：TypeScript + Vue3；渲染自研（WGSL/GLSL，约 2-3k 行），不引重型图表库；可选 fflate（MIT）压缩导出；零成本、商用友好。

## 模块设计

见 architect_002 系统架构；load（数据）→ render（探测/三后端）→ interact（相机与刷选）→ export；index.vue 组装 UI。

## 关键实现方法

```wgsl
// WebGPU binning compute（示意）
@compute @workgroup_size(64)
fn bin(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= dataLen) { return; }
  let p = vec2<f32>(data[i*2], data[i*2+1]);
  let cell = floor((p - viewMin) / cellSize);
  atomicAdd(&bins[cell.y * gridW + cell.x], 1u);
}
```
```ts
// 交互→渲染参数（interact.ts）
export function applyBrush(r: Rect, view: View) {
  // 更新 viewport 裁剪与筛选列，标记 renderer.invalidate()
}
```

## 文件清单

- 新建：`src/tools/gpu-data-viz/manifest.ts`、`index.vue`、`lib/load.ts`、`lib/store.ts`、`lib/render/detect.ts`、`lib/render/webgpu.ts`、`lib/render/webgl.ts`、`lib/render/canvas.ts`、`lib/interact.ts`、`lib/export.ts`
- 修改：无（纯新增工具）

## 开发环境与工具链

- Node ≥ 20.19；Vite dev；WGSL/GLSL 编辑（VS Code wgsl 插件可选）；`npm test`、`npm run verify:tools`。

## 开发步骤与里程碑

- M1（2 天）：load/store + detect；
- M2（4-5 天）：WebGPU 渲染（折线+散点 binning）；
- M3（2-3 天）：交互 + 导出；
- M4（2-3 天）：WebGL/Canvas 降级 + 计费 + 回归。

## 代码规范与质量要求

- fangzi 现有风格（`<script setup lang="ts">`、严格 TS）；渲染代码注释 WGSL/GLSL 对应关系；动态 import 渲染模块；不进 SW 预缓存。

## 验收标准

- `npm run type-check`、`npm test`（新增 load/binning/interact 单测）通过；
- Chrome 桌面：100 万点折线 ≥55fps、内存 <500MB；WebGL 降级可用；刷选筛选与导出正确；
- `npm run verify:tools` 命中「数据分析/图表/csv」关键词；存量工具回归正常。
