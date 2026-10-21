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
