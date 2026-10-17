# bill-csv（通用账单/表格 CSV 读取）

零依赖纯函数，浏览器与 Node 均可运行。为“导入官方导出的中文账单/表格 CSV”类工具提供统一底座。

## API

- `decodeText(buf: ArrayBuffer): { text, encoding }`：UTF-8（含 BOM）优先，检测到替换字符时回退 GBK（微信/支付宝账单常见）。
- `parseCsv(text: string): string[][]`：RFC4180 状态机解析，支持引号包裹、引号内逗号/换行、`""` 转义、`\r\n`；自动剔除全空白行。
- `yuanToCents(raw: string): number | null`：去除 `¥ ￥ , 空格` 后转整数分（避免浮点误差），非法返回 null。
- `parseFlexibleDate(raw: string): number | null`：兼容 `YYYY-MM-DD HH:mm:ss`、`YYYY/M/D`、`YYYY.MM.DD`、`YYYYMMDD HH:mm` 等，返回 epoch ms（以 UTC 承载“浮动本地时间”）。
- `findColumn(header, candidates): number`：按“精确→包含”匹配候选列名（自动忽略空白与中英文括号/冒号差异），未找到返回 -1。

## 使用示例

```ts
import { decodeText, parseCsv, findColumn, yuanToCents, parseFlexibleDate } from './bill-csv'
const { text } = decodeText(await file.arrayBuffer())
const rows = parseCsv(text)
const iAmt = findColumn(rows[0], ['金额(元)', '金额'])
```

许可：内部模块，随方子以 MIT 方式使用；无第三方依赖。
