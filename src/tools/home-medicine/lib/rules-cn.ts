/**
 * home-medicine —— 保守的用药安全规则库（确定性、可解释、宁少勿错）。
 *
 * 严格边界：这里只收录说明书层面、公开科普中长期稳定的少数常见风险，
 * 命中一律提示“请咨询医生或药师”，不做个体化剂量建议、不诊断、不评判处方。
 * 规则版本化，更新须保守可溯源（见 SOURCES），拿不准的组合宁可不收录。
 */

export const RULE_VERSION = 'cn-2026-10'

/** 公开科普/权威来源（仅标注名称，供用户进一步核对，不替代医嘱） */
export const SOURCES = {
  health: '北京市卫生健康委员会《老年人多重用药，这些“药”害需警惕》（2026-06）',
  label: '药品说明书与国家基本用药常识（具体成分与剂量以所购药品说明书为准）'
} as const

export interface IngredientDef {
  /** 通用/常见名称 */
  name: string
  /** 所属分组 key，用于“同类叠加”检测 */
  groups: IngredientGroup[]
  /** 便于录入的别名（如商品名俗称） */
  aliases?: string[]
}

export type IngredientGroup =
  | 'acetaminophen' // 含对乙酰氨基酚（复方感冒药/退烧药）
  | 'nsaid' // 非甾体抗炎药（布洛芬等，不含作为抗血小板用途的小剂量阿司匹林）
  | 'anticoag' // 抗凝/抗血小板
  | 'acei' // 普利类降压
  | 'arb' // 沙坦类降压
  | 'statin' // 他汀类调脂

export const INGREDIENT_LABEL: Record<IngredientGroup, string> = {
  acetaminophen: '对乙酰氨基酚（扑热息痛）',
  nsaid: '非甾体抗炎药（布洛芬等）',
  anticoag: '抗凝/抗血小板药',
  acei: '普利类降压药（ACEI）',
  arb: '沙坦类降压药（ARB）',
  statin: '他汀类调脂药'
}

/**
 * 成分字典：key 为稳定标识。录入时用户勾选药品“含哪些已知成分”，
 * 只有明确命中才参与规则判断，避免凭空误报。
 */
export const INGREDIENTS: Record<string, IngredientDef> = {
  acetaminophen: { name: '对乙酰氨基酚（扑热息痛）', groups: ['acetaminophen'], aliases: ['泰诺', '必理通', '很多复方感冒药/退烧药'] },
  ibuprofen: { name: '布洛芬', groups: ['nsaid'], aliases: ['芬必得'] },
  diclofenac: { name: '双氯芬酸', groups: ['nsaid'], aliases: ['扶他林'] },
  naproxen: { name: '萘普生', groups: ['nsaid'] },
  warfarin: { name: '华法林', groups: ['anticoag'] },
  rivaroxaban: { name: '利伐沙班', groups: ['anticoag'] },
  apixaban: { name: '阿哌沙班', groups: ['anticoag'] },
  clopidogrel: { name: '氯吡格雷', groups: ['anticoag'], aliases: ['波立维'] },
  aspirin: { name: '阿司匹林（多为小剂量抗血小板）', groups: ['anticoag'] },
  acei: { name: '“普利”类降压药（如依那普利、贝那普利）', groups: ['acei'] },
  arb: { name: '“沙坦”类降压药（如缬沙坦、厄贝沙坦）', groups: ['arb'] },
  statin: { name: '他汀类调脂药（如阿托伐他汀）', groups: ['statin'] }
}

export const INGREDIENT_KEYS = Object.keys(INGREDIENTS)

/** 同组成分叠加的提示（保守，仅对有明确叠加顾虑的组给非空文案） */
export const GROUP_DUPLICATE: Partial<
  Record<IngredientGroup, { level: 'danger' | 'warn'; title: string; advice: string; source: string }>
> = {
  acetaminophen: {
    level: 'danger',
    title: '疑似多种药同含对乙酰氨基酚',
    advice: '多种感冒药/退烧药叠加可能造成对乙酰氨基酚过量、增加肝损伤风险。请核对各药说明书成分与每日最大剂量，不要自行叠加，建议咨询医生或药师。',
    source: SOURCES.label
  },
  nsaid: {
    level: 'warn',
    title: '疑似同时使用多种非甾体抗炎药',
    advice: '布洛芬、双氯芬酸、萘普生等同属一类，叠加会增加胃肠与肾脏不良反应风险，通常不应自行同用，建议咨询医生或药师。',
    source: SOURCES.health
  },
  acei: {
    level: 'warn',
    title: '疑似同时使用两种“普利”类降压药',
    advice: '两种同类降压药一般不是常规联用方式，可能造成重复用药。请带上药盒请医生或药师核对。',
    source: SOURCES.health
  }
}

export interface RiskRule {
  /** 需要同时出现的两个组 */
  a: IngredientGroup
  b: IngredientGroup
  level: 'danger' | 'warn'
  title: string
  advice: string
  source: string
}

/** 高风险跨组组合（保守收录少数公开科普明确的常见组合） */
export const HIGH_RISK_RULES: RiskRule[] = [
  {
    a: 'anticoag',
    b: 'nsaid',
    level: 'danger',
    title: '抗凝/抗血小板药 + 布洛芬等非甾体抗炎药',
    advice: '华法林、利伐沙班、氯吡格雷、小剂量阿司匹林等与布洛芬、双氯芬酸、萘普生素同用，可能明显增加出血（尤其胃肠出血）风险。不要自行加用止痛药，如需止痛退热请先咨询医生或药师。',
    source: SOURCES.health
  },
  {
    a: 'acei',
    b: 'arb',
    level: 'warn',
    title: '“普利”类与“沙坦”类降压药',
    advice: '普利类与沙坦类是否联用、如何联用需由医生根据病情决定，自行联用可能影响血压与肾功能。请遵医嘱并请药师复核。',
    source: SOURCES.health
  }
]

/** 剂型开封后的默认可用天数（无特殊说明时的保守值）；0/缺省表示不做开封倒计时 */
export const DEFAULT_OPEN_DAYS: Partial<Record<string, number>> = {
  eyeDrop: 28 // 滴眼液常规建议开封后 4 周内用完
}

/** 距有效期多少天进入“临期”预警 */
export const NEAR_EXPIRY_DAYS = 90
