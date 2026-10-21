# Postmortem · PDF 真脱敏（pdf-redact）

> 档位：**M**（多场景链路 + IDB/文件处理 + WASM/wasm 资源自托管）

## license / CVE / 版本
- pdfjs-dist ^4.10.38（Apache-2.0，仓内既有，未动）；pdf-lib ^1.17.1（MIT，本版新增）。均可商用、无 NC、本编写时无公开高危 CVE。

## 路线取舍与最终实现
A（内容流算子级精准删除）对子集字体/多 stream/BT·ET bbox 不稳，M 档预算内不可靠；**最终用 B（混合）**：无遮页 copyPages 保留矢量可搜索；含遮页 ~150dpi 渲染位图+盖黑块整页嵌回，该页文字层彻底删除。代价：含遮页变图不可选中，UI/文档已明示。

## 真删实证（E2E 输出）
现场生成两页测试 PDF（页1 有 `SECRETBANK ACCT 8899`、页2 仅 `PUBLIC ONLY PAGE TWO`，Author=张三 Secret、Title=Confidential Draft），对页1 秘密区域加遮罩后导出，用 pdf.js `getTextContent` 重新解析导出件：
- `page0=""`（含遮页文字层彻底删除，SECRET/8899 提取不到）；
- `page1="PUBLIC ONLY PAGE TWO"`（未遮页矢量文字完整保留）；
- readMeta Author='' / Title=''（元数据已清空）。
以上三断言在 pc/tablet/mobile/offline 五次均通过。

## worker 自托管与离线
pdf.worker.min.mjs 经 Vite `?url` 本地打包；vite.config globPatterns 增列 mjs，rebuild 后 sw.js 预缓存含该 worker（grep=1）；离线 E2E 仍可完成一次遮罩导出，且无外部请求。

## EdgeOne 体积
dist ~133M/163 文件；新增最大静态 pdf.worker.mjs 1.37MB；最大单文件 ort-wasm 13.6MiB<25MiB。

## 三视口验证
1280×860 / 834×1112 / 375×812：真删/未遮保留/元数据断言通过、横向溢出 0、无 pageerror；离线通过。

## 截图
- docs/shots/pr-pc-main.png（68593 B）
- docs/shots/pr-mobile-main.png（40578 B）

## 踩坑
pdf-lib setKeywords 收 string[]、无 getInfo()、setCreationDate 需 Date；vue 模板里普通 let draft 会被 vue-tsc 收窄成 never，须用 ref。
