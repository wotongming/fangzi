/**
 * 中国网购常见时效规则包（确定性、版本化、可编辑）。
 * 仅为常见规则参考，每条都带法规/规则来源与例外说明；
 * 具体以最新法律法规、平台规则与三包/保修凭证为准，不替代律师或 12315 认定。
 */
import type { Category } from './models'

export const RULE_VERSION = 'cn-2026-10-18'

export interface CategoryRule {
  label: string
  /** 是否适用「部分商品三包」中常见的 7 日退 / 15 日换（性能故障） */
  triplePack15: boolean
  /** 常见整机保修期（月）。0 表示无统一法定月数，以商家承诺/三包凭证为准 */
  warrantyMonths: number
}

export const CATEGORY_RULES: Record<Category, CategoryRule> = {
  digital: { label: '数码 3C / 小家电', triplePack15: true, warrantyMonths: 12 },
  appliance: { label: '大家电 / 厨卫电器', triplePack15: true, warrantyMonths: 12 },
  computer: { label: '电脑 / 微型计算机', triplePack15: true, warrantyMonths: 12 },
  furniture: { label: '家具 / 家装大件', triplePack15: false, warrantyMonths: 12 },
  clothing: { label: '服饰 / 鞋包 / 日用', triplePack15: false, warrantyMonths: 0 },
  general: { label: '一般商品 / 其它', triplePack15: false, warrantyMonths: 0 }
}

export const CATEGORY_ORDER: Category[] = ['digital', 'appliance', 'computer', 'furniture', 'clothing', 'general']

export const NOREASON_DAYS = 7

export const SOURCES = {
  noReason: '《消费者权益保护法》第二十五条（网络等远程购物七日无理由退货）',
  quality: '《消费者权益保护法》第二十四条（商品质量问题修换退，不受七日无理由期限限制）',
  triplePack: '相关商品“三包”规定（如《部分商品修理更换退货责任规定》及微型计算机、家电等三包规定）',
  warranty: '三包规定及厂家三包凭证 / 保修卡承诺',
  price: '各电商平台“价格保护”规则（非全国统一法定期限，以订单页规则为准）'
}

export const NOREASON_EXCEPTIONS =
  '定作、鲜活易腐、在线下载或拆封的音像制品/计算机软件、交付的报纸期刊等不适用七日无理由；其他商品退货时应保持“完好”，但「拆封」不等于必然「不完好」，商家不能仅以已拆封为由拒绝。'

export const DISCLAIMER =
  '本工具的时效与规则为常见情形的参考整理，标注了规则版本与来源；具体时限、三包与保修以最新法律法规、平台规则及三包凭证/保修卡为准，不替代律师意见或 12315、市场监管部门的正式认定。'
