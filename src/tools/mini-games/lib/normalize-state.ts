/**
 * 小游戏本地状态的纯归一化（无 DOM / 无 IndexedDB / 无路径别名，可直接被 node:test 引用）。
 * 从 storage.ts 拆出，保证“旧数据兼容”这类高频逻辑能在毫秒级单测中覆盖。
 */

export interface MiniGameSettings {
  /** 静音（音效总开关） */
  muted: boolean
  /** 触感振动（不支持的设备静默忽略） */
  vibrate: boolean
  /** 粒子规格：auto=按设备与帧率自适应；high/low=手动锁定 */
  particle: 'auto' | 'high' | 'low'
}

export const DEFAULT_SETTINGS: MiniGameSettings = {
  muted: false,
  vibrate: true,
  particle: 'auto'
}

export interface PersistedState {
  best: Record<string, number>
  /** 007 新增：可选设置；旧数据无此字段 */
  settings?: Partial<MiniGameSettings>
}

export interface MiniGameState {
  best: Record<string, number>
  settings: MiniGameSettings
}

/** 把可能是旧结构（无 settings）的持久化数据归一化为运行态；不读写库。 */
export function normalizeState(raw?: PersistedState): MiniGameState {
  const best = raw?.best ?? {}
  const s = raw?.settings ?? {}
  const settings: MiniGameSettings = {
    muted: typeof s.muted === 'boolean' ? s.muted : DEFAULT_SETTINGS.muted,
    vibrate: typeof s.vibrate === 'boolean' ? s.vibrate : DEFAULT_SETTINGS.vibrate,
    particle: s.particle === 'high' || s.particle === 'low' || s.particle === 'auto'
      ? s.particle
      : DEFAULT_SETTINGS.particle
  }
  return { best, settings }
}
