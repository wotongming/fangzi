/**
 * use-pull-to-search：首页顶部「垂直下拉唤起搜索」手势的纯函数判定（零依赖、可单测）。
 *
 * 规则：
 *  - 仅当页面滚动到顶部（scrollTop<=0）且手指**垂直向下**（dy>0 且纵向占主导）才开始；
 *  - 水平滑动、非顶部一律不触发，避免误触正常浏览；
 *  - 视觉位移用阻尼压缩（PULL_DAMPING），阈值判定用原始 dy（按视口高比例）；
 *  - 松手时原始位移 ≥ 0.25*视口高 → 跳转 /search，否则平滑回弹。
 */

/** 触发搜索所需的下拉位移 / 视口高（1/4 屏）。 */
export const PULL_SEARCH_RATIO = 0.25
/** 视觉阻尼：跟手位移 = 原始位移 × 阻尼，超过目标后封顶，避免一拉到底。 */
export const PULL_DAMPING = 0.55
/** 纵向主导阈值：|dy| >= |dx| * 该倍数才算垂直手势。 */
export const VERTICAL_DOMINANCE = 1.2

export interface PullStartInput {
  /** 容器当前垂直滚动距离（顶部为 0）。 */
  scrollTop: number
  /** 当前点相对起点的纵向位移（向下为正）。 */
  dy: number
  /** 当前点相对起点的横向位移。 */
  dx: number
}

/** 是否允许开启下拉手势：顶部 + 向下 + 纵向主导。 */
export function canStartPull(i: PullStartInput): boolean {
  return i.scrollTop <= 0 && i.dy > 0 && Math.abs(i.dy) >= Math.abs(i.dx) * VERTICAL_DOMINANCE
}

/** 带阻尼的视觉下拉位移（始终为正；向上/负值返回 0）。 */
export function pullOffset(dy: number, viewportH: number): number {
  if (dy <= 0 || viewportH <= 0) return 0
  const cap = PULL_SEARCH_RATIO * viewportH * 1.15
  return Math.min(dy * PULL_DAMPING, cap)
}

/** 下拉进度 0~1（原始位移口径，供「继续下拉/松开搜索」提示与阈值判断）。 */
export function pullProgress(dy: number, viewportH: number): number {
  if (viewportH <= 0) return 0
  const raw = dy / (PULL_SEARCH_RATIO * viewportH)
  return Math.min(1, Math.max(0, raw))
}

export type PullDecision = 'search' | 'bounce'

/** 松手判定：原始下拉位移达标 → search，否则回弹。 */
export function decideRelease(dy: number, viewportH: number): PullDecision {
  if (viewportH <= 0) return 'bounce'
  return dy >= PULL_SEARCH_RATIO * viewportH ? 'search' : 'bounce'
}

/** 进度对应的提示文案：未达标「继续下拉找方子」，达标「松开搜索」。 */
export function pullHint(progress: number): string {
  return progress >= 1 ? '松开搜索' : '继续下拉找方子'
}
