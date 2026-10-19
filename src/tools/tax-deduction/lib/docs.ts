/**
 * tax-deduction —— 资料留存清单（按已填扣除项派生，留存 5 年备查）。
 */
import { KEEP_YEARS, ruleOf } from './rules-cn'
import type { DeductionItem, DeductionKind } from './models'

export interface DocRow {
  key: string
  kind: DeductionKind
  kindName: string
  docs: string[]
  keepUntilYear: number
}

/** 根据本年扣除项去重派生材料清单；同一类只列一次。 */
export function deriveChecklist(items: DeductionItem[], year: number): DocRow[] {
  const kinds: DeductionKind[] = []
  for (const it of items) {
    if (it.year === year && !kinds.includes(it.kind)) kinds.push(it.kind)
  }
  return kinds.map((kind) => ({
    key: `${year}:${kind}`,
    kind,
    kindName: ruleOf(kind).name,
    docs: ruleOf(kind).docs,
    keepUntilYear: year + KEEP_YEARS
  }))
}
