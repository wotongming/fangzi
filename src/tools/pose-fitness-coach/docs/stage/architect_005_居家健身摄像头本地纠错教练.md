# 架构方案：居家健身摄像头本地纠错教练（pose-fitness-coach）

- 对应 innovator：`innovator_005_居家健身摄像头本地纠错教练.md`
- 对应 pm：`pm_005_居家健身摄像头本地纠错教练.md`（结论：可集成-新增，H 档，里程碑交付）
- 设计日期：2026-10-16
- 工具 id：`pose-fitness-coach`（方子第 19 个工具，web 类，档位 H）

## 需求回顾与设计依据
纯前端 PWA：getUserMedia 取摄像头 → WebGPU（回退 WASM）端侧姿态估计 33 关键点 → 动作状态机自动计数 + 实时纠错/语音提示 + 动作分 → 训练计划与本地日志。视频流只实时分析，**不录制、不上传**。模型同源自托管（避免境外 CDN 大陆不可达的既有坑）。

## 技术方案
### 系统架构
- **采集层**：`<video>` 前置/后置摄像头（手机默认后置、镜像开关），requestAnimationFrame 驱动；按设备能力降采样（15–30fps）。
- **推理层**：**MediaPipe Tasks Vision `PoseLandmarker`（Apache-2.0，可商用）**，`delegate: 'GPU'`（WebGPU）失败自动回退 `'CPU'`（WASM/WASM-SIMD）；wasm 与 `.task` 模型**同源放 `/mf/`（或 /models/）经 SW 分片/缓存**，`createFromOptions` 指本地路径，禁止运行时连 storage.googleapis.com。
- **几何层 `lib/pose-geometry.ts`（纯函数，核心可单测）**：关键点平滑（One-Euro/EMA）、关节角度、矢状面投影、关键点置信度门控、左右侧。
- **动作判定层 `lib/exercises/*.ts`**：每动作一个有限状态机（down/up），输出有效次数、当前问题（膝内扣、深度不足、塌腰、肘角、节奏）、每rep 0–100 分。V1 六个前/侧面可靠动作：深蹲、俯卧撑、弓步蹲、臀桥、站姿肩推、平板支撑（平板做计时与姿态）。
- **反馈层**：Canvas 叠加骨架/角度/问题高亮；语音用 `speechSynthesis`（关键纠错节流，不每帧念）；可关语音。
- **计划与日志层**：本地周期计划（目标/器械→周课表，纯规则生成，无 LLM）；训练记录（动作、有效次数、动作分、时长、问题）存 IndexedDB 库 `fz-pose-coach-v1`（复用 indexeddb-kv）；趋势用 Canvas 自绘。

### 模块设计
`src/tools/pose-fitness-coach/`
`manifest.ts`、`index.vue`（Tab：今日训练 / 自由练 / 历史趋势 / 设置）；
`lib/camera.ts`（权限/前后置/分辨率/生命周期，用 `use-lazy-init` 保证无流→流到达都能初始化）、`lib/pose-runner.ts`（MediaPipe 装载/委托切换/帧循环/释放，用 `gpu-detect` 且不提前销毁 device）、`lib/pose-geometry.ts`、`lib/exercises/{squat,pushup,lunge,bridge,shoulderpress,plank}.ts`、`lib/exercises/index.ts`（注册表）、`lib/feedback.ts`（语音节流+提示文案）、`lib/plan.ts`、`lib/store.ts`、`components/{SkeletonOverlay.vue,RepHud.vue,PlanCard.vue,TrendChart.vue}`。

### 关键技术路线
- 模型/引擎唯一选择：MediaPipe Tasks Vision PoseLandmarker + 其自托管 wasm/pose_landmarker_lite/full.task（均 Apache-2.0）。lite 模型优先（端侧实时），需要更稳再按需 full；同一场景不并列多套引擎。
- GPU 无头验证：编码阶段严格按 pipeline-coder `references/gpu-headless-testing.md` 分层——几何/状态机用 Node 单测（喂录制的关键点序列），视觉在 Chromium 强制 WebGL2 截图，不在无头软渲染上追 WebGPU 上屏。
- 资源：wasm 与模型通常各数 MB（lite），<25MiB 无需分片；若用 full 超限则走 shards.json。
- 隐私：仅在内存/Canvas 处理 video，不抓帧存盘、不建 MediaRecorder；权限仅工具运行时持有，离开页面 stop tracks。

### 盈利模式
Freemium+买断主方案：免费深蹲+俯卧撑（计数/基础提示）；买断 ¥49.9 解锁全 6 动作、实时纠错与动作分、周期计划、趋势与无限历史。订阅/课程包作为后续可配置能力。

## 与 fangzi 现有代码的集成方式
新增独立目录，自动发现；复用 `reusable-module/use-lazy-init`、`gpu-detect`、`worker-post`（几何可放 Worker）、`indexeddb-kv`、`use-seo`；模型走现有 /mf + `sw-model-shards.js`（无需改 SW 代码，仅增静态资源；若 <25MiB 直放）。接 `useToolBilling('pose-fitness-coach')`。不改路由/manifest 识别性/PWA 离线（声明摄像头权限，SW 预缓存模型可选）。

## 软硬件/依赖选型（商用授权）
| 依赖 | 许可 | 用途 |
| --- | --- | --- |
| @mediapipe/tasks-vision | Apache-2.0 | PoseLandmarker 推理（GPU/CPU） |
| pose_landmarker_lite/full.task | Apache-2.0 | 姿态模型权重 |
| Web Speech(speechSynthesis) | 浏览器内置 | 语音提示，无依赖/无联网 |
均免费可商用；无 NC 资源。运行需支持 getUserMedia 的 HTTPS 环境（已具备）与较新 Chrome/Edge/Safari；不支持时给明确提示与降级说明。

## 开发方案
1 人，约 8–10 人日，H 档双里程碑：
- **M1（可运行 checkpoint）**：摄像头+姿态+几何/状态机（深蹲、俯卧撑）+计数/HUD+日志+单测与 WebGL2 截图；能完整练一组并落库。
- **M2**：其余四动作、实时纠错与动作分、语音、周期计划、趋势、全端 E2E 与真机人工复测清单。

## 测试方案
- 单测（毫秒级，左移）：pose-geometry 角度/平滑/置信门控；用录制关键点序列驱动每个动作 FSM，覆盖正常计数、半程不计、左右失衡、抖动误触发、无人体/丢点。
- 摄像头 E2E：用合成视频流/伪造 landmarks 注入 runner（不依赖真实摄像头稳定性）验证计数与 HUD；真实摄像头与麦克风免提（语音）列入真机人工复测。
- 视觉：强制 WebGL2 截骨架叠加图；三视口（PC/平板/手机）布局与权限引导。
- 回归：verify:tools + 全量单测；确认模型自托管不影响 003/004 共用的 /mf 与 SW。

## 实施部署方案
静态 EdgeOne；模型 /mf 同源；首启按需下载。回滚=下线工具目录。监控仅前端：埋点（本地）记录 GPU/CPU 委托、不支持率与动作完成数，便于优化（不上传视频）。

## 风险与反思
真需要吗——端侧 AI 私教正处上升期，省钱+防受伤成立。会搞复杂吗——V1 严格限 6 个可靠动作，不做社交/视频。省时间/钱吗——替代私教与订阅。主要风险：端侧判定准确性与设备差异 → 几何层厚测、lite/full 可切、明确动作边界；隐私是强卖点需在 UI 明示“不上传/不录制”。
