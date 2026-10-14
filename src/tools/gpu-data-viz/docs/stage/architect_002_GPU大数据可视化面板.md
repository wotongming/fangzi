# 架构方案：GPU大数据可视化面板

- 对应 innovator：innovator_002_GPU大数据可视化面板.md
- 对应 pm：pm_002_GPU大数据可视化面板.md（结论：可集成（新增））
- 设计日期：2026-10-15

## 需求回顾与设计依据

- 需求（innovator_002）：百万级以上数据点 60fps 可视化分析面板，GPU 聚合、本地数据、缩放/刷选交互、导出报告；目标人群金融/IoT/科研/数据分析。
- PM 结论：与现有功能无重复，纯前端可行，freemium 计费。
- 设计前提：零后端、纯前端、EdgeOne Pages、不引重型图表库（自研轻量 GPU 渲染管线）、不破坏 fangzi 存量。

## 技术方案

### 系统架构

```
src/tools/gpu-data-viz/
├── manifest.ts        # 工具元数据（关键词：数据分析/图表/可视化/csv/大数据/百万点/gpu）
├── index.vue          # 主界面：数据导入区 + 图表画布 + 交互工具条 + 导出区
└── lib/
    ├── load.ts        # CSV/JSON 流式解析（分块读取，typed array 存储，避免 OOM）
    ├── store.ts       # 数据集内存管理：列类型推断、范围统计、可选 IndexedDB 持久化
    ├── render/
    │   ├── detect.ts  # WebGPU/WebGL2 能力探测与降级决策
    │   ├── webgpu.ts  # WebGPU 渲染：compute shader binning 聚合 + vertex buffer 绘制
    │   ├── webgl.ts   # WebGL 回退管线（同一套交互接口）
    │   └── canvas.ts  # 最终兜底（小数据量）
    ├── interact.ts    # 平移/缩放/框选/刷选状态机（GPU 视图矩阵）
    └── export.ts      # 截图导出、筛选结果 CSV 导出
```

### 模块设计

- **load 模块**：File 流式解析（首行表头、类型推断：number/date/string），百万行分块读入 Float64Array/Int32Array，解析在 Web Worker 执行。
- **render 模块**：视口驱动的 GPU 渲染——数据常驻 GPU vertex buffer；缩放时 compute shader 动态 binning（hexbin/线性 bin）计算密度；绘制用单 pass shader；主线程只处理交互事件。
- **interact 模块**：相机矩阵（pan/zoom）+ 刷选矩形 → 更新 GPU viewport 参数与筛选条件；交互延迟目标 < 100ms。
- **export 模块**：Canvas 快照 PNG 下载；刷选/筛选结果导出 CSV。

### 关键技术路线

- 渲染：优先 WebGPU（`navigator.gpu` 存在且 createComputePipeline 成功），降级 WebGL2，再降级 Canvas2D（提示数据量上限）；
- 聚合：GPU binning（count/sum/avg/min/max），学术路线参考（UW CSE512 的「Query & Render on GPU」）；
- 无重型库：自研 ~2-3k 行渲染核心，避免 ECharts 等性能天花板与授权问题。

### 盈利模式（可灵活扩展调整）

- freemium：免费 50 万点上限 + 基础图型；Pro（buyout ¥49.90 或订阅）解锁全量数据、流式更新、导出报告、嵌入式图表组件（生成 Web Component 供用户嵌入）。

## 与 fangzi 现有代码的集成方式

- 新增 `src/tools/gpu-data-viz/`（manifest.ts + index.vue + lib/*），工具框架自动发现，零核心改动；
- 复用 `reusable-module/indexeddb-kv`（如需数据集持久化）、`useToolBilling('gpu-data-viz')`；
- 渲染核心若体积可控可直接打进工具 chunk，动态 import 该工具页面即可（fangzi 工具页本身按路由懒加载）。

## 软硬件/依赖选型

| 依赖 | 用途 | 授权 | 商用状态 |
| --- | --- | --- | --- |
| WebGPU / WebGL2 | GPU 渲染（浏览器内置） | W3C 标准 | 商用友好 ✓ |
| 自研渲染管线 | 绘制/聚合 | 自研（项目开源） | 商用友好 ✓ |
| fflate（可选） | CSV 压缩导出 | MIT | 商用友好 ✓ |
| EdgeOne Pages | 静态托管 | 免费额度 | 商用友好 ✓ |

## 开发方案

- 语言/框架/环境：TypeScript + Vue3 + Vite（现有栈）；WGSL/GLSL 着色器开发；Node ≥ 20.19。
- 里程碑：M1 能力探测与数据加载 → M2 WebGPU 渲染管线（折线+散点 binning）→ M3 交互（缩放/刷选/导出）→ M4 WebGL 降级与回归。

## 测试方案

- 策略：单元测试（类型推断、binning 计算、视口变换）+ 浏览器实测（Chrome/Edge/Firefox + 集成 GPU/无 GPU 场景）。
- 用例重点：①100 万点渲染 FPS ≥ 55（Chrome 桌面）；②100 万点内存 < 500MB；③WebGL 降级可用；④刷选筛选结果正确；⑤导出文件可打开。
- 验收标准：`npm run type-check`、`npm test` 通过；`npm run build` 成功；存量工具回归（首页搜索/其他工具打开正常）。

## 实施部署方案

- 部署架构：EdgeOne Pages 静态托管；工具随 fangzi 版本一起发布。
- 上线步骤：`npm run build` → EdgeOne CLI/Git 推送 → 灰度 → 全量。
- 运维监控：EdgeOne 访问统计；着色器编译失败采集（降级日志）。
- 回滚预案：git revert + 重新部署；仅影响新增工具。

## 风险与反思

- 用户真的需要吗：是——商业库高价验证需求，ChartGPU 登 HN 热榜说明大众关注；与 fangzi 开发者用户群相邻。
- 会不会把 fangzi 搞复杂：不会——单工具目录、框架零改动；渲染核心自研保持轻量。
- 真的能节省时间、资金吗：免服务端聚合成本 + 秒级探索，依据充分。
- 遗留问题：百万点内存与移动端 GPU 限制（流式分块 + 数据量上限提示）；待确认：首发图型范围（折线/散点/热力/柱状）与 Pro 功能边界需与计费策略一起定。
