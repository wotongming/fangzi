# recurring-detect（通用周期性扣费/订阅识别）

零依赖纯函数。输入标准化支出，按“同名商户 + 近似金额 + 近似周期”聚类，输出月/季/半年/年订阅。

## API

- `normalizeMerchant(raw): string`：去 emoji、括号备注（自动续费/会员续费等）、尾号、长单号、续费词与空白，输出品牌主体（小写）。
- `detectRecurring(rows, opts?): RecurringGroup[]`
  - 输入：`{ id, time(epoch ms), merchantNorm, amountCents }[]`
  - opts：`minCount=2`、`priceTolRatio=0.12`、`priceTolAbs=500`(5 元)、`maxCv=0.25`
  - 输出含：cadence、periodDays、avgGapDays、cv、priceCents、min/max、count、firstAt/lastAt、nextAt、annualCents、totalCents、ids。
- `median(nums)`、`CADENCE_INFO`（周期天数区间与中文标签）。

## 判定口径

- 金额先归桶（容差取 `max(5 元, 参考价×12%)`），吸收零头与小幅涨价；
- 桶内按时间求相邻间隔，间隔中位数落在 26–35 / 85–98 / 170–200 / 340–392 天判月/季/半年/年；
- 间隔变异系数 CV ≤ 0.25 才算规律，避免把偶发同额消费误判为订阅。

## 使用示例

```ts
import { detectRecurring, normalizeMerchant } from './recurring-detect'
const groups = detectRecurring(expenses.map(e => ({ id: e.id, time: e.time, amountCents: e.c, merchantNorm: normalizeMerchant(e.name) })))
```

业务侧的“展示名、平台、类别、闲置/重复/涨价标注、人工纠正”在工具层（如 subscription-audit 的 `lib/subscriptions.ts`）实现，本模块只做稳定的聚类内核。
