/**
 * parse.ts —— File → 标准化账单记录（Worker 与主线程回退共用同一份实现）。
 */
import { decodeText } from '../../../../reusable-module/bill-csv/bill-csv'
import { parseBillText, sniffPlatform, mergeRecords, type Platform, type TxRecord } from './platforms'

export interface FileParseOutcome {
  name: string
  platform: Platform
  account: string
  records: TxRecord[]
  unrecognized: boolean
}

/** 解析单个账单文件。account 为用户填写的账户标签（可空）。 */
export async function parseBillFile(file: File, account: string, force?: Platform): Promise<FileParseOutcome> {
  const buf = await file.arrayBuffer()
  const { text } = decodeText(buf)
  const acc = account.trim() || (sniffPlatform(text) === 'alipay' ? '支付宝账户' : '微信账户')
  const forced = force && force !== 'unknown' ? force : undefined
  const r = parseBillText(text, file.name, acc, forced)
  return { name: file.name, platform: r.platform, account: acc, records: r.records, unrecognized: r.unrecognized }
}

/** 解析多份并全局去重。 */
export function combine(outcomes: FileParseOutcome[]): { merged: TxRecord[]; outcomes: FileParseOutcome[] } {
  const merged = mergeRecords(outcomes.map((o) => o.records))
  return { merged, outcomes }
}
