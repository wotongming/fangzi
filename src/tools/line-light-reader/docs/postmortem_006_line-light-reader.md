# Postmortem · 行光阅读器 LineLight Reader（006 focus-reader）

> 档位：**标准 M**（MV3 扩展 + 纯本地能力，无后端、无自研 WASM）。
> 基线 HEAD `8950736` ｜ 交付版本 0.1.0 beta ｜ 2026-10-21（功能补全重做版）

## 一、实际架构

```
plugins-src/line-light-reader/
├── manifest.json        # MV3；权限 activeTab + storage + scripting（未申请 <all_urls>）
│                        # web_accessible_resources 声明 woff2 供页面注入层 @font-face 使用
├── background.js        # action.onClicked → 按序 executeScript：Readability → sentences → content.js
├── content.js           # 注入层（自包含）：逐行引导色 / 焦点行 / Readability 纯净阅读 /
│                        # Dyslexic 字体 / TTS 状态机 / 摘录 / 排版(行距·段距·页宽) / 退出还原
├── popup.html|css|js    # 开关、行距/段距/页宽/语速滑杆、Dyslexic 开关、跳选项页
├── options.html|js      # 摘录列表、Markdown/JSON 导出、Dyslexic 开关、许可码输入位
├── vendor/
│   ├── Readability.js              # @mozilla/readability Apache-2.0（UMD 尾部改写为 globalThis）
│   ├── LICENSE-Apache-2.0-Readability.md
│   └── sentences.js                # 运行时切句（缩写/小数保护，对应 lib/sentences.ts）
├── fonts/
│   ├── OpenDyslexic-400.woff2      # OFL-1.1，Latin 子集
│   ├── OpenDyslexic-700.woff2
│   └── OFL-LICENSE.txt
└── icons/               # 程序化生成 16/48/128（node zlib 编码 PNG，蓝橙行光三横条）

lib/（仅 Node 单测纯逻辑源，不进扩展包）
├── sentences.ts  gradient.ts  license.ts  excerpt.ts
```

- **注入时机**：background 只在用户点图标时 `chrome.scripting.executeScript({ target, files:['vendor/Readability.js','vendor/sentences.js','content.js'] })`；受限页面（`chrome://`、商店、新标签页）静默 catch。重复点图标 = 退出还原。
- **退出还原**：注入前把目标段落原始 `innerHTML` 存于 `state.originals`；退出时逐段回填，移除工具条/样式/阅读容器/焦点层/行 span，取消语音与看门狗定时器，清掉 CSS 变量与类名；不向原页写入持久节点，刷新即彻底清空。
- **PWA 上架**：`src/tools/line-light-reader/manifest.ts`（`type:'plugin'`）由 registry `import.meta.glob` 自动发现，未手改 registry / 路由 / 搜索 / ToolRunnerView。

## 二、功能落地（本轮补全后）

| 功能 | 实现 | 边界 / 降级 |
| --- | --- | --- |
| **逐行引导色**（核心） | 对正文文本节点逐字符 `Range.getClientRects()` 取 top，按 4px 容差聚类成视觉行；行级 `<span class="llr-line">` 包裹，**文字**沿阅读方向蓝(210)→橙(28)渐变（段落位置 70% + 段内行 30%）；ResizeObserver + `document.fonts.ready` + resize 250ms 防抖重算 | 含 `pre/table/img/iframe/svg/video/figure/blockquote/list/code` 的复杂段跳过行包裹，仅落一段浅色 `lineBg` 兜底，不破坏代码/图片/链接；多栏/RTL 未做逐列重排 |
| **焦点行** | 当前视口中点最近段落加 `.llr-active`，其余 `.llr-target` 减透明至 0.32；`#llr-focus` 覆盖条不引起 reflow；随滚动与 TTS 位置更新 | 段落级聚焦，非逐字符行遮罩 |
| **纯净阅读（Readability）** | `new Readability(document.cloneNode(true)).parse()` 抽取标题与正文，渲染进 `#llr-reader` 干净容器；解析为空/过短（<200 字符）**回退原页仅叠加**引导层 | 启发式隐藏仅作为回退分支；抽取失败不报错白屏 |
| **OpenDyslexic** | 400/700 woff2 随包 `fonts/`，`@font-face` 经 `chrome.runtime.getURL` 加载，manifest `web_accessible_resources` 声明；开关切换 `body.llr-dyslexic` | 字体仅覆盖拉丁；中文走系统字体栈 |
| **排版** | 行距、**段距**（`margin-bottom` em）、页宽（`max-width`）三项均在 popup 实时调，写入 CSS 变量 | 仅作用于阅读视图与目标段落 |
| **TTS** | `vendor/sentences.js` 缩写（Mr./Dr./e.g./i.e.）与小数 3.14 保护切句；当前句高亮 `.llr-tts-on` + `scrollIntoView`；控件 暂停/恢复/上一句/下一句 + 语速；5s 看门狗，>10s 疑似卡死 `pause()→resume()` 规避 Chrome ~15s 中断 | 语音选择留选项页后续；未做长句二次分片拆分（看门狗兜底） |
| **摘录** | Selection → `chrome.storage.local`（上限 500 条，标题/URL/时间/正文）；选项页导出 Markdown / JSON | 超阈值未迁 IndexedDB（beta 口径见下） |
| **许可验签** | ECDSA P-256 / ES256，公钥 SPKI DER 占位为空；beta 一律 free，不阻断功能 | 将来填公钥后本地验签解锁 Pro |

## 三、beta 计费开关将来如何切真买断

1. 当前 `license.ts` `PUBLIC_KEY_B64=''` → `verifyLicense()` 返回 `{ok:false, tier:'free', reason:'beta'}`，popup/options 不对 Pro 开关做拦截。
2. 将来接入外链收款后：离线生成 P-256 密钥对并填入 SPKI 公钥；收款成功签发 `LLR-<payloadB64>-<sigB64>`；options 输入后本地 `importKey('spki',…P-256)` + `verify({ECDSA,SHA-256})` 置 Pro 档；基础引导色/焦点行永久免费。
3. 全程本地 WebCrypto，不联网、不建账号。

## 四、验证覆盖

### 单测（`test/line-light-reader.test.ts`，11 例）
- 中英文切句：缩写 Mr./e.g.、小数 3.14、中文句号不误切；
- `textColor`/`lineBg` 色相映射与越界归正；`clusterVisualLines` 行聚类；`groupByLineTops` 字符行分组保持原始下标；
- beta 许可 free 分支；摘录归一化与 Markdown 导出。

### E2E（`scripts/e2e-line-light-reader-20261021.mjs`，全绿）
- PWA `/#/t/line-light-reader`：plugin 卡片、手册、下载 zip 字节 sha256/sizeBytes 与 manifest 完全一致；搜索「专注阅读」命中。
- 加载未打包扩展（persistent context `--load-extension`）多站点 fixture：
  - **英文噪声文章**：`#llr-reader` 生成，广告/页脚噪声不进阅读视图；`.llr-line` 575 个、行色 7 种且首末不同；焦点行 1 个 active、其余 opacity≈0.32；computed font-family 含 OpenDyslexic；
  - **TTS mock**：安装 `speechSynthesis` 记录 speak/pause/resume/cancel；点击朗读触发 speak，手动 `onend` 推进索引，暂停/恢复/下一句/上一句断言通过；
  - **摘录**：选区保存，标题/URL/正文齐全；选项页 Markdown 与 JSON 导出内容校验（file:// 无头不派发 blob 下载事件，改拦截 `createObjectURL` 读 blob 文本断言）；
  - **回退分支**：仅噪声侧栏页面不生成阅读容器，保留原页；
  - **技术文档代码块**：`pre code` 原样保留、零横向溢出；
  - **中文长文**：`.llr-line` 289 个；退出后工具条/阅读容器/行 span 全部清空。

### 截图（`src/tools/line-light-reader/docs/shots/`）
- `detail-pc.png` 详情页 PC；`detail-mobile.png` 详情页 375×812；`popup.png` 弹窗开关与滑杆；`article-focus.png` 阅读视图 + 焦点行高亮 + 行色渐变。

### 质量门
- `npm test`：**480 通过 / 0 失败**（基线 469 + 新增 11）
- `vue-tsc --noEmit`：**0 错误**；`verify:tools`：**33**；`vite build` 成功

### EdgeOne 限额复核
- dist 总体积 **176 MiB**、文件 **173**、最大单文件 **24.0 MiB**（`model_quantized.onnx`）< 25 MiB；
- 扩展 zip **277825 字节**（17 文件），其中 Readability 90037B、OpenDyslexic 400 115280B / 700 120356B、OFL 4452B；zip 不进 SW 预缓存（glob 不含 zip）。

## 五、真机 / 上架待验（无头无法 100% 覆盖）

1. **商店审核**：当前 beta 以「加载已解压扩展」分发；上架 Chrome Web Store / Edge Add-ons 需开发者注册、隐私政策与素材。
2. **多站点版面**：无头仅覆盖本地 fixture；真实新闻/博客/多栏/RTL/复杂广告位的行聚类与 Readability 抽取需真机目检。
3. **OpenDyslexic 真实字形**：无头只断言 font-family 生效与 woff2 随包；真机需确认拉丁字母字形渲染与中文回退正常。
4. **TTS 真机**：语音包可用性、Chrome ~15s 长句中断与看门狗、逐句高亮跟随需真机复测；语音选择 UI 待补。
5. **摘录容量**：500 条阈值之上的 IndexedDB 迁移未做；当前本地存储配额内可用。
6. **Firefox**：写法预留，首版仅产 Chromium zip；`browser.*` 适配与 AMO 打包未做。
7. MV3 service worker 空闲回收后 `action.onClicked` 重触发需 Chrome 真机复测。

## 六、打包脚本

`scripts/pack-line-light-reader.mjs`：递归收集 `plugins-src/line-light-reader/`（跳过 `lib/` 测试源），fflate `zipSync` 输出到 `public/plugins/line-light-reader/line-light-reader-chrome-0.1.0.zip`，stdout 打印 packageUrl / sha256 / sizeBytes / 文件清单；`scripts/gen-line-light-icons.mjs` 生成三枚图标。改源码后先跑打包脚本，把真实 sha256/sizeBytes 回填 `manifest.ts`，禁止手填编造。
