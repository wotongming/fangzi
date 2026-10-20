# use-pull-to-search

首页顶部「垂直下拉唤起搜索」手势的**纯函数**判定（零依赖 TS，可在 node:test 下单测）。

## API

- `PULL_SEARCH_RATIO = 0.25`：触发搜索需下拉 ≥ 1/4 视口高（原始位移口径）。
- `PULL_DAMPING = 0.55`：视觉跟手阻尼，仅用于位移展示。
- `VERTICAL_DOMINANCE = 1.2`：`|dy| >= |dx| × 1.2` 才算垂直手势，防水平滑动误触。
- `canStartPull({scrollTop, dy, dx})`：顶部（scrollTop≤0）+ 向下（dy>0）+ 纵向主导才允许开启。
- `pullOffset(dy, viewportH)`：阻尼后的视觉位移（封顶）。
- `pullProgress(dy, viewportH)`：0~1 进度。
- `decideRelease(dy, viewportH)`：`'search' | 'bounce'`，达标跳转、否则回弹。
- `pullHint(progress)`：`继续下拉找方子 / 松开搜索`。

## 使用示例（绑定在首页内容容器 touch 事件）

```ts
import { canStartPull, pullOffset, pullProgress, decideRelease, pullHint } from './use-pull-to-search'

// touchstart：记录 y0；touchmove：若 canStartPull 则 preventDefault 并设置 translateY=pullOffset
// touchend：decideRelease → search 跳转 /search，bounce 则回弹到 0
```

仅在满足「顶部 + 垂直下拉」时 `preventDefault`，正常滚动与水平滑动不拦截，避免卡死页面。
