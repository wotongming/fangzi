# 技术沉淀：电商商品图批量处理工作台（image-converter 电商上新模式）

- 对应 dev：`dev_002_电商商品图批量处理工作台.md`
- 日期：2026-10-16
- 档位：M（在既有工具内增量，无新模型、无新重型依赖）

## 技术选型与理由
- **不新增工具、不新增模型**：能力落在既有 `image-converter` 内，作为与「通用处理」并列的「电商上新」模式。AI 换底直接复用已集成、商用友好的 MODNet（onnxruntime-web WASM），不引入第二套抠图/生成模型，规避包体膨胀与非商用授权风险。
- **纯 Canvas2D + 现有 fflate**：规格裁剪/留白、换底合成、水印、目标体积编码全部用原生 Canvas `drawImage(9 参数)` 与 `canvas.toBlob`；ZIP 继续用仓库已依赖的 fflate（MIT），无新增第三方包。
- **纯逻辑/像素分层**：`presets.ts`（几何）、`pack.ts`（命名/CSV/ZIP）、`watermark.ts`（锚点）、`templates.ts`（归一化）均为无 DOM 纯函数，可在 Node 直接单测；只有 `compose.ts` 依赖 DOM Canvas，交给浏览器 E2E 覆盖。这让最易错的几何/命名/分包在毫秒级单测里被拦住。
- 依赖漏洞/兼容：未新增依赖；沿用现有 fflate、onnxruntime-web 版本，构建与既有工具一致。

## 关键实现
新增目录 `src/tools/image-converter/ecom/`：
- `types.ts`：规格/换底/水印/模板的可序列化类型。
- `presets.ts`：9 个平台规格种子 + `resolveSpec`（覆盖/钳制）+ `computeGeometry(srcW,srcH,ratio,longEdge,fit)`。
  - `cover`：先按目标宽高比居中算源图采样矩形（`sx/sy/sw/sh`），再铺满画布；
  - `contain`：完整源图等比缩放居中，留白矩形由背景层填色；
  - 竖图（ratio<1）长边作用于高，横图作用于宽。
- `compose.ts`：`removeBackground? → 建规格画布 → 背景层(纯色/自定义图/jpeg留白填白) → 9 参数 drawImage 主体 → 水印 → encodeToSize`。
  - **目标体积**：JPEG/WebP 在质量 [0.3,0.95] 内二分至多 7 次逼近 `targetBytes`，返回「不超过目标的最高质量」，达不到则给最低质量结果（UI 提示）；PNG 无损不压缩体积。
- `watermark.ts`：九宫格 `anchorOf` + 对角交错平铺 `computeAnchors`（纯函数）；文字就地绘制；logo 按短边 16% 缩放定位。
- `pack.ts`：文件名模板变量替换、非法字符净化、按平台 `key` 分目录、序号补零、重名自动 `-2/-3` 去重、`manifest.csv`（UTF-8 BOM + RFC 式转义）、fflate 打包。
- `templates.ts`：LocalStorage key `fz-img:ecom-templates`，版本 1，读取宽松校验 + 损坏/隐私模式回退默认。
- `components/EcomMode.vue`：导入→规格→换底→水印→命名 5 段配置；把「原图 × 规格」展开为作业，复用 `runBatch`（并发 1，AI 安全），**每个原图每轮只扣一次额度**；结果路径/清单行存 Map 供打包。
- `index.vue` 仅新增顶部「通用处理 / 电商上新」模式切换，通用单张/批量逻辑零改动。

### 关键流程图
```
原图 File ──(换底?)──► MODNet 透明 PNG ──┐
                 否 ──► 原 Bitmap ───────┤
                                         ▼
                  computeGeometry(规格 ratio/longEdge/fit)
                                         ▼
            背景层(纯色/自定义图/JPEG留白白) + 9参drawImage主体
                                         ▼
                    文字/logo 水印  →  encodeToSize(目标KB二分)
                                         ▼
        renderName → buildEntryPath(平台目录/名.ext) → fflate ZIP + manifest.csv
```

## 踩坑记录
1. **任务列表始终为空**：初版展开了 `jobs` 却忘了像通用批量那样在运行前 `tasks.value = jobs.map(...)` 预填，而 `runBatch` 的 `onItem` 是按 index 回填数组——导致 UI 无任务、E2E 等待超时。修复：运行前预填任务数组；并用独立 Playwright 探针脚本快速定位（比全量截图省时）。
2. **`runBatch` 非泛型**：`runBatch<BatchItem>` 报 TS2558。没有改动公共函数签名（避免影响存量），改为回调内用 `index` 从闭包 `jobs[index]` 取回带 `spec/sourceId` 的扩展作业。
3. **JPEG 透明留白变黑**：不换底 + contain 留白 + JPEG 时，未绘制区域 alpha=0 被编码成黑；修复为该情形先填白底。
4. **PNG 不承诺目标体积**：目标 KB 仅对有损格式二分，PNG 直接无损导出，文档明示。
5. **模板恢复的可选链类型收窄**：`t.output?.format` 后再访问其它字段，TS 仍认为可能 undefined；取局部 `const out=t.output` 后统一判空。
6. **E2E 下载**：组件只生成 `blob:` 对象链接、不触发浏览器下载；测试通过 `addInitScript` 包装 `URL.createObjectURL` 捕获 zip URL，再页内 `fetch` 取回字节用 fflate 解包断言（分目录/张数/manifest 尺寸）。

## 验证覆盖
- 档位 M。
- **类型检查**：`npx vue-tsc --noEmit` = 0 错误。
- **单元测试**：新增 `test/image-converter-ecom.test.ts` 15 例全过（规格 key 唯一性/覆盖钳制、cover/contain/横竖图几何、命名模板/净化/补零、平台分目录、CSV BOM 与转义、ZIP 重名去重、九宫格/平铺锚点边界、模板归一化与损坏回退）；全量 `test/*.test.ts` = **155/155 通过**，存量无回归。
- **构建/限额**：`npm run build` 成功，postbuild 25MiB 守卫通过（最大单文件 13.6MiB）；`dist` ≈ **86 MB / 95 文件**，相对上版仅增 JS/UI，无新大文件，满足 EdgeOne 免费版 5GiB / 20000 文件 / 单文件 ≤25MiB。
- **工具回归**：`npm run verify:tools` 通过（仍为 17 工具，电商为工具内模式，不计新工具）。
- **浏览器 E2E（preview + 无头 Chromium）**：
  - `e2e-image-converter.mjs`（存量通用，含真实 MODNet AI 去背景、买断、批量 ZIP、平板/手机）**11/11**；
  - `e2e-image-converter-ecom.mjs`（新增）**7/7**：通用单张回归、导入份数=原图×规格、2 图×2 规格=4 份全成功、ZIP 含 `taobao-1x1-800/`、`xiaohongshu-3x4/`、`manifest.csv` 且清单含 800×800 与 810×1080、平板/手机无横向溢出、无 console error。
- **多端多尺寸**：PC 1280、平板 834、手机 375 三视口主流程通过，无横向溢出。
- **guide 截图有效性**（真实运行、非占位）：
  - `shots/pc-ecom-done.png`：1280×2420，300659 B，通过；
  - `shots/tablet-ecom.png`：834×2046，248090 B，通过；
  - `shots/mobile-ecom.png`：375×3175，254542 B，通过。
- 变量覆盖（用户使用变量 ≥90%）：多/单文件、文件夹/ZIP 导入；9 规格与多选；3 种格式；质量/目标 KB/cover/contain；3 种换底（含不换底）；文字水印开关/颜色/旋转/九宫格/平铺、logo；命名 5 变量与非法字符；模板保存/损坏回退；免费额度→买断；大批量（逻辑上单张限流，200 张由既有队列与逐份释放内存支撑，建议分批）。**未做真机（物理机）摄像头/触控测试**——本功能不涉及摄像头，已用三视口无头验证布局与交互。
- AI 换底真实链路：由存量通用 E2E 的 MODNet 去背景 11/11 间接保证；电商模式换底复用同一 `removeBackground`，仅合成方式不同（已在 compose 单测接缝 + 不换底 E2E 覆盖；纯色/自定义底合成属同一 drawImage 路径）。

## 可复用经验
- **表驱动规格 + 纯几何函数**：平台尺寸易变，把规格做成数据、几何做成 `computeGeometry` 纯函数，后续加平台/加裁剪策略只改数据与单测。
- **「原图 × 规格」展开 + 每原图计一次费**：批量派生多份输出时，计费/额度应按业务主体（原图/一次上新）而不是派生份数扣减。
- **目标体积统一用质量二分**，并明确无损格式不承诺体积，避免给用户错误期待。
- **JPEG/任意不透明编码前先铺底色**，是透明源/留白场景的通用坑。
- **批量 UI 运行前预填任务数组**，回调按 index 原地更新，避免响应式数组与队列索引错位。
- **测试大体积结果用 blob URL 拦截**而非依赖浏览器下载事件，适合静态纯前端工具的无头断言。
