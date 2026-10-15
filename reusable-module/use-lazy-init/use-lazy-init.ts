/**
 * use-lazy-init —— 安全初始化位于 v-if / 异步数据后的 canvas / 第三方控制器。
 *
 * 解决的坑（pipeline 002 致命 bug）：
 *   canvas 放在 `v-if="data"` 的区块里，组件 onMounted 时数据为空、canvas 尚未挂载，
 *   此时初始化函数因拿不到 ref 提前 return 且之后不再执行，导致控制器永不初始化
 *   （徽标永远“探测中”、画面空白）。
 *
 * 本 composable 用「post watcher + onMounted 双触发 + 幂等守卫」保证：
 *   当“就绪条件”满足且所有必需模板 ref 都已挂载时才执行一次 init；init 失败可重试。
 *
 * 依赖：Vue 3。
 * 授权：MIT（fangzi 内部模块），沉淀自 pipeline 002 GPU 大数据可视化面板。
 */
import { onBeforeUnmount, onMounted, watch, type WatchSource } from 'vue'

export interface LazyInitOptions {
  /** 数据/状态就绪条件（如 () => dataset.value） */
  when: WatchSource<unknown> | (() => unknown)
  /** 额外要求“已挂载”的模板 ref 取值器列表（如 () => canvasRef.value），全部非空才 init */
  require?: Array<() => unknown>
  /** 真正的初始化动作（可 async）；完成后通常在此把当前数据补灌进控制器 */
  init: () => void | Promise<void>
  /** 组件卸载时的清理（销毁控制器、移除监听等），可选 */
  dispose?: () => void
}

export interface LazyInitHandle {
  /** 手动触发一次初始化（内部仍有幂等/就绪判断） */
  ensure: () => Promise<void>
  /** 复位幂等标记（init 失败后允许下一次 watcher/ensure 重新尝试） */
  reset: () => void
}

export function useLazyInit(opts: LazyInitOptions): LazyInitHandle {
  let tried = false
  let disposed = false
  let inflight: Promise<void> | null = null

  const refsReady = (): boolean =>
    !opts.require || opts.require.every((fn) => {
      const r = fn()
      return r !== null && r !== undefined && r !== false
    })

  const ensure = async (): Promise<void> => {
    if (tried || disposed || inflight) return
    const ready = Boolean((opts.when as () => unknown)())
    if (!ready || !refsReady()) return
    tried = true
    inflight = Promise.resolve()
      .then(() => opts.init())
      .catch((e) => {
        // init 失败：复位以便后续数据/DOM 变化时重试，避免一次失败永久卡死；同时不静默错误
        tried = false
        console.error('[use-lazy-init] 初始化失败，将在下次就绪变化时重试：', e)
      })
      .finally(() => {
        inflight = null
      })
    await inflight
  }

  // DOM 更新后触发（此时 v-if 的节点已挂载）
  watch(opts.when as WatchSource<unknown>, () => void ensure(), { flush: 'post' })
  // 组件挂载时若数据已就绪也能触发（双保险）
  onMounted(() => void ensure())
  if (opts.dispose) {
    onBeforeUnmount(() => {
      disposed = true
      opts.dispose?.()
    })
  }

  return { ensure, reset: () => { tried = false } }
}
