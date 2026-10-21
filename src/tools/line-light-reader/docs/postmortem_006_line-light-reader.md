# Postmortem · 行光阅读器 LineLight Reader（006 focus-reader）

> 档位：**标准 M**（MV3 扩展 + 纯本地能力，无后端、无 WASM/无 GPU）。
> 基线 HEAD `8950736` ｜ 交付版本 0.1.0 beta ｜ 2026-10-21

## 一、实际架构

```
plugins-src/line-light-reader/
├── manifest.json        # MV3；权限 activeTab + storage + scripting（未申请 <all_urls>）
├── background.js        # chrome.action.onClicked → executeScript 动态注入 content.js
├── content.js           # 注入层（自包含，不 import 外部模块）：引导色/焦点行/纯净阅读/TTS/摘录/退出还原
├── popup.html|css|js    # 开关、行距、语速、跳选项页
├── options.html|js      # 摘录列表/导出 Markdown·JSON、Dyslexic 开关、许可码输入位
└── icons/               # 程序化生成 16/48/128（node zlib 编码 PNG，蓝橙行光三横条）

lib/（仅 Node 单测纯逻辑源，不进扩展包）
├── sentences.ts         # 中英文切句（缩写 Mr./e.g.、小数 3.14 保护）
├── gradient.ts          # HSL 行色映射 + 视觉行几何聚类
├── license.ts           # ECDSA P-256（ES256）WebCrypto 验签，公钥占位
└── excerpt.ts           # 摘录归一化 + Markdown 导出
```

- **注入时机**：background 只在用户点图标时 `chrome.scripting.executeScript({ files:['content.js'] })` 注入；受限页面（`chrome://`、商店、新标签页）静默 catch。重复点图标 = 退出还原。
- **退出还原**：移除工具条/样式节点，清掉段落背景与行距，`speechSynthesis.cancel()`；不向原页 DOM 写入持久节点，刷新即彻底清空。
- **PWA 上架**：`src/tools/line-light-reader/manifest.ts`（`type:'plugin'`）由 registry `import.meta.glob` 自动发现，未手改 registry / 路由 / 搜索 / ToolRunnerView；`plugins[0]` 声明 platform、packageUrl、sha256、sizeBytes、version、minHostVersion。

## 二、功能落地与降级（如实）

| 设计功能 | 落地情况 | 降级 / 局限 |
| --- | --- | --- |
| 逐行引导色 | 段落按位置映射 HSL 210(蓝)→28(橙) 浅色底纹；`clusterVisualLines` 纯几何聚类已实现并单测 | v1 注入层按**段落级**上色；复杂多栏/代码块版面不做逐行重排，避免破坏链接/图片（设计允许的整段渐变降级） |
| 焦点行 | 视口中点最近段落高亮，覆盖层不引起 reflow；scroll 监听 | 非逐字行级遮罩，是段落级聚焦 |
| 纯净阅读 | 隐藏常见广告/侧边栏节点（aside、.ads、#ads、.advertisement），限宽 + 行距 | **未 vendor @mozilla/readability**：v1 用轻量启发式隐藏，正文抽取失败时回退原页仅叠加引导层；待后续版本接入 Readability 做正文抽取 |
| TTS | 原生 speechSynthesis，按句朗读、语速可调、退出即停 | 未实现逐句高亮跟随与语音选择 UI；依赖浏览器内置语音，部分站点受浏览器策略限制 |
| 摘录 | Selection 存 `chrome.storage.local`（上限 500 条），选项页导出 Markdown/JSON | 量大后未迁 IndexedDB；容量受本地存储配额约束 |
| Dyslexic 字体 | 选项页开关位 + CSS 类 | **未随包 vendor OpenDyslexic woff2 子集**（SIL OFL）：当前拉丁走系统字体栈，中文走系统字体；字体子集化随包列入待办 |
| 许可验签 | ECDSA P-256 / ES256，公钥 SPKI DER、`importKey('spki',…{namedCurve:'P-256'})` + `verify({name:'ECDSA',hash:'SHA-256'})` | 公钥占位为空，beta 一律返回 free，不阻断任何功能 |

## 三、beta 计费开关将来如何切真买断

1. 现在 `license.ts` 的 `PUBLIC_KEY_B64` 为空 → `verifyLicense()` 返回 `{ ok:false, tier:'free', reason:'beta' }`，popup/options 对 Pro 开关不做拦截。
2. 将来接入 Lemon Squeezy 等外链收款后：
   - 离线生成 ECDSA P-256 密钥对，把 SPKI DER 公钥填入 `PUBLIC_KEY_B64`；
   - 收款成功后由后端（或独立签发脚本）对 `tier+序列号` 签名，打包为 `LLR-<payloadB64>-<sigB64>` 发给用户；
   - options 页输入许可码 → `verifyLicense()` 验签通过置 Pro 档，`billing.features` 中 `free:false` 的能力（引导色增强 / Dyslexic / TTS 高亮 / 摘录高级导出）再读取判定；基础引导色与焦点行永久免费。
3. 不建自有账号、不联网校验：验签全程本地 WebCrypto，许可码与设备绑定策略后续按需加入。

## 四、验证覆盖

### 单测（`test/line-light-reader.test.ts`，10 例）
- 英文两句正确断开；Mr./e.g. 缩写不误切；小数 3.14 不误切；中文句号断开。
- `lineColor(0)=h210` 蓝、`lineColor(1)=h28` 橙，越界归正；`clusterVisualLines` 按 y 归行、行内按 x 排序、ratio 0..1。
- beta 无公钥返回 free；摘录空文本归一化 null；默认标题/时间补齐，Markdown 含标题/引用/来源。

### E2E（`scripts/e2e-line-light-reader-20261021.mjs`，全绿）
- PWA `/#/t/line-light-reader`：plugin 卡片、「使用手册」「直接下载 zip」、SHA256 展示均出现；
- 点击直接下载拿到 zip 字节，**sha256 与 sizeBytes 与 manifest 完全一致**（9127 字节，`28a17179…`）；
- 搜索「专注阅读」命中本插件；
- Playwright persistent context `--load-extension` 加载未打包目录；本地文章页注入 `content.js`，工具条 6 按钮出现，点「退出」后工具条与样式节点全部清空；无 pageerror。

### 截图（`src/tools/line-light-reader/docs/shots/`）
- `detail-pc.png`：详情页 PC（手册 + 下载区 + SHA256）
- `detail-mobile.png`：详情页手机 375×812
- `article-focus.png`：文章页注入专注层（工具条 + 引导底色）

### 质量门
- `npm test`：**479 通过 / 0 失败**（基线 469 + 新增 10）
- `vue-tsc --noEmit`：**0 错误**
- `verify:tools`：**33**（32 → 33，未新增其它工具）
- `vite build`：成功

### EdgeOne 限额复核
- dist 总体积 **176 MiB**、文件 **173**、最大单文件 **24.0 MiB**（`model_quantized.onnx`）< 25 MiB；
- 扩展 zip **9127 字节**（14 文件根目录直接含 manifest.json，无顶层目录），不进 SW 预缓存（glob 不含 zip）；
- 资源均为本地脚本/图标，无 CDN、无远程字体/脚本、无遥测。

## 五、真机 / 上架待验（无头无法 100% 覆盖）

1. **真实商店流程**：当前 beta 以「加载已解压扩展」分发；上架 Chrome Web Store / Edge Add-ons 需走开发者注册、审核、隐私政策与截图素材。
2. **多站点版面**：无头仅用本地样例页验证注入/退出；真实新闻、技术文档（代码块）、多栏、RTL、复杂广告位上的引导色与纯净阅读效果需真机目检，失败回退路径已保留。
3. **TTS**：真实语音包可用性、Chrome ~15s 长句中断与看门狗、逐句高亮跟随未在无头验证。
4. **OpenDyslexic 字体**：子集化 woff2 + OFL 声明随包待补；目前仅开关位。
5. **Readability 正文抽取**：待 vendor `@mozilla/readability`（Apache-2.0）替换启发式隐藏。
6. **Firefox**：写法预留，首版仅产 Chromium zip；`browser.*` 适配与 AMO 打包未做。
7. 扩展服务 worker 在 MV3 下的生命周期（空闲回收后 `action.onClicked` 重触发）需 Chrome 真机复测。

## 六、打包脚本

`scripts/pack-line-light-reader.mjs`：递归收集 `plugins-src/line-light-reader/`（跳过 `lib/` 测试源），fflate `zipSync` 输出到 `public/plugins/line-light-reader/line-light-reader-chrome-0.1.0.zip`，stdout 打印 packageUrl / sha256 / sizeBytes / 文件清单；`scripts/gen-line-light-icons.mjs` 程序化生成三枚图标。改源码后先跑打包脚本，把真实 sha256/sizeBytes 回填 `manifest.ts`，禁止手填编造。
