# 用户使用指导书：本地图片AI增强工作台

- 对应 dev：dev_001_本地图片AI增强工作台.md
- 日期：2026-10-15
- 版本：v1.1.0（manifest v1.1.0，五种变现声明）

## 功能简介

「图片处理工作台」是 fangzi 内置的图片工具（升级原 image-converter）：本地转换/压缩、裁剪、**AI 超分 4x**、**AI 去背景**、批量工具链与 ZIP 导出。图片全程在浏览器本地处理、不上传服务器；AI 模型首次使用时按需从 HuggingFace 下载并缓存（SW 缓存 90 天），之后可离线复用。

## 运行环境要求

- 浏览器：推理统一 **WASM（CPU）**，Chrome / Edge / Safari / Firefox 全浏览器可用（不含 WebGPU 依赖）。
- 免安装：PWA 直接访问即可；建议「添加到首页」以获得离线体验。
- 磁盘：AI 模型缓存约 30MB（超分 18MB + 去背景 11MB）+ 推理 wasm 13.6MB（随应用部署，非用户下载）。

## 安装与启动

功能随 fangzi 项目运行，无需单独安装：

```bash
cd fangzi
npm install        # 首次
npm run dev        # 开发（访问 http://localhost:5173/#/t/image-converter）
npm run build && npm run preview   # 产物预览
```

配置项：
- 无环境变量依赖；AI 模型直链与 wasm 路径已内置（`src/tools/image-converter/lib/ai/models.ts`、`loader.ts`）。
- 计费默认本地演示支付（`LocalMockProvider`，订单存 localStorage `fangzi:billing:v1`）；配置 `VITE_BILLING_ENDPOINT` 可切换真实网关。

## 使用说明

### 一、单张处理（免费）

1. 进入工具页（fangzi → 图片处理工作台）。
2. 点击「选择图片」导入一张图（仅本地处理，不上传）。
3. 设置输出格式（WebP/JPEG/PNG）、质量、最大宽度；可选勾选「裁剪」「清除 EXIF/GPS」。
4. 点击「开始处理」，结果卡展示原始/处理后体积与步骤耗时，点「下载 .ext」保存。

> 界面见 `docs/shots/pc-single-ai.png`（含 AI 去背景结果示例）。

### 二、AI 增强（超分 / 去背景）

1. 未购买时若今日有免费额度（默认 3 张/日），AI 复选框直接可用，消耗免费额度。
2. 勾选「AI 去背景」或「AI 超分 4x」（可同时勾选，按顺序执行）。
3. 点击「开始处理」：首次会下载模型（超分约 18MB、去背景约 11MB），进度条提示；完成后结果卡显示步骤日志（如「转换压缩 → AI 去背景」）。
4. 免费额度用尽且未购买时，复选框禁用，需购买（见「权益与解锁」）。

### 三、批量工具链（买断/订阅/用量包）

1. 切换到「批量工具链」页签。
2. 导入：多选文件 / 选择文件夹 / 导入 ZIP 三种方式。
3. 勾选工具链步骤（转换压缩、裁剪、AI 去背景、AI 超分 4x，按顺序执行）。
4. 点击「开始批量处理」，任务列表实时显示每张状态（成功/失败/处理中）。
5. 全部完成后点「导出 ZIP」下载打包结果。

> 界面见 `docs/shots/pc-batch-done.png`（3 张全部成功 + ZIP 已生成）。

### 四、权益与解锁（五种变现）

面板提供：**买断**（¥29.9 一次永久）、**订阅**（¥9.9/月、¥89/年）、**用量包**（¥9.9/张 ×100，先扣每日免费额度再扣用量包）、**免费增值**（基础转换免费 + 每日免费 AI 额度）、**平台分成**（20% 渠道分销，订单统一记录）。本地演示支付点击即购买；正式上线通过计费框架对接真实收银台。

> 手机/平板布局示例见 `docs/shots/mobile-single.png`、`docs/shots/mobile-batch.png`、`docs/shots/tablet-single.png`、`docs/shots/tablet-batch.png`。

## 常见问题（FAQ）

| 问题 | 处理 |
| --- | --- |
| 首次 AI 处理很慢？ | 需下载模型（超分 18MB / 去背景 11MB）+ 初始化 wasm（13.6MB 随应用部署）。已缓存后再次使用只需推理时间（128px 图去背景约 4.4s，WASM CPU）。 |
| 为什么不用 GPU 加速？ | EdgeOne Pages 静态托管单文件上限 25MiB，而 WebGPU 后端 wasm（27MiB）必然超限；WASM 推理全浏览器可用、部署合规，性能已足够（见 postmortem 踩坑 8）。 |
| 批量按钮灰的？ | 批量工具链需解锁（买断/订阅/用量包任一）。AI 复选框灰的是今日免费额度已用完且未购买。 |
| 模型下载失败/很慢？ | 模型托管于 HuggingFace 直链（商用友好授权），可重试；已下载部分会被 SW 缓存，后续离线可复用。 |
| 我的图片会上传吗？ | 不会。转换、裁剪、AI 推理全部在浏览器本地完成，无任何网络上传（仅模型文件下载是出网请求）。 |

## 注意事项

- AI 模型授权：Real-ESRGAN（BSD-3-Clause）、MODNet（Apache-2.0），均可商用。
- 超分输入上限 512px（`UPScaleMaxInput`），更大图请先压缩再超分。
- 去背景输出透明 PNG；含 alpha 的图在 WebP 下可能不支持透明，建议选 PNG。
- 本地演示支付仅记录本地订单，正式商用需配置 `VITE_BILLING_ENDPOINT` 对接真实收银台。
