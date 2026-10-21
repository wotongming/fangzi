# Ops · 行光阅读器 LineLight Reader（focus-reader / 006）

> 本轮**仅写发布运维指引，实际上架动作未执行**。独立扩展 zip，不走 fangzi EdgeOne 主包发布。

## 1. 总体
- 三个商店分发：Chrome Web Store、Edge Add-ons、Firefox AMO。
- 变现：外部收银台 Lemon Squeezy 发卡 → 扩展内输入许可码 → WebCrypto 本地验签。零自有后端。

## 2. 隐私政策 URL（零成本托管）
- 上架必需隐私政策链接。用 **EdgeOne Pages**（与 fangzi 同托管）或 GitHub Pages 静态托管一个隐私政策页（纯本地、无数据收集、无遥测）。
- 入口：EdgeOne 控制台 https://console.edgeone.ai/ ；GitHub Pages https://pages.github.com/。

## 3. Chrome Web Store 发布步骤
1. 注册开发者账号，一次性注册费 US$5（个人）。入口：https://chrome.google.com/webstore/devconsole 。
2. 上传 zip（根目录含 manifest.json；官方上限 2GB，建议 < 50MB）。来源：https://developer.chrome.google.cn/docs/webstore/publish 。
3. 商店资料：名称 ≤75 字符、截图、描述中**显式声明 Pro 为外部一次性购买、卖家为开发者本人非 Google**（Program Policies：https://developer.chrome.google.cn/docs/webstore/program-policies/policies ）。
4. 数据使用披露（Privacy Practices）：声明仅本地 storage、无远程数据传输。
5. MV3 审核要点：最小权限（activeTab/storage/scripting）、无远程代码、CSP 合规。
6. 可选 Verified CRX 私钥签名（2025-06 起支持，防账号被盗后被冒名发版）：https://developer.chrome.google.cn/blog/extension-news-june-2025 。

## 4. Edge Add-ons
- 入口：https://partner.microsoft.com/dashboard/microsoftedge/ 。用同一 MV3 zip 提交；审核要求与 Chrome 近似，按 Edge Partner Center 指引补截图/隐私说明。

## 5. Firefox AMO
- 入口：https://addons.mozilla.org/developers/ 。个人开发者可上架。
- 政策：上架描述必须披露「部分功能需付费」（Add-on Policies https://extensionworkshop.com/documentation/publish/add-on-policies/ ）。
- 可在 AMO 页面挂 contributions_url 外链到收银台（支持的支付方见 https://extensionworkshop.com/documentation/publish/make-money-from-browser-extensions ）。
- 开源可选：提交时可上传源码（本扩展本就开源友好），加快人工审核。

## 6. 外部收银台与许可码
- 推荐 **Lemon Squeezy**（https://www.lemonsqueezy.com/ ）：免月费、按成交抽成；开通→建产品「LineLight Reader Pro ¥49」→ 开启 license key（许可码）发放。
- 许可码即「签名码」：开发者用 Ed25519 私钥离线签发（脚本在本地 CI/个人机），公钥烧进扩展。Lemon Squeezy 负责收款与把码发邮件给用户，扩展不联网。
- 用户在扩展 options 页输入许可码 → WebCrypto 验签 → 解锁档位。换机手动重输。
- 降级：若某商店拒外链支付，该商店版本整体免费或延后变现（见 architect §4.4）。

## 7. 更新 / 灰度 / 回滚
- 商店版：改版本号→重传 zip→商店审核后全量。无灰度，回滚即重传上一版本。
- 自托管官网 zip：手动提示用户更新。

## 8. 常见拒审原因与应对
- 权限过大（申请了非必要 host_permissions）→ 收窄到 activeTab。
- 描述未披露付费功能 → 在商店描述与 UI 明示。
- 远程代码/eval → 全部打包 vendor，CSP 不远程。
- 隐私政策缺链接 → 先放 EdgeOne/GitHub Pages 隐私页。

## 9. EdgeOne 限额说明
本扩展独立 zip 分发，不经 fangzi 站点；EdgeOne 仅托管隐私政策/落地页（静态小文件），不涉及 wasm/模型体积，限额无关。
