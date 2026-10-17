/**
 * 方子 —— 全局领域类型定义
 * 所有工具、计费、检索模块均基于此处的类型契约扩展。
 */

/** 工具大类：网页内可直接使用的功能页 / 插件（跳转使用手册 + 下载） */
export type ToolType = 'web' | 'plugin'

/** 工具分类，用于首页分区与浏览 */
export type ToolCategory = 'life' | 'work' | 'compliance' | 'developer' | 'security'

/** 计费模式 */
export type BillingMode =
  | 'free' // 完全免费
  | 'buyout' // 一次性买断
  | 'freemium' // 基础免费，高级功能付费
  | 'usage' // 按次 / 按量计费

/** 插件平台 */
export type PluginPlatform =
  | 'browser-chromium' // Chrome / Edge / Brave 等 Chromium 浏览器
  | 'browser-firefox'
  | 'vscode'
  | 'idea' // JetBrains IDEA 系列

/** 计费方案声明：每个工具在 manifest 中声明自身规则，由全局计费框架解释 */
export interface BillingPlan {
  mode: BillingMode
  /** 币种，默认人民币 CNY */
  currency?: 'CNY' | 'USD'
  /** buyout：一次性买断价格（单位：分）。如 990 = 9.9 元 */
  priceCents?: number
  /** usage：每次调用价格（单位：分），与 unit 搭配 */
  pricePerUnitCents?: number
  /** usage：计量单位描述，如 “次”、“1000 Token” */
  unit?: string
  /** usage：每周期免费额度（单位同 unit），默认 0 */
  freeQuotaPerCycle?: number
  /** 用量周期重置方式：day / month / never，默认 month */
  quotaCycle?: 'day' | 'month' | 'never'
  /** freemium：功能权益清单（用于前端展示与权限判定） */
  features?: BillingFeature[]
  /** 买断之外的补充变现（订阅制 / 用量包 / 平台分成），可选扩展，不影响既有判定 */
  subscription?: {
    /** 月度订阅价（分） */
    priceCentsPerMonth?: number
    /** 年度订阅价（分） */
    priceCentsPerYear?: number
  }
  usagePack?: {
    /** 每单位用量包价格（分） */
    priceCentsPerUnit?: number
    /** 计量单位描述，如「次」「张」 */
    unit?: string
    /** 每日免费额度（单位同 unit） */
    freePerDay?: number
  }
  platformSplit?: {
    enabled: boolean
    /** 分销/平台分成比例（百分比，0-100） */
    partnerRatePct?: number
    /** 分成说明文案 */
    note?: string
  }
}

export interface BillingFeature {
  /** 功能标识，工具内部用 hasFeature(key) 判定 */
  key: string
  label: string
  /** 是否属于免费层（freemium 下 false 表示高级付费功能） */
  free: boolean
}

/** 插件分发元信息 */
export interface PluginPackage {
  platform: PluginPlatform
  /** 压缩包相对 public 的路径，如 /plugins/example-extension/chrome-v0.1.0.zip */
  packageUrl: string
  /** 压缩包 sha256（小写 hex），用于下载完整性校验；缺失则跳过校验并告警 */
  sha256?: string
  /** 包字节大小，展示用 */
  sizeBytes?: number
  /** 插件自身版本 */
  version: string
  /** 宿主最低版本说明 */
  minHostVersion?: string
}

/** 工具清单：新增工具时唯一需要填写的契约 */
export interface ToolManifest {
  /** 唯一标识，kebab-case，同时是工具目录名与路由 slug */
  id: string
  /** 工具名称 */
  name: string
  /** 一句话简介 */
  tagline: string
  /** 工具分类 */
  category: ToolCategory
  /** 工具类型 */
  type: ToolType
  /** 目标用户（用于检索与展示） */
  targetUsers: string[]
  /** 使用场景（具体句式，参与检索） */
  scenarios: string[]
  /** 解决了什么痛点 */
  painPoints: string[]
  /** 检索关键词（含同义词、口语化说法，质量直接决定命中率） */
  keywords: string[]
  /** 计费规则 */
  billing: BillingPlan
  /** 首次上线日期 YYYY-MM-DD（决定“最新工具”排序） */
  createdAt: string
  /** 最近更新日期 YYYY-MM-DD（README 与详情页展示） */
  updatedAt: string
  /** 语义化版本 */
  version: string
  /** 成熟度 */
  status?: 'stable' | 'beta'
  /** 插件类工具：分发信息；可支持多平台多包 */
  plugins?: PluginPackage[]
  /** 强沉浸工具：网页工具页提供「全屏」入口，进入后隐藏应用外壳并铺满安全区（默认 false） */
  immersive?: boolean
  /** 作者，可选 */
  author?: string
}

/** 检索引擎使用的扁平文档（由 manifest 派生） */
export interface SearchDocument {
  id: string
  name: string
  tagline: string
  category: ToolCategory
  type: ToolType
  targetUsers: string[]
  scenarios: string[]
  painPoints: string[]
  keywords: string[]
  updatedAt: string
}

/** 单条检索结果 */
export interface SearchHit {
  doc: SearchDocument
  /** 融合后的最终得分，0~1 */
  score: number
  /** 各通道原始得分，便于调试与解释 */
  scores: {
    keyword: number
    vector: number | null
  }
  /** 命中片段（字段名 -> 已高亮片段） */
  highlights: SearchHighlight[]
}

export interface SearchHighlight {
  field: 'name' | 'tagline' | 'scenarios' | 'painPoints' | 'keywords' | 'targetUsers'
  snippet: string
}

/** AI / 向量检索配置（运行时可在设置页配置，持久化在本地） */
export interface AiSearchConfig {
  /** OpenAI 兼容接口基础地址，如 https://api.openai.com/v1 */
  baseUrl: string
  /** 嵌入模型名称，如 text-embedding-3-small / bge-m3 等 */
  model: string
  apiKey: string
  /** 自定义 embeddings 路径，默认 /embeddings */
  embeddingsPath?: string
}

export function isAiConfigured(cfg: Partial<AiSearchConfig> | null | undefined): boolean {
  return Boolean(cfg && cfg.baseUrl && cfg.model && cfg.apiKey)
}

/** 用户需求反馈条目 */
export interface FeedbackRequest {
  content: string
  context?: {
    query?: string
    ua?: string
    lang?: string
  }
  createdAt: string
}
