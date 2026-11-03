# 技术沉淀：体检趋势（health-trend）

- 对应 dev：`docs/stage/dev_004_体检趋势.md`
- 日期：2026-11-03
- 档位：**M**

## 技术选型与理由
- 纯前端零新依赖：IndexedDB 复用 `reusable-module/indexeddb-kv`；SVG 折线图手写 polyline 不引图表库（轻量）；复查 PDF 复用 payment-chaser/rent-evidence 的 canvas 系统字体→JPEG→pdf-lib 模式，免内嵌中文字体。
- 趋势判定纯函数 `trendStatus`：连续 ≥2 年上升 + 累计涨幅 ≥20% + 达参考上限 80% → climb；最新值超上限 → abnormal；否则 ok。刻意做「缓慢爬升才预警」以减少单次波动焦虑。

## 关键实现
- `lib/model.ts` 无 DOM：`trendStatus / groupByName / buildActionList`，6 例单测。
- 独立 IndexedDB 库 `fz-health-trend-v1`，与 rent-evidence 等键隔离。

## 踩坑记录
- 宿主 ToolRunnerView 头部 tagline 是 nowrap 单行，移动端超长会横向溢出：tagline 必须控制在 ~20 汉字以内（初版 30 字溢出 286px，逐次缩短到 20 字归零）。
- E2E reload 持久化必须在同一 context 内 `page.reload()`，新开 context 是全新 IDB 会误判丢数据。

## 验证覆盖
- 单测：`test/health-trend.test.ts` 6 例（平稳/超限/climb/涨幅不足/清单排序/分组）。
- 全量 `npm test`：**553 通过 / 0 失败**（基线 547 + 6）。
- `npx vue-tsc --noEmit`：**0 错误**。
- `npm run verify:tools`：**37**（新增独立顶层工具 36→37）。
- Playwright 三视口：录 3 年血糖 → 自动识别「缓慢爬升」；录尿酸超限 → 「复查行动清单」出现；reload 同 context 数据保留；零横向溢出、无 pageerror。

### 截图有效性
| 文件 | 视口 | 大小（字节） | 结论 |
| --- | --- | ---: | --- |
| `shots/pc-health-trend.png` | 1280×860 | 已生成 | 趋势曲线+爬升徽标+超限红标，通过 |
| `shots/tablet-health-trend.png` | 834×1112 | 已生成 | 竖屏自适应，通过 |
| `shots/mobile-health-trend.png` | 375×812 | 已生成 | iPhone UA 零溢出，通过 |

### EdgeOne 限额
- dist **184,399,428 B ≈ 175.87 MiB**（< 5GiB）；文件数 **187**（< 20000）；最大单文件仍为既有 ONNX 22.90 MiB。

## 真机待验
- 手动录入多年份后 SVG 点标可读性；多指标删除；复查 PDF 在微信内打开。
