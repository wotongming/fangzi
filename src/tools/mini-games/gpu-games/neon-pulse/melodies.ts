/**
 * 霓虹脉冲 —— 公有领域经典旋律谱面（全部为程序化音符数据，零音频文件、零版权录音）。
 *
 * 版权说明：所选曲目旋律均已进入公有领域——
 *  - 小星星 / 两只老虎：传统民歌（Traditional），词旋律版权早已过期；
 *  - 欢乐颂（贝多芬 Ode to Joy）、致爱丽丝（Für Elise）：贝多芬作品（作者逝世已近 200 年）；
 *  - 卡农（帕赫贝尔 Pachelbel's Canon in D）：约 17 世纪作品，公有领域。
 * 不包含任何近现代仍受版权保护的流行歌曲旋律；现场演奏由 Web Audio 振荡器合成。
 *
 * 音符用 MIDI 音高编号表示（A4=69，C4=60），null 表示休止；b 为该音符时值（以“拍”为单位）。
 */

export interface Song {
  id: string
  name: string
  /** 副标题/出处 */
  desc: string
  /** 每拍秒数（越小越快） */
  beat: number
  /** [MIDI 音高或 null(休止), 时值(拍)] */
  notes: Array<[number | null, number]>
}

// —— 便捷音名 → MIDI（仅本文件编码用）——
const N = (name: string): number => {
  const map: Record<string, number> = {
    C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
    'F#': 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11
  }
  const m = /^([A-G][#b]?)(-?\d)$/.exec(name)
  if (!m) throw new Error('bad note ' + name)
  const pc = map[m[1]!] ?? 0
  const oct = Number(m[2])
  return (oct + 1) * 12 + pc
}

/** 小星星（Traditional: Twinkle, Twinkle, Little Star） */
const twinkle: Array<[number | null, number]> = (
  'C4:1 C4:1 G4:1 G4: A4:1 A4:1 G4:2 F4:1 F4:1 E4:1 E4:1 D4:1 D4:1 C4:2 ' +
  'G4:1 G4:1 F4:1 F4:1 E4:1 E4:1 D4:2 G4:1 G4:1 F4:1 F4:1 E4:1 E4:1 D4:2 ' +
  'C4:1 C4:1 G4:1 G4:1 A4:1 A4:1 G4:2 F4:1 F4:1 E4:1 E4:1 D4:1 D4:1 C4:2'
)
  .trim()
  .split(/\s+/)
  .map((tok) => {
    const [name, b] = tok.split(':')
    return [name ? N(name) : null, Number(b)]
  })

/** 欢乐颂（Beethoven: Ode to Joy）主旋律 */
const ode: Array<[number | null, number]> = (
  'E4:1 E4:1 F4:1 G4:1 G4:1 F4:1 E4:1 D4:1 C4:1 D4:1 E4:1 E4:1.5 D4:0.5 D4:2 ' +
  'E4:1 E4:1 F4:1 G4:1 G4:1 F4:1 E4:1 D4:1 C4:1 D4:1 E4:1 D4:1.5 C4:0.5 C4:2 ' +
  'D4:1 D4:1 E4:1 C4:1 D4:1.5 E4:0.5 F4:1 E4:1 C4:1 D4:1.5 E4:0.5 F4:1 E4:1 D4:1 C4:1 D4:1 G3:2 ' +
  'E4:1 E4:1 F4:1 G4:1 G4:1 F4:1 E4:1 D4:1 C4:1 D4:1 E4:1 D4:1.5 C4:0.5 C4:2'
)
  .trim()
  .split(/\s+/)
  .map((tok) => {
    const [name, b] = tok.split(':')
    return [name ? N(name) : null, Number(b)]
  })

/** 两只老虎（Traditional: Frère Jacques） */
const frere: Array<[number | null, number]> = (
  'C4:1 D4:1 E4:1 C4:1 C4:1 D4:1 E4:1 C4:1 ' +
  'E4:1 F4:1 G4:2 E4:1 F4:1 G4:2 ' +
  'G4:0.5 A4:0.5 G4:0.5 F4:0.5 E4:1 C4:1 G4:0.5 A4:0.5 G4:0.5 F4:0.5 E4:1 C4:1 ' +
  'C4:1 G3:1 C4:2 C4:1 G3:1 C4:2'
)
  .trim()
  .split(/\s+/)
  .map((tok) => {
    const [name, b] = tok.split(':')
    return [name ? N(name) : null, Number(b)]
  })

/** 致爱丽丝（Beethoven: Für Elise）开头主题（含临时升降号） */
const furElise: Array<[number | null, number]> = (
  'E5:0.5 D#5:0.5 E5:0.5 D#5:0.5 E5:0.5 B4:0.5 D5:0.5 C5:0.5 ' +
  'A4:1 C4:0.5 E4:0.5 A4:0.5 B4:1 E4:0.5 G#4:0.5 ' +
  'B4:0.5 C5:1 E4:0.5 A4:0.5 B4:1 E4:0.5 D5:0.5 ' +
  'C5:1.5 A3:0.5'
)
  .trim()
  .split(/\s+/)
  .map((tok) => {
    const [name, b] = tok.split(':')
    return [name ? N(name) : null, Number(b)]
  })

/** 卡农（Pachelbel: Canon in D）著名高音旋律片段（D 大调） */
const canon: Array<[number | null, number]> = (
  'F#5:1.5 E5:0.5 D5:1 C#5:1 B4:1 A4:1 B4:1 C#5:1 ' +
  'D5:1.5 C#5:0.5 B4:1 A4:1 G4:1 F#4:1 G4:1 E4:1 ' +
  'F#4:1 D4:1 F#4:1 A4:1 G4:1 F#4:1 E4:1 D4:1 ' +
  'F#5:1.5 E5:0.5 D5:1 C#5:1 B4:1 A4:1 G4:1 F#4:1'
)
  .trim()
  .split(/\s+/)
  .map((tok) => {
    const [name, b] = tok.split(':')
    return [name ? N(name) : null, Number(b)]
  })

export const SONGS: Song[] = [
  { id: 'twinkle', name: '小星星', desc: 'Traditional · 经典儿歌', beat: 0.5, notes: twinkle },
  { id: 'ode', name: '欢乐颂', desc: '贝多芬 · Ode to Joy', beat: 0.5, notes: ode },
  { id: 'frere', name: '两只老虎', desc: 'Traditional · Frère Jacques', beat: 0.5, notes: frere },
  { id: 'elise', name: '致爱丽丝', desc: '贝多芬 · Für Elise', beat: 0.42, notes: furElise },
  { id: 'canon', name: '卡农', desc: '帕赫贝尔 · Canon in D', beat: 0.56, notes: canon }
]

export function songOf(id: string): Song {
  return SONGS.find((s) => s.id === id) ?? SONGS[0]!
}

/** MIDI 音高 → 频率（Hz），A4=69=440Hz。 */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}
