# Postmortem · 小票本 receipt-vault

> 档位：**M**

## 版本/license/CVE
tesseract.js 5.1.1（Apache-2.0）；tesseract-core 5.1.1 与语言包均 Apache-2.0，可商用、无 NC，无公开高危 CVE。

## 自托管与体积
- worker.min.js 124KB；core wasm 2.86MB + glue 3.94MB；chi_sim.traineddata.gz 20.16MB、eng.traineddata.gz 10.92MB。
- 全部 public/ 自托管，无外链 CDN。>5MB 资源走 runtimeCaching CacheFirst，首次后离线。

## 字段抽取实测（E2E 输出）
输入「商户：星巴克咖啡南京店 / 日期 2026-10-21 / 合计 45.00 / 税额 2.55」：
merchant=星巴克咖啡南京店、date=2026-10-21、amount=45.00、tax=2.55、confidence=1。
CSV=表头+「2026-10-21,星巴克,45.00,2.55,餐饮,」。

## IDB 持久化
db=fz-receipt-vault-v1；E2E save id=e2e1 后 all() 仍含，刷新后记录在。

## EdgeOne
dist 133M→169M、文件 163→170；最大单文件 chi_sim.gz 20.2MB<25MiB。

## 三视口
1280/834/375：抽字段/IDB/CSV 断言通过、横向溢出 0、无 pageerror、离线纯逻辑可用。

## 截图
- docs/shots/rv-pc.png（52.3KB）
- docs/shots/rv-mobile.png（38.7KB）

## 局限
中文发票版式多样，首版抽字段+人工校对，不追求全自动；OCR 真实识别真机手感未测（E2E 用确定性 parse 接缝断言字段逻辑，未跑完整 tesseract 识别流程）。

## 2026-10-21 热修：老 WebView 卡"识别中" + 账单 xlsx 导入
- OCR 根因：core 写死 SIMD wasm，不支持 WebAssembly SIMD 的老安卓 WebView 初始化 reject 但 UI 不收口。改：自托管 non-SIMD `tesseract-core-lstm.wasm(.js)`（2.86MB+3.94MB，tesseract.js-core@5.1.1 同版本），SIMD 失败自动降级；60s 超时，失败重置可重试。
- 新增账单导入：SheetJS 0.18.5（Apache-2.0），微信/支付宝 xlsx 自动找表头行（含「交易时间」+「金额」）跳过说明行，映射 交易时间/交易对方/收/支方向（支出正、收入退款负）/备注；导入前预览勾选再入 fz-receipt-vault-v1。
- 验证：单测覆盖微信/支付宝表头与金额方向；三视口 E2E 现场生成 xlsx 断言预览勾选+批量入账 rows=2、金额 42.50/-10.00。EdgeOne dist 176MB/172 文件，最大单文件 ort-wasm 13.6MiB<25MiB。
- 真机待验：华为/WeLink WebView 的 SIMD 支持与 chi_sim 首次下载 20MB 弱网进度需真机复测。
