/**
 * 维权文书 / 话术模板拼装（纯函数，可单测：无空占位符）。
 * 产出均为「用户自述草稿」，需用户核对后自行提交；不代为投诉。
 */
import { fmtYuan, type ClaimCase } from './models'
import { CATEGORY_RULES } from './rules-cn'

export type Scenario = 'quality' | 'wrong' | 'noReason' | 'beyondWarranty' | 'price'
export type LetterType = 'negotiate' | 'platform' | 'complain12315'

export const SCENARIOS: { key: Scenario; label: string; hint: string }[] = [
  { key: 'quality', label: '质量瑕疵 / 性能故障', hint: '商品本身有质量问题，要求修换退' },
  { key: 'wrong', label: '发错货 / 与描述不符', hint: '货不对板、发错型号、缺件' },
  { key: 'noReason', label: '仅不想要（7 日内）', hint: '无理由退货，商品完好' },
  { key: 'beyondWarranty', label: '过了 7 日但在三包/保修期', hint: '质量问题不受七日无理由限制' },
  { key: 'price', label: '价保 / 降价补差', hint: '价保期内降价，要求退差价' }
]

export const LETTER_TYPES: { key: LetterType; label: string }[] = [
  { key: 'negotiate', label: '与商家协商话术' },
  { key: 'platform', label: '平台介入说明' },
  { key: 'complain12315', label: '12315 投诉文本' }
]

function orDash(s?: string): string {
  const t = (s || '').trim()
  return t || '（未填）'
}

interface Ctx {
  c: ClaimCase
  scenario: Scenario
}

function facts(c: ClaimCase): string {
  const lines = [
    `商品名称：${orDash(c.product)}`,
    `购买渠道 / 店铺：${orDash(c.channel)}`,
    `订单编号：${orDash(c.orderNo)}`,
    c.amountCents != null ? `成交金额：${fmtYuan(c.amountCents)}` : '',
    `签收日期：${c.receivedDate}`,
    c.foundDate ? `发现问题日期：${c.foundDate}` : '',
    `商品类别：${CATEGORY_RULES[c.category].label}`
  ]
  return lines.filter(Boolean).join('\n')
}

function demand(scenario: Scenario): string {
  switch (scenario) {
    case 'quality':
      return '诉求：请依法履行售后责任，在查明属质量问题后为我办理退货退款（或免费修理/换货），并承担由此产生的运费等合理费用。'
    case 'wrong':
      return '诉求：请尽快按订单正确发货（或办理退货退款），错发/退回产生的运费由责任方承担。'
    case 'noReason':
      return '诉求：依据七天无理由退货规定为我办理退货退款；商品我会保持完好并按要求退回。'
    case 'beyondWarranty':
      return '诉求：该问题属于质量瑕疵，依法不受七日无理由期限限制，请在三包/保修期内为我免费修理；符合条件的，请办理换货或退货退款。'
    case 'price':
      return '诉求：该订单在价保期内出现降价，请依据平台价保规则退还差价。'
  }
}

function negotiateBody({ c, scenario }: Ctx): string {
  const problem: Record<Scenario, string> = {
    quality: '收到的商品存在质量问题（性能故障 / 瑕疵），已影响正常使用，相关照片、视频和订单、聊天记录我都已留存。',
    wrong: '收到的商品与订单/页面描述不符（发错型号或货不对板），证据我已留存。',
    noReason: '该商品在七天无理由退货期内，商品保持完好，不影响二次销售，现申请无理由退货。',
    beyondWarranty: '该商品虽已超过七天无理由期限，但出现的是质量问题。质量问题的修换退依法不受七日无理由期限限制。',
    price: '我发现该订单在价保期内价格下降，符合价保退差条件。'
  }
  return [
    `你好，关于订单 ${orDash(c.orderNo)}「${orDash(c.product)}」：`,
    problem[scenario],
    '',
    demand(scenario),
    '请在合理时间内给出明确处理方案。如协商无法解决，我将依法申请平台介入并向 12315 / 市场监管部门反映，相关证据一并提交。'
  ].join('\n')
}

function platformBody({ c, scenario }: Ctx): string {
  return [
    '【申请平台介入】',
    facts(c),
    '',
    '争议情况：',
    scenario === 'noReason'
      ? '买家在签收后七天内、商品保持完好的情况下申请无理由退货，商家未依法妥善处理。'
      : scenario === 'price'
        ? '订单在价保期内降价，买家申请退差价，商家未按平台价保规则处理。'
        : '买家发现商品问题后第一时间与商家沟通并留存了订单、商品、聊天、物流等证据，商家未依法承担售后责任。',
    '',
    demand(scenario),
    '',
    '请平台依据法律法规与平台规则核实证据、支持买家的合理诉求。相关截图与凭证见证据包。'
  ].join('\n')
}

function complainBody({ c, scenario }: Ctx): string {
  return [
    '投诉书（个人自述草稿，请核对后提交）',
    '',
    '一、基本信息',
    facts(c),
    '',
    '二、投诉请求',
    demand(scenario),
    '',
    '三、事实与理由',
    `本人在${orDash(c.channel)}购买「${orDash(c.product)}」，于${c.receivedDate}签收。` +
      (scenario === 'quality' || scenario === 'beyondWarranty'
        ? '使用中发现该商品存在质量问题（性能故障），出现问题后及时联系商家。依据《消费者权益保护法》第二十四条，商品不符合质量要求的，经营者应承担修理、更换、退货等责任，且质量问题并不受七日无理由退货期限的限制。'
        : scenario === 'wrong'
          ? '收到商品与约定不符，经营者未按约定提供商品。'
          : scenario === 'noReason'
            ? '本人在七天无理由退货期内、商品完好的情况下申请退货，经营者无正当理由拒绝。依据《消费者权益保护法》第二十五条，远程购物消费者有权自收到商品之日起七日内无理由退货。'
            : '该订单在价保期内降价，经营者未按其公示的价保规则退还差价。'),
    '与经营者协商未果，现依法投诉，恳请调解，维护消费者合法权益。',
    '',
    '四、证据清单',
    '订单信息、支付凭证、商品/瑕疵照片或视频、与商家的聊天记录、物流签收记录等（见随附证据包）。',
    '',
    '投诉人：（请填写姓名）　联系电话：（请填写）　日期：（请填写）',
    '',
    '说明：本文为系统根据你填写的信息生成的自述草稿，不构成法律意见；提交前请自行核实事实与诉求，依据以最新法律法规和 12315 / 市场监管部门认定为准。'
  ].join('\n')
}

export function buildLetter(c: ClaimCase, scenario: Scenario, type: LetterType): string {
  const ctx = { c, scenario }
  if (type === 'negotiate') return negotiateBody(ctx)
  if (type === 'platform') return platformBody(ctx)
  return complainBody(ctx)
}

/** 生成后自检：不应残留未替换的 {{占位符}}。 */
export function hasUnfilledPlaceholder(text: string): boolean {
  return /\{\{[^}]+\}\}/.test(text)
}
