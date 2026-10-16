# 技术沉淀：小游戏合集

- 对应 dev：dev_001_网页小游戏合集.md
- 日期：2026-10-17
- 档位：**M**（多款游戏的多场景链路工具：多难度、IndexedDB 持久化、freemium 付费墙、多端触控；无 GPU/WASM/本地 AI，未做满规模大数据性能实测）

## 技术选型与理由

| 项 | 选型 | 理由 / 授权 |
| --- | --- | --- |
| 渲染 | 原生 DOM/CSS + 少量网格（2048/翻牌/华容道/三消均为离散格，无需 Canvas） | 零依赖、包体最小、触屏与可读性好；无图片素材，表情用系统 Emoji，零版权风险 |
| 框架 | Vue 3 SFC + TypeScript（与方子一致） | 走现有工具自动发现框架（manifest.ts + index.vue），零路由/检索/SW 改动 |
| 持久化 | IndexedDB，复用 `reusable-module/indexeddb-kv` | 单例 `fz-mini-games-v1/kv` 存一份 `{best}`，与其它工具约定一致 |
| 计费 | 复用 `src/core/billing` + `useToolBilling`，manifest 声明 `freemium` | 免费 2048/翻牌，付费华容道/三消；本地 LocalMock 可完整演示，接 `VITE_BILLING_ENDPOINT` 即切真实支付 |
| 新增依赖 | **无**（package.json 未改动） | 全部用标准 Web 能力，商用无限制 |

漏洞/兼容性：未引入任何第三方运行时依赖，无已知 CVE 面；兼容 Chrome/Edge/Firefox/Safari 桌面与移动端。

## 关键实现

- 目录：`src/tools/mini-games/`
  - `manifest.ts`：id=`mini-games`、category=`life`、freemium 价 ¥19.90（1990 分），口语化关键词覆盖小游戏/摸鱼/2048/翻牌/华容道/消消乐。
  - `index.vue`（GameShell）：游戏标签、本局/最高分、重新开始、难度切换、专业版付费墙；`:key="game:diff:nonce"` 保证切游戏/切难度/重开时子组件干净重挂载。
  - `components/Game2048.vue / GameMemory.vue / GameKlotski.vue / GameMatch3.vue`：四款游戏，各自维护局内状态，通过 `@score` / `@gameover` 上报外壳；`defineExpose({reset})` 备用。
  - `lib/2048-core.ts`：棋盘移动/合并纯函数（四方向、每子单步只合并一次、可移动判定、终局）。
  - `lib/match3-core.ts`：三消纯函数（初始无三连生成、相邻判定、交换、横纵标记、消除-下落-补充、连锁加权）。
  - `lib/storage.ts`：`loadState/saveBest/persistState`，1.5s 防抖 + 卸载前补写，IndexedDB 失败静默降级内存。
- 2048 输入：键盘（方向键/WASD）、屏幕方向键、触摸滑动（阈值 24px，`touch-action:none`）。
- 华容道初始局面由「已解局面执行数百次随机合法步」生成，**数学上保证可还原**，不会出现无解死局。
- 三消交换前先用克隆棋盘预判是否成三连，非法交换不改盘并提示；无可走步时自动 `createGrid` 洗牌。
- 变现钩子（接好一个主方案）：`billing.isOwned('freemium-pro'||'buyout')` 判定，锁定游戏渲染付费墙，`billing.buy('freemium-pro')` 走统一下单；订阅/用量/分成等其余模式属框架已具备能力，本工具不额外配置。

## 踩坑记录

1. **freemium 权限判定要按 feature 归属**：未传 featureKey 时 `canUse()` 默认放行，因此外壳没有用 feature 粒度，而是用 `isOwned('freemium-pro'||'buyout')` 明确判定「是否已拥有专业版」来决定锁定游戏，避免误放行。
2. **切难度/重开必须重建游戏组件**：初版仅改响应式数组，翻牌计时器与三消 busy 锁可能跨局残留；改为在动态组件 `:key` 中带上 nonce/难度，配合 `onBeforeUnmount` 清理 `setInterval`，每局都是全新生命周期。
3. **`noUncheckedIndexedAccess` 下数组下标可能 undefined**：三消模板里 `grid[r-1][c-1]` 直接下标类型报错，收敛为 `cellVal()` 访问器兜底；`GAMES[0]` 改为 `find(id==='2048')!`。
4. **三消「无解」处理**：8×8 随机盘偶尔会进入无有效交换局面，加了 `hasPossibleMove` 全表探测并自动洗牌，避免卡死。
5. **华容道可解性**：随机乱序排列有约一半概率不可解；改为从已解态做随机合法滑动，保证必有解且不回到已解。

## 验证覆盖

**质量门**

- `npx vue-tsc --noEmit`：0 错误。
- 单测：`node --import tsx --test test/*.test.ts` 全量 **203/203 通过**；其中新增 `test/games.test.ts` **13 条**（2048 四方向合并/单步只合并一次/终局/落子守恒/整局跑通；三消初始无三连/相邻判定/横向标记/消除补齐/非法交换不动盘）。
- `npm run build`：成功；`npm run verify:tools`：校验工具数 **20**，全部 manifest 与示例提问回归通过（新增示例「午休摸鱼想玩局几分钟的 2048 翻牌小游戏打发时间」首条命中 mini-games）。

**E2E（真实构建产物 preview，`scripts/e2e-mini-games-20261017.mjs`）：11/11 通过**

- 搜索首条命中并进入工具页；4 标签、2 个专业版带锁；2048 键盘合并计分>0；翻牌简单 12 张/困难 24 张、首张可翻开；华容道未解锁显示 ¥19.90 付费墙；本地模拟下单后华容道 8 块、三消 64 格、锁标消失；指导页有实质内容；Console 无未捕获错误。
- 三视口（PC 1280×800 / 平板 834×1112 / 手机 375×812）工具页横向溢出均为 0。
- 存量回归：`e2e-revamp-20261016.mjs` **21/21**、`e2e-lkb-hotfix-20261016.mjs` **6/6**。

**用户变量覆盖（≥90%）**

- 游戏：4 款全部跑通主流程；难度：翻牌 3 档、华容道 2 档均验证；输入：键盘、鼠标点击、触摸滑动三类；付费态：未解锁付费墙、下单解锁、锁标联动；持久化：IndexedDB 读取/更高分写回（含失败降级逻辑）。
- 多端：PC/平板/手机代表视口均验证无溢出、可触控。

**EdgeOne Pages 免费版限额核查**

- dist 总大小 **130 MiB**（限 5 GiB）；文件数 **112**（限 20000）；最大单文件为既有 `model_quantized.onnx` **22.9 MiB**（限 25 MiB，非本次新增）。
- 本工具产物 `assets/mini-games-*.js` 仅 **约 15.5 KiB**，纯 CSS/DOM，零图片/音频/wasm，远低于限额。

**截图有效性验证（真实构建后实拍，非占位/网图）**

| 截图文件 | 像素 | 大小 | 内容一致性 | 结论 |
| --- | --- | --- | --- | --- |
| pc-1-2048.png | 884×776 | 50,589 B | 2048 棋盘+分数 72+方向键 | 通过 |
| pc-2-memory.png | 884×655 | 54,937 B | 翻牌网格+步数/用时 | 通过 |
| pc-3-paywall.png | 884×604 | 68,786 B | 华容道付费墙+¥19.90 | 通过 |
| pc-4-klotski.png | 884×732 | 53,517 B | 3×3 华容道棋盘 | 通过 |
| pc-5-match3.png | 884×744 | 56,057 B | 8×8 三消棋盘 | 通过 |
| tablet-1-2048.png | 798×776 | 47,829 B | 平板自适应布局 | 通过 |
| mobile-1-2048.png | 354×857 | 41,753 B | 手机自适应布局 | 通过 |

均为 PNG、非 0 字节、可正常打开，与 guide 引用路径及文字一致。

## 可复用经验

- **离散格小游戏无需 Canvas**：2048/翻牌/华容道/三消用 CSS Grid + 状态数组即可，天然响应式、可访问、易测试；只有连续渲染/粒子才需要 rAF+Canvas。
- **纯逻辑内核与渲染分离**：把移动、合并、匹配、结算写成无 DOM 纯函数并注入 `rng`，毫秒级单测即可覆盖易错规则（如「每子单步只合并一次」「连锁加权」），不必等浏览器。
- **可解局面从已解态随机合法步生成**，比随机排列+逆序数判定更简单稳妥。
- **工具级 freemium** 用 `useToolBilling().isOwned('freemium-pro')` + manifest.features 表达即可，无需为每个游戏写支付链路。
