# 技术沉淀：莫比环 MÖBIUS（莫比环3D翻转跑酷）

- 对应 dev：dev_008_莫比环3D翻转跑酷.md
- 日期：2026-10-19
- 功能档位：**H（重型）**——three.js 实时 3D、半扭转带状几何、对象池粒子、固定步长物理、多后端兼容与计费/沉浸集成。

## 技术选型与理由

| 项 | 选择 | 版本/许可 | 理由 |
| --- | --- | --- | --- |
| 3D 引擎 | three.js | 0.186.1 · MIT（可商用） | 生态成熟、WebGL 覆盖最广、体积可控；无需重型引擎 |
| 类型 | @types/three | 0.186.0 · MIT | 与运行时版本对齐 |
| 框架 | Vue 3.5 `<script setup>` + TS | 随 fangzi | 增量接入既有 registry/计费/沉浸/SEO，不引入新框架 |
| 渲染后端 | 仅 WebGL（WebGL2 优先） | — | 无头与移动端最稳；不为本项目引 WebGPU，避免软渲染深坑 |
| 音频 | Web Audio 程序化合成 | 自研 · 0 素材 | 零音频资源、零外链；flip/gate/near/perfect/collect/twist/death 全部合成 |
| 存档 | IndexedDB | 浏览器原生 | 库 `fz-mobius-runner-v1`，零后端、离线可用 |
| 后处理 | 不使用 UnrealBloom | — | 无头软渲染不稳定且增加体积；用加性发光材质 + 高饱和色出“炫光” |

无已知高危漏洞：three 0.186.x 为当前维护线；仅使用核心模块，未引外部模型/纹理/字体资源。所有依赖均为 MIT/Apache 等可商用许可，符合“只用商用友好免费资源”的硬约束。

## 关键实现

### 分层：逻辑与渲染彻底解耦

- `game/`：纯 TS，**不依赖 three / DOM**，可在 Node 下单测。
  - `logic.ts`：固定步长 `STEP=1/120`，生成闸门/光屑、碰撞、连击倍率、半扭转期禁门、死亡/续命；每步把事件写入 `state.events`（下一步清空）。
  - `geometry.ts`：莫比乌斯光带参数化几何，是本项目的核心。
  - `difficulty.ts`：随距离提升速度与门密度。
  - `storage.ts`：IndexedDB 分数/局数/累计光屑/设置，`recordRunResult` 自增统计。
  - `audio.ts`：`MobiusAudio`（首次手势 resume、默认静音、异常静默降级）+ `vibrate()`。
- `three/MobiusRenderer.ts`：纯呈现层，只读 `GameState` 快照 + 插值 alpha 绘制，**不做任何规则判定**；规则真相只在 logic。
- `index.vue`：固定步长 RAF（累加器 + 24 步 guard）、单键输入、懒加载渲染器、计费、全屏、SEO、教学、设置、结算。

### 半扭转“两车道”几何（关键设计决定）

早期把“两面”理解为法线正负两侧，会导致半扭转时站位/碰撞语义拧巴。最终统一为沿带宽方向 `across` 的**两条车道**：

- `RIBBON_WIDTH=2.4`、`LANE_OFFSET=RIBBON_WIDTH*0.25=0.6`、`STAND_OFF=0.12`；
- `faceOffset(face)`：face0 = +LANE_OFFSET，face1 = −LANE_OFFSET（沿 across）；
- `pointOn(u,face)` = center + across·lane + normal·STAND_OFF；
- 半扭转段（`FIRST_TWIST_AT=150`、`TWIST_LEN=18`、`TWIST_PERIOD=80`）内 `frameAt` 让 across/normal 一起绕 tangent 旋转 0→π，两条车道自然对调；
- 因而 logic 里只需一维 `face:0|1` 碰撞，渲染随标架翻滚即可，二者完全兼容。
- 几何端点判等**包含扭转结束点**（`phase<=TWIST_LEN` 取 π、`inTwistZone` 含端点），避免门恰好落在边界时“提前死亡”。

### 渲染与性能

- 连续光带网格：沿 across 8 条带、220 段、段长 0.32、尾部留 16m，随玩家前移复用缓冲；双侧发光边线。
- 对象池：闸门 16、光屑八面体 28、粒子 360，全部复用、无逐帧分配；加性混合 + 重力的爆点粒子。
- 闸门用完整标架 `makeBasis(tangent, −normal, across)` 定向，保证红墙/绿缺口在扭转段朝向正确。
- 贴面跟随相机：相机 up 取带面 normal，半扭转时画面自然翻滚；`reduceMotion` 时回正世界上、关闭大震屏。
- three 由 index.vue 动态 `import()`，产物为独立异步 chunk `MobiusRenderer-*.js`（≈0.52 MiB / gzip ≈136 KiB），**不进首屏**。
- 擦过慢动作（R11 juice 补全）：near / perfect 事件触发短暂时间放缓（near 缩放到 0.42 持续 0.22s，perfect 0.6 持续 0.14s），窗口内缩放从谷底线性回升到 1；实现上**只缩放喂给固定步长累加器的实时 dt**（`acc += realDt*slowScaleNow()`），不改 `STEP`，故逻辑仍确定性、跨刷新率一致，结束后由累加器自然补步（24 步 guard 兜底），连续擦过取更强缩放/更长窗口；`reduceMotion` 开启时不触发，避免加重眩晕。

### 沉浸与计费

- 复用 `useImmersive`：在用户点击「开始」的手势内同步 `enter()` 系统全屏；路由离开/退出对局 `exit()`。
- 对局内只保留极简 HUD（分数/倍率/暂停/扭转提示/点按提示），与游戏无关信息一律不显示。
- 复用 `useToolBilling(toolId)`：freemium，`priceCents=1290`（¥12.90）；`proOwned = isOwned('freemium-pro')||isOwned('buyout')`；专业能力=每局一次续命、熔火/幽紫主题、流光拖尾、后续模式。核心玩法永久免费。
- `useSeo` 注入 title/description/keywords 与 JSON-LD（WebApplication/Game + Offer price 0）。
- WakeLock 常亮、`visibilitychange` 自动暂停；无 WebGL2 时友好兜底面板。

## 踩坑记录

1. **TS 因 `step()` 改状态把字面量类型窄化死**：循环内 `if (state.status==='dead')` 被判“无重叠”。用 `isRunning(s)/isDead(s)` 函数包装比较解决，不与控制流分析对抗。
2. **`noUncheckedIndexedAccess` 下对象池/粒子数组全部可能 undefined**：池取用处加非空断言（已由池大小保证存在），回收循环判空；粒子热循环先把 `pPos/pVel/pLife` 取局部别名并用 `?? 0` 兜底，兼顾严格与性能。
3. **manifest 必须具名导出 `export const manifest`**：registry 与 `scripts/verify-tools.mjs` 都读 `mod.manifest`；同时保留 `export default` 供 index.vue 默认导入，两者都满足。
4. **相对路径**：工具内 manifest 引类型是 `../../core/types`（`src/tools/<id>/manifest.ts` → `src/core/types`）；gpu-detect 真实入口是 `reusable-module/gpu-detect/gpu-detect`（目录下无 index）。
5. **E2E 教学面板竞态**：点菜单 CTA 后 three chunk 异步加载，教学面板稍晚出现，立即 `count()` 会漏点。改为 `waitForSelector('.panel.tutorial .cta', timeout)` + catch 直接等 running。
6. **桌面 Chromium 上下文不支持 `tap()`**：统一改用 `locator.click({position})` 触发 `pointerdown`。
7. **three Clock 弃用告警**：仅控制台 warning，不影响功能；后续可迁移到 `THREE.Timer`。
8. **测试把门放进半扭转区导致“假失败”**：修逻辑端点判等的同时，教学段（<150m 无扭转）内放受控门，避免测试自身制造非法局面。

## 验证覆盖

> 档位：**H**（three.js / WebGL 3D / WASM 级实时渲染、多后端降级）。
>
> **M4（2026-10-19，并入小游戏合集 + 原创卡通角色）**：本游戏由独立工具「莫比环 MÖBIUS」并入 `src/tools/mini-games/gpu-games/mobius-runner/`，更名**莫比环跑酷**，删除独立工具（verify 工具数 28→**27**），主角由发光六边形改为**原创卡通奔跑小人**（5 角色：电光小子/棉花兔/薄荷猫免费，火焰仔/紫影侠专业；几何体程序化绘制，无版权 IP），计费并入小游戏专业版 **¥19.90**（`useToolBilling('mini-games')`，toolId 严格匹配）。以下早期独立版数据保留为历史记录，**M4 重刷后的权威数据见下**。
>
> M4 质量门（全绿，本轮重新执行）：
> - `npx vue-tsc --noEmit`：**0 错**；`npm test`：**342 通过 / 0 失败**（仅导入路径从独立工具改到合集内新位置，6 处）；`npm run verify:tools`：**27**；`npm run build`：成功。
> - 三视口 E2E 脚本改为从**合集选卡进入**（`/#/t/mini-games` → 莫比环跑酷卡 → FocusStage），强制 WebGL2，覆盖：角色选择（断言 5 角色、选棉花兔生效、点锁定火焰仔弹 ¥19.9 付费墙）、教学、点按翻转 `face 0→1→0`、canvas backing（PC 实测 1280×800）、HUD 暂停/继续、自然撞墙结算（PC 实测死亡分 **210**）、免费无续命、¥19.90 付费墙、注入 `toolId:'mini-games'` 已购订单后光盾续命、立刻重开；三视图口横向溢出全 **0px**、无 pageerror。
> - 三个 chunk `MobiusRenderer-*.js`（548,011 B / gzip 137.66 KiB）、`mobius-runner-*.js`、`mobius-runner-*.css` 均进入 `dist/sw.js` 预缓存，离线可玩；dist ≈ **131 MiB / 142 文件**，无 >25 MiB 文件。
> - 9 张截图已用合集版真实 build 全部重刷覆盖（见下表 M4 列）。

### 自动化质量门（全绿）

- `npx vue-tsc --noEmit`：通过（strict + noUnusedLocals/Parameters + noUncheckedIndexedAccess）。
- `npm test`（node:test）：**342 通过 / 0 失败**（330 存量基线 + 12 个 008 逻辑用例：翻转、过门/碰撞、near/perfect 倍率、连击上限、半扭转对调、禁门区间、续命无敌、教学段受控门等）。
- `npm run verify:tools`：**校验工具数 28，全部 manifest/插件包/示例提问回归通过**。
- `npm run build`：成功；three 为独立异步 chunk，不被 index/registry 静态入口引用。

### 三视口真实浏览器 E2E（强制 WebGL2）

脚本：`scripts/e2e-mobius-runner-20261019.mjs`；视口 PC 1280×800 / 平板 834×1112 / 手机 375×812。覆盖并断言：

- 菜单→教学→开始进入 `running`；canvas backing 尺寸正常（PC 实测 884×624）；
- 点按画面真实翻转：钩子读数 `face 0 → 1 → 0`；
- 暂停/继续；不操作在连续闸门内自然死亡→结算出现（PC 实测死亡分 110）；
- 免费态无续命按钮；付费墙显示 ¥12.90；注入已购订单后出现并可点「光盾续命」回到 running；
- 「立刻重开」可再开局；
- 三视口横向溢出均为 **0px**（阈值 ≤2）；除主动 abort SW 的噪音外**无 pageerror / console.error**。

结论：主要用户变量（设备视口、触控/鼠标、免费/已购、暂停/死亡/续命/重开、WebGL 软渲染后端）覆盖≥90%，全业务链路无阻塞。真机独显 Chrome 的 WebGL 上屏观感建议上线后人工再复核一次。

### EdgeOne Pages 免费版限额核查（生产构建产物）

| 限额项 | 上限 | 实测 | 结论 |
| --- | --- | --- | --- |
| 单项目存储 | 5 GiB | dist ≈ 130.6 MiB（136,915,526 B） | ✅ |
| 文件总数 | 20000 | 142 | ✅ |
| 单文件大小 | 25 MiB（26,214,400 B） | 最大 `mf/bge-small-zh-v1.5/onnx/model_quantized.onnx` = 24,010,842 B（≈22.9 MiB，存量文件，非本功能） | ✅ |
| 本功能最大资源 | — | `MobiusRenderer-*.js` = 541,601 B（≈0.52 MiB，gzip≈136 KiB，异步 chunk） | ✅ |

### guide 截图有效性核验（均为生产 build + preview 真实截图）

| 文件 | 像素 | M4 大小(B) | 内容（M4 重刷后） | 是否通过 |
| --- | --- | --- | --- | --- |
| shot-01-pc-playing.png | 1280×800 | 20,218 | PC 对局：棉花兔在青色光带上奔跑、脚下光环、星空、红墙绿缺口、左上分数 1 与右上暂停，全屏无外壳 | ✅ |
| shot-02-pc-paused.png | 1280×800 | 49,538 | PC 对局中 HUD 暂停浮层 | ✅ |
| shot-03-pc-dead.png | 1280×800 | 310,011 | PC 结算面板（死亡分 210/重开/解锁专业版） | ✅ |
| shot-04-pc-paywall.png | 1280×800 | 325,569 | 舞台内付费墙：小游戏专业版、光盾续命/火焰仔紫影侠/全部专业游戏、一次买断 **¥19.90** | ✅ |
| shot-05-pc-revive.png | 1280×800 | 324,865 | 已购专业版死亡后光盾续命入口 | ✅ |
| shot-06-tablet-menu.png | 834×1112 | 319,475 | 平板舞台主菜单（角色更换/开始奔跑） | ✅ |
| shot-07-tablet-playing.png | 834×1112 | 20,070 | 平板对局全屏自适应 | ✅ |
| shot-08-mobile-menu.png | 375×812 | 154,220 | 手机主菜单：标题「莫比环跑酷」、当前角色电光小子·更换、开始奔跑、最高分/已跑 0 局 | ✅ |
| shot-09-mobile-playing.png | 375×812 | 10,789 | 手机对局全屏自适应 | ✅ |

全部为生产 `build` + `vite preview` 真实截图，PNG、非 0 字节、可正常打开，内容与 guide 描述一致；PC 5 张、平板/手机各 2 张，满足 H 档数量要求。合集舞台 FocusStage 为 `position:fixed;inset:0;z-index:1000` 全屏容器，截图已确认不含方子外壳顶栏/底部 Tab（见 shot-01/08）；真机独显 Chrome 的系统级全屏与 WebGL 上屏观感建议上线后再人工复核一次。

## 可复用经验

- **逻辑/渲染分层 + 固定步长**：游戏判定全部在纯 TS（120Hz 步进 + 事件队列），渲染只插值快照——可单测、可换引擎、跨刷新率一致，适合后续所有反应类游戏。
- **带状半扭转“多车道”建模**：`face` 只是沿 across 的离散车道偏移，扭转=标架绕 tangent 旋转，一维碰撞即可表达“正反面对调”，可复用于任何轨道翻转玩法。
- **three 懒加载范式**：`const mod = await import('./three/XRenderer')` + 独立 chunk，菜单先持有纯逻辑静止世界，点开始才加载 3D；兼顾首屏体积与 H5 启动体验。
- **无头 GPU 验证**：视觉/交互一律强制 WebGL2（`newCompatContext` 注入 `navigator.gpu=undefined` + abort SW），逻辑翻转用只读 `window.__mobius` 钩子断言，不依赖像素比对。
- **防眩晕开关**：相机 up 跟随带面 normal 是沉浸关键，但必须配 `reduceMotion` 回正世界上 + 降档，照顾 3D 敏感用户。
