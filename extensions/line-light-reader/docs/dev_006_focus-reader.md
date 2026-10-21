# Dev · 行光阅读器 LineLight Reader（focus-reader / 006）

> 本轮**仅拆解实现任务清单，不写代码**。基于 architect_006。

## 0. 环境与工具链
- Node 20 + TypeScript（或 JS JSDoc，随简）；打包用 esbuild/rollup 产未打包扩展目录。
- 单测：node:test + tsx（与 fangzi 主仓一致风格），可脱离 DOM 的纯逻辑。
- E2E：Playwright，`launchPersistentContext`/`extension` 路径加载未打包扩展到 Chromium。
- 无构建进 PWA；本扩展独立工程，仓库路径 `extensions/line-light-reader/`。

## 1. 需求拆解清单

### 1.1 manifest.json（MV3）
- `manifest_version: 3`
- `permissions: ["activeTab","storage","scripting"]`
- 不声明 `host_permissions`（activeTab 临时授权）；如需在特定站预注入再议。
- `action`（popup）、`background.service_worker`、`content_scripts` 用 `scripting.executeScript` 在点图标时动态注入（而非静态 `"matches":["<all_urls>"]`），符合「仅用户主动点图标」边界。
- `web_accessible_resources`：仅字体 woff2（content script 内页面引用）。
- CSP 默认，不内联远程脚本。

### 1.2 background/service-worker
- 接收 popup 的「开关专注模式」消息 → `chrome.scripting.executeScript({tabId, files:[content/index.js]})`。
- 短生命周期：不驻留状态；激活档位从 storage 读。

### 1.3 content/index.js（专注模式注入）
- 流程：Readability 抽正文 → 成功则建干净阅读容器渲染；失败回退原页叠加。
- 暴露开关：再次点图标退出（移除注入 DOM/样式，恢复原页）。

### 1.4 行切分模块（核心）
- `splitIntoVisualLines(paragraphEl, containerWidth)`：TreeWalker 取文本节点 → Range.getClientRects() → 按行 y 聚类 → 行级 span 包裹。
- 重算触发：ResizeObserver + fonts.ready + 防抖 150ms。
- 降级开关：切行失败率 > 阈值则整段渐变/关闭。

### 1.5 焦点行
- scrollend 后 elementFromPoint 定位行，覆盖条 + 其余内容 opacity。

### 1.6 TTS
- `sentenceSplit(text)` 纯函数：缩写白名单 + 小数点保护。
- speak 队列 + onboundary 高亮 + onend 自动滚。
- 15s 中断看门狗：interval 探测 + pause/resume。

### 1.7 摘录
- selection → storage（量大 IndexedDB）→ 导出 MD/JSON。

### 1.8 storage 封装
- `chrome.storage.local` 包一层 Promise API（Firefox browser.* 适配两行 shim，不引 webextension-polyfill）。

### 1.9 许可模块
- `license/verify.ts`：内置 **ECDSA P-256（ES256）公钥**（SPKI DER base64），`crypto.subtle.importKey('spki', der, {name:'ECDSA', namedCurve:'P-256'}, false, ['verify'])` → `verify({name:'ECDSA', hash:'SHA-256'}, key, sigDer, payloadBytes)`；许可码格式 `LLR-XXXX-...` 去横线 base32 解码为 `payload‖sigDer` → 验签 → 解析档位。
- 选 ECDSA P-256 而非 Ed25519：三店全版本长期稳定（Ed25519 需 Chrome/Edge 137+、Safari 有空消息 bug，见 architect §4.2）。
- options 页输入码 → 验签通过写 storage `{pro:true, parent:bool}`。

## 2. 纯逻辑单测清单（node:test）
- `sentenceSplit`：英文缩写 Mr./Dr./e.g. 不切；小数 3.14 不切；中英文句号切分正确。
- `licenseVerify`：合法签名通过、篡改签名拒绝、错误档位解析正确（用测试密钥对）。
- `splitIntoVisualLines` 配 jsdom/happy-dom 或在 E2E 里测，纯函数部分（行聚类算法）可单测。
- 渐变配色 HSL 插值函数单测。

## 3. E2E（Playwright 未打包扩展）
导航用例：
1. 英文技术博客（含代码块）→ 点图标注入 → 断言正文容器出现、代码块未被切坏。
2. 中文新闻长文 → 注入 → 焦点行高亮存在。
3. 新闻页 → 退出 → 原页 DOM 恢复。
4. SPA 路由切换（hash/pushState）→ 再点图标仍可注入。
5. 三视口 1280/834/375：零横向溢出。
6. 边界：PDF 页/图片页 → 优雅提示不注入。

Firefox：人工清单（TTS 语音列表、Readability 差异、storage Promise 适配）。

## 4. 验收标准
- 纯逻辑单测全绿。
- E2E 6 用例全过，无 pageerror。
- 不含任何远程脚本/CDN（CSP 检查 network 无外链）。
- 包 < 5MB，字体 woff2 子集化。

## 5. 里程碑（后续真做时）
- M1：去广告+焦点行+开关（免费版可上）。
- M2：行切分引导色 + OpenDyslexic。
- M3：TTS 逐句高亮。
- M4：摘录导出 + 许可验签 + options。
