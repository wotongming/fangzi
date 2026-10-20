# 架构方案：家庭资产与重要证件档案库（家庭资产档案库）

- 对应 innovator：innovator_004_家庭资产档案库.md
- 对应 pm：pm_004_家庭资产档案库.md（结论：可集成（新增））
- 设计日期：2026-10-20
- 建议目录：`src/tools/home-vault/`（路由自动注册为 `/#/t/home-vault`）

## 需求回顾与设计依据

innovator 核心闭环：**拍照入库（发票/保修卡/证件/保单）→ 结构化资产档案与凭证链 → 到期日历（保修/证件/保险/年检）→ 搬家 QR 箱单 → 理赔资料包导出 → 申报调档**；手机拍照是主入口、搬家现场无信号要能离线扫码；敏感证件（身份证/房产证/保单）用户不敢上云 → 本地优先 + 可选加密导出备份。

pm 已核定：
- 与 shopping-claim（维权案件流程）、household-finance（管钱流）、photo-privacy（发图脱敏）、local-knowledge-base（文档问答）**均不重复**；本工具是"全家庭资产长期档案 + 多场景决策包"。边界：保修到期提醒在本工具做，但不生成维权文书（可提示跳转 shopping-claim 立案）。
- 档位 **M**：多场景链路、IndexedDB、照片、QR 生成/扫码、zip 导出；无 WebGPU、无主包大权重。
- 边界硬约束：**双人/多端共享降级为"本地 + 加密导出备份包 + 导入合并"，不做实时云同步**；OCR 为可选增强、默认手动录入可用；不编造后端。

设计前提：复用 fangzi 已验证的 pet-health / shopping-claim / tax-deduction 模式——照片压缩（image-redraw）、Web Crypto 加密信封、.ics 系统日历、fflate ZIP、独立 IndexedDB 库、纯逻辑下沉 `lib/`。

## 技术方案

### 系统架构

```
浏览器（PWA，搬家现场离线可用）
├── index.vue（Tab：档案 | 到期日历 | 搬家箱单 | 理赔导出 | 备份）
│     ├── components/（AssetEdit / AssetGrid / CalendarView / MovingBoxView / ClaimPackView / BackupView）
│     └── useToolBilling('home-vault')（免费层 50 张卡片）
├── lib/（纯逻辑）
│     ├── models.ts      Asset / Doc / Box / ExpiryItem
│     ├── store.ts       indexeddb-kv 四表 CRUD
│     ├── photos.ts      image-redraw 照片压缩（长边 1600、去 EXIF）
│     ├── expiry.ts      到期计算（保修/证件/保险/年检统一抽象 + .ics 生成）
│     ├── qrcode.ts      纸箱 QR 生成（qrcode-generator 库）+ BarcodeDetector 扫码封装/降级
│     ├── claim-pack.ts  理赔资料包：清单 HTML + fflate ZIP 组织
│     ├── crypto.ts      Web Crypto PBKDF2(10 万)+AES-GCM-256 加密备份信封
│     ├── merge.ts      导出包导入合并（按 id 去重/冲突策略）
│     └── ocr.ts        【Pro 可选】ONNX 文字识别懒加载（默认不加载）
├── IndexedDB：独立库 fangzi-home-vault（assets/docs/boxes/boxItems 四表）
└── SW 预缓存外壳；QR 库随主包懒 chunk（仅搬家视图 import 时加载）
```

### 模块设计

1. **资产档案（Asset）模块**：每件贵重/关键物品一张卡——名称、类别（家电/数码/家具/证件/保单/车辆…）、存放位置（房间+位置自由层级）、购入价、购入日期、保修截止日、序列号/型号、关联凭证。凭证链：一张 Asset 挂多份 Doc（发票/保修卡/说明书/维修记录照片），Doc 之间靠 `assetId` 关联。
2. **照片入库（photos.ts）**：手机拍照即 `<input capture="environment">` → image-redraw Canvas 重绘压缩（长边 1600、去 EXIF、JPEG quality 0.82）→ 存 IndexedDB Blob。**照片不进静态包、不进 SW 预缓存、不上传**。
3. **到期日历（expiry.ts）**：把"保修截止、证件到期（护照/驾照/车辆年检/保险续保/疫苗本）"统一抽象为 `ExpiryItem { dueDate, kind, title, assetId? }`；看板按"逾期/7 天内/30 天内"分级；导出 `.ics`（VALARM 提前 30 天与 7 天两条提醒，对应 innovator 的"可延保/赶紧报修"）。
4. **搬家箱单（qrcode.ts）**：封箱时新建 Box（箱号/目的地房间）→ 生成该箱 QR 码（内容即箱号短码，如 `fz-box:<boxId>`）→ 屏幕展示可打印（window.print 小标签页）贴箱；现场用 BarcodeDetector（Chrome/Edge 原生）扫码后直接进入该箱录入页；不支持时降级为"输入箱号/点选箱号"。事后搜索物品 → 显示"在 3 号箱·卧室区"。
5. **理赔资料包导出（claim-pack.ts，Pro）**：按时间/类别勾选资产 → 生成 ① `清单.html`（自包含、打印样式，浏览器打印即得 PDF，无需重型 PDF 库）；② fflate 打包 `凭证/<assetId>/<docId>.jpg` 全部照片 + `manifest.json` → `理赔资料包_2026-10-20.zip` 下载发保险公司。
6. **备份与双人合并（crypto.ts + merge.ts，Pro）**：导出加密备份包 `home-vault-backup-YYYYMMDD.json`（Web Crypto 信封，口令派生密钥）；夫妻一方微信发送、另一方导入——按 `assetId/docId` 主键合并，同 id 取更新时间晚者，孤儿数据保留。**不做实时同步**。
7. **OCR（ocr.ts，Pro 可选）**：拍照后一键识别→填充购买日期/金额/商家/保修截止字段，用户确认后入库；失败/未加载 → 手动录入（主路径）。

### 关键技术路线

| 决策点 | 选型 | 理由 |
| --- | --- | --- |
| QR 生成 | `qrcode-generator`（**MIT**，浏览器端零依赖，min ~15KB）动态 `import()` 进搬家视图懒 chunk | pm 指定 MIT 轻量库；手写 QR（Reed-Solomon/掩码）风险高不值当；体积远低于限额 |
| QR 扫码 | 原生 `BarcodeDetector` API（Chrome/Edge）；不支持 → 手动输入箱号 | 零依赖；Safari/Firefox 有降级，不阻塞 |
| 照片压缩 | `reusable-module/image-redraw` | 现成、已被 photo-privacy/shopping-claim/pet-health 验证 |
| ZIP 导出 | `fflate`（**MIT**，已是依赖） | shopping-claim 证据包同款 |
| 清单 PDF | 打印友好 HTML + `window.print()` 另存 PDF | 不引重型 PDF 生成库；pdfjs-dist 是解析库不适合反向生成 |
| 加密 | Web Crypto PBKDF2-SHA256 10 万次 + AES-GCM-256 | home-medicine/tax-deduction/pet-health 已验证信封格式（Envelope: v/alg/iters/saltB64/ivB64/ctB64） |
| 到期提醒 | 页面看板分级 + `.ics` 导出系统日历 | PWA 无后端不做 Web Push（subscription-audit 同款兜底） |
| OCR（可选） | onnxruntime-web（已有依赖，MIT）+ PPOCRv4-mobile（Apache-2.0）hf-mirror 懒加载 | 同场景一套；不进主包 |
| 存储 | `reusable-module/indexeddb-kv` | 现成 |

### 盈利模式（可灵活扩展调整）

`useToolBilling('home-vault')`，`manifest.billing` = freemium：**买断主方案 ¥12.90（1290 cents）**，订阅 月 ¥3.9（390）/ 年 ¥29.9（2990）（对齐 pet-health 低频刚需档位）。
- 免费层：≤50 张资产卡片、基础到期看板、手动录入。
- 专业层（`canUse('pro')` 统一门）：卡片不限量、凭证链无限挂接、理赔资料包 ZIP/HTML 导出、加密备份与双人导入合并、搬家 QR 箱单、OCR 识别。
- 其余计费模式框架已具备，默认不开启。

## 与 fangzi 现有代码的集成方式

1. 新增 `src/tools/home-vault/`：`manifest.ts`（category='life'，keywords 覆盖"保修卡/发票/证件/理赔/搬家/箱单/到期提醒/家庭档案"）、`index.vue`、`guide.md`、`lib/*.ts`、`components/`。
2. **复用**：indexeddb-kv、use-seo、image-redraw、fflate（依赖内）、useToolBilling；crypto.ts 参照 home-medicine/lib/crypto.ts 同款信封复制（保持零新增依赖）；.ics 参照 home-medicine/lib/notify.ts。
3. **新增 npm 依赖（仅 1 个，需显式写入 package.json 并核查版本）**：`qrcode-generator`（MIT，浏览器端；动态 import 懒 chunk，不进首包）。
4. **修改的现有文件（仅登记性追加）**：根 `README.md` 工具清单追加条目；`src/core/sample-queries.ts` 可选追加 1 条浮动提问。**不改动** router/registry/search/SW/manifest 及其它工具。
5. 与 shopping-claim 的衔接：到期日历中"仍在保、出现质量问题"的条目提供跳转文案（链接 `/#/t/shopping-claim`），不生成维权文书。

## 软硬件/依赖选型（逐项商用授权）

| 依赖/资源 | 许可 | 是否新增 | 用途 |
| --- | --- | --- | --- |
| Vue/Pinia/router/vite-plugin-pwa | MIT | 否 | 框架 |
| fflate 0.8 | MIT | 否（已在依赖） | 理赔包/备份 ZIP |
| image-redraw / indexeddb-kv / use-seo / ort-wasm-loader | 内部 TS | 否 | 复用 |
| onnxruntime-web 1.30 | MIT | 否（已在依赖） | OCR 推理（懒加载路径） |
| PPOCRv4-mobile det+rec | Apache-2.0 | 否（运行时下载） | OCR 模型，hf-mirror 懒加载 |
| **qrcode-generator** | **MIT** | **是（唯一新增，~15KB，懒 chunk）** | 纸箱 QR 生成 |

零资金；严禁 NC 授权；照片/证件全程不出端，无合规风险。

### 本地 AI 选型（OCR 可选增强）

- 引擎 onnxruntime-web（MIT），模型 PPOCRv4-mobile 中文 det+rec（Apache-2.0 可商用，约 10–15MB 量化）；同一场景仅此一套。
- 加载策略：首次"拍照识别"点击动态 import；hf-mirror 下载后 SW/Cache 缓存离线可用；失败静默降级手动录入。
- 原则：**无 OCR 时工具必须 100% 可用**——手动录入是主路径，OCR 只是省字增强。

## 开发方案

M 档，预估 7–10 人日，单人。里程碑：
- M1（2d）：骨架 + assets/docs 双表 CRUD + 照片压缩入库 + 免费 50 卡门。
- M2（1.5d）：expiry 抽象 + 到期看板分级 + .ics 导出。
- M3（2d）：搬家 QR（生成/打印标签/BarcodeDetector 扫码/降级手输/箱内物品搜索）。
- M4（1.5d）：理赔资料包（清单 HTML + fflate ZIP + manifest.json）。
- M5（1d）：crypto 加密备份 + 导入合并。
- M6（1d）：OCR 懒加载 + 计费 + SEO + 三视口 E2E + 质量门。

## 测试方案

- 单测（test/home-vault.test.ts，≥16 例）：到期分级计算、.ics 字段、QR 短码生成与解析、合并冲突取新、加密信封加解密往返、免费 50 卡门。
- E2E（scripts/e2e-home-vault-20261020.mjs）三视口：建资产→拍照→挂凭证→保修到期分级→建箱生成 QR→（无头环境用手输箱号降级路径）扫码录物→搜物定位箱→勾选导出 ZIP→加密导出→导入合并→免费层第 51 卡付费墙。
- 存量回归：npm test 全绿、vue-tsc 0 错、verify:tools=28、build 成功；断网 preview 下档案与箱单可打开。

## 实施部署方案

随主站 EdgeOne Pages 自动构建发布；QR 库为懒 chunk 约 +15KB，零大资产。回滚 = git revert；数据在本机 IndexedDB，下架不删用户数据。

## 风险与反思

- **真的需要吗？** 需要——"5 年保修单找不到小票等于零""理赔时想不全丢了什么"是多个独立来源反复确认的家庭高频损失场景；低频但单次高价值（理赔差额数千到数万）。
- **会不会搞复杂？** 单目录自闭环、免费层手动录入即可用；QR/理赔包/加密备份均为 Pro 增值，不影响基础档案。
- **隐私边界**：敏感证件本地加密存储，必须在 UI 明示"数据不出本机、不强制注册、可随时删除全库"；不做实时云同步是诚实的能力边界（无后端），双人协作=导出包互传。
- **遗留**：BarcodeDetector 在 Safari/iOS 不可用 → 必须保留手输/点选降级；打印 QR 标签需提示用户用普通 A4 纸打印手写贴箱。
