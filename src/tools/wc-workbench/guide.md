# 跨框架组件库工作台 · 用户指导

版本 1.0.0 · 更新于 2026-10-15

## 这是什么 / 能做什么

在浏览器里可视化定义一个 Web Component：填属性（property / attribute）、事件（CustomEvent）、插槽（slot）、CSS 变量主题。一次建模，免费产出零依赖原生 Web Component、API 文档（Markdown）与 custom-elements.json；专业版另生成 Lit 3 + TypeScript 组件、React / Vue 适配 wrapper 与完整 npm 包。中间栏用 Shadow DOM 沙箱实时预览，右侧直接取可运行代码与可下载包，解决「同一个组件要在 React / Vue / 老系统里各写一遍」的重复维护问题。全部本地完成，无需注册、无后端。

## 快速开始

1. 首次进入是「我的组件库」视图，点「＋ 新建组件」进入三栏工作台（默认带一个示例 MyButton 可直接体验）。
2. 左侧填基础信息、属性、事件、插槽、CSS 变量主题；中间实时预览并试值、看事件日志。
3. 右侧用标签页取产物：原生 JS / API 文档 / manifest 免费，Lit + TS / React / Vue 为专业版。
4. 点「保存到组件库」回列表，可随时「在工作台打开」继续改；按需下载单文件、演示页或压缩包。

## 分步用法

### 1. 新建组件

组件模型保存在浏览器 localStorage，免费版最多 3 个；默认示例含 label / disabled 属性、press 事件、默认 + icon 插槽、primary-color / radius 两个 CSS 变量。

### 2. 左侧建模

- **基础信息**：填 PascalCase 类名与标签前缀；标签自动派生为 `前缀-类名kebab`（如 MyButton + wc → `wc-my-button`），必须全小写且含连字符，非法时顶部标红。
- **属性 Properties**：填 camelCase 属性名，attribute 自动按 kebab 派生（可改）；类型选 string / number / boolean，填默认值与说明。
- **事件 Events**：声明自定义事件名（kebab），组件交互时派发 `CustomEvent`（bubbles + composed），可跨越 Shadow DOM 被父页面监听。
- **插槽 Slots**：留空表示默认插槽，命名插槽（如 `icon`）生成 `<slot name="icon">`。
- **CSS 变量主题**：声明 `--变量名` 与默认色值，挂在组件 `:host` 上，外部可覆盖做主题化。

### 3. 中间实时预览与试值

- 组件源码内联进 sandboxed iframe（srcdoc、零网络）真实注册并渲染，状态栏显示「已连接」。
- 在「属性试值」改 label、勾选 disabled，改动实时写入组件 JS 属性并反射到 attribute，不影响默认值。
- 点预览中的组件按钮，自定义事件冒泡回工作台，显示在「事件日志」里（时间、事件名、detail）。

### 4. 右侧取代码

标签页：原生 JS（免费）、Lit + TS（Pro）、React（Pro）、Vue（Pro）、API 文档（免费）、manifest / custom-elements.json（免费）；可「复制」或「下载此文件」，专业版未解锁时代码区显示门控遮罩。

### 5. 打包导出（四种）

- **单文件组件 .js（免费）**：零依赖 IIFE，引入后即可使用，含重复 `define` 保护。
- **交互演示页 .html（免费）**：独立双击打开，自带属性控制面板，改值、看事件。
- **最小可用包 .zip（免费）**：组件 + 演示页 + custom-elements.json + README。
- **完整 npm 包 .zip（专业版）**：额外含 package.json、Lit 源、React / Vue wrapper、dist，目录可直接发布。

### 6. 保存与再次编辑

点「保存到组件库」回列表，卡片显示类名、标签与各类成员数量，可继续打开编辑或删除（仅删本地记录，不影响已导出文件）。支持模型 .json 导入导出；导入时名称归一化为合法标识符、描述文本清洗，无法借生成的源码注入脚本。

## 免费与专业版

- 免费：原生 Web Component 生成、实时预览、属性 / 事件 / 插槽 / 主题建模；API 文档、交互演示页、custom-elements.json、单文件 / 最小可用包导出；本地组件库最多 3 个与模型导入导出。
- 专业版（一次买断 ¥29.90）：Lit 3 + TypeScript 组件源码生成；React / Vue 跨框架 wrapper 批量生成；完整 npm 包结构一键打包、不限本地组件数量。

## 数据与隐私

- 建模、预览、打包全部在浏览器本地完成，不上传任何代码或模型；压缩包由本地 fflate 生成。
- 本地组件库存于 localStorage，清除站点数据会删除未导出的模型，请及时用「导出模型 .json」或打包备份。实时预览是 sandboxed iframe，组件无法访问外网与父页 DOM，为有意的隔离设计。

## 常见问题

- **标签报红「需为全小写且含连字符」？** 自定义元素规范要求标签至少含一个 `-` 且不能有大写，改前缀或类名即可（类名仍用 PascalCase，只有标签被 kebab 化）。
- **导入别人给的模型 .json 安全吗？** 安全，导入时名称归一化、描述文本清洗，非法字段类型回退为 string。
- **生成的组件在我的框架里还要再改吗？** 原生文件零依赖可直接用；React / Vue 项目建议用专业版 wrapper（类型化 props 与事件）。
- **支持 Angular 吗？** 本期 wrapper 覆盖 React 与 Vue；Angular 可直接消费原生自定义元素，专属 wrapper 列入后续版本。

## 注意事项 / 功能边界

- 免费版组件数量上限为 3，超出请升级或先导出 / 删除旧组件。工作台在窄屏自动切为单列，平板、手机上可正常建模、预览与取代码。
