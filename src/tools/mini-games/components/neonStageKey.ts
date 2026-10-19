import type { InjectionKey } from 'vue'

/**
 * FocusStage 通过该键向内部 GPU 游戏注入控制句柄。
 * 游戏在“点按但未拖动”（不是滑动操作）时可调用 toggleMenu() 唤出/收起极简控制浮层，
 * 从而在不遮挡滑动操作的前提下，满足“轻触唤出控制”的沉浸交互。
 */
export interface NeonStageApi {
  toggleMenu: () => void
}

export const NEON_STAGE_KEY: InjectionKey<NeonStageApi> = Symbol('neon-focus-stage')
