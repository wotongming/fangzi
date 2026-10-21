/**
 * payment-chaser —— 三档梯度催收话术模板（本地，变量填充，可复制/导出）。
 */
import { fillTemplate, type TemplateVars } from './aging'

export interface LetterTemplate {
  stage: 1 | 2 | 3
  key: 'polite' | 'formal' | 'final'
  title: string
  body: string
}

export const LETTER_TEMPLATES: LetterTemplate[] = [
  {
    stage: 1,
    key: 'polite',
    title: '礼貌提醒（逾期 1–7 天）',
    body: `{{client}}你好，\n\n关于「{{project}}」项目的尾款 {{amount}}，按约定应在 {{dueDate}} 前结清。看到这边还没收到，猜你可能是最近太忙、财务排期排到后面了，特此轻提醒一下。\n\n如果流程上还需要我补什么材料（发票、收据、交付确认），随时告诉我，我马上配合。方便的话这周内安排一下就好，谢谢！`
  },
  {
    stage: 2,
    key: 'formal',
    title: '正式催告（逾期 8–29 天）',
    body: `{{client}}你好，\n\n「{{project}}」项目已于约定时间交付，尾款 {{amount}}（约定付款日 {{dueDate}}）至今已逾期 {{days}} 天仍未到账。\n\n这笔款项是我这边安排后续工作的重要现金流，麻烦在收到本消息后 3 个工作日内安排付款；若对账金额或进度有出入，也请尽快回复说明，我们当面/线上核对清楚。\n\n付款后请回个消息，我这边同步销账。感谢配合。`
  },
  {
    stage: 3,
    key: 'final',
    title: '最后通牒（逾期 30 天以上）',
    body: `{{client}}：\n\n关于「{{project}}」项目尾款 {{amount}}，约定付款日为 {{dueDate}}，现已逾期 {{days}} 天。期间已多次友好提醒，均未收到付款或明确付款计划。\n\n现正式通知：请于收到本通知后 7 日内一次性结清上述款项。逾期未付，我将依据《保障中小企业款项支付条例》及相关规定，向全国统一拖欠投诉平台/12315 提交投诉，并保留通过法律途径追偿（含逾期利息、维权合理费用）的权利。\n\n希望此事不必走到那一步，盼尽快回复并给出付款时间。`
  }
]

const PRE_DUE_TITLE = '到期前友好提醒'
const PRE_DUE_BODY = `{{client}}你好，\n\n「{{project}}」项目的款项 {{amount}} 按约定将在 {{dueDate}}（还有 {{days}} 天）到期。提前跟你对一下，方便你这边安排付款流程、预留时间；如需要我补发票或收据，随时说。\n\n到期后我会再来确认一次到账，谢谢配合。`

export function renderLetter(stage: 1 | 2 | 3, vars: TemplateVars): string {
  // 未到期（days<=0）不套用催告口吻，改为到期前友好提醒
  if (vars.days <= 0) {
    return `【${PRE_DUE_TITLE}】\n\n${fillTemplate(PRE_DUE_BODY, { ...vars, days: -vars.days })}`
  }
  const t = LETTER_TEMPLATES.find((x) => x.stage === stage)!
  return `【${t.title}】\n\n${fillTemplate(t.body, vars)}`
}
