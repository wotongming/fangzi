# 技术沉淀：可嵌入交互组件生成平台

- 对应 dev：dev_006_可嵌入交互组件生成平台.md
- 日期：2026-10-15
- 档位：M（标准档）

## 技术选型与理由

- **产物 = 浏览器原生 Web Component**（Custom Elements + Shadow DOM + CSS 变量），W3C 标准、零依赖、零授权成本（商用友好），天然满足「跨 React/Vue/原生/CMS、样式隔离、免 iframe」。
- **生成器 = Vue3 + TS 单文件工具**，沿用 fangzi 工具框架（`manifest.ts` 自动发现 + `useToolBilling` + `useSeo`），不新增运行时依赖、不触碰 SW/manifest/路由。
- **运行时以纯字符串烘焙**：`gen.ts` 用 `String.raw` 保存一段只含单引号字符串、不含反引号/`${}` 的 IIFE 运行时，再把配置 `JSON.stringify` 后内联。选单引号风格是为了让同一段脚本能安全地以内联 `<script>` 注入预览 iframe 的 `srcdoc`，杜绝嵌套模板字符串冲突。
- **数据默认本地**：生成器侧用 localStorage 保存组件实例与预览测试提交；正式嵌入的组件运行在宿主域，数据写宿主 localStorage 或 `data-endpoint`（`fetch(...,{keepalive:true})`），不做跨域回流（同源策略下本就做不到，如实告知用户）。
- 未引入 fflate（MVP 单文件直接下载，无需 ZIP），减少依赖面。
- 计费主方案 freemium + 买断专业版（manifest `priceCents=3990`，¥39.90），只接钩子与一个主方案，符合分档裁剪规则。

## 关键实现

```
lib/types.ts      配置模型（5 类 WidgetKind + 字段/计价/倒计时/主题），可整体 JSON 序列化
lib/templates.ts  5 类模板注册表（schema + defaults()），免费/Pro 标记，随机 6 位 id
lib/gen.ts        运行时字符串 + 配置烘焙 → 自包含单文件脚本；标签 widget-fz-<id>
lib/snippet.ts    standaloneDoc（预览/demo HTML）+ embedSnippet（两段式嵌入代码、版本化 URL）
lib/data.ts       实例本地持久化、预览提交、CSV（BOM+转义）、文件下载
lib/monetization.ts  专业版判定（freemium-pro/buyout）与升级
index.vue         五步向导：选模板 → 配置 → iframe 实时预览 → 嵌入导出 → 数据面板
```

- **预览即真实宿主**：`standaloneDoc(cfg, preview=true)` 生成含灰色宿主背景 + 组件的完整 HTML，作为 `iframe[srcdoc]`；组件在 `data-preview=1` 时通过 `window.parent.postMessage({__fzWidget:'submit'})` 把提交回传生成器，生成器据此填充「测试提交」，验证的是与线上一致的产物代码而非另一套模拟渲染。
- **主题品牌化**：主色与圆角在运行时拼成 Shadow DOM 内 CSS，宿主站点可用自定义属性之外的配置定制；`poweredBy:false` 时不渲染角标（免费版在保存时强制回 true）。
- **价格计算器**：`合计 = 数量×单价 + 固定费用`，输入即时重算并 `toLocaleString` 千分位/两位小数；提交时把数量与金额一并上报。
- **倒计时**：目标时间在生成时写进配置（绝对时间），组件内 `setInterval` 每秒刷新天/时/分（可选秒），到点清空计时块并显示到期文案、派发 `widget-countdown-end` 事件。

## 踩坑记录

1. **提交后 `self.paint is not a function`（E2E 抓到的真实运行时错误）**：星级组件才在 bind 里定义 `paint()`，但提交成功后的通用重置逻辑对 contact/feedback 也无条件调用 `self.paint(0,0)`。修复：改为 `if (typeof self.paint==='function') self.paint(0,0)`，并顺带在重置时清除 feedback 选项高亮。教训：**通用收尾路径不能假设某个子类型专属方法存在**——此类「分支专属 API 被公共路径调用」的问题适合继续用 E2E 在非该分支类型上跑一遍来拦。
2. **用户文本含 `</script>` 会提前闭合内联脚本（安全）**：`JSON.stringify` 不转义斜杠，标题里的 `</script><img>` 在 srcdoc/独立 HTML 内联 `<script>` 中会直接闭合脚本。修复：烘焙 JSON 时统一 `.replace(/</g,'\\u003c')`，`\u003c` 在 JS 源码层被解析回 `<`，运行时字符串原值不变，既防注入又不影响显示；补了回归单测。
3. **断言空格不一致导致的假失败**：单测里把 `attachShadow({mode:'open'})` 当精确串，实际源码带空格。改为宽松匹配 `attachShadow(` + `'open'`，避免无意义脆弱断言。

## 验证覆盖

- **档位 M**，质量门未降级。
- 类型检查：`npx vue-tsc --noEmit` 通过。
- 单元测试：新增 `test/embed-widget-builder.test.ts` 9 例（模板注册表、id/标签安全、字段/计价默认值、生成脚本结构、角标开关、`</script>` 转义、两段式 snippet、独立 HTML、CSV 转义/BOM/中文）；**全量 98/98 通过**。
- `npm run build` 成功；`npm run verify:tools` 校验 14 个工具全部通过（本工具关键词覆盖「组件生成/表单/问卷/评分/计算器/倒计时/Web Component」）。
- 多端 E2E `scripts/e2e-embed-widget.mjs`：**PC 1280×800 全链路 17 项 + 平板 834×1112 / 手机 375×812 各 4 项，共 25/25 通过**；三端均无横向溢出（Δ=0），console 无错误；PC 覆盖选模板→配置→Shadow DOM 内真实填写提交→跨 frame 回流→嵌入代码结构→下载文件名→数据面板→免费版 CSV/Pro 模板双重计费门控；移动两端覆盖星级组件真实渲染与点亮交互。
- 独立产物校验 `scripts/_embed-standalone-check.ts`（file:// 打开生成脚本）：**9/9 通过**——feedback 选项提交、calculator 默认/改数量计价（218→317）、countdown 未来 4 时间块与过去到期文案、Shadow DOM 样式隔离（宿主 `div{border-radius:0}` 下卡片仍 18px、按钮仍主题绿 rgb(15,122,79)）、`poweredBy:false` 无角标。五类模板均被实际渲染验证。
- **EdgeOne Pages 免费版限额核查**：dist 总量 28 MiB（限 5 GiB）、文件数 66（限 20000）、最大单文件 13.58 MiB 的既有 onnx wasm（限 25 MiB）；本工具新增源目录约 640 KB（含文档截图），生成的组件脚本单文件约 14 KB，全部合规。
- **截图有效性（均为构建后真实运行截图，已逐张打开核验）**：

| 截图文件 | 尺寸 | 大小 | 内容 | 是否通过 |
| --- | --- | --- | --- | --- |
| shot-01-list.png | 1280×800 | 110 KB | 我的组件 + 5 类模板 | 通过 |
| shot-02-config.png | 1280×800 | 101 KB | 字段配置 + 主题侧栏 | 通过 |
| shot-03-preview.png | 1280×800 | 77 KB | iframe 真实组件 + 提交回流 | 通过 |
| shot-04-embed.png | 1280×800 | 104 KB | 嵌入代码与脚本导出 | 通过 |
| shot-tablet.png | 834×1112 | 105 KB | 平板单列预览 | 通过 |
| shot-phone.png | 375×812 | 39 KB | 手机星级组件 | 通过 |

## 可复用经验

- **「配置对象 → 单引号运行时字符串 + JSON 烘焙 → Web Component」是通用的无代码组件生成范式**：想新增一类可嵌入组件，只需在 `templates.ts` 加一份 defaults + 在运行时 `bodyHtml`/`bind` 加一个分支，生成/预览/嵌入/数据链路全部复用，不必为每类组件单独搭工程。
- **srcdoc iframe + postMessage 回传**适合「在工具里真实预览将要分发到第三方环境的产物」：预览的就是最终那份脚本，避免生成器内模拟与真实产物不一致。
- **内联脚本/HTML 注入 JSON 配置，统一转义 `<` 为 `\u003c`** 是可直接复用的一条安全规则（对任何把用户文本拼进 `<script>` 的场景都成立）。
- **通用收尾/重置逻辑调用子类型专属方法前先 `typeof` 守卫**，且 E2E 至少在一个「不含该专属能力」的类型上跑通提交，成本很低、能稳定拦截这类跨分支运行时错误。
- 本工具未产生新的可复用通用模块（配置持久化/CSV 为本领域专用，indexeddb-kv 等既有模块本次未必需引入）；如后续多工具都需要「生成可分发脚本 + 嵌入代码」，可再把 gen/snippet 的骨架抽象到 reusable-module。
