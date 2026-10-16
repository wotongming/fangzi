/**
 * 求职信生成（纯模板槽位 + 本人要点检索重组，无 LLM、不虚构）。
 * 槽位：称呼 / 岗位 / 公司 / 3 个匹配技能 / 3 条本人真实经历要点（来自命中段落，可溯源）。
 */

export interface CoverInput {
  company: string
  position: string
  candidate?: string
  /** 命中的硬技能标准名 */
  hits: string[]
  /** 从简历命中的真实要点（已在调用处截取，元素为原文句子） */
  bullets: string[]
  lang: 'zh' | 'en'
}

function clean(line: string): string {
  return line.replace(/\s+/g, ' ').trim()
}

export function buildCoverLetter(input: CoverInput): string {
  const company = input.company.trim() || '贵公司'
  const position = input.position.trim() || '该岗位'
  const name = input.candidate?.trim() || '求职者'
  const skills = input.hits.slice(0, 3)
  const bullets = input.bullets.map(clean).filter(Boolean).slice(0, 3)

  if (input.lang === 'en') {
    const skillLine = skills.length ? skills.join(', ') : 'the required core skills'
    const bulletLines = bullets.length
      ? bullets.map((b) => `  - ${b}`).join('\n')
      : '  - (Add 2–3 of your real accomplishments that match the job description.)'
    return [
      `Dear Hiring Team at ${company},`,
      '',
      `I am writing to apply for the ${position} position. After reviewing the job description, ` +
        `I believe my background aligns well with the role, particularly in ${skillLine}.`,
      '',
      'Highlights from my experience that match your requirements:',
      bulletLines,
      '',
      `I would welcome the opportunity to discuss how I can contribute to the team at ${company}. ` +
        'Thank you for your time and consideration.',
      '',
      'Sincerely,',
      name
    ].join('\n')
  }

  const skillLine = skills.length ? skills.join('、') : '岗位所需的核心技能'
  const bulletLines = bullets.length
    ? bullets.map((b) => `  - ${b}`).join('\n')
    : '  - （请补充 2–3 条与岗位要求对应的真实经历）'
  return [
    `尊敬的 ${company} 招聘负责人：`,
    '',
    `您好！我看到贵公司正在招聘「${position}」，结合岗位要求与我的经历，认为自己较为匹配，尤其在 ${skillLine} 方面有较扎实的实践。`,
    '',
    '与岗位要求对应的主要经历如下：',
    bulletLines,
    '',
    `希望有机会进一步说明我能为 ${company} 带来的价值，感谢您阅读我的申请，期待回复。`,
    '',
    '此致',
    '敬礼',
    '',
    name
  ].join('\n')
}
