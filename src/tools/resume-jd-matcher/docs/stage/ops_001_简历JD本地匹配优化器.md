# 部署运维指引：简历 × JD 本地匹配优化器（resume-jd-matcher）

- 对应 architect：`architect_001_简历JD本地匹配优化器.md`
- 编写日期：2026-10-16

## 部署架构与环境准备
纯静态 PWA，无后端、无数据库、无密钥。组件：EdgeOne Pages 静态站 + 同源 `/mf/`（或复用003目录）下 MiniLM 模型与 ort wasm + 现有 Service Worker（/mf 分片合并）。用户数据仅存本机 IndexedDB/LocalStorage。

## 软硬件配置清单
无服务器。构建机 Node≥20.19（现有流水线即可）；模型文件沿用既有自托管，单文件 <25MiB（超限已由 shards.json 分片）。

## 部署步骤
1. 合入 main（代码随仓库）；EdgeOne Pages 绑定 GitCode main 自动构建，或手动在控制台触发发布。
2. 确认产物含 `assets/`、工具 chunk、以及 `/mf/...` MiniLM 与 wasm；`dist` 总量/文件数/单文件在免费额度内（构建守卫自动卡 25MiB）。
3. 发布后用 www 自定义域校验：工具页 200、模型 200 且 content-type 正确、SW activated 且 clientsClaim 接管。
4. 真机（大陆 4G）验证模型同源可达、可离线二次打开。

## 配置项说明
无环境变量/密钥。计费档位写在 `manifest.billing`（freemium+买断 priceCents 4990，月免次数）；模型路径常量在 lib/embeddings.ts（BASE_URL+/mf/...）。

## 上线/灰度方案
先随版本上线、首页不主推（观察 1–2 天解析/匹配错误与模型加载失败率），稳定后加入“工作”分类与示例提问。回滚：revert 该工具目录提交并重新发布（自动发现即下线），不影响主站与其它工具。

## 平台对接指南
- **EdgeOne Pages**：复用现有项目与 www.fangzi.asia 自定义域（HTTPS 已部署）；本次无需新资质。注意裸域 fangzi.asia 仍需在控制台单独添加（与本工具无关的既有事项）。
- 无 Chrome/VS Code/JetBrains 插件分发。

## 运维监控指标与告警
无服务端指标。前端本地（不上传隐私）记录：模型加载成功率/耗时、解析失败类型、匹配调用次数、GPU/CPU 路径；用于后续优化。出错时 UI 显示可操作提示（文件不支持/模型未就绪）。

## 日志管理 / 备份容灾
无服务端日志。用户数据本地：提供“导出全部数据(JSON)/导入”作为用户自备份（可纳入 M3）；清缓存即清除，属预期。

## 常见故障排查与回滚
- 模型 Failed to fetch：核对 /mf 文件与 SW（参照004 sw-model-shards 经验：controller、shards.json、拒绝 HTML、缓存版本）。
- PDF 文本为空：扫描件（图片型 PDF），V1 不支持 OCR，明确提示转文字版（JD/简历截图 OCR 为 V2）。
- 匹配异常：检查技能词典与归一；match 为纯函数可在单测复现。
- 回滚：删工具目录发布即可，主体不受影响。
