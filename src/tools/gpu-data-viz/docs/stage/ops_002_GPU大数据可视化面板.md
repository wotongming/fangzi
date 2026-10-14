# 部署运维指引：GPU大数据可视化面板

- 对应 architect：architect_002_GPU大数据可视化面板.md
- 编写日期：2026-10-15

## 部署架构与环境准备

- 部署架构：EdgeOne Pages 静态托管（同 fangzi 现有流程）；纯前端渲染，无服务端；
- 环境清单：Node ≥ 20.19（构建机）；EdgeOne Pages 账号（已有）。

## 软硬件配置清单

| 项 | 规格 |
| --- | --- |
| 构建机 | Node 20+ |
| 部署 | EdgeOne Pages（免费额度） |
| 客户端 | 桌面 Chrome/Edge（推荐 WebGPU）；Firefox/Safari 走降级路径；集成显卡可用 |
| 数据 | 用户本地文件，不落服务端 |

## 部署步骤

1. `cd fangzi && npm install && npm run build`
2. EdgeOne Pages CLI/Git 推送 dist/
3. 验证：工具页加载、导入 CSV、渲染与降级正常
4. 更新 README 工具清单（登记 gpu-data-viz 七字段）

## 配置项说明

- 无新增环境变量；数据量上限与计费在 manifest 与 store.ts 常量维护。

## 上线/灰度方案

- 先桌面端灰度（WebGPU 完整能力），观察降级比例；移动端提示数据量上限；全量发布。

## 平台对接指南

- **EdgeOne Pages**：个人账号即可；部署 CLI/Git；HTTPS 由平台提供（现有域名）；版本更新=重新部署（SW 指纹更新）。
- 其余平台：不涉及（PWA 内工具）。

## 运维监控指标与告警

- 指标：工具访问量、渲染后端分布（webgpu/webgl/canvas，本地打点可选上报）、着色器编译失败率；
- 告警：WebGPU 编译失败占比异常 → 检查降级逻辑或浏览器版本分布。

## 日志管理

- 浏览器 console + error 聚合；不上传用户数据文件。

## 备份与容灾

- 无服务端数据；代码仓 git 备份；渲染核心为自研，回归风险集中于新增模块。

## 常见故障排查与回滚预案

- 渲染黑屏/报错：检查浏览器 WebGPU 支持与驱动；确认降级路径生效；
- 大数据 OOM：提示数据量上限，流式分块兜底；
- 严重问题：`git revert` + 重部署，仅影响新增工具。
