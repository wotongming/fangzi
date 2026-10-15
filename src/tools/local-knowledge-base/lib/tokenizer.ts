/**
 * 最小 BERT WordPiece 分词器（为 bge-small-zh-v1.5 定制，但适用于中文 BERT 词表）。
 * 不依赖 transformers.js：仅需模型仓的 vocab.txt，配合 onnxruntime-web 直接推理。
 *
 * 处理：小写 → 去重音 → 空白归一化 → 标点切分 → CJK 按字切分 → WordPiece 最长匹配（## 续接）。
 * bge-small-zh-v1.5: do_lower_case=true，CLS=101，SEP=102，PAD=0，UNK=100，max_len=512。
 */

export interface Encoded {
  inputIds: Int32Array
  attentionMask: Int32Array
  tokenTypeIds: Int32Array
  tokens: string[]
}

const PAD = 0
const UNK = 100
const UNK_TOKEN = '[UNK]'
const MAX_INPUT_CHARS = 100

export class BertTokenizer {
  private vocab: Map<string, number>
  readonly unkId: number

  constructor(vocabText: string) {
    this.vocab = new Map()
    const lines = vocabText.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i]!.trim()
      if (t) this.vocab.set(t, i)
    }
    const unk = this.vocab.get(UNK_TOKEN)
    this.unkId = unk ?? UNK
  }

  get size(): number {
    return this.vocab.size
  }

  tokenId(token: string): number | undefined {
    return this.vocab.get(token)
  }

  /** 基本清洗：空白归一化、小写、去重音 */
  private cleanText(text: string): string {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
  }

  private isControl(ch: string): boolean {
    const c = ch.codePointAt(0)!
    return c === 0 || c === 0xfffd || (c >= 0x00 && c <= 0x1f) || (c >= 0x7f && c <= 0x9f)
  }

  private isPunctuation(ch: string): boolean {
    const c = ch.codePointAt(0)!
    // 中英文常见标点：ASCII 标点区间 + Unicode 标点类别（Pd/Ps/Pe/Pi/Pf/Pc/Po 常见码位）
    return (
      (c >= 33 && c <= 47) ||
      (c >= 58 && c <= 64) ||
      (c >= 91 && c <= 96) ||
      (c >= 123 && c <= 126) ||
      (c >= 0x2000 && c <= 0x206f) ||
      (c >= 0x3000 && c <= 0x303f) ||
      (c >= 0xff00 && c <= 0xffef)
    )
  }

  /** CJK 统一表意文字区间（BERT basic tokenizer 的 is_chinese 判定） */
  private isChinese(ch: string): boolean {
    const c = ch.codePointAt(0)!
    return (
      (c >= 0x4e00 && c <= 0x9fff) ||
      (c >= 0x3400 && c <= 0x4dbf) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0x20000 && c <= 0x2a6df) ||
      (c >= 0x2a700 && c <= 0x2b73f) ||
      (c >= 0x2b740 && c <= 0x2b81f) ||
      (c >= 0x2b820 && c <= 0x2ceaf)
    )
  }

  /** whitespace → 标点/CJK 两侧加空格 → split */
  basicTokenize(text: string): string[] {
    const cleaned = this.cleanText(text)
    const spaced: string[] = []
    for (const ch of cleaned) {
      if (ch === ' ' || this.isControl(ch)) {
        spaced.push(' ')
      } else if (this.isPunctuation(ch) || this.isChinese(ch)) {
        spaced.push(' ', ch, ' ')
      } else {
        spaced.push(ch)
      }
    }
    return spaced.join('').split(' ').filter(Boolean)
  }

  /** 单词 → WordPiece 子词（## 前缀续接，贪心最长匹配） */
  wordpiece(token: string): string[] {
    if (token.length > MAX_INPUT_CHARS) return [UNK_TOKEN]
    const subTokens: string[] = []
    let start = 0
    while (start < token.length) {
      let end = token.length
      let matched: string | null = null
      while (start < end) {
        const substr = start === 0 ? token.slice(start, end) : '##' + token.slice(start, end)
        if (this.vocab.has(substr)) {
          matched = substr
          break
        }
        end--
      }
      if (matched === null) return [UNK_TOKEN]
      subTokens.push(matched)
      start = end
    }
    return subTokens
  }

  encode(text: string, maxLen = 512): Encoded {
    const pieces: string[] = []
    for (const basic of this.basicTokenize(text)) {
      for (const sub of this.wordpiece(basic)) pieces.push(sub)
    }
    // 截断：为 <[BOS_never_used_51bce0c785ca2f68081bfa7d91973934]>/[SEP] 留 2 个位置（长文按头部截断，分块已控制长度，一般不触发）
    const cap = maxLen - 2
    const kept = pieces.length > cap ? pieces.slice(0, cap) : pieces
    const tokens = ['<[BOS_never_used_51bce0c785ca2f68081bfa7d91973934]>', ...kept, '[SEP]']
    const ids = tokens.map((t) => this.vocab.get(t) ?? this.unkId)
    const n = ids.length
    return {
      inputIds: Int32Array.from(ids),
      attentionMask: new Int32Array(n).fill(1),
      tokenTypeIds: new Int32Array(n).fill(0),
      tokens
    }
  }
}

/** 把一个 batch 的编码 pad 到同长，返回 ort 所需的三个 Int32Array */
export function padBatch(encoded: Encoded[]): {
  inputIds: Int32Array
  attentionMask: Int32Array
  tokenTypeIds: Int32Array
  dims: [number, number]
} {
  const b = encoded.length
  const maxLen = Math.max(...encoded.map((e) => e.inputIds.length))
  const inputIds = new Int32Array(b * maxLen).fill(PAD)
  const attentionMask = new Int32Array(b * maxLen)
  const tokenTypeIds = new Int32Array(b * maxLen)
  encoded.forEach((e, i) => {
    inputIds.set(e.inputIds, i * maxLen)
    attentionMask.set(e.attentionMask, i * maxLen)
    tokenTypeIds.set(e.tokenTypeIds, i * maxLen)
  })
  return { inputIds, attentionMask, tokenTypeIds, dims: [b, maxLen] }
}
