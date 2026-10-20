# 技术沉淀：炫酷全屏沉浸小游戏（炫光 NEON 系列 M1 + M2）

- 对应 dev：`dev_007_炫酷全屏沉浸小游戏.md`
- 日期：2026-10-19
- 档位：**H**（GPU/WASM 类、实时渲染、多后端降级）。M1 交付渲染抽象 + WebGL2/Canvas2D + 首个 GPU 游戏 + 全屏沉浸 + 计费/存储兼容；**M2 追加**：两款 GPU 游戏（霓虹脉冲、星轨穿梭）、炫光连消手势重构（修复“一点就弹菜单”）、Wake Lock 屏幕常亮、特效档位实时切换，全量质量门通过。WebGPU 原生后端仍列后续。

## 技术选型与理由

- **零第三方图形/音频库**：WebGL2 点精灵 + 自写 GLSL ES 3.00 着色器实现加法混合辉光；Canvas2D 用按色相缓存的 radial-gradient 精灵做保底；音效用 Web Audio 振荡器 + 白噪声实时合成。零素材、零许可证风险，全部为原生 Web API（商用无限制）。
- **渲染后端抽象 `Renderer`**：`init/resize/setPalette/render/setBloomPasses?/dispose` 统一接口，M1 提供 `WebGl2Renderer`、`Canvas2dRenderer`，后续 `WebGpuRenderer` 只需实现同接口插到降级链最前。
- **降级链与超时**：`NeonEngine` 通过复用模块 `reusable-module/gpu-detect` 探测（只到 `requestAdapter()`，绝不探测期 `requestDevice()+destroy()`），初始化包 try/catch + 6s 超时；WebGL 上下文丢失监听热重启到 Canvas2D；M1 探测到 WebGPU 也先落 WebGL2。
- **复用既有内核与框架能力**：玩法判定直接复用存量 `lib/match3-core.ts`（交换/消除/下落/连锁/计分），只新增表现层与首波格位定位；计费接统一 `useToolBilling`（freemium + 买断主方案），沉浸态接 `useImmersive`，存储接 `reusable-module/indexeddb-kv`。
- **动态分包**：GPU 游戏 `import()` 拆独立 chunk（glow-match ≈ 22KB），按需加载且 <5MiB 自动进入 workbox 预缓存，离线可玩。
- 无运行时新增依赖，`@webgpu/types` 仅为类型；不存在已知 CVE 引入面。

## 关键实现

### 分层与数据流

- `engine/`：`types.ts`（Renderer/QualitySpec/FrameInfo）、`quality.ts`（设备分级 pickQuality / 运行时 stepDown / 手动档 applyManual / 地板 isFloor）、`fx.ts`（帧率无关粒子系统 ParticleSystem + ShakeState）、`shaders.ts`、`backend-webgl2.ts`、`backend-canvas2d.ts`、`neon-engine.ts`（装配 + RAF 固定步长 + 后台暂停 + 自动降档）。
- `audio/synth.ts`：`NeonAudio`（手势内建 AudioContext、五声音阶 blip、噪声 explode、节拍 beat）与 `haptic()`。
- `components/FocusStage.vue`：`position:fixed;inset:0;z-index:1000` 黑底整体覆盖，100dvh + `env(safe-area-inset-*)`；GPU 整屏 slot / DOM 居中限宽；极简 HUD 与自动隐去浮层；provide `NEON_STAGE_KEY` 供游戏"轻点唤出菜单"。
- `gpu-games/glow-match/`：`logic.ts`（tryMove 返回首波 BurstCell[] 与含连锁加权得分、hasPossibleMove）、`glow-match.vue`（居中 DOM 棋盘 + 全屏下层 canvas，pointer 滑动/轻点，精确格位 burst + setShake + 音效/振动）。
- `index.vue` 由单层面板改为**两层**：选游戏页 + FocusStage；FocusStage 按"游戏+难度"建 key（**不含重开 nonce**），重开只重建内部游戏组件，避免全屏容器卸载重进造成的沉浸态竞态。

### 帧率无关与自适应

粒子阻力用解析衰减 `e^-k·dt`、震屏 `e^-7dt`，RAF 单帧步长封顶 0.05s；连续 >1.1s 帧时 >22ms（≈低于 45fps）且冷却结束，按 **bloomPasses → DPR(-0.25) → 粒子上限减半** 降档，地板粒子 120、DPR 1、0 辉光，不回涨。

### 存储向后兼容

库名 `fz-mini-games-v1` / version 1 / store `kv` / `best` 结构完全不变；同一 state 文档新增可选 `settings`。纯函数 `normalizeState`（拆到无别名、无 DOM 依赖的 `lib/normalize-state.ts`）对旧数据逐项默认回退；读取不回写，仅用户改设置才落库。落库前把 Vue 响应式 Proxy 展开为纯对象，规避 IndexedDB 结构化克隆报错。

## 踩坑记录

1. **重开即退出全屏**：初版把重开 `nonce` 拼进 FocusStage 的 `:key`，重开导致全屏容器卸载→`imm.exit()`、新容器再 `enter()`，两者竞态把沉浸态关闭（专注层整体消失）。修复：FocusStage key 只含游戏+难度，重开仅提升内部游戏组件 key；同时 `NeonAudio.close()` 在组件卸载时关闭 AudioContext，避免反复重开堆积上下文。
2. **IndexedDB 无法克隆 Vue Proxy**：`saveBest` 传入响应式 `best`，`IDBObjectStore.put` 抛 "could not be cloned"。在 `persistState` 内展开成纯对象/原始字段后落库修复，并补 E2E pageerror 断言。
3. **严格模式类型**：`noUncheckedIndexedAccess` 下数组/Map/Uniform 取值须显式收敛（uniform 包一层 `U(name)` 返回 `WebGLUniformLocation|null`；色相/数组下标给默认值）；未使用的私有字段（palette/dpr）改为接口 no-op 或删除。
4. **路径别名边界**：`@/*` 仅映射 `src/*`，而 `reusable-module` 在仓库根；应用代码改用与全仓一致的相对路径；可纯逻辑单测的归一化拆到独立文件，node:test 无需解析别名。
5. **无头 Playwright 模块**：本地 `playwright` 包不含 chromium 启动器，E2E 直接引用全局 `/opt/vm/preinstall/npm-global/lib/node_modules/playwright` 与 `/usr/local/bin/chromium`（与既有 GPU E2E 一致）。
6. **软渲染只用于逻辑/交互视觉**：严格按 GPU 无头策略，强制 WebGL2（navigator.gpu=undefined + abort SW）做可视与交互断言，不依赖无头 WebGPU 上屏。

## 验证覆盖

- **单测（node:test + tsx）**：新增 `test/mini-games-neon.test.ts` 13 个用例，覆盖粒子爆发守恒/容量截断/到期回收、震幅上限与回落、pickQuality 分级、stepDown 降档顺序与地板、applyManual 高/低、tryMove 合法（得分=消除数×20、首波格位带色相、结算后无残留）/非相邻无效、hasPossibleMove、normalizeState 旧数据/部分设置/非法值/空输入。全量 `npm test` **320/320 通过**。
- **类型**：`vue-tsc --noEmit` **0 错**。
- **注册表回归**：`npm run verify:tools` 通过，工具数仍为 **27**（对既有 mini-games 重构升级，未新增工具）。
- **构建**：`npm run build` 成功。新增 chunk：glow-match JS ≈ 22.16KB(gzip 8.52KB)/CSS 1.08KB，mini-games JS ≈ 21.32KB(gzip 8.57KB)。
- **E2E（scripts/e2e-mini-games-neon-20261019.mjs，强制 WebGL2）**：PC/平板/手机三视图口。断言：2 张"即将上线"占位不可进入且不弹付费墙；免费态点三消弹 ¥19.90 付费墙；进入炫光连消后端落 webgl2、canvas backing 1280×800 正常、选游戏页元素消失（纯净）、HUD 唯一；**真实随机相邻滑动打出消除，HUD 分数实际增长（多次运行分别得到 60/240/800 分，含连锁）**；暂停→继续浮层显隐、重开分数归零并重建、退出回选游戏页；已购订单种子下三消可进且不显示 GPU 分数 HUD；三视图口横向溢出均为 0；无 pageerror/非噪声 console.error。**全部通过**。
- **多视口尺寸**：PC 1280×800、平板 834×1112、手机 375×812，溢出 `scrollWidth-clientWidth` 均为 0。

### EdgeOne Pages 免费版限额核查

| 指标 | 限额 | 实测 | 结论 |
| --- | --- | --- | --- |
| 单项目存储 | 5 GiB | 131 MiB | 通过 |
| 文件总数 | 20000 | 133 | 通过 |
| 单文件大小 | 25 MiB | 24,010,842 字节（≈22.9 MiB，bge 模型） | 通过 |
| workbox 预缓存单脚本 | 5 MiB | 预缓存内无 >5MiB 的 js/css/json/html | 通过 |

本功能零图片/音频/字体/wasm 素材，仅新增小型 JS/CSS chunk；glow-match chunk 已进入 SW 预缓存，离线可玩。

### guide 截图有效性验证（均为 preview 真实构建产物截图）

| 文件 | 像素 | 大小(字节) | 内容 | 是否通过 |
| --- | --- | --- | --- | --- |
| shot-01-pc-picker.png | 1280×800 | 137,930 | PC 选游戏页（经典+炫光区） | 通过 |
| shot-02-pc-paywall.png | 1280×800 | 139,203 | PC ¥19.90 付费墙 | 通过 |
| shot-04-pc-sheet-paused.png | 1280×800 | 210,223 | PC 暂停控制浮层 | 通过 |
| shot-05-pc-glow-fresh.png | 1280×800 | 226,576 | PC 炫光全屏（重开后 0 分纯净画面） | 通过 |
| shot-06-pc-dom-pro.png | 1280×800 | 31,379 | 已购进入专业版三消 DOM 全屏 | 通过 |
| shot-07-mobile-picker.png | 375×812 | 71,700 | 手机选游戏页 | 通过 |
| shot-08-mobile-glow.png | 375×812 | 145,248 | 手机炫光全屏（220 分 ×2 连击 + 粒子） | 通过 |
| shot-09-tablet-picker.png | 834×1112 | 138,088 | 平板选游戏页 | 通过 |
| shot-10-tablet-glow.png | 834×1112 | 230,662 | 平板炫光全屏 | 通过 |

全部为有效 PNG、非 0 字节、可正常打开，内容与 guide 文字描述一致；H 档要求的 PC 多视图 + 移动两端代表图满足。

## 已验证的 M1 范围 vs 未完成项

**M1 已交付并验证**：渲染抽象与 WebGL2/Canvas2D 双后端、设备分级与运行时自动降档、粒子/震屏、程序化音效与振动、FocusStage 纯净全屏、炫光连消（复用 match3-core）、index 两层化、freemium+买断计费钩子、存储向后兼容、动态分包离线、三视口 E2E 与真实截图。

**后续里程碑（本 checkpoint 明确未做）**：
- R4：WebGPU/WGSL 原生后端（接口已就位，插到降级链最前）；
- ~~G2 霓虹脉冲（单指节奏）、G3 星轨穿梭（穿梭）两款 GPU 游戏~~ → **M2 已完成上线**；
- ~~WakeLock 屏幕常亮、特效档位~~ → **M2 已完成**；主题/色盲模式仍为后续。

---

# M2 增量（2026-10-19）

## M2 技术选型与理由

- **玩法纯逻辑与表现彻底分离**：两款新游各自 `logic.ts`（无 DOM、无 Vue、无引擎，确定性纯函数）+ `*.vue`（RAF 驱动 + NeonEngine 粒子 + synth 音效 + 触摸输入）。逻辑可直接进 node:test，节奏判定/碰撞/计分全部毫秒级可测，不依赖浏览器。
- **复用 M1 引擎而非新写渲染**：两款新游都 `new NeonEngine(canvas,{manual,beat})`，命中/撞击用 `engine.burst()`、`setShake()`，色板 `setPalette()`；节奏游音符走 DOM、闪避游障碍走 DOM，环境星流与爆炸走引擎粒子，各司其职、包体不膨胀。
- **零网络、零后端（再次澄清）**：M2 全部代码 grep 无 `fetch/XHR/WebSocket`。面向用户文案统一用“图形渲染器（WebGL2/Canvas2D）”，避免“后端”被误解为服务器。
- 无新增任何运行时依赖/素材，依旧零图片、零音频、零 wasm 增量。

## M2 关键实现

### 霓虹脉冲 neon-pulse（专业版）

- `logic.ts`：3 轨、判定线 `HIT_Y=0.82`、完美半窗 0.05 / 良好 0.1、漏击线在判定窗下方；速度 0.42→0.9 归一化/秒、生成间隔 0.62→0.34s；`hitLane` 取本轨窗内最接近判定线的音符，完美 100 / 良好 60，连击每击 +2，**空击不扣分**（移动端防误触）；漏 3 个结束并结算最佳。
- `neon-pulse.vue`：单 RAF 调 `update()`；`pointerdown` 点轨击打（`setPointerCapture`），判定线处按轨道色相爆发粒子、`audio.hit(perfect)`、`haptic`；顶部 3 个漏击点、结束遮罩与组件内“再来一首”复位；切暂停挂起逻辑与音频。

### 星轨穿梭 orbit-surge（专业版）

- `logic.ts`：玩家固定 `PLAYER_Y=0.86`，横向以 `FOLLOW_SPEED=2.4` 平滑跟随目标并钳制 0..1；障碍 0.34→0.95 加速下落、间隔随时间收窄；圆形距离碰撞（玩家+障碍半径），生存每秒 100 分；撞障 `crashed` 结束并移除该障碍，越界障碍记 `dodged` 回收。
- `orbit-surge.vue`：全屏 `.field` 接收 `pointerdown/move/up`，按住即跟随；玩家蓝色光体、障碍粉色光体（**统一固定 34px**，删除早期内联 vmin 尺寸，避免与归一化判定/视觉不一致）；顶部持续向下的引擎光粒制造穿梭速度感；撞击大爆发 + 强震屏 + `audio.explode` + 振动；`data-px` 暴露归一化横坐标供 E2E 断言跟随。组件卸载用 `alive` 标志停止额外同步 RAF，杜绝 rAF 泄漏。

### 炫光连消手势重构（修“一点就弹菜单”）

- 根因：M1 的 `onPointerUp` 对“同格、位移<10px 的轻点”一律 `stageApi.toggleMenu()`，而轻点宝石是最高频操作 → 一点就弹暂停菜单，游戏无法操作。
- 修复：棋盘手势与菜单完全解耦——移除 `inject(NEON_STAGE_KEY)` 与轻点唤菜单；新增 `selected` 选中态与 `.gem.sel` 高亮。两种操作：**点选**（点第一颗高亮→再点相邻交换；同格/空白取消；非相邻改选不抖动）与**短滑**（pointermove 位移超 16px 立即按主轴与相邻交换，`consumed` 防抬起重复处理）；`pointercancel` 走 `cancelPointer`，暂停时清选中。菜单仅由 FocusStage 右上 ❚❚ 打开。

### Wake Lock 屏幕常亮 + 特效档位实时切换

- `FocusStage.vue`：进入专注态 `navigator.wakeLock?.request('screen')`，暂停/卸载释放；监听 `visibilitychange`，回到前台且未暂停时重新申请；不支持或被拒静默忽略，不影响游戏。
- 暂停浮层新增“特效：自动/高（更炫）/低（省电）”循环项，`emit('update:particle')` → index 持久化到 storage 并下发。
- `NeonEngine.setManual()` 新增运行时切档：即时更新粒子上限/辉光趟数/DPR（必要时 resize），三款 GPU 游戏均 `watch(particle)` 接入，无需重进。

## M2 踩坑记录

1. **“后端”措辞误导用户**：架构文档里的 backend 指本地渲染后端，用户误以为游戏要联网/有服务器。处理：代码侧确认零网络；所有面向用户文案（guide/FAQ/注释面向人的部分）改为“图形渲染器/本地渲染”，并在 FAQ 显式说明。
2. **闪避障碍内联 vmin 与 CSS 固定像素并存**：早期内联 `width/height: ...vmin`、`<style>` 又用 34px 固定值覆盖，判定半径是归一化常量，多视口下观感/判定可能错位。统一为 DOM 固定 34px、定位用百分比 + translateX(-50%)，判定与视觉解耦且稳定。
3. **额外 RAF 未随组件释放**：用于把 `px` 写到 `data-px` 的同步 RAF 初版自递归且无停止条件，组件卸载后仍运行。加 `alive` 标志，`onBeforeUnmount` 置 false 停掉。
4. **生存分 E2E 不能要求重开后恒为 0**：星轨按存活时间计分，点击“再来一局”后 300ms 已重新累计到 30 分，初版断言“===0”误报；改为断言遮罩消失且分数回落到开局极小值（<10）。
5. **`noUncheckedIndexedAccess`**：轨道取色数组下标需 `LANE_HUES[lane] ?? 默认` 收敛，否则类型报错。

## M2 验证覆盖

- **单测**：新增 `test/mini-games-neon-m2.test.ts` 10 个用例（脉冲：完美=100/良好=60/空击不扣分、连击递增加分、漏 3 结束并同步最佳、速度单调有上限；星轨：目标钳制、平滑跟随、生存计分与最佳、速度上限、撞击结束移除障碍、越界记 dodged 回收、结束后 no-op）。全量 `npm test` **330/330 通过**。
- **类型**：`vue-tsc --noEmit` **0 错**。
- **注册表回归**：`npm run verify:tools` 通过，工具数仍 **27**。
- **构建**：`npm run build` 成功。新增独立 chunk：neon-pulse JS/CSS、orbit-surge JS/CSS，三者（含 glow-match）均进入 `sw.js` 预缓存，离线可玩。
- **E2E**：
  - M1 回归脚本更新选卡断言（占位 2 → 0、两款新卡存在）后**仍全部通过**，真实滑动消除 HUD 实测 540 分。
  - 新增 `scripts/e2e-mini-games-m2-20261019.mjs`（强制 WebGL2）：①手势回归——轻点宝石/点选相邻都不弹菜单，菜单仅右上按钮可开；②免费态点霓虹脉冲被 ¥19.90 付费墙拦截；③霓虹脉冲进入后端 webgl2、canvas backing 正常，**依据下落音符真实点轨得分（实测 60）**，停止操作后 3 漏击结束、再来一首复位；④星轨穿梭**拖动生存计分增长（实测 339/341）**、停住等撞击结束、再来一局回落；⑤手机 375 视口脉冲零溢出。全部通过、无 pageerror。
- **多视口**：PC 1280×800、手机 375×812 新增场景横向溢出均为 0；平板沿用 M1 已验证布局，新游 DOM 布局与脉冲同构（等宽三轨/全屏 field）。

### EdgeOne 限额复核（M2）

| 指标 | 限额 | M2 实测 | 结论 |
| --- | --- | --- | --- |
| 单项目存储 | 5 GiB | 131 MiB | 通过 |
| 文件总数 | 20000 | 138 | 通过 |
| 单文件大小 | 25 MiB | 最大 ≈13.6 MiB（ort wasm） | 通过 |

### M2 guide 新增截图有效性验证（preview 真实构建产物）

| 文件 | 像素 | 内容 | 是否通过 |
| --- | --- | --- | --- |
| shot-11-pc-neon-pulse.png | 1280×800 | 霓虹脉冲结束结算（60 分、再来一首、三轨余光） | 通过 |
| shot-12-pc-orbit-surge.png | 1280×800 | 星轨穿梭生存 341 分（蓝色光体+粉色光障+提示） | 通过 |
| shot-13-mobile-neon-pulse.png | 375×812 | 手机霓虹脉冲三轨全屏、漏击点、判定线 | 通过 |

均为有效 PNG、非 0 字节、可正常打开，内容与 guide 描述一致；M1 九张截图继续有效（选卡页 shot-01 已用 M2 新构建重截，占位变为真实专业版卡）。

## M2 已验证范围 vs 仍未完成

**M2 已交付并验证**：霓虹脉冲、星轨穿梭两款专业版 GPU 游戏（纯逻辑单测 + 三视口/真机路径 E2E + 真实截图）、炫光连消手势重构、Wake Lock、特效档位实时切换、index 接线与去占位、manifest v1.2.0 与关键词/权益文案、零网络复核、动态分包离线、限额复核。

**仍未完成（后续）**：WebGPU/WGSL 原生后端；主题/色盲模式；真机独显 Chrome 的 WebGPU 上屏人工复核（当前视觉均在强制 WebGL2 路径验证）。

## 可复用经验

- **"重开只换内容、不换全屏容器"**：沉浸/全屏类场景，容器 key 与内部内容 key 分离，可避免重进全屏的手势与状态竞态。
- **GPU 降级要"探测轻、创建重"**：探测只到 adapter，device 创建与超时/try-catch 放渲染链；上下文丢失要能热重启到 2D，保证任何环境不白屏。
- **IndexedDB 落库前净化响应式对象**：Vue reactive Proxy 不能结构化克隆，统一在持久化边界展开为纯对象。
- **可单测逻辑下沉到无 DOM/无别名文件**：像 normalizeState、fx、quality、match 判定这类纯逻辑放独立模块，毫秒级 node:test 即可拦住守恒/兼容/降档类回归，不必等浏览器 E2E。
- **无头视觉强制 WebGL2**：GPU 工具的可视/布局/交互验证用 navigator.gpu=undefined 强制降级，稳定且能截图；不要在无头软渲染上断言 WebGPU 上屏像素。

---

# M3 增量（2026-10-19）：去重三消 · 卡片统一 · 指导刷新 · 首页改版

## 改动

1. **下线重复的经典「三消」**：删除 `components/GameMatch3.vue`，并从 `index.vue` 移除其 import、`DOM` 映射与 `CLASSIC` 定义（三处）。**保留 `lib/match3-core.ts`**——炫光连消 glow-match 的 logic/组件依赖它（games.test.ts 的 match3-core 内核用例因此全部保留，仍绿）。付费墙文案、manifest tagline 与 `pro-library` 权益 label、README、两份 guide 中“三消”全部清除。旧 IndexedDB 里 `match3:classic` 历史最高分自然保留在库中、UI 不再展示，不做迁移/清库（零风险）。
2. **卡片展示风格统一**：去掉炫光区单独的深色 `.neon-card/.neon-grid/.free-badge/.lock/.badge`，经典区与炫光区统一用同一 `.gcard`（白底、同圆角/间距/hover）、同一套徽标 `.tag-pill`（免费=绿蓝渐变、🔒专业版=灰、✓已解锁=品牌浅绿），桌面两区都为 3 列、移动 2 列。meta 文案统一为“即点即玩 · 全屏沉浸”。已购专业版游戏现在显示“✓ 已解锁”，状态更明确。
3. **用户指导刷新**：页面内 `guide.md`（注册中心 root guide，用户点“用户指导”实际看到的版本）此前停留在 001 旧版——仍列三消、完全没有炫光系列。已整篇重写为覆盖现存 6 款（经典 3 + 炫光 3），含玩法/手势/计分/专业版/画面音效电量/FAQ，并显式说明三消下线原因与“无服务器后端”。pipeline `docs/guide_007` 同步到 v1.3.0。manifest 升 **v1.3.0**。
4. **首页（HomeView）改版**（同批用户诉求）：① “我收藏的工具”由完整 `ToolCard`（占空间大）改为**紧凑胶囊快速跳转链接**（名称 + ×移除），点击直达工具、×即取消收藏；② “大家都在问”从独立 block 移入搜索框所在的同一张卡片 `.search-unit`（虚线分隔），与搜索成为不可分割的一个整体，搜索后该区随未搜索态一起隐藏；移除 chips 的浮动动画避免整体卡片内抖动。

## 牵连面处理

- E2E：`e2e-mini-games-neon-20261019.mjs` 与 `e2e-mini-games-m2-20261019.mjs` 中所有 `.neon-card*` 选择器改为统一的 `.gcard`；原“点三消弹付费墙 / 已购点三消进 DOM”两处用例改测现存专业版 DOM 游戏**数字华容道 klotski**（点击 `.gc-name`，避开难度 chip）；新增“三消卡片不存在”断言。
- 历史归档文档（`docs/postmortem_001`、`docs/stage/architect_007`）中的 GameMatch3/三消属当时存档，按归档不回改原则保留。
- 首页新增 E2E：`scripts/e2e-home-redesign-20261019.mjs`（注入 5 个收藏 + 关闭新手条），断言收藏胶囊数=收藏数、收藏区内无 `.tool-card`、“大家都在问”位于 `.search-unit` 内、胶囊点击正确跳转 `/t/mini-games`、三视口零横向溢出。

## M3 验证覆盖

- vue-tsc 0 错；`npm test` **330/330 全绿**（match3-core 内核用例保留通过，删除 GameMatch3.vue 后无导入残留）；`verify:tools` **27**；`npm run build` 成功，最大单文件仍为 ort wasm ≈13.6MiB <25MiB。
- E2E（强制 WebGL2）：neon 脚本（含手势回归、付费墙=数字华容道、已购进 klotski DOM、炫光真实滑动 180 分、暂停/重开/退出、三视口 0 溢出）**全过**；m2 脚本（霓虹脉冲真实得分 60、星轨生存 264、手机 0 溢出）**全过**；首页改版脚本 PC/平板/手机三视口**全过**。
- 真实截图目检：选游戏页 shot-01（两区卡片统一、三消消失、徽标一致）、付费墙 shot-02、已购 klotski shot-06；首页 PC/平板/手机（搜索+大家都在问同卡片、收藏紧凑胶囊）。手机端“收藏标题与底部 Tab 接近”为整页 fullPage 截图对 fixed 底栏的呈现伪影：App.vue 内容区已有 `padding-bottom: tab高+安全区+8px`，真机滚动无遮挡。
- EdgeOne 限额：本批仅删除 1 个组件、改动少量前端文件与文案，无大资源；总量较 M2（131MiB/138 文件）只减不增，远低于限额。

## M3 仍未做

WebGPU/WGSL 原生后端；主题/色盲模式。

# M4 增量（2026-10-20）：莫比环角色美化/俯瞰 · 炫光目标化 · 霓虹经典旋律

## 改动

1. **莫比环跑酷**
   - `mobius-runner/three/Character.ts` 整体重写：扁平方块 → **Q 版三渲二**（MeshToonMaterial 共享一张 3 阶 DataTexture gradientMap；大头球体 + 胶囊躯干/四肢、眼白/瞳孔/高光、腮红、小嘴、圆头鞋、圆润配饰；5 款原创造型 cap/bunny/cat/spike/hood 保留并圆润化，ROOT_SCALE=0.6）。
   - `MobiusRenderer.ts`：相机由"又低又近"（CAM_BACK=3.4、法向抬高 0.55、FOV72、CAM_AHEAD=7）抬升为**约 45° 俯瞰追尾**（CAM_BACK=2.7、CAM_UP=1.85、CAM_AHEAD=5.2），小人落画面下方、前路无遮挡；新增 AmbientLight(0.66) + 挂在 player 标架下的 keyLight(1.0)/fillLight(0.4)，半扭转任意朝向都不死黑。
2. **炫光连消**
   - `lib/match3-core.ts`：ResolveResult 增加实际物理消除块数 `count`（与含连锁加权的计分量 `removed` 区分）。
   - `glow-match/logic.ts`：MoveResult 增加 `removed`（=res.count），导出 `BurstCell`。
   - `glow-match.vue`：粒子 12→18/26、加 sizeScale/life，连锁中心补 30 粒大爆发；新增格位扩散爆圈 `.pop`、全屏 radial `.flash`、更强震屏；新增 **TARGET_REMOVED=60** 目标，顶部"目标：消除 60 块 · 还差 N"+渐变进度条；达成置 finished、庆祝爆发、emit `gameover`、弹通关结算卡（含"再来一局"组件内重置）；finished 时锁输入。
3. **霓虹脉冲**
   - 新增 `neon-pulse/melodies.ts`：5 首**公有领域**旋律（小星星/两只老虎/欢乐颂/致爱丽丝/卡农）以 MIDI 音高+时值的音符序列编码，附 `midiToFreq`；零音频文件、零版权录音。
   - `logic.ts`：**增量**加入谱面模式（保留全部旧导出与随机模式，旧单测不回归）——`ChartEvent`/`buildChart`（整首音域三等分映射到 3 轨、休止符空拍、固定 CHART_TRAVEL=1.6s 旅行时间）/`newPulseFromSong`/`win` 标志；谱面模式按事件时间点确定性生成、恒定下落速度，漏击不中途判负、整曲音符处理完即 `win`。
   - `audio/synth.ts`：新增 `tone(freq, strong)`，三角波+高八度泛音+指数包络，命中即按旋律音高实时合成"八音盒"音。
   - `neon-pulse.vue`：新增**选曲页**（5 曲目 + "∞ 自由脉冲"）、当前曲名标签、命中奏响 `audio.tone(midiToFreq)`、通关/失败结算（"再来一首/换一首"）、emit `gameover`。

## 版权与合规

仅内置**公有领域**旋律（传统民歌 + 贝多芬/帕赫贝尔古典，作者逝世均远超版权期），用游戏自带程序化 Web Audio 合成器演奏；**不内置任何近现代流行曲旋律或录音**，规避版权风险。现代流行曲因仍受版权保护，明确不做。

## M4 验证覆盖

- vue-tsc **0 错**（修掉 Character.ts 三处把 MeshToonMaterial 当 color number 传入的类型错误：手臂/兔耳改用 `def.skin`/`def.hair`）。
- 单测：新增 `test/mini-games-neon-songs.test.ts` 4 例（谱面编译排序/轨道范围/旅行时间、**5 首曲目都能完整演奏到 win 且不因漏击中途失败**、命中返回 midi 并得分、midiToFreq A4/C5）；相关 neon 两文件 **27/27**；`npm test` 全量 **366/366 全绿**（基线 362 + 新增 4）。
- `verify:tools` **28**；`npm run build` 成功，PWA precache 正常，最大单文件 ort wasm ≈13.6MiB。
- 三视口 GPU E2E（强制 WebGL2，`scripts/e2e-mini-games-trio-20261020.mjs`，注入已购专业版以进入 pro 游戏）：莫比环 PC/手机 canvas backing 正常且 **0 横向溢出**、截图肉眼确认俯瞰视角前路无遮挡、Q 版小人可见；炫光 PC/平板目标 HUD 开局=60、真实滑动后"还差"从 60 降到 57（进度链路真实打通）、0 溢出；霓虹 PC/平板/手机选曲 6 按钮（5 曲+自由）齐全、进入后曲名标签正确、谱面音符真实下落、0 溢出；全程无 pageerror（SW abort 噪音过滤）。**全过**。
- 截图有效性（均非 0 字节、PNG 可打开、与文案一致）：mobius-pc-run 28KB、mobius-mobile-run 165KB、glow-pc-effects 240KB、glow-tablet-effects 253KB、neon-mobile-picker 160KB、neon-pc/tablet-playing 各≈16KB。
- EdgeOne 限额复核（dist 实测）：总量 **131 MiB**（<5GiB）、文件 **144**（<20000）、单文件最大 **13.6 MiB**（<25MiB）。本批新增仅少量 TS/Vue/测试/E2E 与截图，无大资源。

## M4 仍未做

- 霓虹旋律模式当前为"漏击不判负、只影响得分"，后续可加逐键精确计分/评级（S/A/B）与节拍校准。
- 炫光目标块数当前固定 60，可按难度分档。
- WebGPU 原生后端、主题/色盲模式仍未做。
