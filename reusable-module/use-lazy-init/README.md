# use-lazy-init — 安全初始化 v-if/异步数据后的 canvas 与控制器

Vue 3 composable，用「post watcher + onMounted 双触发 + 幂等守卫」保证：当数据就绪且必需模板 ref 都已挂载时才执行一次初始化；初始化失败可在下一次就绪变化时重试。

- 位置：`use-lazy-init/use-lazy-init.ts`
- 依赖：Vue 3
- 授权：MIT（fangzi 内部模块）
- 沉淀日期：2026-10-15（GPU 大数据可视化面板 pipeline 002 沉淀）

## 解决的问题

canvas 放在 `v-if="dataset"` 区块里，组件 `onMounted` 时数据为空、canvas 未挂载，初始化函数拿不到 ref 提前 return 且此后不再执行 → 控制器永不初始化、画面永久空白。只在 `onMounted` 初始化或只 watch 都不可靠，需要 post watcher 与 onMounted 双触发。

## 快速开始

```ts
import { useLazyInit } from '@/reusable-module/use-lazy-init/use-lazy-init'

const dataset = ref<Dataset | null>(null)
const dataCanvas = ref<HTMLCanvasElement | null>(null)
const hudCanvas = ref<HTMLCanvasElement | null>(null)
let controller: VizController | null = null

useLazyInit({
  when: () => dataset.value,                 // 数据就绪
  require: [() => dataCanvas.value, () => hudCanvas.value], // canvas 已挂载
  init: async () => {
    const cap = await detectGpu()
    controller = new VizController(dataCanvas.value!, hudCanvas.value!)
    await controller.init(cap.preferred)
    // canvas 晚于数据挂载：初始化后把当前数据/图型补灌进去
    controller.setDataset(dataset.value!)
  },
  dispose: () => controller?.destroy()
})
```

## API

| 选项 | 说明 |
|---|---|
| `when` | 就绪条件（watch 源或 getter），真值表示数据/状态就绪 |
| `require` | 模板 ref 取值器数组，全部非 `null/undefined/false` 才执行 init |
| `init` | 初始化动作（可 async）；完成后通常在此把当前数据补灌进控制器 |
| `dispose` | 组件卸载清理（可选），自动注册到 `onBeforeUnmount` |

返回 `{ ensure, reset }`：`ensure()` 可手动触发（仍受幂等与就绪判断保护）；`reset()` 清除幂等标记。

## 说明

- watcher 使用 `{ flush: 'post' }`，在 DOM 更新后执行，确保 `v-if` 节点已挂载。
- init 抛错时会自动复位幂等标记并 `console.error`，下一次数据/DOM 变化可重试，不会一次失败永久卡死。
