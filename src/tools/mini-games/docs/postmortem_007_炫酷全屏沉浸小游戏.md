# 技术沉淀：炫酷全屏沉浸小游戏（炫光 NEON 系列 M1）

- 对应 dev：`dev_007_炫酷全屏沉浸小游戏.md`
- 日期：2026-10-19
- 档位：**H**（GPU/WASM 类、实时渲染、多后端降级）。按 H 档里程碑策略，本轮交付**可运行 checkpoint（M1）**：渲染抽象 + WebGL2/Canvas2D + 首个 GPU 游戏 + 全屏沉浸 + 计费/存储兼容，全量质量门通过；WebGPU 后端与其余两款游戏列入后续里程碑。

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
- G2 霓虹脉冲（单指节奏）、G3 星轨穿梭（穿梭）两款 GPU 游戏（现为专业版"即将上线"占位）；
- G4：主题/色盲模式、WakeLock 屏幕常亮等全量设置（storage 已预留 muted/vibrate/particle 字段）。

## 可复用经验

- **"重开只换内容、不换全屏容器"**：沉浸/全屏类场景，容器 key 与内部内容 key 分离，可避免重进全屏的手势与状态竞态。
- **GPU 降级要"探测轻、创建重"**：探测只到 adapter，device 创建与超时/try-catch 放渲染链；上下文丢失要能热重启到 2D，保证任何环境不白屏。
- **IndexedDB 落库前净化响应式对象**：Vue reactive Proxy 不能结构化克隆，统一在持久化边界展开为纯对象。
- **可单测逻辑下沉到无 DOM/无别名文件**：像 normalizeState、fx、quality、match 判定这类纯逻辑放独立模块，毫秒级 node:test 即可拦住守恒/兼容/降档类回归，不必等浏览器 E2E。
- **无头视觉强制 WebGL2**：GPU 工具的可视/布局/交互验证用 navigator.gpu=undefined 强制降级，稳定且能截图；不要在无头软渲染上断言 WebGPU 上屏像素。
