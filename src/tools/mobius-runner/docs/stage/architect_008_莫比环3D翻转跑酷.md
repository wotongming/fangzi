# 架构方案：莫比环 MÖBIUS（一指翻转 3D 莫比乌斯环带跑酷）

- 对应 innovator：`innovator_008_莫比环3D翻转跑酷.md`
- 对应 pm：`pm_008_莫比环3D翻转跑酷.md`（结论：可集成·新增独立工具）
- 设计日期：2026-10-19
- 落地仓库：`https://gitcode.com/m0_45688211/fangzi`（Vue3+Vite+TS，纯静态 PWA / EdgeOne Pages）

## 需求回顾与设计依据

做一款**单键**、点开即玩、强吸引力且“不落俗套”的 Three.js 3D 游戏：玩家是一道光，沿无限**莫比乌斯光带**自动奔跑，点一下翻到环带另一面穿过闸门缺口；半扭转周期性交换“两面”，构成独特空间反应挑战。必须：纯前端、无后端、离线、全屏沉浸、低端降级、PC/手机/平板都可用，并接入方子统一 freemium 计费。

设计依据：PM 已确认与现有 mini-games 不重复、Three.js(MIT) 可商用、以**独立工具 + 独立异步 chunk** 零侵入集成。

## 技术方案

### 系统架构

分层（依赖方向只向内，渲染层不写规则）：

```
src/tools/mobius-runner/
├── manifest.ts            # 自动注册：id/name/keywords/billing(freemium)/immersive:true
├── index.vue              # 工具外壳：路由入口、结算/暂停/付费墙 UI、生命周期
├── guide.md               # 页面内“用户指导”（随站发布）
├── game/
│   ├── types.ts           # Face/GameState/Gate/Segment/Settings/SaveData 类型
│   ├── rng.ts             # mulberry32 等可种子化随机（确定性生成，可单测）
│   ├── geometry.ts        # 莫比乌斯中心线/帧(Frenet)/半扭转采样（纯函数，可单测）
│   ├── logic.ts           # 关卡生成/换面/扭转状态/碰撞/计分/连击（纯逻辑，node:test）
│   ├── difficulty.ts      # 速度/闸门密度/扭转频率随距离的曲线（纯函数，可单测）
│   ├── storage.ts         # 复用 indexeddb-kv 封装 best/settings/总光屑/外观（宽松结构）
│   └── audio.ts           # 极简单声道 WebAudio 合成（翻转/擦过/死亡/连击/扭转上扬）
├── three/
│   ├── MobiusRenderer.ts  # Three.js 场景/相机/光照/对象池，RAF 驱动只读 Logic 状态
│   ├── RibbonMesh.ts      # 参数化莫比乌斯光带（TubeGeometry/自定义带状网格）+ 回收
│   ├── GateMesh.ts        # 闸门(墙/缺口)、光屑、玩家光体的网格与对象池
│   └── fx.ts              # 拖尾/粒子爆裂/辉光(可选 UnrealBloom)/慢动作/震屏
├── components/
│   ├── GameStage.vue      # 承载 canvas 的纯净全屏舞台 + 输入(点击/空格) + WakeLock/震动
│   ├── Hud.vue            # 极简 HUD：分数/距离/连击 + 一个暂停钮（沉浸约束）
│   ├── OverlayPanels.vue  # 开始引导 / 暂停 / 结算 / 付费墙 / 不支持兜底
│   └── settings/ 主题与动效开关面板
└── docs/                  # pipeline 五阶段 + guide/postmortem（归档，图片不随站）
```

数据流（单向）：`Logic(权威状态, 固定步长)` → 每帧快照 `GameState` → `MobiusRenderer` 只读渲染；输入（tap）→ `Logic.flip()`。渲染绝不反写规则，保证逻辑可在无 WebGL 环境单测、录像/重放与确定性调试。

### 模块设计

- **geometry.ts（莫比乌斯的数学核心）**：给定弧长 `u`，用 Frenet 标架给出中心线位置 `C(u)`、切向 `T(u)`、法向 `N(u)`、副法向 `B(u)`；在约定的“扭转区间”令环带绕切向旋转角从 0 平滑到 π（半扭转），从而环带是真正只有一个面的莫比乌斯带。提供 `pointOn(u, across, faceSign)` 返回带上一点与世界方向。**扭转采样为纯函数**，单测验证：经过一个扭转区后两面 id 互换、带面连续无翻转跳变。
- **logic.ts（权威玩法）**：
  - 状态：`{distance, speed, face(0/1 逻辑面), runSeed, gates[], shards[], combo, multiplier, score, best, status}`。
  - `flip()`：记录换面（渲染层播跨越弧）；若恰在判定窗内穿过闸门则 perfect/near-miss，否则撞墙 `dead`。
  - 固定步长 `update(dt)`：前进、回收/生成闸门与光屑（对象窗口随玩家弧长滚动）、计算碰撞（比较玩家 `u` 与闸门 `u`、所在面是否为墙）、连击衰减、难度推进、半扭转换面记账。
  - 碰撞用一维弧长 + 面，不用 3D 物理，确定性强、移动端稳。
- **difficulty.ts**：以距离为自变量输出 speed、闸门间隔分布、扭转区频率、是否允许“扭转+闸门”组合、横移闸门开关；前 ~150m 为教学段（单面门、慢、无扭转），平滑爬坡。
- **MobiusRenderer.ts**：透视相机略微后置上抬，**朝向并按表面法线做受限角速度的 bank 翻滚**，扭转区随带翻滚；`WebGLRenderer({antialias, powerPreference:'high-performance'})`；所有长生命周期网格对象池化，按弧长循环回收，避免 GC 卡顿；像素比上限随质量档封顶（高档 ≤2、低档 ≤1.25）。
- **fx.ts**：玩家拖尾用短历史点带 / `Line`；擦过/死亡粒子用 `Points` 小池；辉光用 `UnrealBloomPass`（仅高档，按需动态加载后处理，避免低端负担）；near-miss 触发时间缩放（0.35× 持续 90ms）+ 轻微震屏；严格“画面只留游戏+HUD 分数+一个暂停钮”。
- **audio.ts**：WebAudio 一个 AudioContext（首次交互后 resume），振荡器+噪声合成翻转、擦过、命中、连击升调、死亡、扭转上扬；静音开关；移动端按设置触发 `navigator.vibrate`。
- **storage.ts**：库 `fz-mobius-runner-v1`，单例 `{id:'state', best, totalShards, settings?{muted,vibrate,fx:'auto'|'high'|'low',reduceMotion}, unlockedThemes[]}`，读取做默认值回退；**独立库不碰其它工具数据**。
- **GameStage.vue**：onMounted 内 `await import('three')` 与渲染器（**懒加载**），用 `use-lazy-init` 处理“chunk 到达后再初始化画布”；进入调用全屏/WakeLock；卸载彻底 dispose（renderer/geometry/material/纹理/RAF/监听/AudioContext）。

### 关键技术路线

1. **真莫比乌斯而非两条车道贴图**：半扭转由 `geometry.ts` 的标架旋转真实驱动，相机与碰撞都基于同一参数化，保证“翻面对调”在视觉与规则上一致，这是新鲜感与可信度的根。
2. **固定步长逻辑 + 可变帧率渲染**：`Logic.update` 以固定 1/120 步长累加器推进，渲染按 RAF 插值，避免高刷屏/低端正快慢不一；移动端默认锁目标 60FPS，掉帧时只降渲染质量不降逻辑速度。
3. **Three.js 动态分包**：`const THREE = await import('three')`（后处理同理单独 chunk），Vite 自动切分；不进入首屏与其它工具 chunk。
4. **零素材程序化美术**：网格/粒子/光带全部代码生成，emoji 不用于 3D 主体；无图片/音频/模型，零版权与网络依赖。
5. **沉浸与可中断**：复用外壳 `immersive` 全屏 + 游戏内 WakeLock；失焦/visibilitychange 自动暂停，来电切后台不判死。
6. **无障碍/晕 3D**：`reduceMotion` 降低相机翻滚幅度、关景深/震屏、放慢扭转角速度；色盲友好的“面/缺口”区分除颜色外加形状/发光轮廓双通道。

### 盈利模式

接方子统一计费框架（freemium + 买断，无广告/无订阅）：
- 免费：核心玩法、无限重开、基础拖尾、本地最高分、全部难度。
- 专业版买断（建议价 ¥12.90 / `priceCents=1290`，以计费框架最终配置为准）：多主题皮肤包、每局限一次的“光盾续命”、专属拖尾与结算徽章、未来模式优先。
- 代码只接计费钩子：进入“专业内容”前 `hasEntitlement('mobius-runner','pro')` 校验、续命消耗的本地记账、买断入口；不实现真钱通道，不做逼氪弹窗，免费可玩性完整。

## 与 fangzi 现有代码的集成方式

- **新增**目录 `src/tools/mobius-runner/`；`manifest.ts` 与 `index.vue` 会被 `src/core/registry.ts` 的 `import.meta.glob('../tools/*/…')` 自动发现，**无需改路由表/搜索/注册逻辑**。
- **复用**：`src/core/billing`（权限/买断/订单）、`reusable-module/indexeddb-kv`、`reusable-module/use-lazy-init`、`reusable-module/gpu-detect`、`reusable-module/use-seo`（title/description/JSON-LD/canonical）、外壳 `immersive` 全屏与移动端安全区/底部避让。
- **依赖**：新增 `three`（运行）、`@types/three`（开发）；锁定一个无已知漏洞、与 Vite 7 兼容的稳定版本（编码前联网核对最新稳定版与 advisory）。
- **不改** mini-games、SW 源码策略、manifest 主清单；仅需确认构建后 three 异步 chunk 被 PWA 预缓存（见测试/部署）。
- 入口关键词覆盖：3D 游戏/跑酷/反应力/炫酷/莫比乌斯/翻转/单指/离线等，接入首页“大家都在问”示例与工具间互链（mini-games guide 可加“想玩 3D？试莫比环”的同体系引导，属可选项，不强制改对方文件）。

## 软硬件 / 依赖选型（商用授权）

| 选型 | 用途 | 授权/成本 | 商用合规 |
| --- | --- | --- | --- |
| three | WebGL 3D 引擎 | MIT，免费 | ✅ 可商用 |
| @types/three | TS 类型 | MIT，免费(dev) | ✅ |
| three/examples UnrealBloomPass（按需） | 高档辉光 | three 同仓 MIT | ✅；动态 import，低端不加载 |
| Web Audio API | 程序化音效 | 浏览器原生 | ✅ 无依赖 |
| IndexedDB（经 indexeddb-kv） | 存档 | 浏览器原生 | ✅ |
| Screen Wake Lock / Vibration / Fullscreen | 沉浸 | 浏览器原生（缺失即静默降级） | ✅ |
| EdgeOne Pages 免费版 | 静态托管 | 免费额度 | ✅ 无 NC 风险 |

不使用任何仅限非商用/学术的模型、素材或库；本功能**不涉及本地 AI 模型**，无大权重下载。

## 开发方案

- 语言/框架：TypeScript + Vue 3 SFC + Three.js；Vite 构建；node:test 单测；Playwright(Chromium) E2E。
- 里程碑（H 档，建议三段）：
  - **M1 垂直切片**：geometry/logic 纯逻辑 + 单测；Three 环带/相机/玩家；单键翻转 + 闸门碰撞 + 死亡/秒重开；基础分数与本地最高。
  - **M2 深度与 juice**：半扭转区（数学+相机）、连击/near-miss/慢动作/震屏、光屑收集、难度曲线、合成音/震动/WakeLock、质量档自动探测。
  - **M3 商业化与交付**：计费钩子 + 续命 + 主题/外观、设置面板、不支持兜底、SEO、三视口 E2E、guide/postmortem、README、SW 预缓存核对、推送 EdgeOne。
- 分工：独立开发者一人；逻辑先行、渲染做薄、每里程碑跑质量门。

## 测试方案

- **纯逻辑单测（node:test，毫秒级，测试左移）**：
  - geometry：经过扭转区后两面 id 互换；带面连续；点采样在带宽度内。
  - rng：同种子同序列；difficulty：教学段无扭转、速度单调有界。
  - logic：在缺口面通过=存活、在墙面通过=死亡；完美翻转/擦过加分与连击倍率；连击衰减；固定步长推进距离守恒；重开状态归零；越界窗口回收数量稳定。
- **挂载/集成**：`use-lazy-init` 在“初始无 Three→chunk 异步到达”两路径都正确初始化；向 Worker（如后续使用）只传纯对象（参考 worker-post 规范）。
- **E2E（Playwright，强制 WebGL2 软渲染，遵循 gpu-headless-testing）**：PC 1280×800 / 平板 834×1112 / 手机 375×812；断言：进入即全屏舞台、点击触发翻转（逻辑分数/存活随可控种子变化）、撞墙出结算、点击 1 秒内重开、三视口 `scrollWidth-clientWidth<=2`、无 pageerror（过滤主动 abort SW 的噪声）；付费墙与续命的免费/已购两态；无 WebGL 兜底分支（用 init script 抹除 canvas/webgl 上下文）。
- **回归**：确认 mini-games 与其它 27 个工具 `verify:tools` 全过、首页/导航无异常；three chunk 不影响其它路由。
- **真机人工**：上线后真机（iOS Safari / 安卓 Chrome）各一次肉眼复核 3D 上屏与手感（无头只断言 WebGL2 视觉，不断言 WebGPU）。

## 实施部署方案

- 部署：沿用 EdgeOne Pages，推送 main 自动构建发布；无服务端配置、无环境变量密钥。
- SW/离线：构建后检查 three 相关 hashed chunk 在 PWA 预缓存清单内（`vite-plugin-pwa` globPatterns 覆盖 `assets/*.js`，必要时把动态 chunk 加入 `additionalEntries`/`glob` 包含项，验收点明确）；版本更新走既有 SW 更新提示，旧缓存可回收。
- 监控/回滚：纯静态无后端监控；以构建/E2E 为质量门，线上问题通过 `git revert` + 回推快速回滚（独立工具，回滚不影响他人）；存储只增可选字段保证向前兼容。
- 性能预算：首屏不新增（懒加载）；进入游戏新增 three chunk（gzip 目标 < ~200KB，以实测为准）；运行内存对象池化、像素比封顶；目标稳定 60FPS（中高端机），低端降到可玩 30FPS。

## 风险与反思

- **用户真的需要吗？** 需要的是“1 分钟就能获得的爽感与成就感”，不是更复杂的游戏——所以坚持单键、秒重开、强反馈，不堆系统/剧情。
- **会不会把方子搞复杂？** 独立目录 + 独立 chunk + 独立存档，不进首屏、不改存量，复杂度被严格关在本工具内。
- **真能省时间/钱吗？** 免安装免广告免联网即玩本身省时间；免费本体零成本，专业版仅个性化/便利。
- **主要风险与对策**：
  1. 半扭转看不懂/晕 → 强预告、教学三局、受限相机角速度、reduceMotion 开关、颜色+形状双通道。
  2. 低端机卡 → gpu-detect 分档、像素比/粒子/辉光裁剪、对象池、固定步长逻辑。
  3. Three.js 版本/构建兼容 → 编码前锁定稳定无漏洞版本并核对与 Vite7 适配；动态 import 隔离。
  4. 手感“不好玩” → 用可控种子在 E2E 调时机窗与难度曲线，M1 即真人试玩校验翻转响应延迟（目标输入到视觉反馈 <100ms）。
- 遗留待确认：最终专业版定价与首发主题数量（建议 ¥12.90 / 首发 3 主题），可在 dev/实现期按计费框架再定，不影响架构。
