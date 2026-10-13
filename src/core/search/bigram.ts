/**
 * 中英文混合分词：中文 2-gram（bigram）+ 拉丁/数字整词 + 中文单字回退。
 * 无外部依赖，可在浏览器 / Node / Worker 中运行，同时供可复用模块分发。
 */

const CJK_RE = /[㐀-䶿一-鿿豈-﫿぀-ヿ가-힯]/

/** 全角字符转半角、统一小写、去除冗余标点空白 */
export function normalize(input: string): string {
  if (!input) return ''
  let out = ''
  for (const ch of input) {
    const code = ch.codePointAt(0)!
    if (code === 0x3000) {
      out += ' '
    } else if (code >= 0xff01 && code <= 0xff5e) {
      out += String.fromCodePoint(code - 0xfee0)
    } else {
      out += ch
    }
  }
  return out
    .toLowerCase()
    .replace(/[\s\u00a0]+/g, ' ')
    .trim()
}

function isCJK(ch: string): boolean {
  return CJK_RE.test(ch)
}

function isAlnum(ch: string): boolean {
  return /[a-z0-9]/.test(ch)
}

export interface TokenizeOptions {
  /** 是否生成中文单字（短查询回退），默认 true */
  unigram?: boolean
}

/**
 * 分词：
 * - 连续 CJK 片段：相邻两字组成 bigram（如 “年终奖税” -> 年终 终奖 奖税），并附加单字
 * - 连续 a-z0-9 片段：整词（json2csv 不拆）
 * - 其余标点空白作为分隔
 */
export function tokenize(input: string, options: TokenizeOptions = {}): string[] {
  const { unigram = true } = options
  const text = normalize(input)
  if (!text) return []

  const tokens: string[] = []
  const chars = Array.from(text)
  let latinBuf = ''

  const flushLatin = () => {
    if (latinBuf) {
      tokens.push(latinBuf)
      latinBuf = ''
    }
  }

  let cjkBuf = ''
  const flushCJK = () => {
    if (!cjkBuf) return
    const run = Array.from(cjkBuf)
    if (run.length === 1) {
      tokens.push(run[0]!)
    } else {
      if (unigram) tokens.push(...run)
      for (let i = 0; i < run.length - 1; i++) {
        tokens.push(run[i]! + run[i + 1]!)
      }
    }
    cjkBuf = ''
  }

  for (const ch of chars) {
    if (isCJK(ch)) {
      flushLatin()
      cjkBuf += ch
    } else if (isAlnum(ch)) {
      flushCJK()
      latinBuf += ch
    } else {
      flushLatin()
      flushCJK()
    }
  }
  flushLatin()
  flushCJK()

  return tokens
}

/** 查询用分词：去重后的 token 集合（保持顺序） */
export function queryTokens(input: string): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const t of tokenize(input)) {
    if (!seen.has(t)) {
      seen.add(t)
      ordered.push(t)
    }
  }
  return ordered
}
