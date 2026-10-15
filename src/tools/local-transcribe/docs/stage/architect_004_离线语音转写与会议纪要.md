# 架构方案：离线语音转写与会议纪要

- 对应 innovator：innovator_004_离线语音转写与会议纪要.md
- 对应 pm：pm_004_离线语音转写与会议纪要.md（结论：可集成（新增））
- 设计日期：2026-10-15

## 需求回顾与设计依据

- 需求（innovator_004）：离线本地语音转写 + 说话人分段 + 本地纪要生成（要点/结论/待办），音频不出端、离线可用；目标人群商务/律师/记者/学生/医生。
- PM 结论：无重复功能，纯前端可行（Whisper MIT + Qwen Apache-2.0），freemium。
- 设计前提：零后端、纯前端、EdgeOne Pages、模型运行时下载、不破坏存量、商用友好授权；MVP 先做「时间戳分段」不做重说话人分离（pyannote 类过重，列为 Pro 后续）。

## 技术方案

### 系统架构

```
src/tools/local-transcribe/
├── manifest.ts        # 元数据（关键词：语音转文字/转录/会议纪要/离线/whisper/录音/摘要）
├── index.vue          # 主界面：录音/导入区 + 转写区（时间戳/分段/可编辑）+ 纪要区 + 波形
└── lib/
    ├── input.ts       # MediaRecorder 录音（可选系统音频）；File API/File System Access 导入（mp3/wav/m4a/ogg/flac；视频提取音轨用 ffmpeg.wasm 动态加载，可选）
    ├── asr.ts         # Whisper 推理：Transformers.js/onnxruntime-web 动态加载，模型档位 tiny/base/small，WebGPU→WASM→CPU
    ├── segment.ts     # 时间戳分段、静音切分（VAD 简易实现）、说话人标记占位（V2: 说话人分离）
    ├── summarize.ts   # 本地 LLM（Qwen2.5-0.5B/1.5B INT4）生成要点/结论/待办/摘要（与音频同语言）
    ├── store.ts       # 转写与纪要存 IndexedDB（复用 indexeddb-kv），支持历史检索
    ├── waveform.ts    # 波形绘制（Canvas），点击跳转、变速播放
    └── export.ts      # 导出 文本/Markdown/SRT；批量队列
```

### 模块设计

- **input**：麦克风录音（MediaRecorder, webm）或导入音频文件；视频提音轨（ffmpeg.wasm 动态加载，约 30MB，仅按需）。
- **asr**：Whisper 模型按需下载（tiny ~75MB / base ~140MB / small ~460MB）并缓存；推理进度（实时率）展示；术语词库（initial_prompt 偏置，产品名/人名提高准确率）。
- **segment**：段级时间戳输出（Whisper 自带 segments）+ 静音 VAD 切分；说话人分离列为 V2（浏览器内 diarization 模型过重，MVP 用「段落+时间戳」+ 手动标注）。
- **summarize**：转写完成后本地小模型流式生成结构化纪要（要点/决定/待办/摘要），可编辑可导出。
- **数据流**：音频 →（Worker）ASR 转写 → 分段/时间戳 → 本地 LLM 纪要 → IndexedDB 存储 → 导出/历史检索。

### 关键技术路线

- ASR：`@huggingface/transformers`（Apache-2.0）加载 Whisper（MIT 权重）；WebGPU 加速优先，WASM/CPU 回退；
- 纪要：WebLLM（Apache-2.0）或 Transformers.js 跑 Qwen2.5（Apache-2.0，INT4）；
- 存储：IndexedDB（复用 indexeddb-kv）；波形 Canvas；
- 重型依赖动态 import，不进 SW 预缓存。

### 盈利模式（可灵活扩展调整）

- freemium：免费每月 60 分钟转写（base 模型）；Pro（buyout ¥49.90 或订阅 ¥19.90/月）解锁无限制时长、small 模型、术语词库、批量、纪要导出；V2 说话人分离作为 Pro 卖点；企业内网部署版（后续）。

## 与 fangzi 现有代码的集成方式

- 新增 `src/tools/local-transcribe/`，工具框架自动发现；
- 复用 `reusable-module/indexeddb-kv.ts`、`useToolBilling('local-transcribe')`；
- 不修改现有文件；不触碰 SW/manifest/路由。

## 软硬件/依赖选型

| 依赖 | 用途 | 授权 | 商用状态 |
| --- | --- | --- | --- |
| @huggingface/transformers | ASR/LLM 推理 | Apache-2.0 | 商用友好 ✓ |
| onnxruntime-web | 推理后端 | MIT | 商用友好 ✓ |
| Whisper 权重 | 语音识别 | MIT | 商用友好 ✓ |
| Qwen2.5 权重 | 纪要生成 | Apache-2.0 | 商用友好 ✓ |
| ffmpeg.wasm（可选） | 视频提音轨 | MIT（含 LGPL 组件按需） | 商用友好（注意 LGPL 合规提示）✓ |
| MediaRecorder / File System Access | 录音/导入 | Web 标准 | 商用友好 ✓ |
| Hugging Face | 模型下载（运行时） | 免费 | 商用友好 ✓ |
| EdgeOne Pages | 静态托管 | 免费额度 | 商用友好 ✓ |

## 开发方案

- 语言/框架/环境：TypeScript + Vue3 + Vite；Node ≥ 20.19。
- 里程碑：M1 录音/导入 + Whisper 转写（base）→ M2 分段/波形/编辑/导出 → M3 本地纪要生成 → M4 批量/降级/Pro 权益/回归。

## 测试方案

- 策略：单元测试（分段、导出格式、词库偏置）+ 浏览器实测（断网离线、CPU 推理、中英混合音频）。
- 用例重点：①1 小时音频转写成功且时间戳正确；②断网后已缓存模型可用；③纪要结构完整（要点/待办）；④SRT 导出可被播放器识别；⑤freemium 时长限额正确扣减。
- 验收标准：`npm run type-check`、`npm test`、`npm run build` 通过；存量回归正常。

## 实施部署方案

- 部署架构：EdgeOne Pages 静态托管；模型运行时下载不进部署包。
- 上线步骤：`npm run build` → EdgeOne 推送 → 灰度 → 全量；README 登记。
- 运维监控：转写耗时/失败率本地打点；EdgeOne 访问统计。
- 回滚预案：git revert + 重部署。

## 风险与反思

- 用户真的需要吗：是——StarWhisper/AirgapAI 已收费验证；会议纪要耗时是普遍痛点。
- 会不会把 fangzi 搞复杂：不会——单工具；但需在 UI 提示「录音前取得对方同意」的法律义务（合规提示）。
- 真的能节省时间、资金吗：10 人团队每周约省 20 小时 + 免订阅费，依据充分。
- 遗留问题：说话人分离 V2 的技术选型（浏览器内 diarization 尚无轻量成熟方案，暂以手动标注替代）；待确认：首次模型下载策略、转写时长上限、中英混合优化程度。

