import type { WidgetConfig, WidgetKind, FieldCfg, FieldType, CalcCfg, CountdownCfg } from './types'

export function newId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let s = ''
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}

function field(id: string, name: string, label: string, type: FieldType, required: boolean, placeholder = ''): FieldCfg {
  return { id, name, label, type, required, placeholder }
}

export interface TemplateDef {
  kind: WidgetKind
  name: string
  emoji: string
  desc: string
  /** 是否 Pro 模板（计算器 / 倒计时） */
  pro: boolean
  defaults(): WidgetConfig
}

const PRESET_THEME = { primary: '#0f7a4f', radius: 10 }

export const TEMPLATES: TemplateDef[] = [
  {
    kind: 'contact',
    name: '报名 / 联系表单',
    emoji: '📝',
    desc: '姓名、邮箱、留言收集，落地页报名 / 联系我们',
    pro: false,
    defaults(): WidgetConfig {
      return {
        id: newId(),
        kind: 'contact',
        title: '联系我们',
        description: '填写下方表单，我们会尽快与你联系。',
        submitLabel: '提交',
        successText: '提交成功，我们会尽快联系你！',
        poweredBy: true,
        theme: { ...PRESET_THEME },
        fields: [
          field('f1', 'name', '姓名', 'text', true, '请输入你的称呼'),
          field('f2', 'email', '邮箱', 'email', true, 'name@example.com'),
          field('f3', 'message', '留言', 'textarea', false, '想对我们说的话')
        ]
      }
    }
  },
  {
    kind: 'feedback',
    name: '满意度反馈',
    emoji: '🙂',
    desc: '单选项 + 补充说明，文章 / 产品满意度收集',
    pro: false,
    defaults(): WidgetConfig {
      return {
        id: newId(),
        kind: 'feedback',
        title: '这篇内容对你有帮助吗？',
        description: '点选你的感受，帮助我们做得更好。',
        submitLabel: '提交反馈',
        successText: '感谢你的反馈！',
        poweredBy: true,
        theme: { ...PRESET_THEME },
        choices: ['😊 有帮助', '😐 一般', '😞 待改进']
      }
    }
  },
  {
    kind: 'rating',
    name: '星级评分',
    emoji: '⭐',
    desc: '1–5 星评分 + 文字评价，服务 / 商品评价',
    pro: false,
    defaults(): WidgetConfig {
      return {
        id: newId(),
        kind: 'rating',
        title: '为本次服务评分',
        description: '点击星星给出你的评分。',
        submitLabel: '提交评分',
        successText: '评分已提交，谢谢！',
        poweredBy: true,
        theme: { ...PRESET_THEME },
        max: 5,
        lowLabel: '非常不满意',
        highLabel: '非常满意'
      }
    }
  },
  {
    kind: 'calculator',
    name: '价格计算器',
    emoji: '🧮',
    desc: '数量 × 单价 + 固定费用实时计价，电商 / 报价落地页',
    pro: true,
    defaults(): WidgetConfig {
      const calc: CalcCfg = {
        qtyLabel: '购买数量',
        qtyDefault: 1,
        unitLabel: '单价',
        unitPrice: 99,
        fixedFee: 0,
        currency: '¥'
      }
      return {
        id: newId(),
        kind: 'calculator',
        title: '价格速算',
        description: '输入数量，实时查看合计价格。',
        submitLabel: '提交询价',
        successText: '已记录你的询价！',
        poweredBy: true,
        theme: { ...PRESET_THEME },
        calc
      }
    }
  },
  {
    kind: 'countdown',
    name: '活动倒计时',
    emoji: '⏳',
    desc: '到点自动切换文案，活动预热 / 促销紧迫感',
    pro: true,
    defaults(): WidgetConfig {
      const d = new Date(Date.now() + 7 * 24 * 3600 * 1000)
      const pad = (n: number) => String(n).padStart(2, '0')
      const targetAt = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T20:00`
      const countdown: CountdownCfg = { targetAt, completeText: '🎉 活动已开始，快来参与！', showSeconds: true }
      return {
        id: newId(),
        kind: 'countdown',
        title: '距离活动开始还有',
        description: '',
        submitLabel: '',
        successText: '',
        poweredBy: true,
        theme: { ...PRESET_THEME },
        countdown
      }
    }
  }
]

export function templateOf(kind: WidgetKind): TemplateDef {
  return TEMPLATES.find((t) => t.kind === kind) ?? (TEMPLATES[0] as TemplateDef)
}

export const THEME_PRESETS = ['#0f7a4f', '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#0891b2', '#111827']
