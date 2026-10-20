# 技术沉淀：家庭资产档案库（home-vault）

- 对应 dev：dev_004_家庭资产档案库.md
- 日期：2026-10-20
- **档位：M**（多场景链路、IndexedDB、照片、QR 生成、ZIP 导出；无 WebGPU/WASM/本地大模型）

## 技术选型与理由

| 组件 | 版本/许可 | 用途 | 选型与核查结论 |
| --- | --- | --- | --- |
| Vue 3.5 + Vite 8 + TS + Pinia + vue-router + vite-plugin-pwa | MIT（既有） | 框架 | 沿用仓库既有栈，零新增框架 |
| **qrcode-generator** | **2.0.4 / MIT（唯一新增依赖，精确锁版本）** | 纸箱 QR 生成 | 联网核查：npm 官方页 MIT、零运行时依赖、成熟库（Kazuhiko Arase）；OSV MAL-2026-6061 恶意包是**另一个包 `qrcode-generator-node`**（typo-squat），与本包无关；动态 `import()` 进搬家视图懒 chunk，不进首包 |
| fflate | 0.8.x / MIT（既有依赖） | 理赔 ZIP 打包 | shopping-claim 证据包同款，无需新增 |
| Web Crypto（原生） | 浏览器内置 | PBKDF2-SHA256 + AES-GCM-256 加密备份 | 无第三方加密库，密钥本机派生不出设备 |
| 原生 BarcodeDetector | 浏览器内置 | 扫码 | 不支持（Safari/iOS/无头）自动隐藏扫码按钮，走点选降级 |
| 照片压缩 | 内联 Canvas 重绘（见踩坑） | 长边 1600 / JPEG q0.82 / ≤300KB / 去 EXIF/GPS | 未复用 image-redraw，理由见踩坑 |
| OCR（未启用） | onnxruntime-web MIT + PPOCRv4 Apache-2.0（运行时懒加载） | 实验增强 | V1 默认关闭、不挂计费、不卖未验证能力 |

无 NC 授权资源、无侵权 IP、零资金。

## 加密方案说明（D14/D15）

- 信封 `{v:1, alg:'PBKDF2-SHA256/AES-GCM-256', iters, saltB64, ivB64, ctB64}`：salt 16B、iv 12B 随机；PBKDF2-SHA256 默认 **100000 次**（迭代次数做成可注入参数，单测传 1000 加速），派生 AES-GCM-256 数据密钥。
- 密钥由用户口令在本机 `crypto.subtle` 派生，**不出设备、无服务器参与、开发者无法恢复口令**；错口令 AES-GCM 认证失败统一抛「口令错误或备份文件已损坏」，不区分「错口令」与「文件损坏」以防侧信道。
- 照片 Blob 在导出 JSON 时经 `arrayBuffer → bytesToB64` 内联（保留 MIME），导入 `b64ToBlob` 还原；全库 assets/docs/boxes/boxItems/手动到期项整体打包。
- 导入合并（merge.ts 纯函数）：按 id upsert，`updatedAt`（无则 `createdAt`）晚者胜，反馈「新增 X 条，更新 Y 条」；不先清空，避免误删。

## 关键实现

1. **数据层（lib/store.ts）**：独立 IndexedDB 库 `fangzi-home-vault` v1 四表 assets/docs/boxes/boxItems（复用 reusable-module/indexeddb-kv）；手动到期项体积小、存 LocalStorage 保证刷新持久。写库前组件侧把 reactive 对象拍平为纯对象，Blob 直接放纯对象字段。
2. **到期抽象（lib/expiry.ts）**：`buildExpiryRows` 聚合 assets.warrantyEnd + 手动项，`classifyExpiry` 分级（<0 逾期 / ≤7 橙 / ≤30 黄 / 其余正常），按紧迫度排序；`buildExpiryIcs` 手写 VCALENDAR，每个 VEVENT 两条 VALARM（-P30D / -P7D）。
3. **QR（lib/qrcode.ts）**：载荷 `fz-box:<boxId>`，`renderBoxQrSvg` 动态 import 库后 `createSvgTag({scalable:true})` 输出矢量 SVG 供打印；`parseBoxPayload` 纯函数解析前缀；`isBarcodeDetectorSupported` 能力探测。
4. **理赔包（lib/claim-pack.ts）**：`buildClaimManifest` 纯函数做资产-凭证映射；`buildClaimHtml` 自含打印样式清单；`buildClaimZip` 用 fflate 组织 `manifest.json` / `清单.html` / `凭证/<assetId>/<docId>.jpg`。
5. **计费（D17）**：`useToolBilling('home-vault')`，freemium 买断 ¥12.90（1290 分）；免费门 = 50 张卡片；pro 门覆盖 unlimited-assets / claim-pack / backup / ocr，其余四种变现模式框架已具备、不重写。

## 踩坑记录

1. **image-redraw 不直接复用**：既有工具曾观测到共享模块被新工具 import 时偶发触发 photo-privacy 的 vue-tsc latent 报错。本工具按 exam-review-scheduler 先例在 `lib/photos.ts` 内联等价 Canvas 压缩（铺白底、from-image 定向、阶梯降质量 0.82→0.72→0.62→0.5 压到 300KB 内），零跨工具风险。
2. **DataCloneError 静默写库失败**：reactive 嵌套代理直接 put 会让 structuredClone 抛错；组件保存前 `toRaw` 拍平，Blob 字段原样放纯对象。
3. **动态 import 与类型**：qrcode-generator 走运行时 `import()` 才被 Vite 切成独立懒 chunk（构建产物 `qrcode-*.js` 20.6KB / gzip 7.2KB）；BarcodeDetector 不在本仓 TS DOM lib，用结构化类型探测 `globalThis`，避免裸引用报 TS2304。
4. **移动端 3px 横向溢出**：箱内物品行的删除按钮复用了凭证缩略图的绝对定位样式（right:-0.2rem），在 375px 视口探出 3px；改为行内静态按钮后归零。通用教训：绝对定位小圆角删除按钮不要跨组件复用样式。
5. **加密单测速度**：10 万次 PBKDF2 在单测里太慢，构造函数注入 iters=1000，默认值仍为 100000。
6. **断网 E2E**：E2E 中主动 abort 了 sw.js，reload 会拿不到 HTML 直接 ERR_INTERNET_DISCONNECTED；断网验证改为不导航、直接核验 IDB 与已渲染 DOM。

## 验证覆盖

**档位 M。用户变量覆盖**：新增/编辑/删除资产、挂/删多份凭证、免费 50 卡门、到期四档、手动增删到期项、.ics 导出、建箱/QR/挂物/解挂、全局搜索反查箱号、理赔勾选/导出 ZIP、加密导出/错口令/对口令导入/合并计数/照片还原、二次确认清空。

**单测（test/home-vault.test.ts，20 例，≥16 达标）**：日期跨月/闰年、分级四档边界（-1/0/7/8/30/31/null）、聚合排序、.ics 双 VALARM、QR 载荷前缀/解析、加密往返（iters=1000）、错口令抛错、非信封报错、b64/Blob 往返、mergeRecord 新增/取晚/保留、mergeCollection 计数、理赔 manifest 映射、清单 HTML、50 卡门、导入汇总文案、金额整数分。

**全量质量门**：`npm test` 403 通过（基线 383 + 本工具 20）；`npx vue-tsc --noEmit` 0 错；`npm run verify:tools` 校验工具数 **30** 通过；`npm run build` 成功，qrcode 独立懒 chunk，主包未膨胀。

**三视口 E2E（scripts/e2e-home-vault-20261020.mjs，preview 产物，全程无 pageerror、零横向溢出）**：

| 视口 | 尺寸 | 结论 |
| --- | --- | --- |
| PC | 1280×860 | 档案/到期/搬家 QR/理赔/备份五视图正常，无溢出 |
| 平板 | 834×1112 | 自适应布局正常，无溢出 |
| 手机 | 375×812 | 主流程全通（建资产→凭证→橙色到期→.ics→建箱 QR→手输挂物→搜索箱号→理赔 ZIP→加密往返→合并），无溢出 |

**关键链路断言**：.ics 单事件双 VALARM（-P30D/-P7D）；QR 容器出现非空 `<svg>` 且 node 侧用同库重生成 `fz-box:<id>` 比对；理赔 ZIP 经 node 侧 fflate 解包含 manifest.json/清单.html/凭证 jpg 且映射正确；加密导出 4355B（含照片 base64）→ 错口令报错 → 对口令「新增 4 更新 0」→ 调旧时间戳后二次导入「新增 0 更新 2」、照片 Blob 可见；免费层第 51 张弹专业版门，买断后解锁；断网状态 IDB 与渲染档案仍在。

**截图有效性清单（真实构建产物截图，非 0 字节、可打开、与 guide 描述一致）**：

| 文件 | 像素 | 大小 | 内容 | 通过 |
| --- | --- | --- | --- | --- |
| shot-01-pc-vault.png | 1280×860 | 62022B | PC 档案网格+凭证缩略图 | ✅ |
| shot-02-pc-calendar.png | 1280×860 | 67351B | PC 到期看板橙色档 | ✅ |
| shot-03-pc-moving.png | 1280×992 | 81454B | PC 搬家 QR 标签 | ✅ |
| shot-04-pc-claim.png | 1280×860 | 54519B | PC 理赔勾选页 | ✅ |
| shot-05-pc-backup.png | 1280×1109 | 107291B | PC 加密备份/导入/清空 | ✅ |
| shot-06-tablet.png | 834×1112 | 58138B | 平板自适应 | ✅ |
| shot-07-mobile-vault.png | 375×812 | 52729B | 手机档案 | ✅ |
| shot-08-mobile-moving.png | 375×1011 | 65929B | 手机箱单+挂物 | ✅ |

**EdgeOne Pages 免费版限额核查（dist 全站）**：总存储 132 MiB（< 5 GiB）；文件 150 个（< 20000）；最大单文件 22.90 MiB（bge 量化模型，< 25 MiB）。本工具主 chunk 35.4KB（gzip 12.9KB），qrcode 懒 chunk 20.6KB（gzip 7.2KB），照片不进静态包。

## 可复用经验

- **加密信封三件套**（PBKDF2 可注入迭代数 + AES-GCM + base64 信封 + Blob 内联）可直接复用于任何本地档案类工具；错口令统一报错不区分原因。
- **到期分级 + 双 VALARM .ics** 是 PWA 无后端场景的可靠提醒兜底（后台推送不可靠）。
- **QR 走动态 import 懒 chunk** 是控制首包体积的标准手法；扫码能力探测 + 点选降级保证不支持环境主流程不断。
- **为何 crypto 沿用工具内 lib 模式**：仓内 home-medicine/pet-health/tax-deduction 各有一份成熟信封，既定模式是工具内自带 `lib/crypto.ts`，零跨工具依赖风险；本次未新增 reusable-module 纯模块（不触碰任何存量工具、不为沉淀而沉淀）。
- **遗留/后续项**：OCR 默认未启用（拟 V1.1 动态 import onnxruntime-web + hf-mirror PPOCRv4，用户确认才入库）；BarcodeDetector 相机连续扫码循环未实现（V1 走点选降级）；无实时云同步，双人协作=加密包互传合并。
