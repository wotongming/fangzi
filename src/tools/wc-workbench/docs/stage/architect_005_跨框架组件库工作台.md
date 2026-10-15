# 架构方案：跨框架组件库工作台

- 对应 innovator：innovator_005_跨框架组件库工作台.md
- 对应 pm：pm_005_跨框架组件库工作台.md（结论：可集成（新增））
- 设计日期：2026-10-15

## 需求回顾与设计依据

- 需求（innovator_005）：浏览器内 Web Components 组件开发工作台——可视化定义属性/事件/插槽/主题 → 生成 Lit/原生组件骨架 → 实时预览调试 → 自动文档/Custom Elements Manifest → 跨框架 wrapper → 打包发布；目标人群设计系统团队/组件库作者/前端架构师/独立开发者。
- PM 结论：无重复功能，纯前端可行，freemium。
- 设计前提：零后端、纯前端、EdgeOne Pages、不引重型框架（避免 Monaco，用轻量编辑器）、产物即浏览器原生组件（与 PWA 同构）。

## 技术方案

### 系统架构

```
src/tools/wc-workbench/
├── manifest.ts        # 元数据（关键词：web components/组件库/自定义元素/lit/设计系统/跨框架/组件生成）
├── index.vue          # 主界面：左侧组件树/属性表单 + 中间预览沙箱 + 右侧代码/文档/导出页签
└── lib/
    ├── model.ts       # 组件定义模型：name/properties(attr↔prop)/events/slots/cssVars/描述
    ├── generate/
    │   ├── lit.ts     # 生成 Lit + TypeScript 骨架（@customElement、@property、CustomEvent、slot、CSS 变量）
    │   ├── native.ts  # 生成原生 Web Components 骨架（HTMLElement + attachShadow + observedAttributes）
    │   └── wrappers.ts# 生成 React(@lit/react createComponent 风格)/Vue/Angular wrapper 代码
    ├── preview.ts     # iframe 沙箱预览：注入生成代码 + 属性实时改值（postMessage 通信）
    ├── docs.ts        # 从 model 生成 API 文档（属性/事件/插槽表）与交互演示页
    ├── manifest-gen.ts# 生成 custom-elements.json（编辑器补全元数据）
    ├── editor.ts      # 轻量代码编辑器：CodeMirror 6（MIT）动态加载，语法高亮
    └── export.ts      # fflate 打包：单文件脚本 / npm 包结构 zip
```

### 模块设计

- **model**：组件定义的核心数据模型（单一事实源），驱动表单、生成器、文档、Manifest 四路输出，保证一致性。
- **generate**：模板字符串生成器（Lit 为默认目标，原生为轻量选项）；wrapper 按模板批量生成（React/Vue/Angular 三选）。
- **preview**：iframe（sandbox + allow-scripts）内加载生成的组件代码（blob URL），Shadow DOM 自然隔离；通过 postMessage 接收属性变更实时重渲染。
- **docs/manifest-gen**：由 model 派生 Markdown 文档、演示页 HTML、custom-elements.json。
- **export**：打包单文件（无构建步骤 `<script>` 即用）或标准 npm 包结构（package.json + src + dist + custom-elements.json）。

### 关键技术路线

- 生成目标：Lit（BSD-3，约 5-6KB）为默认；原生 Web Components 为轻量选项；Stencil 风格跨框架编译列为 V2（构建链较重）。
- 编辑器：CodeMirror 6（MIT）按需加载，避免 Monaco 体积。
- 预览：iframe + blob URL + postMessage；导出 fflate（MIT）。
- 全部动态 import；不进 SW 预缓存。

### 盈利模式（可灵活扩展调整）

- freemium：免费（原生/基础生成、公开模板）；Pro（buyout ¥49.90 或订阅）解锁 Lit 生成、跨框架 wrapper 批量生成、私有组件库、团队协作、自定义模板、custom-elements.json 高级输出。

## 与 fangzi 现有代码的集成方式

- 新增 `src/tools/wc-workbench/`，工具框架自动发现；
- 复用 `useToolBilling('wc-workbench')`；不修改现有文件；不触碰 SW/manifest/路由。

## 软硬件/依赖选型

| 依赖 | 用途 | 授权 | 商用状态 |
| --- | --- | --- | --- |
| CodeMirror 6 | 代码编辑器 | MIT | 商用友好 ✓ |
| fflate | ZIP 打包 | MIT | 商用友好 ✓ |
| Lit（生成的代码） | 组件运行时 | BSD-3 | 商用友好 ✓ |
| custom-elements.json | 元数据标准 | W3C/开源 | 商用友好 ✓ |
| EdgeOne Pages | 静态托管 | 免费额度 | 商用友好 ✓ |

## 开发方案

- 语言/框架/环境：TypeScript + Vue3 + Vite；Node ≥ 20.19。
- 里程碑：M1 组件定义模型 + 属性表单 → M2 生成器（Lit/原生）+ 代码编辑器 → M3 预览沙箱 + 实时改值 → M4 文档/Manifest/导出/wrapper/回归。

## 测试方案

- 策略：单元测试（模型→代码生成快照、manifest 结构、wrapper 模板）+ 浏览器实测（预览沙箱渲染、生成代码在 React/Vue/原生页面可用）。
- 用例重点：①生成代码可直接在浏览器运行（复制到独立 HTML 验证）；②属性/事件双向映射正确；③custom-elements.json 合法；④ZIP 导出结构可解压；⑤freemium 权益判定正确。
- 验收标准：`npm run type-check`、`npm test`、`npm run build` 通过；存量回归正常。

## 实施部署方案

- 部署架构：EdgeOne Pages 静态托管；工具随 fangzi 发布。
- 上线步骤：`npm run build` → EdgeOne 推送 → 灰度 → 全量；README 登记。
- 运维监控：EdgeOne 访问统计；生成失败打点（可选）。
- 回滚预案：git revert + 重部署。

## 风险与反思

- 用户真的需要吗：是——WC 生态 2026 爆发但一体化工具空白；多框架重复实现是明确痛点（大厂案例佐证）。
- 会不会把 fangzi 搞复杂：不会——单工具 + 框架零改动；CodeMirror 按需加载保持轻量。
- 真的能节省时间、资金吗：省跨框架重复实现人力与文档维护工时，依据充分。
- 遗留问题：复杂组件仍依赖手写（定位为「骨架 + 可编辑」，避免承诺全自动）；待确认：Lit 生成 vs 原生默认档、wrapper 目标框架范围（V1 覆盖 React/Vue，Angular V2）。
