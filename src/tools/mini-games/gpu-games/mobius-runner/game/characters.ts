/**
 * 莫比环跑酷 —— 可选的原创卡通奔跑角色。
 * 全部为程序化几何体拼搭的原创形象，不使用任何受版权保护的角色名称或造型。
 * 该文件不依赖 three，UI 层可安全静态引用（three 仍只在独立异步 chunk）。
 */

export type CharStyle = 'cap' | 'bunny' | 'cat' | 'spike' | 'hood'

export interface CharacterDef {
  id: string
  name: string
  /** 是否专业版角色 */
  pro: boolean
  /** 一句话描述 */
  blurb: string
  style: CharStyle
  /** 颜色（hex number 交给 three；UI 另有 cssHex） */
  skin: number
  /** 头发/帽子/耳朵主色 */
  hair: number
  /** 衣服主色 */
  suit: number
  /** 点缀色（腮红/内衬/披风等） */
  accent: number
  cssHex: { skin: string; hair: string; suit: string; accent: string }
}

export const CHARACTERS: CharacterDef[] = [
  {
    id: 'bolt',
    name: '电光小子',
    pro: false,
    blurb: '戴鸭舌帽的元气跑者，速度感满满',
    style: 'cap',
    skin: 0xffd9b0,
    hair: 0x39e6ff,
    suit: 0xffd23c,
    accent: 0x1b7cff,
    cssHex: { skin: '#ffd9b0', hair: '#39e6ff', suit: '#ffd23c', accent: '#1b7cff' }
  },
  {
    id: 'bunny',
    name: '棉花兔',
    pro: false,
    blurb: '长耳朵一蹦一跳，软萌但跑得很快',
    style: 'bunny',
    skin: 0xfdfdff,
    hair: 0xffffff,
    suit: 0xff9ec4,
    accent: 0xffc2dd,
    cssHex: { skin: '#fdfdff', hair: '#ffffff', suit: '#ff9ec4', accent: '#ffc2dd' }
  },
  {
    id: 'mint',
    name: '薄荷猫',
    pro: false,
    blurb: '机灵敏捷的薄荷色小猫，有一条长尾巴',
    style: 'cat',
    skin: 0xc8ffe9,
    hair: 0x8ef0c8,
    suit: 0x37c9a8,
    accent: 0xfff27a,
    cssHex: { skin: '#c8ffe9', hair: '#8ef0c8', suit: '#37c9a8', accent: '#fff27a' }
  },
  {
    id: 'blaze',
    name: '火焰仔',
    pro: true,
    blurb: '一头火焰短发，专业版专属的热血跑者',
    style: 'spike',
    skin: 0xffc79a,
    hair: 0xff7a2c,
    suit: 0xff3b5d,
    accent: 0xffd23c,
    cssHex: { skin: '#ffc79a', hair: '#ff7a2c', suit: '#ff3b5d', accent: '#ffd23c' }
  },
  {
    id: 'grape',
    name: '紫影侠',
    pro: true,
    blurb: '戴着兜帽面罩的神秘夜跑者',
    style: 'hood',
    skin: 0xe3d2ff,
    hair: 0x8a5cff,
    suit: 0x5a35c8,
    accent: 0x39e6ff,
    cssHex: { skin: '#e3d2ff', hair: '#8a5cff', suit: '#5a35c8', accent: '#39e6ff' }
  }
]

export const DEFAULT_CHARACTER_ID = 'bolt'

export function characterOf(id: string | undefined | null): CharacterDef {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0]!
}
