# 技术沉淀：《挽星弓》gravity-sling（007 太空弹弓）

- 对应 dev：`dev_007_太空弹弓.md`
- 日期：2026-10-22
- 档位：**M**（标准档：多状态机 + 定时/限次 + 本地快照；无 WASM / 本地 AI / 音视频重资源）
- 最终 id：`gravity-sling`；目录 `src/tools/mini-games/gpu-games/gravity-sling/`

## 一、技术选型与理由

| 决策点 | 选型 | 理由与兼容性核查 |
| --- | --- | --- |
| 渲染 | 原生 **Canvas 2D** + DPR 适配 + ResizeObserver | 合集内 orbit-surge 之外的第二款纯 Canvas2D 自绘游戏；不需要 three.js / WebGL2 粒子体系，避免引入重依赖。`package.json` **未新增任何运行时依赖**。 |
| 物理 | 自包含反平方引力 + 软化半径 + 固定时间步 | 弹道游戏物理量小、可完全数值化；引力/推斥/黑洞/收集/碰撞/通关全部下沉为无 DOM 纯函数，供 node:test 直测。 |
| 音频 | 复用合集 `audio/synth.ts` 的 `NeonAudio` 与 `haptic` | 不另建 AudioContext；复用 `ensure()/setMuted()/suspend()/close()/blip()/hit()/explode()/tone()`；首次手势后 `ensure()` 解锁，遵守移动端自动播放策略。 |
| 暂停 / 常亮 / 特效档 | 完全交给宿主 `FocusStage.vue` | 子游戏只 `watch(props.paused)` 停止推进并 `audio.suspend()`；不重复监听 `visibilitychange`，不抢 Wake Lock 与菜单。 |
| 高分存储 | 父级 `lib/storage.ts` 写入合集 IndexedDB `fz-mini-games-v1`，key `gravity-sling:classic` | 内核不直写高分库；与莫比环独立库、合成宇宙手动存档物理隔离。 |
| 自动快照 | 独立 localStorage 键 `fangzi:gravity-sling:auto-save:v1` | 仿 merge-planet 纯函数快照模式，但**另建键、另写序列化/校验**；不 import 其存档函数，不串键。 |
| 变现 | 本体免费，预留 freemium 钩子（皮肤 / 常驻预测线 / 高级关卡包） | beta 不硬锁、不设付费墙；不新增 feature key，复用合集既有计费机制；无广告 SDK / 网盟。 |

**形态口径（已核对 `scripts/verify-tools.mjs` 与 `src/core/registry.ts`）**：两者只枚举 `src/tools/*/manifest.ts` 顶层单层 glob；本子游戏内嵌在 `mini-games` 内，**不计入顶层工具数**，`npm run verify:tools` 保持 **35**，未新建顶层 manifest，未改 registry / 路由 / ToolRunnerView / 搜索。

## 二、关键实现

### 2.1 目录与职责

```
gpu-games/gravity-sling/
├── gravity-sling.vue                 # 最薄 wrapper：挂 canvas、转发 paused/muted/vibrate/particle、emit score/combo/gameover、卸载清理
├── game/sling-core.ts                # 自包含内核：关卡表 + 纯物理 + 预测 + combo + 渲染 + 快照 + mount/destroy
├── docs/stage/                       # innovator / pm / architect / dev / ops 五阶段文档
├── docs/guide_007_太空弹弓.md
├── docs/postmortem_007_太空弹弓.md
└── docs/shots/                       # 三视口真实截图
```

wrapper 只做三件事：`onMounted` 调 `mount(canvas, opts)`、`watch` 宿主 props 转发、`onBeforeUnmount` 调 `destroy()` 并删除全局调试缝。游戏状态、渲染循环、输入、音频、快照全部在内核。

### 2.2 状态机

`intro → aim → fly → win | lose`，外加 `resume` 续玩弹层：

- `intro`：首局引导，点屏进 `aim`；
- `aim`：拖拽蓄力，重算预测轨迹；松开满足力度阈值进入 `fly`；低于阈值取消，不消耗次数；
- `fly`：固定步推进，处理收集 / 借力 / 碰撞 / 黑洞 / 星门 / 越界 / 超时；
- `win` / `lose`：结算面板；`resume`：快照恢复选择层。

### 2.3 物理常数与试玩调参依据

世界固定 1000×1500，锚点统一 `(500, 1380)`。下列常数在无头 E2E 与三视口实机预览中反复试调，量级记录如下：

| 常数 | 取值 | 调参依据 |
| --- | --- | --- |
| `V_MAX` | 940 px/s | 满力星箭从底部到顶部约 1.15s，接近人手可感知的即时反馈；再高会擦掠而过来不及预判，再低则第 1 关飞不到星门。 |
| `MAX_PULL` | 280 世界像素 | 锚点周围可拖出的最大拉伸距离，对应约半屏手感；超过部分按钳制处理。 |
| 力度曲线 | `p = (len / MAX_PULL)²`（二次曲线） | 弱拖拽段力度增长慢，便于微调近距离角度；满力段仍能达到 `V_MAX`，避免线性曲线在小手势下过猛。 |
| `GRAVITY_G` | 1,600,000 | 配合恒星半径 46–54，贴近时偏折明显、远场干扰可忽略；与关卡星门间距匹配。 |
| `SOFT` | 52 像素软化半径 | 反平方在中心会爆冲，软化后近距离不出现奇点/穿星；抵消 1/r² 在 d→0 时的无穷大。 |
| 黑洞质量系数 | ×3 | 引力阱更陡，视觉与判定都比普通恒星危险，但不会在远距离就吸住星箭。 |
| `ASSIST_EXTRA` | 96 世界像素 | 借力触发带（恒星半径外扩 96），掠过该环即计入 combo，避免必须贴脸才判定。 |
| `FIXED_DT` | 1/120 s | 120Hz 固定步，碰撞与轨迹稳定；`MAX_FRAME_STEPS=4` 单帧最多补 4 步，`dt` 钳制 ≤50ms，防止切后台积压后瞬间跳变。 |
| `COMBO_WINDOW_S` | 1.5 s | 连续借力窗口；超过归零。`COMBO_MAX_MULT=4` 倍率封顶，避免远距离连击分数失控。 |
| `PREDICT_STEPS` | 150 步（约 1.25s） | 初版 90 步在第 1 关竖直弹道上算不到星门，预测虚线半途消失；提到 150 步后覆盖到目标，每 2 步采样一个渲染点。 |

天体类型：`gravity`（蓝恒星）、`repel`（品红推斥星）、`blackhole`（黑洞）、`asteroid`（陨石）、`collect`（金尘）、`portal`（周期/固定星门）、`moving`（椭圆轨道星门）。

### 2.4 13 关难度曲线

| # | 标题 | 机制要点 | 次数 / 时限 |
| --- | --- | --- | --- |
| 1 | 启程直瞄 | 无引力直上星门，教学拖拽与预测 | 不限次 / 不限时 |
| 2 | 沿途收星 | 直线微调，拾取 3 颗星尘 | 不限次 / 不限时 |
| 3 | 引力偏折 | 恒星压弯轨迹，瞄得比星门略偏 | 不限次 / 不限时 |
| 4 | 单星绕弯借力 | 贴恒星半圈切出，避开两颗陨石 | 不限次 / 不限时 |
| 5 | 反向抬升借力 | 借上方恒星托举越过陨石墙 | 不限次 / 不限时 |
| 6 | 双星接力 | A 星转、B 星加速切入星门 | 3 发 / 不限时 |
| 7 | 三连借力链 | 三颗恒星连续接力，combo 得分 | 3 发 / 不限时 |
| 8 | 限次数挑战 | 三颗陨石防守，3 发内必须命中 | 3 发 / 不限时 |
| 9 | 限时窗口 | 星门周期 6s 开 3s | 3 发 / 25s |
| 10 | 动目标预判 | 星门椭圆缓慢移动，打提前量 | 3 发 / 不限时 |
| 11 | 推斥天体登场 | 两颗推斥星推开星箭，顺势改向 | 3 发 / 不限时 |
| 12 | 黑洞与小行星带 | 黑洞吞噬 + 两条陨石带穿行 | 3 发 / 30s |
| 13 | 终局星系 | 动星门 + 推斥 + 黑洞 + 三颗星尘混合收官 | 3 发 / 30s |

### 2.5 得分与快照

- 借力 `+60 × 倍率`；星尘 `+100 × 倍率`；命中星门基础 `+300`，限时关追加 `剩余秒数 ×10`，限次关追加 `剩余发数 ×50`。
- 快照字段：`version / tool / chain / savedAt / level / score / combo / bestCombo / collected / collectedIds / shotsLeft / timeLeft / assists / elapsed / ship`；`validateSave` 严格校验版本号、tool、chain、数值有限性与关卡区间，损坏 JSON / 版本不符 / tool 或 chain 不符一律回退 `null`。
- 写入时机：`visibilitychange`（隐藏）、`pagehide`、15s 节流、手动 `autoSaveNow()`；仅当 `score > 0 || collected > 0 || ship.launched || assisted.length > 0` 且处于 `aim/fly` 才写，空局面不落盘；通关 / 失败 / 重试 / 新局立即清快照。
- 键隔离：本游戏 `fangzi:gravity-sling:auto-save:v1`；未触碰 `fangzi:merge-planet:save:v1`、`fangzi:merge-planet:auto-save:v1`、`fz-mobius-runner-v1` 及其它既有键。

### 2.6 与被参照作品的差异化

参照方向仅取「引力井 / 捕获 / 轨道借力 / combo / 预测线 / 难度爬升」等通用机制：本作输入是**按住拖拽反向拉伸 → 力度 + 角度双自由度 → 实时预测轨迹 → 松手发射**，并非 one-tap 时机释放；名称、美术、音效、关卡、道具与 combo 文案均为原创，不含 Starfling 命名或近似商标元素。

## 三、踩坑记录

1. **不限次关卡通关奖励为 0**：初版奖励只算 `timeLeft × 10 + shotsLeft × 50`，第 1 关 `shotsLeft=-1`、`timeLeft=0`，命中后分数仍是 0，E2E 断言 `score > 0` 暴露。补 300 分基础过关奖励，时限/次数奖励叠加在其上。
2. **Playwright `waitForFunction` 参数顺序**：签名为 `(fn, arg, options)`，把 options 放到第二位会被当成入参，超时回落到默认 30s；三处等待断言已改为 `(fn, target, { timeout })`。
3. **移动端引导点击坐标越界**：首版点屏引导固定 `(600, 400)`，在 375 宽视口落在屏外，指针事件不命中画布。改为读取 `.sling-canvas` 包围盒取中心点击。
4. **preview 占用 dist 导致 EBUSY**：`vite preview` 常驻期间重新 build，删除 `dist/tesseract/` 下 fuse 临时文件报 `EBUSY: resource busy or locked`。交付前先停 preview、build 完成后再起服务。
5. **离线上下文必须先让 SW 接管**：新上下文首次加载即 `setOffline(true)` 时，SW 尚未注册/控制页面，`reload` 报 `ERR_INTERNET_DISCONNECTED`。正确顺序：在线进入 → 等 `navigator.serviceWorker.ready` → 在线 reload 一次拿到 `controller` → 再断网二次加载。
6. **调试缝分层**：宿主只把 handle 挂到 `window.__gravitySling`，高分/暂停/快照等句柄方法在根层，物理调试（`phase/isPaused/anchorScreen/layout/forcePortal/launch`）在 `debug` 命名空间；E2E 按此分层调用，避免把纯调试方法暴露进游戏状态机。
7. **力度条遮挡锚点**：初版力度条固定贴屏幕底部，与锚点/橡皮筋叠在一起；改为贴锚点上方 84 世界像素，PC/平板/手机均可见且不挡出生点。
8. **画布重复绘制分数与宿主 HUD 冲突**：`FocusStage` 已在左上 DOM 渲染分数/连击、右上渲染暂停钮；初版画布又在右上重复画分数，高分时被暂停钮遮挡只剩一位数，关卡标题也与左上分数叠字。最终画布**不再绘制分数/连击**（由 `onScore/onCombo` 上抛宿主 DOM 展示），关卡标题与提示改为顶部居中第二行，避开左右两侧宿主控件。

## 四、验证覆盖

### 4.1 质量门（真实执行，2026-10-22）

| 检查项 | 结果 |
| --- | --- |
| `npm test` | **516** 通过（基线 505 + 本游戏 11 例），0 失败 |
| `vue-tsc --noEmit` | **0 错误**（strict / noUnusedLocals / noUncheckedIndexedAccess） |
| `npm run verify:tools` | **35**（子游戏不计顶层工具数，未变为 36） |
| `npm run build` | 成功；gravity-sling 的 `js + css` chunk 进入 SW 预缓存清单 |
| 运行时依赖 | `package.json` 未新增运行时依赖；零图片 / 音频 / wasm / 模型外链 |

### 4.2 纯逻辑单测（`test/gravity-sling.test.ts`，11 例）

1. 13 关配置完整性：唯一星门、坐标界内、次数/时限合法、id 唯一、越界索引回退；
2. 引力方向（恒星拉向自身 / 推斥星反向推开）、空天体零加速度、中心软化不产生 NaN；
3. 瞄准向量归一化、力度二次曲线与上下限钳制；
4. 第 1 关预测轨迹点列有限、单调升高并接近星门；
5. 固定步推进：第 1 关竖直发射命中星门；
6. 第 2 关直上拾取 3 颗星尘且不重复触发；
7. 撞入恒星半径触发 `crash`、坠入黑洞触发 `blackhole`；
8. 限时关卡时间耗尽触发 `timeout` 且余量归零；
9. combo：窗口内累加、过期归零、倍率封顶 ×4；
10. 周期星门开/关判定；动目标轨道位置随时间变化；
11. 快照 `serialize ↔ validate` 往返字段一致；损坏 JSON、版本不符、tool 不符、chain 不符全部回退 `null`；持久化/读取/清除往返正确。

### 4.3 三视口 Playwright E2E（`scripts/e2e-gravity-sling-20261022.mjs`）

视口：PC `1280×860`、平板 `834×1112`、手机 `375×812`（iPhone UA + `hasTouch`）。每视口执行：

- 选卡进入 → 引导点屏进 `aim`；
- 真实 `pointerdown/move/up` 在锚点向下拖拽蓄力，截图预测轨迹/橡皮筋/力度条，松手；
- 调试缝强制命中第 1 关星门 → `win`，断言首关 `level=0`、分数为正；`nextLevel()` 进入第 2 关，关卡 `level=1`、分数保留；
- 切 `hidden` 自动暂停（`isPaused=true`）、关卡进度不丢；回前台经菜单「继续」恢复；
- 写快照 → 整页 reload → 弹「继续上一局」，恢复后关卡/分数与之前一致；「开始新局」清除自动快照键；
- 横向溢出 `0px`；无 pageerror（SW 脚本取噪音已过滤）；**零外部请求**（全部同源）。

离线专项：移动视口在线加载并等 SW 接管 → 在线 reload → `setOffline(true)` → 二次 reload 进入合集选卡、进入游戏，阶段可进入 `aim/resume/intro`；`dist/sw.js` 命中 `gravity-sling-*.js` 预缓存条目。

### 4.4 截图有效性目检

截图目录：`docs/shots/`；均为生产 `vite preview` 真实运行画面，非占位图，逐张打开目检通过。

| 文件 | 视口 | 像素 | 大小（字节） | 内容 | 结论 |
| --- | --- | --- | --- | --- | --- |
| `shots/pc-aim.png` | PC 1280×860 | 1280×860 | 63,531 | 第 1 关竖直预测虚线、青色星门、橡皮筋、锚点上方力度条；左上宿主分数、顶部居中关名/提示、右上暂停钮互不遮挡 | 通过 |
| `shots/pc-win.png` | PC 1280×860 | 1280×860 | 49,014 | 「命中星门！」结算面板：得分 300、连击峰值 ×0、收集星尘 0、下一关 / 重试本关；左上宿主分数 300 清晰可见 | 通过 |
| `shots/tablet-aim.png` | 平板 834×1112 | 834×1112 | 65,066 | 竖屏等比缩放、预测轨迹、中段力度条、标题居中、无横向溢出 | 通过 |
| `shots/mobile-aim.png` | 手机 375×812 | 375×812 | 45,219 | iPhone UA 触控布局、预测虚线、满力条、标题居中不压分数/暂停钮、底部安全区不遮挡操作 | 通过 |

### 4.5 EdgeOne Pages 限额复核（生产构建 `dist/`）

- 总大小：**184,202,824 B ≈ 175.7 MiB**（`du -sh dist` 显示 177M 块占用）；
- 文件数：**180**；
- 最大单文件：`dist/mf/bge-small-zh-v1.5/onnx/model_quantized.onnx`，**24,010,842 B ≈ 22.9 MiB**（既有 ONNX，非本游戏引入）；
- 限额对照：单项目 5 GiB、20,000 文件、单文件 25 MiB —— 全部满足；本游戏 chunk 为几十 KB 级纯代码 + CSS，未新增 wasm / 字体 / 图片 / 音频素材，**未改动 SW 既有预缓存/runtimeCaching 策略**，新 chunk 由既有分包与 glob 预缓存自动收录。

## 五、可复用经验

1. **合集 GPU 子游戏最薄 wrapper 契约**：props `paused/muted/vibrate/particle`、emit `score/combo/gameover`；暂停/音频挂起交给 FocusStage，内核只响应 `paused`，避免每个游戏重复实现 `visibilitychange` 与 Wake Lock。
2. **物理游戏先把判定做成纯函数**：引力加速度、瞄准向量、力度、预测点列、combo、碰撞、快照校验不碰 DOM，node:test 毫秒级覆盖方向/边界/损坏回退，E2E 只负责手势、面板与续玩链路。
3. **快照独立键 + 严格 chain/version**：复用一个合集时必须新键新校验，读取前先 `validateSave`，空局面不落盘，胜负/重开即清；不要直接拷贝另一游戏的存档实现与键名。
4. **离线 E2E 顺序不能省**：必须先在线让 SW 接管（`controller` 非空）再断网 reload；新上下文第一次加载就断网会绕过缓存导致误报失败。
5. **预测轨迹步数要按弹道时长反推**：固定步 × 步数 ≥ 满力飞行到目标的时间，否则瞄准虚线在关卡中途消失，手感与可读性都会受损。

## 六、真机待验（本轮无头环境无法覆盖）

- 手机真实触控手感：拖拽摩擦、长按不触发系统选中/滚动、单指连发节奏；WeLink / 微信 / 华为内置 WebView 的 Pointer Events 与音频自动播放策略。
- 低端机帧率：120Hz 固定步 + 粒子爆发在中低端安卓上的掉帧情况；必要时由合集特效档位（`particle=low`）降级粒子数量。
- 真实横屏/刘海安全区：竖屏为主，若用户旋转屏幕，缩放与居中需在真机复核；本轮 E2E 视口均为竖屏比例。
- 第 3 关以后各关的真实可解性：本轮单测覆盖物理规则与配置完整性，E2E 仅强制打通第 1 关；后续真机/试玩中若发现某关力度/引力无法到达星门，按 2.3 常数表微调 `GRAVITY_G`、天体位置或星门半径。
- 长时间挂机后快照体积与恢复一致性；长时间后台切回的音频 `suspend/ensure` 恢复。
