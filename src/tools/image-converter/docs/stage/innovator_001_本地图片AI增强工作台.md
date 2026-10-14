# 功能建议：本地隐私图片批处理与 AI 增强工作台（WebGPU 加速）

- 序号：001
- 建议形态：网页应用（PWA 内嵌工作台 / 独立页面）

## 需求来源

- WebGPU 已进入主流：Chrome/Edge/Firefox/Safari 默认支持，全球浏览器覆盖率约 70%，compute shader 可在浏览器内做大规模并行图像计算（来源站点：reptile.haus《WebGPU Goes Mainstream: What Your Development Team Needs to Know in 2026》，检索关键词：webgpu mainstream 2026；https://reptile.haus/journal/webgpu-mainstream-what-development-teams-need-to-know-2026/）
- 本地图片处理工具已形成真实付费市场：COMBb2（16 个隐私优先图片工具，AI 超分/去噪/人脸修复/去背景，Pro 版支持批量，明确按订阅收费，用户评价涵盖自由摄影师 NDA 场景、HR 证件照、电商店主批量处理）（来源站点：COMBb2 官网，检索关键词：AI image upscaler free private in-browser；https://combb2.io/）
- zeropng AI 照片修复：Real-ESRGAN 模型约 5MB 浏览器本地缓存，WebGPU/WebAssembly 加速，支持离线、批量、4 倍超分（来源站点：zeropng，检索关键词：ai photo restorer local webgpu；https://zeropng.com/tools/ai-photo-restorer）
- BulkPicTools：宣称 1,000,000+ 用户、86 个本地图片工具，支持 200+ 张批量、工具链串联、离线使用（来源站点：BulkPicTools，检索关键词：浏览器 本地 批量图片处理 不上传；https://bulkpictools.com/zh-TW）
- Chrome 扩展「AI Upscaler & Background Remover」：本地 ONNX Runtime 推理，模型从 Hugging Face 下载后完全离线，说明“隐私优先本地图片处理”需求已从 Web 站扩散到浏览器扩展形态（来源站点：Chrome Web Store，检索关键词：ai upscaler local chrome extension；https://chromewebstore.google.com/detail/ai-upscaler-background-re/akfcbifmheikdgccbnlhdmfdnfcpobpp）
- WebGPU 计算优势量化：2048×2048 高斯模糊 CPU JS 约 400ms，WebGPU compute shader 约 4ms；文本嵌入模型 200ms→8-15ms（来源站点：CODERCOPS《WebGPU in 2026》，检索关键词：webgpu compute shader speedup；原文未提供独立 URL，数据同见于 Chrome for Developers https://developer.chrome.google.cn/blog/webgpu-io2023?hl=zh-cn）

## 使用场景

- **摄影师/自由职业者**：给客户照片做交付前处理（超分、去噪、修脸），照片含客户肖像与拍摄原片，签了 NDA 或不想把客户照片传到第三方服务器；现有云端工具需要上传，逐张处理慢、有泄露风险。
- **电商卖家/店铺运营**：每周处理 200+ 张商品图（去背景、压缩、统一尺寸），产品图含未公开新品与价格信息，批量处理需求强，云端工具限制张数或收费高。
- **普通用户/家庭**：老照片翻新（去噪、修复、超分）、手机 HEIC 转 JPG、证件照制作；在意照片隐私（家庭照片、证件），希望离线可用。
- **职场用户**：HR 处理员工证件照、企业内部资料配图，明文规定照片不得上传外部服务。

## 功能描述

- 核心：一个浏览器内运行的本地图片处理工作台，全部处理（Canvas/WebGPU compute + 本地 ONNX/WebGPU 推理）在用户设备完成，文件不出浏览器。
- 批量导入：拖拽/文件夹/ZIP 批量导入图片，一次处理 200+ 张。
- 工具链串联：压缩 → 裁剪 → 格式转换 → AI 增强（超分/去噪/去模糊/人脸修复/去背景/上色）按顺序串成工作流，中间结果不用重新上传。
- WebGPU 加速：AI 模型（Real-ESRGAN 等）首次从 Hugging Face 等免费源下载并本地缓存（约 5MB/个），WebGPU 不可用时回退 WASM/CPU。
- 输出：单张下载或 ZIP 批量导出；支持导出到指定体积（100KB/200KB/1MB）。
- 离线可用：首次加载模型后断网可继续处理。
- 辅助能力：EXIF/GPS 元数据清除（隐私）、证件照模板（1寸/2寸）、社交媒体尺寸预设。

## 目标人群

- 画像：自由摄影师、电商卖家、内容创作者、HR/行政、家庭老照片整理者；年龄 20-55 岁，有一定电脑使用能力。
- 规模：全球摄影师+电商卖家+内容创作者数以千万计（BulkPicTools 单站已破百万用户、COMBb2/zeropng 持续增长）；国内电商从业者、自媒体人群庞大。
- 付费意愿：强——COMBb2 已用 Pro 订阅卖「批量处理」；电商卖家批量处理是刚性高频需求；自由摄影师为客户保密处理愿意付费（证据：COMBb2 用户评价直接提到“batch processing alone is worth Pro”“upscaler I can use on client photos without worrying about NDAs”）。

## 建议形态

- 网页应用（PWA 内工作台）：用户打开即用、无需安装，文件拖入即处理，符合“一次性批量任务 + 隐私敏感”场景；可离线（Service Worker 缓存页面与模型），后续可打包为浏览器扩展/桌面壳。选择网页形态是因为目标人群处理照片时就在浏览器里（电商后台、图库、社交平台），PWA 免安装最适合。

## 落地价值

- 解决：照片/商品图处理必须上传云端的隐私风险与泄露焦虑；单张处理的低效；云端按次/按量收费。
- 节省：摄影师每单省去逐张上传等待；电商每周节省数小时批量处理时间；省下云端工具订阅费。
- 市场空间：隐私优先图片处理是 2026 年已被验证的细分市场（百万级用户、Pro 付费存在）。
- 潜在盈利点：免费开放基础工具，Pro 订阅解锁批量、AI 模型增强、自定义工作流、更多格式；未来可延伸团队/企业内网私有化版本。
- **多场景链路**：触发（拖入批量图片/文件夹）→ 处理（选择工具链：压缩→裁剪→AI 增强）→ 产出（导出/下载/ZIP）→ 后续动作（电商上架、社交发布、证件提交、归档）；可延伸视频帧处理、文档配图处理、团队共享工作流。

## 多场景链路与红海规避判断

- 是否同质化小工具：否（非单一原子动作；是批量处理 + 多工具链串联 + AI 增强的组合型工作台，具备平台化潜力）
- 多场景链路：图片导入 → 本地 GPU/AI 处理 → 导出归档 → 发布/提交，贯穿摄影师交付、电商上架、证件制作、老照片翻新多个场景
- 持续使用频次与付费空间：电商/摄影师按周高频使用；付费场景=批量+AI 模型+自定义工作流订阅，付费理由=时间节省+数据安全
- 红海规避：云端图片工具是红海但普遍存在“上传隐私 + 单张限制”未满足点；纯本地+WebGPU 批量+离线是差异化空间（COMBb2/zeropng 已证明付费意愿，市场仍在早期增长期）

## 强规则核对

| 强规则 | 是否满足 | 依据 |
| --- | --- | --- |
| 给用户带来真实价值（节省时间/资金/情感价值，至少其一） | 是 | 批量+本地处理显著节省时间（一次处理 200+ 张免上传等待）；免云端订阅节省资金；照片隐私安全感为情感价值 |
| 用户有购买意愿（必要条件） | 是 | 目标用户：摄影师/电商/HR；付费场景：批量处理与 AI 增强 Pro 订阅；付费理由：高频刚需+数据不出端（竞品已实际收费） |
| 形态贴合目标人群使用场景 | 是 | 网页/PWA 免安装，浏览器即处理，贴合电商后台、图库、社交平台等真实操作环境；离线可用贴合弱网场景 |
