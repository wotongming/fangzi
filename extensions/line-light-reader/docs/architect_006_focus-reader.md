# Architect · 行光阅读器 LineLight Reader（focus-reader / 006）

> 本轮**仅设计、不写实现代码、不上架**。档位 L。独立浏览器扩展（MV3），不并入 fangzi PWA 主包。

## 1. 需求回顾与设计依据
- innovator_006：BeeLine Reader 把逐行引导色改成按设备订阅（$8~15/月）引发用户强烈反弹；空带=「一次性买断、无账号、本地配置、打磨到位」的长文阅读辅助扩展。
- pm_006 结论：**可集成·新增·独立扩展，L 档**；免费版（去广告+焦点行）+ Pro 一次性买断 ¥49；远期家长包 ¥19。与现有 32 个 fangzi 工具无重复。
- 硬边界：**不抓登录态、不后台定时、不跨站批量采集**；仅用户主动点图标时对当前文章页注入样式；content script + SpeechSynthesis + chrome.storage.local，是最干净的一类扩展。

## 2. 与 fangzi 的边界（关键）
- 本扩展是**独立 zip 分发的浏览器扩展**，与 fangzi PWA **无数据耦合、不共享存储、不进 PWA 主包、不增 PWA 体积/SW/manifest**。
- 关系仅为「同一独立开发者的隐私工具品牌」。落地页方案仅作文档内后续设想（可放 EdgeOne Pages 静态页介绍扩展），本轮不改 PWA。
- 仓库内本批**只放设计文档**（`extensions/line-light-reader/docs/`），后续实现代码另行独立提交。

## 3. 形态与目标平台
- MV3（Manifest V3）。
- 首发 Chromium（Chrome / Edge），Firefox（AMO）紧随。
- 独立 zip 分发：Chrome Web Store、Edge Add-ons、Firefox AMO 三个商店 + 官网外链（Lemon Squeezy/Gumroad 购买）。

## 4. 零后端 + 一次性买断授权方案（核心）
### 4.1 2026 商店外链支付政策核实结论
- **Chrome Web Store**：商店内购/订阅系统早已废弃；现行政策允许扩展引导用户到外部完成支付，但必须在描述与 UI 明确声明「卖家是开发者本人而非 Google」（来源：Chrome Web Store Program Policies https://developer.chrome.google.cn/docs/webstore/program-policies/policies ）。2026 年已在架实例：Cloak（`$30 for 6 months. Pay at cloak.build to receive an activation code. Then enter your checkout email and activation code inside the extension`，https://chromewebstore.google.com/detail/cloak/imbonogbddkbpefebglfoaekjhbmfocl ）——证实「外部收银台付款→激活码→扩展内输入激活」模式合规。Header Modifier Pro 也是「single one-time payment unlocks for life」的在售实例。
- **Firefox AMO**：政策要求「Listing must disclose when payment is required to enable any add-on functionality」（来源：Add-on Policies https://extensionworkshop.com/documentation/publish/add-on-policies/ ）；官方对捐赠/外链收款提供 contributions_url 与支持的支付方列表（Liberapay/OpenCollective/PayPal 等，https://extensionworkshop.com/documentation/publish/make-money-from-browser-extensions ）。AMO 上存在「免费安装、部分功能/许可需付费」的在售扩展，与本方案一致，但**上架描述必须显式披露付费功能**。

### 4.2 推荐变现链路（零自有后端）
1. 用户在外部收银台（**Lemon Squeezy**，免月费、按成交抽成约 5%+，可商用、支持发卡/许可码；备选 Gumroad 抽成 10%）支付 ¥49。
2. 收银台交付一个**许可码**：格式 `LLR-XXXX-XXXX-XXXX-XXXX`，由收银台 webhook 触发或开发者侧用私钥离线签发。
3. 用户在扩展 options 页输入许可码 + 购买邮箱。
4. 扩展内置**ECDSA P-256（ES256）公钥**，用浏览器原生 **WebCrypto（SubtleCrypto.verify）本地验签**：许可码 = base32( payload ‖ signature )，payload 内含产品档位（pro/parent-pack）+ 序列号/有效期位。**无需联网授权服务器**，离线即验。
5. 验签通过 → chrome.storage.local 存「已激活档位」；换机由用户手动在新机 options 页重新输入同一许可码（纯本地无账号，换机不自动迁移，文档明示）。
6. 无账号、无遥测、无联网检查；扩展除「打开收银台购买页」外不发起授权请求。

**签名算法选型（2026 跨浏览器核实）**：
- Ed25519(EdDSA) 密钥更短，但 WebCrypto 支持时间线偏晚且不齐：Chrome/Edge **137+**（2025-05 才默认开启）、Firefox 129+、Safari 17+；且 WebKit 2026-08 仍有空消息验签 bug（bugs.webkit.org/show_bug.cgi?id=321438）。来源：caniuse https://caniuse.com/mdn-api_subtlecrypto_verify_ed25519 、MDN SubtleCrypto https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto 、Chrome 137 https://developer.chrome.google.cn/blog/chrome-137-beta 。
- **ECDSA P-256（ES256）** 在 Chrome/Edge/Firefox/Safari 所有现代版本均已长期稳定支持（Safari 7+ 即有），是「验签失败=锁功能」场景最稳妥选择。
- 结论：**v1 主用 ECDSA P-256**。公钥为 SPKI DER（未压缩点 0x04‖X‖Y），`crypto.subtle.importKey('spki', der, {name:'ECDSA', namedCurve:'P-256'}, false, ['verify'])`，`verify({name:'ECDSA', hash:'SHA-256'}, key, sigDer, payloadBytes)`；签名为 ASN.1 DER（WebCrypto 标准）。Ed25519 留作未来可选升级（基线整体抬到 Chrome 137+ 后再切），v1 不启用。

### 4.3 诚实局限
纯本地公钥验签无法 100% 防盗版（公钥在包内，理论上可被 patch 绕过）；靠低价（¥49）+ 用户诚信 + 签名档位（同一许可码可分档 parent-pack）控制。不为此自建后端（违背零资金/隐私定位）。

### 4.4 商店降级分支
- 若某商店审核认为外链支付不合规：该商店版本**整体免费 Pro 全开**或延后变现（仅免费功能），变现仍通过官网/Gumroad；不硬撞审核。
- Firefox 首发可先上免费版，Pro 外链在 options 页以「导入许可码」形式提供，上架描述披露。

## 5. 依赖与商用许可（逐项核）
| 依赖 | 用途 | 许可 | 可商用 | 说明 |
|---|---|---|---|---|
| @mozilla/readability | 正文抽取/去广告 | Apache-2.0 | ✅ | 源码随包打包（vendor/），不引 CDN。 |
| OpenDyslexic 字体 | Pro  dyslexia 字体 | SIL OFL 1.1 | ✅ | OFL 允许再分发，要求保留版权声明、不单独售卖字体；子集化 woff2。来源：https://opendyslexic.org/ 、OFL https://openfontlicense.org/ |
| SpeechSynthesis | TTS | 浏览器原生 API | ✅ | 无依赖、免费、各浏览器自带。 |
| webextension-polyfill | Chrome/Firefox API 统一 | MPL-2.0 | ✅（文件级弱 copyleft，可闭源分发使用） | 倾向**自写极薄适配层**（chrome.* 与 browser.* 两行 shim）避免引入该依赖，减小体积与法务面。 |
| ECDSA P-256(ES256) 验签 | 许可离线校验 | WebCrypto 原生 | ✅ | 无第三方库；三店全版本长期支持，v1 选定（Ed25519 留作未来升级）。 |

无 NC 依赖、无非商用字体。

## 6. 关键技术难点与方案
### 6.1 逐行引导色（BeeLine 式冷暖渐变）
- 算法：在专注模式容器内，对每个 `<p>`（及 h 标签）按**视觉行**切分——用 Range 逐字符测量 `getClientRects()`，按容器宽度把落在同一视觉行的文本合并为一个行级 `<span>`，再对该 span 施加从暖（起始）到冷（结尾）的线性渐变色（CSS `background: linear-gradient` + `-webkit-background-clip:text`，或逐行用 HSL 插值的 color）。
- 触发重算：`ResizeObserver` 监听容器宽度、`document.fonts.ready`、窗口 resize、用户调节页宽/字号后**防抖重切**。
- 降级：遇到无法可靠切行的复杂版面（多栏、浮动、表格、代码块、RTL）→ 该段退化为整段统一渐变色或不切行，**绝不破坏原链接/图片/代码块/双向排版**；切行失败计数超过阈值时整功能降级为「仅去广告+焦点行」并提示。
- 保留原 DOM 语义：用 TreeWalker 遍历文本节点，切分前后对原 Node 做无损包裹，导出摘录时用原 selection 不受影响。

### 6.2 焦点行
- 不重排布局：用**覆盖层**绝对定位一个高亮条（高 = 当前行高），scroll/scrollend 后根据 `elementFromPoint(centerY)` 定位当前段/行，给该行加 class、同行外内容加 `opacity(0.35)`。避免整页 reflow 抖动。

### 6.3 TTS 逐句高亮
- 句子切分正则：中英文句号/问号/感叹号/中文「。！？」/换行；**保留缩写白名单**（Mr./Dr./e.g./i.e./U.S./Inc.）与小数/小数点（3.14、0.5）不误切。
- `speechSynthesis.speak(utterance)` 逐句队列；`utterance.onboundary` 定位当前词高亮、`onend` 滚到下一句。
- **规避 Chrome SpeechSynthesis ~15s 长文中断 bug**：句子本身分片短于 ~10s；用 `setInterval` 每 10s 探测 `speechSynthesis.paused/pending/speaking`，疑似卡死时 `pause()→resume()` 或取下一句重启 utterance。
- 控制：暂停/恢复/上一句/下一句、语音（lang zh-CN/en-US）、rate 选择。

### 6.4 纯净阅读与回退
- 先跑 Readability 抽取正文；成功则渲染到扩展注入的干净容器；失败/正文过短 → **回退原页仅叠加高亮样式**，不破坏站点可读性。

### 6.5 摘录
- `window.getSelection()` 抓选区 → 含页面标题/URL/时间存入 chrome.storage.local（量大改 IndexedDB）→ 导出 Markdown / JSON 下载。

### 6.6 权限最小化
- `permissions: ["activeTab","storage","scripting"]`；**不申请 `<all_urls>` host_permissions**（activeTab 仅在用户点图标时授予当前页）。
- MV3 service worker 短生命周期：所有状态持久化到 storage，不依赖内存长驻。
- CSP：不内联远程脚本；Readability/字体全部打包进扩展 vendor/，无 CDN。

## 7. 包体与平台
- OpenDyslexic 字体**子集化**（Latin + 常用中文? OpenDyslexic 仅拉丁字母，中文用系统字体栈）+ woff2，目标整套 < 2MB。
- Chrome 扩展 zip 官方上限 2GB（来源：https://developer.chrome.google.cn/docs/webstore/publish ），实际建议 < 50MB 以利安装。本扩展预计 < 5MB。
- EdgeOne 限额对本扩展无关（独立 zip，不走 fangzi 站点发布）。

## 8. 测试策略（详见 dev）
- 可脱离 DOM 的纯逻辑单测：中英文切句、许可 ECDSA P-256 验签、行切分/渐变配色函数。
- Playwright 加载未打包扩展，Chromium 自动化导航多类真实长文（英文博客/技术文档/新闻/含代码块/中文长文）：注入/退出、不破坏原页、SPA 路由变化、零横向溢出。
- Firefox 人工兼容清单。
- 边界：PDF 页（浏览器内置查看器不支持 content script）、纯图片页、强 CSP 站、跨域 iframe 不注入。

## 9. 免费 / Pro 边界
| 能力 | 免费 | Pro ¥49 买断 |
|---|---|---|
| 去广告纯净阅读 | ✅ | ✅ |
| 焦点行高亮 | ✅ | ✅ |
| 逐行引导色 | — | ✅ |
| OpenDyslexic 字体 | — | ✅ |
| TTS 逐句高亮 | — | ✅ |
| 摘录导出 MD/JSON | — | ✅ |
| 自定义主题 | — | ✅ |
| 家长儿童包（远期） | — | ¥19 另购 |

## 10. 建议目录结构
```
extensions/line-light-reader/
  manifest.json          # MV3
  background/service-worker.js
  content/               # 注入脚本：行切分/焦点行/TTS/摘录
  popup/                 # 点图标的开关与状态
  options/               # 设置 + 输入许可码
  vendor/                # readability + OpenDyslexic woff2（包内自托管）
  storage/               # chrome.storage.local 封装
  license/               # Ed25519 公钥 + WebCrypto 验签
  docs/                  # 本三份设计文档
```
