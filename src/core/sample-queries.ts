/**
 * 首页随机浮动的常见提问（范式库）。
 * 强约束：每条都必须能命中 expectToolId 指向的工具——
 * scripts/verify-tools.mjs 会用真实搜索引擎回归校验，不通过则构建失败。
 * 提问采用“说人话”的口语范式，每类范式可代表一批相似场景。
 */
export interface SampleQuery {
  text: string
  expectToolId: string
}

export const SAMPLE_QUERIES: SampleQuery[] = [
  { text: '年终奖发了 3 万，单独计税还是并入工资更划算？', expectToolId: 'year-bonus-tax' },
  { text: '被公司裁员，N+1 赔偿到底怎么算？', expectToolId: 'severance-pay' },
  { text: '国庆加班 7 天，加班费能拿多少？', expectToolId: 'overtime-pay' },
  { text: '帮我测一下这个正则能不能匹配手机号', expectToolId: 'regex-tester' },
  { text: 'JSON 乱成一团，怎么快速格式化校验？', expectToolId: 'json-formatter' },
  { text: '上万行名单怎么批量去重和编号？', expectToolId: 'batch-text-processor' },
  { text: '1728000000 这个时间戳对应几号？', expectToolId: 'timestamp-convert' },
  { text: '下载的文件怎么验证 SHA256 有没有被篡改？', expectToolId: 'file-hash-check' },
  { text: '想生成一个又长又安全的随机密码', expectToolId: 'password-generator' },
  { text: '照片太大，怎么在本地转成 WebP 压缩？', expectToolId: 'image-converter' },
  { text: '网页上看到的问题想右键直接在方子里搜', expectToolId: 'fangzi-companion' },
  { text: '微信支付宝花的钱太散，想记个家庭账本看看钱花哪了', expectToolId: 'household-finance' }
]

/** 随机抽取 n 条（使用 Fisher–Yates 部分洗牌，不修改原数组） */
export function pickRandomSamples(n: number): SampleQuery[] {
  const arr = [...SAMPLE_QUERIES]
  const count = Math.min(n, arr.length)
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j]!, arr[i]!]
  }
  return arr.slice(0, count)
}
