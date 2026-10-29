# 架构方案：星脉（starvein）

## 需求回顾
单指拖动画光脉点亮程序化生星网；节点按 BPM 脉冲，窗口内穿过 = PERFECT（粒子 + 五声音阶音符 + combo）；黑暗潮汐从核心吞未点亮节点扣能量（5 格）；可引到出口门收线 ×1.5；S/A/B/C 评级；每日种子星图（后续）。

## 技术选型（全部既有栈，零新依赖）
- 渲染：Canvas2D（`globalCompositeOperation='lighter'` 加法混合、径向渐变、shadowBlur），DPR 自适应 + ResizeObserver。
- 音频：复用合集 `audio/synth.ts` 的 `NeonAudio`（`tone()` 奏五声音阶拨弦、`explode()` 收线、`hit(false)` 潮汐吞点），手势内 `ensure()` 解锁，`setMuted` 跟随宿主。
- 生命周期：暂停/回前台由宿主 FocusStage 托管（props `paused`），内核不重复监听 visibilitychange；自动快照走 localStorage。
- 存储：自动快照 `fangzi:starvein:auto-save:v1`（version/tool/chain 校验，损坏回退，hidden/pagehide/15s 节流写入，结算/重开清除）；最高分由父级 `onScore` 写入 `fz-mini-games-v1`。

## 模块划分
- `game/vein-core.ts`：单文件自包含内核。
  - 纯函数（无 DOM，导出供 node:test）：`mulberry32`、`generateStarMap(seed, stage)`、`bfsPath`、`nearestBeatOffsetMs`、`judge`、`tideFront`、`gradeOf`、`addNodeScore`、`serializeSave/validateSave`、`distToSegment`、`stageForRun`。
  - `mount(canvas, opts)`：Canvas 渲染、Pointer 输入、音频映射、自动快照、debug 句柄。
- `starvein.vue`：最薄 wrapper，只挂 canvas、转发 props（paused/muted/vibrate/particle）与 emit（score/combo/gameover）。

## 必可达保证（核心不变量）
1. 生成器先铺一条核心→出口的贪心通路（每步更靠近出口且 y 递减），再在邻近节点间补边（度数 ≤4）；
2. 生成后立即 `bfsPath(map)` 自检，不可达则 seed+101 重生成；
3. 单测对 50 个 seed × 3 个难度段全部断言 BFS 通路存在。
能量 5 格宽容 + 随时可收线，保证无"一步错整局死"。

## 难度曲线（stageForRun）
| 段 | 节点数 | BPM | PERFECT 窗口 | 潮汐速度 |
| --- | --- | --- | --- | --- |
| 1（1–2 局） | 12 | 100 | ±180ms | 0.55 节点/s |
| 2（3–5 局） | 20 | 110 | ±150ms | 0.8 节点/s |
| 3（6+ 局） | 28 | 120 | ±120ms | 1.1 节点/s |
抬手后潮汐 1.5s 内 +30%（犹豫惩罚）。

## 部署
PWA 走既有 EdgeOne Pages + Git 推送；chunk 走既有分包预缓存，不改 SW 策略、不改 manifest/icons。包体极小（纯代码）。

## 依赖授权
无新增运行时依赖；音频/渲染全部原生 Web API。
