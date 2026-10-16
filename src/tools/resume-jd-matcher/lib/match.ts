/**
 * 匹配引擎（纯函数，无副作用、可单测）。
 *
 * V1 通道（全部离线、确定性）：
 *  1) 技能通道：技能词典 canonical 覆盖率（别名归并）；
 *  2) 职责通道：JD 职责条款的词项（英文词 + 中文二元 gram）在简历中的覆盖率；
 *  3) 资质通道：软性素质/资历要求词项覆盖率；
 *  4) 硬门槛：学历 / 年限 / 证书 / 地点 单独核对，任一不过则封顶提示。
 *
 * V1.1 预留：本地 MiniLM 语义余弦通道（lib/embeddings.ts 接入后与关键词加权融合）。
 * 综合分 = 100 ×（技能 .5 + 职责 .3 + 资质 .2）覆盖率；硬门槛不过封顶 59。
 */
import {
  certsMentioned,
  citiesMentioned,
  contentTerms,
  degreeHeld,
  degreeRequired,
  extractSkillEvidence,
  extractSoftSkills,
  isDutyClause,
  normalizeLoose,
  splitClauses,
  yearsHeld,
  yearsRequired
} from './normalize'
import type { DimKey, DimScore, HardGate, MatchResult } from './types'

const REMOTE_HINTS = ['远程', '居家办公', '异地', 'remote']

export interface MatchInput {
  resumeText: string
  /** 简历切好的段落（用于命中要点溯源）；不传则内部按换行切 */
  resumeParagraphs?: string[]
  jdText: string
}

const DIM_WEIGHT: Record<DimKey, number> = { skill: 0.5, duty: 0.3, qual: 0.2 }

function coverageOf(required: Set<string>, owned: Set<string>): { hit: string[]; missing: string[]; coverage: number } {
  const req = [...required]
  if (req.length === 0) return { hit: [], missing: [], coverage: 1 }
  const hit = req.filter((t) => owned.has(t))
  const missing = req.filter((t) => !owned.has(t))
  return { hit, missing, coverage: hit.length / req.length }
}

export function matchResume(input: MatchInput): MatchResult {
  const resume = input.resumeText ?? ''
  const jd = input.jdText ?? ''
  const resumeParagraphs = input.resumeParagraphs?.length
    ? input.resumeParagraphs
    : resume.split(/\r?\n+/).map((s) => s.trim()).filter(Boolean)

  const jdSkills = new Set(extractSkillEvidence(jd).map((e) => e.canonical))
  // 简历技能证据：标准名精确命中 vs 仅同义词/版本别名命中
  const ownedEvidence = extractSkillEvidence(resume)
  const ownedSkills = new Set(ownedEvidence.map((e) => e.canonical))
  const exactSkills = new Set(ownedEvidence.filter((e) => e.exact).map((e) => e.canonical))
  const synonymAlias: Record<string, string> = {}
  for (const e of ownedEvidence) if (!e.exact && e.matchedAlias) synonymAlias[e.canonical] = e.matchedAlias

  // 职责 / 资质条款分流
  const clauses = splitClauses(jd)
  const dutyTerms = new Set<string>()
  const qualTerms = new Set<string>()
  for (const c of clauses) {
    if (isDutyClause(c)) {
      for (const t of contentTerms(c)) dutyTerms.add(t)
    } else if (/学历|专业|经验|年|素质|沟通|团队|责任|抗压|学习|逻辑|沟通|协调|管理|英语|证书/.test(c)) {
      for (const t of contentTerms(c)) qualTerms.add(t)
    }
  }
  // 软性素质显式入资质通道
  for (const s of extractSoftSkills(jd)) qualTerms.add(normalizeLoose(s))

  const resumeTerms = contentTerms(resume)

  const skillCov = coverageOf(jdSkills, ownedSkills)
  const dutyCov = coverageOf(dutyTerms, resumeTerms)
  const qualCov = coverageOf(qualTerms, resumeTerms)

  const dims: DimScore[] = [
    { key: 'skill', label: '技能匹配', required: skillCov.hit.length + skillCov.missing.length, ...skillCov },
    { key: 'duty', label: '职责经验', required: dutyCov.hit.length + dutyCov.missing.length, ...dutyCov },
    { key: 'qual', label: '资质素质', required: qualCov.hit.length + qualCov.missing.length, ...qualCov }
  ]

  /* ---------------- 硬门槛 ---------------- */
  const gates: HardGate[] = []

  const reqDeg = degreeRequired(jd)
  if (reqDeg) {
    const heldDeg = degreeHeld(resume)
    gates.push({
      kind: 'degree',
      raw: `学历要求：${reqDeg.canonical}及以上`,
      passed: !!heldDeg && heldDeg.level >= reqDeg.level,
      detail: heldDeg
        ? heldDeg.level >= reqDeg.level
          ? `简历学历 ${heldDeg.canonical}，满足`
          : `简历学历 ${heldDeg.canonical}，低于要求`
        : '简历中未识别到明确学历，请在教育经历中写明'
    })
  }

  const reqYears = yearsRequired(jd)
  if (reqYears !== null) {
    const heldYears = yearsHeld(resume)
    gates.push({
      kind: 'years',
      raw: `经验要求：${reqYears} 年及以上`,
      passed: heldYears !== null && heldYears >= reqYears,
      detail:
        heldYears === null
          ? '简历未明确写明年限，建议补充“X 年相关经验”'
          : heldYears >= reqYears
            ? `简历约 ${heldYears} 年经验，满足`
            : `简历约 ${heldYears} 年经验，不足 ${reqYears} 年`
    })
  }

  const reqCerts = certsMentioned(jd)
  const heldCerts = new Set(certsMentioned(resume))
  const missCerts = reqCerts.filter((c) => !heldCerts.has(c))
  if (reqCerts.length) {
    gates.push({
      kind: 'cert',
      raw: `证书要求：${reqCerts.join('、')}`,
      passed: missCerts.length === 0,
      detail: missCerts.length ? `简历未见：${missCerts.join('、')}` : '要求的证书均已在简历中体现'
    })
  }

  const jdCities = citiesMentioned(jd).filter((c) => !REMOTE_HINTS.includes(c))
  if (jdCities.length) {
    const resumeCities = citiesMentioned(resume)
    const remoteOk = REMOTE_HINTS.some((r) => normalizeLoose(jd).includes(r))
    const hitCity = jdCities.find((c) => resumeCities.includes(c))
    const openRelocate = /可调剂|接受异地|愿意|地点不限/.test(resume)
    gates.push({
      kind: 'location',
      raw: `工作地点：${jdCities.join('、')}${remoteOk ? '（JD 同时接受远程）' : ''}`,
      passed: remoteOk || !!hitCity || openRelocate,
      detail: hitCity
        ? `简历期望/经历地点含 ${hitCity}`
        : remoteOk
          ? '岗位接受远程/异地'
          : '简历未体现期望城市与岗位一致，建议在简历注明期望工作地'
    })
  }

  const gatesAllPass = gates.every((g) => g.passed)

  /* ---------------- 综合分 ---------------- */
  let score = Math.round(
    100 *
      (DIM_WEIGHT.skill * skillCov.coverage +
        DIM_WEIGHT.duty * dutyCov.coverage +
        DIM_WEIGHT.qual * qualCov.coverage)
  )
  // 门槛不过：在基础分上封顶 59，明确提示“硬性条件存缺口”
  if (!gatesAllPass) score = Math.min(score, 59)
  score = Math.max(0, Math.min(100, score))

  /* ---------------- 命中要点（供求职信/建议溯源） ---------------- */
  const jdSignal = new Set<string>([...jdSkills, ...dutyTerms, ...extractSoftSkills(jd).map(normalizeLoose)])
  const matchedBullets: string[] = []
  resumeParagraphs.forEach((p, idx) => {
    const pSkills = new Set(extractSkillEvidence(p).map((e) => e.canonical))
    let skillHit = 0
    for (const s of pSkills) if (jdSkills.has(s)) skillHit++
    const terms = contentTerms(p)
    let termHit = 0
    for (const t of terms) if (jdSignal.has(t)) termHit++
    if (skillHit >= 1 || termHit >= 2) matchedBullets.push(String(idx))
  })

  // 仅同义词命中的 JD 技能：能力可算匹配，但提示显式写出标准名（ATS 检索友好，不虚构经历）
  const synonymOnly = [...jdSkills].filter((c) => ownedSkills.has(c) && !exactSkills.has(c))
  const missing = Array.from(new Set([...skillCov.missing, ...dutyCov.missing.slice(0, 12), ...qualCov.missing.slice(0, 8)]))
  const hits = Array.from(new Set([...skillCov.hit]))

  return {
    score,
    dims,
    missing,
    hits,
    gates,
    gatesAllPass,
    matchedBullets,
    keywordCount: skillCov.hit.length + skillCov.missing.length + dutyTerms.size + qualTerms.size,
    synonymOnly,
    synonymAlias
  }
}
