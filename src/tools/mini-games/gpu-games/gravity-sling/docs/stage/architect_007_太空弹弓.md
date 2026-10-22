# 架构设计 · 007 太空弹弓（《挽星弓》gravity-sling）

- 日期：2026-10-22
- 上游：`pm_007_太空弹弓.md`（可集成，合集内新增子游戏，verify 保持 35）
- 档位：M

## 一、设计依据
- innovator：拖拽反向拉伸双自由度瞄准、实时预测轨迹、多星引力借力、combo 连锁、13 关演进、程序化音画、本地离线。
- 宿主约束：mini-games 合集已有 FocusStage 全屏托管、高分 IndexedDB、NeonAudio、暂停/静音/振动/粒子档 props 契约；子游戏只负责自身状态机、渲染与事件发射。

## 二、总体架构（单文件内核 + 最薄 Vue wrapper）

```
index.vue（宿主，NEON 数组追加一条 GameDef，动态 import）
 └─ gravity-sling.vue（wrapper：canvas 挂载、props/emit 转发、卸载清理、E2E 调试接缝）
     └─ game/sling-core.ts（自包含原生内核：纯物理 + 关卡表 + 预测 + combo + 渲染 + 快照）
         ├─ 纯函数：gravityAccel / aimVector / powerFromPull / predictTrajectory /
         │          stepFrame / resolveCombo / levelByIdx / serializeSave / validateSave
         ├─ 运行时：mount(canvas, opts) / destroy()，内部 rAF、ResizeObserver、pointer 事件
         └─ 复用：../../audio/synth.ts 的 NeonAudio + haptic（不新建 AudioContext）
```

### 分层边界
- **内核零框架、零第三方运行时**：不 import Vue、不 import 合集 engine/NeonEngine（本作自绘 Canvas2D 即可）；不 import 任何 npm 包；代码仅用原生 Canvas2D 与 WebAudio 封装。
- **wrapper 极薄**：不写游戏逻辑；只把 `paused/muted/vibrate/particle` 传给内核、把内核 `score/combo/gameover` 转发给宿主；`onBeforeUnmount` 调 `destroy()`。
- **纯逻辑可测**：物理积分、预测、碰撞、combo、通关/失败、快照序列化/校验全部导出为无 DOM 纯函数，node:test 直接引用。

## 三、世界坐标系与渲染适配
- 逻辑世界固定 `W=1000, H=1500`（竖屏比例），关卡天体/靶心/收集星均以该坐标系定义。
- 渲染时按 canvas CSS 尺寸做 contain 等比缩放 + 居中偏移，DPR 由 ResizeObserver 测量后设置 backing store；指针坐标先反算回世界坐标再进入瞄准逻辑。
- 镜头：本作关卡范围固定在单屏世界内，不做大范围跟随平移；仅在命中/失败时做轻量震屏与粒子爆发。

## 四、物理模型
- 天体类型：`gravity`（引力星）、`repel`（推斥星，力反向）、`blackhole`（强引力 + 事件视界吞噬）、`asteroid`（静态实体障碍，碰撞即失败）、`collect`（收集星，拾取加分）、`portal`（目标星门，进入捕获半径过关）、`moving`（沿椭圆轨道缓慢移动的靶心）。
- 加速度：`a = G·m / (r² + ε²)`，方向指向（repel 反向）；`ε` 为软化半径，防止近距奇点；黑洞质量放大、视界半径独立于实体半径。
- 时间推进：固定步长 `H=1/120s`，每帧累加器最多补 4 步；`dt` 钳制 ≤50ms；飞行中每步做一次实体碰撞 / 收集 / 捕获 / 出界判定。
- 发射初速度：`v0 = dir · power · V_MAX`，`dir = normalize(anchor − drag)`，`power = clamp(pullDist / MAX_PULL, 0, 1)`，力度映射二次曲线 `power²` 远端递增。
- 捕获/借力：进入引力星 `assistRadius` 且未进入实体半径 → 记一次借力（combo 窗口内累计），不锁死环绕，飞船继续惯性飞行；进入实体半径 → 坠毁失败；黑洞视界内 → 吞噬失败。
- 失败条件：撞实体、被黑洞吞噬、飞出世界边界、发射次数耗尽、限时归零。
- 过关条件：进入 portal 捕获半径（moving 靶心取当前位置）。

## 五、关卡与节奏（13 关，配置表集中管理）
| 关 | 主题 | 机制引入 | 资源约束 |
| --- | --- | --- | --- |
| 1 | 启程直瞄 | 无引力，直线命中静态靶心 | 无限发、预测常驻 |
| 2 | 沿途收星 | 直线上 2–3 颗收集星 | 无限发、预测常驻 |
| 3 | 引力偏折 | 旁侧小恒星压弯轨迹 | 无限发 |
| 4 | 单星绕弯借力 | 行星遮挡直线通路，绕半圈切入星门 | 无限发 |
| 5 | 反向抬升借力 | 上方恒星托举改向越障 | 无限发 |
| 6 | 双星接力 | A 星转向 → B 星加速 → 星门 | 3 发 |
| 7 | 三连借力链 | 三颗天体连续接力，combo≥3 计优 | 3 发 |
| 8 | 限次数挑战 | 仅 3 发，弹尽失败 | 3 发 |
| 9 | 限时窗口 | 星门周期开关 | 限时 |
| 10 | 动目标 | 靶心椭圆轨道移动，预判前置量 | 3 发 |
| 11 | 推斥天体 | 红色反重力星混合布局 | 3 发 |
| 12 | 黑洞与小行星带 | 黑洞吞噬 + 障碍穿行混合 | 3 发 + 限时 |
| 13 | 终局星系 | 限时 + 动目标 + 多收集星混合 | 3 发 + 限时 |

- 前 3 关预测轨迹常驻；4 关起每关前 2 次尝试显示预测，之后隐藏（常驻预测为预留付费权益，beta 默认放行）。
- combo：两次借力间隔 ≤1.5s 计入连击；倍率 `min(combo, 4)`；借力/收星得分乘倍率；中断归零。
- 三星评级：按收集星数量、剩余发射/时间、combo 峰值折算 1–3 星，仅作本关结算展示，不阻塞过关。

## 六、交互与反馈（Juice）
- 瞄准：橡皮筋连线 + 力度条（绿→红）+ 预测虚线点列（数值积分预演，限 90 步、pointermove 时节流重算）；拉力过短松手自动回弹，不计发射。
- 发射：尾迹粒子、轻震屏、发射上扫音；命中：顿帧 60ms、星门光柱爆发、琶音；借力：音阶上行；收星：短促叮；失败：低频下行 + 淡出结算。
- 首局手势引导：三步半透明提示（按住 → 后拖 → 松手），可点击跳过。
- 输入：统一 Pointer Events（touch + mouse），`touch-action:none`、`user-select:none`，单指可玩；最小触控热区 ≥44px；PC 鼠标同体验。

## 七、生命周期与存档
- 暂停：由 FocusStage `v-model:paused` 托管；内核 `watch(paused)` 停止 rAF 物理推进、挂起 AudioContext，恢复时清零 `last` 避免 dt 跳变；内核**不自行监听 visibilitychange**。
- 自动快照（仿 merge-planet 纯函数模式，独立键）：
  - localStorage 键 `fangzi:gravity-sling:auto-save:v1`；payload 带 `version/tool/chain/savedAt/level/score/combo/collected/shots/time/ship/assists`。
  - 仅 `phase==='aim'|'fly'` 且局面非空时写入；通关/失败/重开清除；hidden/pagehide 与 15s 定时节流写入。
  - 反序列化严格校验：版本/tool/chain 不符、JSON 损坏、坐标非有限 → 安全回退 null，绝不白屏抛错。
  - 重挂载若存在快照 → 弹「继续上一局 / 开始新局」；继续还原局面，新局丢弃快照。
- 高分：父级 `fz-mini-games-v1`，key `gravity-sling:classic`；内核不直接写该库。
- 键位隔离：禁止读写 `fangzi:merge-planet:*` 及其它任何既有键。

## 八、依赖与授权
- 运行时新增依赖：**无**。
- 复用合集 `audio/synth.ts`（NeonAudio / haptic，WebAudio 程序化合成，MIT 体系内自有代码）。
- 美术/音频 100% 程序化生成；无第三方图片、字体、音频、模型；无广告 SDK、无网盟、无后端、无遥测。

## 九、集成点清单（最小改动）
1. `src/tools/mini-games/index.vue`：NEON 数组追加一条 `GameDef`（id `gravity-sling`、免费、`kind:'gpu'`、`loader: () => import('./gpu-games/gravity-sling/gravity-sling.vue')`）；不新增 merge-planet 式存档槽位特例（自动快照由内核自管，不进父级暂停面板）。
2. 新建 `gpu-games/gravity-sling/gravity-sling.vue` 与 `game/sling-core.ts`。
3. `manifest.ts`：可选在 tagline/keywords 补「引力弹弓 / 弹射 / 关卡」；不新增 billing feature（beta 免费放行）。
4. 根 README 小游戏清单补一句本游戏。
5. 不改 registry、路由、ToolRunnerView、搜索、SW、根 manifest、public/icons、其它工具。

## 十、测试与验收方案
- 纯逻辑 node 单测：引力加速度与软化、固定步长推进、预测点列、捕获/软碰撞、combo 窗口与倍率、通关/失败判定、13 关配置完整性、快照 serialize↔validate 往返 + 损坏/版本不符回退。
- 三视口 Playwright：进入即玩、拖拽松手发射、驱动第 1 关过关进入下一关、分数/combo/关卡变化；hidden 自动暂停且进度不丢；reload 弹续玩、继续还原、新局清快照；断网可玩；零横向溢出、无 pageerror、零外部资源请求。
- 回归：其它 8 个子游戏选卡/进入不受影响；合集高分库读写正常。

## 十一、部署与回滚
- 随 PWA 常规 EdgeOne Pages 构建发布；游戏 chunk 走 Vite 动态分包，纳入既有 SW 预缓存。
- 回滚：单 commit  revert 本目录与 index.vue 追加项即可；无数据迁移、无 schema 变更。
