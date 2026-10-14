# 部署运维指引：本地图片AI增强工作台

- 对应 architect：architect_001_本地图片AI增强工作台.md
- 编写日期：2026-10-15

## 部署架构与环境准备

- 部署架构：EdgeOne Pages 静态托管（与 fangzi 现有流程一致）；构建产物 dist/ 推送；AI 模型运行时从 Hugging Face 下载（不进部署包，客户端缓存）。
- 环境清单：Node ≥ 20.19（构建机）；EdgeOne Pages 账号（已有）；Hugging Face 无需账号即可下载公开模型。

## 软硬件配置清单

| 项 | 规格 |
| --- | --- |
| 构建机 | 任意 Node 20+ 环境 |
| 部署 | EdgeOne Pages（免费额度） |
| 客户端 | 现代浏览器（Chrome/Edge/Firefox/Safari）；WebGPU 可选（WASM 回退） |
| 模型源 | Hugging Face（运行时下载，客户端缓存） |

## 部署步骤

1. `cd fangzi && npm install && npm run build`（产出 dist/）
2. EdgeOne Pages CLI/Git 推送 dist/（按 fangzi 现有部署运维指导执行）
3. 发布后验证：打开工具页，单张转换可用；首次使用 AI 增强触发模型下载（有进度）
4. 更新 README 工具清单（image-converter 升级说明、版本 1.1.0）

## 配置项说明

- 无新增环境变量；模型源 URL 在 `lib/ai/models.ts` 常量中维护。

## 上线/灰度方案

- 小范围灰度（内部/种子用户）→ 观察模型下载成功率与错误上报 → 全量；工具级灰度（按用户反馈回滚）。

## 平台对接指南

- **EdgeOne Pages**：注册与资质要求：个人开发者账号即可（现有）；部署流程：CLI `edgeone pages deploy` 或 Git 推送；自定义域名与 HTTPS 证书：EdgeOne 控制台配置（现有域名沿用）；版本更新机制：重新部署即发布新版本，SW 更新由 generateSW 版本指纹控制。
- 其余平台（Chrome Web Store 等）：本功能为 PWA 内工具，不涉及。

## 运维监控指标与告警

- 指标：工具页访问量（EdgeOne 统计）、模型下载失败率/推理耗时（本地打点，可选上报）、WebGPU 可用率；
- 告警：模型源（Hugging Face）不可用 → README/工具页提示，或切换镜像源（models.ts 支持多源）。

## 日志管理

- 浏览器端：console 结构化日志 + 可选 `window.addEventListener('error')` 聚合；不上传用户图片数据。

## 备份与容灾

- 无服务端数据；模型为公开资源可重下；代码仓 git 备份（gitcode fangzi 仓）。

## 常见故障排查与回滚预案

- 模型下载失败：检查网络/代理；切换 models.ts 镜像源；提示用户重试；
- WebGPU 推理报错：自动回退 WASM；记录 `runtime` 档位；
- 上线后严重问题：`git revert` 至上一版本重新部署，仅影响 image-converter 工具，不影响 fangzi 主体与其他工具。
