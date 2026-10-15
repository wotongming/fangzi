# 架构方案：可嵌入交互组件生成平台

- 对应 innovator：innovator_006_可嵌入交互组件生成平台.md
- 对应 pm：pm_006_可嵌入交互组件生成平台.md（结论：可集成（新增））
- 设计日期：2026-10-15

## 需求回顾与设计依据

- 需求（innovator_006）：无代码可嵌入交互小组件（表单/计算器/评分/反馈/图表等）生成与嵌入平台——可视化配置 → 生成含 Shadow DOM 的 Web Component 脚本 → 复制嵌入代码到任意站点 → 数据回流分析；目标人群站长/内容创作者/SaaS/运营/自由开发者。
- PM 结论：无重复功能，纯前端可行（数据回流复用 fangzi 现有「可配置端点」模式），freemium。
- 设计前提：零后端、纯前端、EdgeOne Pages 静态托管组件脚本、生成器 PWA 内运行、不破坏存量。

## 技术方案

### 系统架构

```
src/tools/embed-widget-builder/
├── manifest.ts        # 元数据（关键词：组件生成/嵌入/widget/表单/问卷/反馈/计算器/无代码/站点组件）
├── index.vue          # 主界面：模板选择 → 可视化配置 → 生成预览 → 嵌入代码 → 数据面板
└── lib/
    ├── templates.ts   # 组件模板注册表：form(表单/问卷)/calc(计算器)/rating(评分)/feedback(反馈)/countdown(倒计时)/badge(公告条)
    ├── config.ts      # 配置模型：字段/逻辑（条件显示、计算规则）/主题（CSS 变量品牌化）
    ├── gen.ts         # 生成器：渲染为含 Shadow DOM 的 Web Component 单文件脚本（无构建步骤）
    ├── snippet.ts     # 生成嵌入代码片段：<widget-x data-key="..."> + 远程脚本 <script src="...">
    ├── preview.ts     # iframe 预览已生成组件（真实渲染效果）
    └── data.ts        # 数据回流：MVP 提交数据本地导出 CSV；可选 VITE_WIDGET_ENDPOINT 端点收集（与 fangzi VITE_FEEDBACK_ENDPOINT 同模式）
```

### 模块设计

- **templates**：每种模板 = 配置 schema（字段定义、逻辑规则）+ 渲染模板（Shadow DOM + 样式隔离 + CSS 变量主题接口）。
- **config**：拖拽字段、条件显示/计算规则、品牌色（CSS 变量），实时驱动预览与生成。
- **gen**：将配置实例化为自包含 Web Component 代码（含 customElements.define、事件、提交逻辑、样式）；支持自定义属性（data-key、label 等）。
- **snippet**：输出两段式嵌入代码——①远程脚本标签（脚本托管于 EdgeOne Pages 静态资源，版本化 URL 保证更新）；②组件标签（带 data-key，标识实例）。
- **data**：MVP 提交记录存本地（IndexedDB）+ 一键导出 CSV；配置 `VITE_WIDGET_ENDPOINT` 后 POST 到自有端点（与反馈功能一致，未配置则本地，隐私可控）。

### 关键技术路线

- 产物：Web Component（Custom Elements + Shadow DOM + CSS 变量），任意技术栈站点（React/Vue/原生 HTML/WordPress/CMS）直接使用，无 iframe 冲突；
- 脚本分发：EdgeOne Pages 静态资源 + 版本化 URL（`widgets/v1/<widget-id>.js`），更新宿主无需改代码；
- 数据：MVP 本地 + 可选端点；全部动态 import；不进 SW 预缓存（组件脚本属运行时资源）。

### 盈利模式（可灵活扩展调整）

- freemium：免费（基础模板、实例数/数据量限制）；Pro（buyout ¥39.90 或订阅）解锁全部模板、自定义逻辑、品牌定制、数据导出、高级统计；可选按站点计费；后续可做模板市场分成。

## 与 fangzi 现有代码的集成方式

- 新增 `src/tools/embed-widget-builder/`，工具框架自动发现；
- 复用 `reusable-module/indexeddb-kv.ts`、`useToolBilling('embed-widget-builder')`、环境变量模式（参照 `VITE_FEEDBACK_ENDPOINT` 新增 `VITE_WIDGET_ENDPOINT`）；
- 不修改现有文件；不触碰 SW/manifest/路由。

## 软硬件/依赖选型

| 依赖 | 用途 | 授权 | 商用状态 |
| --- | --- | --- | --- |
| fflate（可选） | 数据导出 ZIP | MIT | 商用友好 ✓ |
| Web Component | 产物运行时 | W3C 标准 | 商用友好 ✓ |
| EdgeOne Pages | 静态托管（生成器 + 组件脚本） | 免费额度 | 商用友好 ✓ |
| 可选数据端点 | 数据回流 | 用户自有/免费方案 | 商用友好 ✓ |

## 开发方案

- 语言/框架/环境：TypeScript + Vue3 + Vite；Node ≥ 20.19。
- 里程碑：M1 模板注册表 + 配置表单（表单/计算器）→ M2 生成器 + 嵌入代码 + 预览 → M3 数据回流（本地 CSV + 可选端点）→ M4 更多模板/Pro 权益/回归。

## 测试方案

- 策略：单元测试（配置→生成代码快照、snippet 结构、数据导出）+ 浏览器实测（生成的组件嵌入 React 页面/原生 HTML/WordPress 场景可用、样式隔离无冲突）。
- 用例重点：①生成代码复制到独立 HTML 直接可用；②Shadow DOM 样式不污染宿主；③提交数据本地保存并导出 CSV 正确；④可选端点 POST 成功；⑤freemium 实例数限额正确。
- 验收标准：`npm run type-check`、`npm test`、`npm run build` 通过；存量回归正常。

## 实施部署方案

- 部署架构：EdgeOne Pages 承载生成器（fangzi 工具页）与生成的组件脚本（public/widgets/ 目录静态资源）；
- 上线步骤：`npm run build` → EdgeOne 推送 → 灰度 → 全量；README 登记；
- 运维监控：EdgeOne 访问统计；组件脚本加载失败率（可选上报）；
- 回滚预案：git revert + 重部署；组件脚本版本化，旧实例不受新版本影响（可指定版本加载）。

## 风险与反思

- 用户真的需要吗：是——Typeform/Tally/Intercom 已大规模验证「可嵌入组件」付费模式；WC 免 iframe 免框架绑定是明确差异化。
- 会不会把 fangzi 搞复杂：不会——单工具 + 框架零改动；数据回流默认本地，隐私可控。
- 真的能节省时间、资金吗：无代码替代开发/外包，运营分钟级上线，依据充分。
- 遗留问题：跨站脚本的 CSP/CORS 兼容需在文档说明（宿主站点需允许脚本加载）；待确认：V1 模板范围（建议表单/计算器/反馈/评分/倒计时 5 类）、数据面板（本地统计 vs 可选端点）的形态。
