# 技术沉淀：跨框架组件库工作台（wc-workbench）

- 对应 dev：`dev_005_跨框架组件库工作台.md`
- 日期：2026-10-15
- 功能档位：**M**（多场景链路：建模 → Shadow DOM 实时预览 → 多框架代码生成 → API/manifest → npm 打包；Worker/无、文件处理/fflate、iframe postMessage 通信）

## 技术选型与理由

| 选型 | 版本/形式 | 授权 | 理由 |
| --- | --- | --- | --- |
| 原生 Custom Elements v1 + Shadow DOM | 浏览器内置 | 原生 | 生成产物零依赖、可被任意框架消费；工作台自身也用同一机制预览 |
| fflate | 0.8.3（已在仓库 dependencies） | MIT（可商用） | 同步 zipSync 打包最小包 / npm 包，**不新增任何依赖** |
| iframe `srcdoc` + `postMessage` | 浏览器内置 | 原生 | 沙箱内联组件源码实时运行，零网络、零 ESM CDN，规避无头环境外链失败；`sandbox="allow-scripts allow-forms allow-popups"` |
| 代码编辑 | 只读 `<pre>` + 表单即模型 | — | PM 允许轻量方案；模型才是唯一数据源，代码只读/复制/下载，避免引入 CodeMirror 增加体积 |
| Lit 3 + TS / @lit/react 风格 wrapper | 仅生成文本，不打进 bundle | 生成代码由用户自行 `npm i lit` | 工作台不承担 Lit 运行时，包体零增量 |
| 计费 | 复用方子统一 billing（freemium + 买断 freemium-pro ¥49.90） | — | 只接计费钩子 + 一个主变现方案，不重复造轮子 |

漏洞与兼容性核查：fflate 0.8.3 为当前稳定线、MIT 无已知高危；未引入新 npm 依赖；Custom Elements / Shadow DOM 在 Chrome/Edge/Firefox/Safari 现行版本全支持。

## 关键实现

```
index.vue（三栏 studio / 组件库 library）
 ├─ lib/model.ts        ComponentModel 类型 + tagNameOf/toClassName/kebab/emptyModel/合法性
 ├─ lib/code.ts         pascal/camel/jsStr/coerceFromAttr + safeIdent/safePascalIdent/safeComment/safeKebab
 ├─ lib/generate/
 │   ├─ native.ts       IIFE class：observedAttributes + defineProperty 反射 + CustomEvent + slot + css 变量
 │   ├─ lit.ts          Lit3 + TS（@customElement/@property/css/emits/TagNameMap）
 │   └─ wrappers.ts     React（@lit/react createComponent 风格）/ Vue（defineComponent）
 ├─ lib/manifest-gen.ts custom-elements.json schema 1.0.0
 ├─ lib/preview.ts      pageShell/previewDoc：内联原生源码 + postMessage 双向通信
 ├─ lib/docs.ts         docsMarkdown + demoHtml（独立演示页）
 ├─ lib/export.ts       freeFiles/proFiles/buildZip/downloadBlob/downloadText（fflate）
 ├─ lib/storage.ts      localStorage 组件库 + sanitizeModel（导入归一化）+ FREE_LIBRARY_LIMIT=3
 └─ lib/monetization.ts buildAccess/upgrade（freemium-pro 买断）
```

- **单一数据源**：表单直接改 `ComponentModel`，所有产物（代码/文档/manifest/zip/预览 srcdoc）均为 computed 纯函数派生，无中间态。
- **生成期固化 + 运行期反射**：shadow 结构在生成时按当前模型固化为字符串内联；属性变化通过 property getter/setter 反射到 attribute 并 `_sync()` 更新 shadow 文本。
- **通信契约**：父→子 `{type:'fz-set-props', props}` / `{type:'fz-ping'}`；子→父 `{__fzWidget:'ready', tag}` 与 `{__fzWidget:'event', name, detail}`。

## 踩坑记录（E2E 在浏览器里真实抓到 5 个运行时 bug，单测无法覆盖）

1. **postMessage 传 Vue reactive 代理 → DataCloneError**。`liveProps` 是响应式对象，结构化克隆直接抛 `#<Object> could not be cloned`，实时改值永远到不了 iframe。修复：发送前 `{ ...liveProps }` 浅拷贝成普通对象（与 `reusable-module/worker-post` 同源教训）。
2. **`jsStr` 误用于对象，得到 `"[object Object]"`（本次最隐蔽）**。预览页靠 `META[propName]` 判断属性类型，而 `propMeta()` 把一个对象交给 `jsStr`，`jsStr` 内部 `String(obj)` 于是内联成 `var META = "[object Object]"`。结果所有属性类型为 `undefined`，boolean 也走字符串分支，`'false'` 被当真值——组件**每次加载都被禁用**，点击事件全部被吞。修复：对象必须 `JSON.stringify`，`jsStr` 只用于字符串字面量。
3. **布尔字符串二次取真**：即便 META 正确，子文档 `el[name] = !!v` 对字符串 `'false'` 仍得 `true`。改为 `v === true || v === 'true'` 按字面量比较。
4. **生成器标识符 / 注释注入面**：类名、属性名、事件名、插槽名、CSS 变量名、描述注释在「导入模型」时可绕过 UI 直接进入生成源码，能制造非法 JS 或塞 `</script>`。修复：新增 `safeIdent/safePascalIdent/safeComment/safeKebab`，在 native/lit/wrappers 三个生成边界统一归一化，`sanitizeModel` 导入时再归一化一次（纵深防御）；`safePascalIdent` 只去非法字符 + 首字母大写，**保留** `MyButton` 内部大小写（不能再过 `pascal()`，否则会被压成 `Mybutton`）。
5. **下载文件名丢失 + 参数顺序错位**：① `downloadText` 把 `TextEncoder` 的 Uint8Array 包成 Blob，无头 Chromium 会丢掉 `a.download` 文件名（回退成把整段内容当文件名）；对齐 006 验证过的路径，直接用字符串建 Blob。② `index.vue` 调用 `downloadText` 时把 `(filename, content)` 写反，helper 签名是 `(content, filename)`，导致内容被当文件名。两处均修。

另修两处预览/演示健壮性：ready 握手存在「子早于父监听」竞态 → 子在 0/120/400ms 重发 ready 且响应父 `fz-ping`，父 onload 主动 ping；独立演示页原 `sync()` 让每个控件给全部属性赋值（checkbox 默认 value `on` 会覆盖 label），改为按 `data-p` + 类型表精确映射。

## 验证覆盖

- **单元测试（test-left-shift，毫秒级拦截）**：`test/wc-workbench.test.ts` 10 例，覆盖模型工具/默认模型、native/lit/react/vue 生成关键结构、custom-elements.json schema 与计数、API 文档四表、免费/Pro zip 结构与 package.json、`</script>` 注入转义、导入 sanitize 归一化与非法输入抛错。**全量 `test/*.test.ts` = 108/108 通过**（基线 98 + 新增 10）。
- **类型与构建**：`vue-tsc --noEmit` 0 错误；`npm run build` 成功，wc-workbench chunk 40.80 KB（gzip 13.73 KB）、CSS 6.88 KB（gzip 1.75 KB）；`verify:tools` 校验工具数 **15**，manifest/插件包/示例提问回归全过。
- **E2E（Playwright + 无头 Chromium，脚本 `scripts/e2e-wc-workbench.mjs`）16/16 通过**：
  - PC 1280×800 全链路：库→新建→标签合法；iframe 内组件真实 `customElements.get` + Shadow 渲染 + slot；label setter→shadow/attribute 反射；点击派发 composed `press` 回流事件日志；disabled 勾选后 host/attr/内部按钮三者禁用且不再派发；native/docs 免费可见、Lit/React/Vue 门控、点 Pro 产物提示升级；写 paid 订单重载后 Pro 代码全部解锁；四个下载文件名正确；保存回库卡片；console 无 pageerror/error。
  - 独立产物：下载的 `.demo.html` 以 `file://` 打开，真实注册渲染、控件改值、点击事件全部通过。
  - 平板 834×1112 / 手机 375×812：进入工作台、iframe 真实渲染、无横向溢出（Δ=0）。
- **用户变量覆盖**：属性类型 string/number/boolean × 有/无默认值；事件 0/1/多个；插槽默认/命名/0 个；CSS 变量 0/多个；类名/前缀边界；免费/已购两态；下载四类；移动端两视口——主要分支均覆盖（≥90%）。
- **EdgeOne Pages 免费版限额核查（实测 dist）**：
  - 存储总量 **28 MiB < 5 GiB**；
  - 文件数 **69 < 20000**；
  - 最大单文件 **13.58 MiB（onnx wasm，存量 002 资产）< 25 MiB**；本工具最大产物为 40.8 KB chunk，无任何超限资产。
- **guide 截图有效性（9 张，均为真实运行/构建后截图，非占位图）**：

| 文件 | 像素 | 大小 | 内容 | 结果 |
| --- | --- | --- | --- | --- |
| shot-01-library.png | 1280×800 | 84 KB | 组件库首页 | 通过 |
| shot-02-studio.png | 1280×800 | 142 KB | 三栏工作台、预览已连接 disabled=false | 通过 |
| shot-03-live-event.png | 1280×800 | 120 KB | 属性试值 + press 事件日志 | 通过 |
| shot-04-pro-locked.png | 1280×800 | 90 KB | Lit 专业版门控遮罩 | 通过 |
| shot-05-pro-unlocked.png | 1280×800 | 146 KB | 已购解锁后 Lit 代码 | 通过 |
| shot-05-saved.png | 1280×800 | 84 KB | 保存回组件库卡片 | 通过 |
| shot-06-standalone.png | 1100×760 | 29 KB | file:// 独立演示页 | 通过 |
| shot-07-tablet.png | 834×1112 | 92 KB | 平板单列自适应 | 通过 |
| shot-08-phone.png | 375×812 | 67 KB | 手机单列无溢出 | 通过 |

全业务场景（建模 → 预览 → 事件 → 代码/门控/解锁 → 四类下载 → 保存 → 独立产物 → 移动端）端到端无阻塞。

## 可复用经验

1. **凡是跨边界传数据（postMessage / Worker / BroadcastChannel），一律传朴素对象**，不要传 Vue/Vue reactive 代理；`{...obj}` 浅拷贝即可（值都是原始类型时）。可沉淀为 `reusable-module` 的跨边界发送约定。
2. **「字符串字面量转义」helper 不能喂对象**：`JSON.stringify` 用于结构化数据，`x => String(x)` 类转义只用于字符串。建议在 `jsStr` 开发态对非字符串入参给一条 dev 警告，防止再次静默产出 `[object Object]`。
3. **布尔跨消息边界要按字面量比较**：`'true'/'false'` 字符串 → `v === true || v === 'true'`，杜绝 `!!'false' === true`。
4. **代码生成器必须把「一切来自模型的标识符 / 注释」当不可信输入**，在生成边界集中用一组 `safe*` 归一化，导入入口再做一次；且 PascalCase 归一化应「保留内部大写」而非重新分词。
5. **无头浏览器下载校验要和生产保持同一条 Blob 路径**：用字符串 `new Blob([content])` 比 Uint8Array 更稳，下载断言必须 `waitForEvent('download')` 配对点击并核对 `suggestedFilename()`。
6. **沙箱预览用 srcdoc + 双向 ready 握手**：子重发 ready + 父 ping，消除监听器挂载竞态，且零网络依赖，天然适配无头/离线。
7. 测试左移的单测能保证「生成文本包含正确结构」，但**生成产物能否在浏览器里真正跑起来**（注册、反射、事件、禁用）只能靠 E2E——本工具 5 个运行时 bug 全部由 E2E 抓出，印证了 M 档「单测 + PC 全链路 E2E」组合的必要性。
