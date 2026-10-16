/**
 * 文本归一与特征抽取（纯函数、离线、零模型依赖）。
 * - 中英归一（全角转半角、小写、去多余空白）
 * - 段落/条款切分
 * - 技能词典归并、软硬技能抽取、职责/素质词项（英文词 + 中文二元 gram）
 * - 硬门槛原始信号抽取（学历 / 年限 / 地点 / 证书）
 */
import {
  CERTS,
  CITY_HINTS,
  DEGREE_LEVELS,
  DUTY_VERBS,
  SKILLS,
  SOFT_SKILLS,
  STOPWORDS
} from '../data/skills'

/** 全角转半角 + 小写 + 折叠空白；保留中英文与数字 */
export function normalizeLoose(input: string): string {
  let s = input.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
  s = s.replace(/\u3000/g, ' ')
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

/** 判断别名是否在文本中出现：拉丁词要求边界，中文直接包含 */
export function aliasHit(haystack: string, alias: string): boolean {
  const a = alias.toLowerCase()
  if (/^[a-z0-9.+# -]+$/.test(a) && /[a-z0-9]/.test(a)) {
    const escaped = a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(^|[^a-z0-9])${escaped}(?![a-z0-9])`).test(haystack)
  }
  return haystack.includes(a)
}

/** 抽取命中的硬技能 canonical 列表（保持词典顺序、去重） */
export function extractSkills(input: string): string[] {
  return extractSkillEvidence(input).map((e) => e.canonical)
}

export interface SkillEvidence {
  canonical: string
  /** 是否写出了标准名（canonical 按词边界出现） */
  exact: boolean
  /** exact=false 时，简历中实际命中的别名写法 */
  matchedAlias?: string
}

/**
 * 抽取硬技能命中证据，区分：
 *  - exact=true：写出了标准名（ATS 关键词可直接命中）
 *  - exact=false：只出现了同义词/版本别名（能力具备，但建议显式补标准名）
 */
export function extractSkillEvidence(input: string): SkillEvidence[] {
  const text = normalizeLoose(input)
  const out: SkillEvidence[] = []
  for (const entry of SKILLS) {
    if (aliasHit(text, entry.canonical)) {
      out.push({ canonical: entry.canonical, exact: true })
      continue
    }
    const via = entry.synonyms.find((s) => aliasHit(text, s))
    if (via) out.push({ canonical: entry.canonical, exact: false, matchedAlias: via })
  }
  return out
}

export function extractSoftSkills(input: string): string[] {
  const text = normalizeLoose(input)
  const hit: string[] = []
  for (const s of SOFT_SKILLS) {
    if (aliasHit(text, s)) hit.push(s)
  }
  return Array.from(new Set(hit))
}

/** 切分段落（按空行/换行/列表符号），并进一步按句读切条款 */
export function splitParagraphs(input: string): string[] {
  return input
    .split(/\r?\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .flatMap((line) => line.split(/[；;]/).map((s) => s.trim()))
    .map((s) => s.replace(/^[\s•·●◆◇▪▫\-–—*|\d.、()（）]+/, '').trim())
    .filter((s) => s.length >= 2)
}

/** JD 条款切分：换行 + 中英文分号/句号 + 列表编号 */
export function splitClauses(input: string): string[] {
  return input
    .split(/\r?\n+/)
    .flatMap((line) => line.split(/[；;。\n]+/))
    .map((s) => s.replace(/^\s*(?:[•·●◆◇▪▫\-–—*|]|\d+[.、)]|[（(]\d+[)）])\s*/, '').trim())
    .filter((s) => s.length >= 2)
}

/** 词项集合：英文词（>=3 字母）+ 中文二元 gram，过滤停用词 */
export function contentTerms(input: string): Set<string> {
  const text = normalizeLoose(input)
  const out = new Set<string>()
  // 英文/数字词
  for (const w of text.match(/[a-z][a-z0-9+#.]{2,}/g) ?? []) {
    if (!STOPWORDS.has(w) && w.length >= 3) out.add(w)
  }
  // 中文连续段 → 二元 gram
  for (const run of text.match(/[\u4e00-\u9fa5]{2,}/g) ?? []) {
    for (let i = 0; i < run.length - 1; i++) {
      const bg = run.slice(i, i + 2)
      if (!STOPWORDS.has(bg)) out.add(bg)
    }
    if (run.length === 2 && !STOPWORDS.has(run)) out.add(run)
  }
  return out
}

export function isDutyClause(clause: string): boolean {
  const text = normalizeLoose(clause)
  return DUTY_VERBS.some((v) => text.includes(v.toLowerCase()))
}

/* ---------------- 硬门槛信号 ---------------- */

export function degreeRequired(input: string): { canonical: string; level: number } | null {
  const text = normalizeLoose(input)
  let found: { canonical: string; level: number } | null = null
  for (const d of DEGREE_LEVELS) {
    if (d.patterns.some((p) => text.includes(p.toLowerCase()))) {
      if (!found || d.level > found.level) found = { canonical: d.canonical, level: d.level }
    }
  }
  return found
}

export function degreeHeld(input: string): { canonical: string; level: number } | null {
  // 简历中通常直接写“XX大学 本科/硕士”，同样取最高学历
  return degreeRequired(input)
}

export function yearsRequired(input: string): number | null {
  const text = normalizeLoose(input)
  // “X年[以上]…经验”，允许中间夹若干修饰字（如“相关工作/前端开发”），但不跨标点
  const patterns = [
    /(\d+)\s*年(?:以上|及以上|\+)?[^。；;，,\n]{0,10}?经验/,
    /经验\s*(?:不少于|≥|>=|至少)?\s*(\d+)\s*年/
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m) return Number(m[1])
  }
  return null
}

/** 从简历中粗略估计工作年限：取“X年…经验/工作 X 年”最大数值 */
export function yearsHeld(input: string): number | null {
  const text = normalizeLoose(input)
  const nums: number[] = []
  for (const re of [/(\d{1,2})\s*年(?:以上)?[^。；;，,\n]{0,10}?经验/g, /工作\s*(\d{1,2})\s*年/g]) {
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) nums.push(Number(m[1]))
  }
  return nums.length ? Math.max(...nums) : null
}

export function citiesMentioned(input: string): string[] {
  return CITY_HINTS.filter((c) => normalizeLoose(input).includes(c.toLowerCase()))
}

export function certsMentioned(input: string): string[] {
  const text = normalizeLoose(input)
  return CERTS.filter((c) => text.includes(c.toLowerCase()))
}
