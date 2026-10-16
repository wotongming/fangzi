# 技术沉淀：居家健身摄像头本地纠错教练

- 对应 dev：dev_005_居家健身摄像头本地纠错教练.md（见 `docs/stage/`）
- 日期：2026-10-16
- **档位：H**（端侧本地 AI / WASM / 实时摄像头 / Canvas2D 叠加 / GPU→CPU 降级）

## 技术选型与理由

| 选型 | 版本/规格 | 用途 | 商用授权 |
| --- | --- | --- | --- |
| @mediapipe/tasks-vision | 1.1.1（npm，npmmirror 安装） | PoseLandmarker 33 点姿态推理 | Apache-2.0，可商用 |
| pose_landmarker_lite.task | float16，5.78MB | 单人轻量姿态模型，端侧实时 | Apache-2.0（Google MediaPipe 模型） |
| vision_wasm_internal.wasm/.js | 13.52MB / 0.33MB | 同源自托管推理运行时 | Apache-2.0 |
| Vue 3 + TS + Pinia | 沿用 fangzi 栈 | 界面/状态 | 项目既有 |
| Canvas2D | 浏览器原生 | 骨架叠加（不引入 WebGPU 渲染） | 原生 |
| IndexedDB | 浏览器原生 | 训练记录本地持久化 | 原生 |
| Web Speech（speechSynthesis） | 浏览器原生 | 语音纠错，不出端 | 原生 |

- 为何选 MediaPipe 而非 transformers.js/ONNX 姿态模型：tasks-vision 提供开箱即用的 VIDEO runningMode、单模型单引擎、体积可控（模型 5.78MB）、Apache-2.0 可商用，满足"同一场景只选一个引擎"。
- 模型与 wasm **同源自托管**在 `public/mf/mediapipe/`，避免依赖 googleapis 运行时拉取（国内网络不稳），并纳入站点缓存；满足零后端、离线与商用合规。
- 计费不自造轮子：只把方子统一计费钩子接到专业能力，主变现方案为 **freemium + 买断（¥49.90）**，feature keys：`ex-squat`/`ex-pushup` 免费，`ex-pro`/`coach-pro`/`plan-pro`/`trend-pro` 为 Pro。

## 关键实现

### 数据流（单 rAF 主循环）

```
camera(video) ─► PoseRunner.detect(video,t)   [注入模式则取 window.__fzPoseInject()]
                     │ GPU 失败自动回退 CPU（PoseLandmarker.delegate）
                     ▼
              raw Pose(33) ─► PoseSmoother(EMA α=0.5，低可见沿用上帧)
                     ▼
              Exercise.evaluate(smoothed, valid, t) ─► RepFsm(up/down 状态机)
                     ▼
              CoachFrame{present,phase,reps,angle,issues,lastScore,smoothed}
                     ├─► SkeletonOverlay (Canvas2D 画 POSE_EDGES + 关键点)
                     ├─► RepHud（次数/阶段/角度/纠错气泡）
                     └─► feedback（speechSynthesis，2.5s 节流）
结束 ─► tally() ─► saveSession()（IndexedDB 库 fz-pose-coach-v1 / 表 sessions）
```

### 六动作判定要点

- 统一用关节夹角（髋-膝-踝、肩-肘-腕、肩-髋-膝）+ 姿态归一化偏移；深蹲/俯卧撑/弓步/臀桥/肩推为计数型（RepFsm 到位→回位计 1 次），平板为计时型。
- 阈值：深蹲 deep<115°/good≤95°/home>150°，膝内扣 `kneeValgusRatio<0.72`；俯卧撑同角度区间，塌腰归一化偏移 >0.14 critical、撅臀 <-0.12 warn；肩推双肘均角 >150° 且腕高于肩为 top；平板肩-髋-踝线偏离 |dev|≤0.1 且斜率 <0.45 才计时。
- 侧别 `pickSide` 取可见度更高一侧；`personPresent` 要求肩/髋/膝/踝 8 点平均可见度≥0.5，无人帧直接短路，避免误计数。
- 半程提示 1200ms 节流防抖；评分按到位深度/稳定度计算并 clamp 到 40–100。

### 隐私与自检接缝

- 生产路径画面从不落盘、不联网；E2E 断言自检模式下 0 个模型/wasm 网络请求。
- `window.__fzPoseInject()` 存在时**跳过摄像头与模型**，改由注入函数供关键点——使无头环境（无摄像头/GPU）也能驱动完整的平滑→FSM→计数→叠加→HUD→落库→计费链路。

## 踩坑记录

1. **@mediapipe/tasks-vision 旧版本号 notarget**：尝试 1.0.1822391256 报版本不存在，改用最新稳定版 1.1.1（npmmirror），安装与类型正常。
2. **模型运行时拉取不可达风险**：不依赖 `storage.googleapis.com` 运行时地址，把 wasm 与 .task 放同源 `public/mf/mediapipe/`，`FilesetResolver.forVisionTasks(base)` 指同源路径。
3. **GPU 不可用必须降级**：`createPoseRunner` 先以 delegate GPU 创建，失败 catch 后 CPU 重建，UI 给出"CPU 兼容模式"提示，任何环境不白屏。
4. **EMA 平滑导致单帧跳变不到位**：这是真实视频的正确行为（连续帧才到位），单测按连续多帧构造序列，而非单帧跳变。
5. **ToolCategory 无 health**：方子分类仅 life/work/compliance/developer/security，manifest 用 `category:'life'`。
6. **无头 Playwright 动态 import 取 chromium 失败**：共享 `_gpu-ctx.mjs` 的 `import('playwright')` 在本全局安装环境下解构不到 `chromium`，本工具 E2E 内联用 default 导入（与仓库既有 e2e 脚本一致），未改动共享脚本以免影响其他工具。
7. vue-tsc 严格未用变量：清理 shoulderpress evaluate 缺 `_valid:boolean[]`、coach 未用类型导入、pushup 未用 midpoint、plank 未用 angle、index 未用 goalOptions。

## 验证覆盖

**档位 H 质量门（均通过，未降级）**

- 类型检查：`npx vue-tsc --noEmit` = 0 错。
- 单元测试：`node --import tsx --test test/*.test.ts` = **171/171 通过**；本工具新增 16 例：
  - `test/pose-geometry.test.ts` 7 例：夹角/距离/personPresent/pickSide/PoseSmoother EMA 与低可见沿用/kneeValgusRatio/常量。
  - `test/pose-exercises.test.ts` 9 例：深蹲 3 次计数、半程不计、无人/丢点不崩、俯卧撑 2 次、弓步、臀桥 2 次、肩推 2 次、平板计时+塌腰暂停+tally 汇总、CoachEngine 整段 stop 汇总。
- 生产构建：`npm run build` 成功，postbuild 25MiB 单文件守卫通过。
- 工具注册：`npm run verify:tools` = **18 个工具**（本工具被 registry glob 自动发现，未改路由/搜索）。

**无头 E2E（scripts/e2e-pose-coach.mjs，注入合成关键点）= 13/13 通过**

深蹲 2 次计数、HUD 次数、自检 0 模型网络请求（隐私）、结束保存落 IndexedDB 并显示、无未捕获异常、Pro 动作门控、买断后解锁可练、平板/手机无横向溢出、手机 Pro 门控可点、Canvas2D 骨架真实截图。

**多端多尺寸（PC1280×900 / 平板834×1112 / 手机375×812）**：三视口 `scrollWidth-clientWidth≤2`，动作胶囊换行、舞台 3:4、HUD 不溢出。

**EdgeOne Pages 免费版限额核查（dist 实测）**

| 项 | 限额 | 实测 | 结论 |
| --- | --- | --- | --- |
| 单项目存储 | 5 GiB | dist 共 105 MiB | 合规 |
| 文件总数 | 20000 | 100 个 | 合规 |
| 单文件大小 | 25 MiB | 最大 14.31MiB（whisper 分片）；本工具 wasm 13.52MiB、模型 5.78MiB | 合规 |

**guide 截图有效性校验（均为真实生产 build 运行截图，非占位/网图）**

| 文件 | 像素 | 大小 | 内容一致性 | 结论 |
| --- | --- | --- | --- | --- |
| pc-idle.png | 1280×900 | 58.4KB | PC 自由练空闲页 | 通过 |
| pc-squat-running.png | 560×747 | 23.1KB | 深蹲底部骨架叠加+HUD | 通过（已肉眼复核绿连线黄点） |
| pc-settings.png | 1280×900 | 73.7KB | 设置与权益/买断 | 通过 |
| tablet-squat.png | 834×1112 | 61.7KB | 平板运行态自适应 | 通过 |
| mobile-idle.png | 375×812 | 52.1KB | 手机空闲页 | 通过 |

**仍需真机人工复测（无头无法覆盖，已写入 guide）**：真实摄像头六动作计数、真机 GPU/CPU 回退、speechSynthesis 语音、首载→离线、iOS Safari 权限与 PWA 全屏。

**全业务场景结论**：免费计数、Pro 门控/买断、实时纠错评分、计划生成、历史落库/删除/趋势、设置静音/镜像/前后摄的逻辑链路在无头环境无阻塞；真机专项见 guide 清单。

## 可复用经验

- **端侧视觉工具的"注入接缝"模式**：在主循环入口判断 `window.__xxxInject`，存在则替换传感器/模型输入，可让无硬件的 CI/无头环境跑通完整业务链路，断言真实落库与计费，而不只是纯函数单测。
- **模型/wasm 一律同源自托管**：放 `public/mf/<engine>/`，既绕开国内对 googleapis 的不稳定访问，又纳入 SW 缓存与 25MiB 守卫，可复用于后续 MediaPipe/transformers 工具。
- **姿态 FSM 三件套**：`personPresent` 短路 + `pickSide` 选侧 + EMA 平滑（低可见沿用上帧），是计数稳定、抗丢点的通用前置；阈值与关节角工具（pose-geometry）后续动作可直接复用。
- **Canvas2D 叠加**比 WebGPU 上屏更适合"贴关键点/连线"这类轻量可视化，无头可直接截图断言，规避软渲染上屏深坑；仅大规模像素计算才需要 WebGPU。
