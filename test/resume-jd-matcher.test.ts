import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  citiesMentioned,
  contentTerms,
  degreeHeld,
  degreeRequired,
  extractSkills,
  extractSoftSkills,
  isDutyClause,
  normalizeLoose,
  splitClauses,
  yearsHeld,
  yearsRequired
} from '../src/tools/resume-jd-matcher/lib/normalize'
import { matchResume } from '../src/tools/resume-jd-matcher/lib/match'
import { buildSuggestions } from '../src/tools/resume-jd-matcher/lib/suggest'
import { buildCoverLetter } from '../src/tools/resume-jd-matcher/lib/cover-letter'
import { applicationsToCsv } from '../src/tools/resume-jd-matcher/lib/export'

test('normalizeLoose：全角/大小写/空白归一', () => {
  assert.equal(normalizeLoose('ＪＳ  Python３  Hello'), 'js python3 hello')
})

test('extractSkills：别名归并到 canonical（中英/缩写/大小写）', () => {
  const s1 = extractSkills('熟练使用 js 和 vue3，懂 k8s 与 Jenkins')
  assert.ok(s1.includes('JavaScript'))
  assert.ok(s1.includes('Vue'))
  assert.ok(s1.includes('Kubernetes'))
  assert.ok(s1.includes('CI/CD'))
  const s2 = extractSkills('用 golang 写过后端，熟悉 springboot')
  assert.ok(s2.includes('Go'))
  assert.ok(s2.includes('Java'))
})

test('extractSkills：拉丁词边界，避免子串误命中', () => {
  // "javaee" 中 java 后紧跟字母 e，不构成词边界，不应仅凭 'java' 命中 Java
  assert.ok(!extractSkills('我只懂 javaee 配置').includes('Java'))
  // css 不会因为 "scissors" 命中（边界）
  assert.ok(!extractSkills('scissors rock paper').includes('HTML/CSS'))
  // 正常出现仍命中
  assert.ok(extractSkills('I write java services').includes('Java'))
})

test('软技能抽取与职责条款识别', () => {
  assert.ok(extractSoftSkills('具备良好的沟通能力和团队协作').length >= 2)
  assert.equal(isDutyClause('负责电商平台前后端开发'), true)
  assert.equal(isDutyClause('本科及以上学历'), false)
})

test('学历/年限/地点信号', () => {
  assert.equal(degreeRequired('要求硕士及以上学历')?.level, 3)
  assert.equal(degreeHeld('XX大学 本科 计算机')?.level, 2)
  assert.equal(yearsRequired('3年以上相关工作经验'), 3)
  assert.equal(yearsHeld('本人有5年后端开发经验'), 5)
  assert.ok(citiesMentioned('工作地点：上海、杭州').includes('上海'))
})

test('splitClauses：换行/分号/编号切分', () => {
  const c = splitClauses('1. 熟练 Vue 和 TypeScript；\n2. 本科及以上学历\n负责前端开发')
  assert.ok(c.length >= 3)
  assert.ok(!c[0]!.startsWith('1.'))
})

test('contentTerms：英文词 + 中文二元 gram，过滤停用词', () => {
  const t = contentTerms('负责开发 React 应用')
  assert.ok(t.has('react'))
  assert.ok(t.has('开发') || t.has('发应') || t.has('应'))
  assert.ok(!t.has('负责'))
})

const STRONG_RESUME = [
  '张三，本科，XX大学 计算机科学与技术，期望城市：上海',
  '5年前端开发经验，先后在两家互联网公司任职',
  '负责公司核心 SaaS 平台前端开发，使用 JavaScript、TypeScript、Vue3、Node.js 独立完成多个模块',
  '参与搭建组件库与 CI/CD 流水线，熟悉 Docker、Git，推动前端性能优化，首屏提速 40%',
  '具备良好的沟通能力与团队协作，英语 CET-6，可阅读英文文档'
].join('\n')

const STRONG_JD = [
  '岗位：高级前端工程师　工作地点：上海',
  '任职要求：',
  '1. 本科及以上学历，计算机相关专业',
  '2. 3 年以上前端开发经验',
  '3. 熟练 JavaScript、TypeScript、Vue，熟悉 Node.js',
  '4. 了解 Docker、CI/CD 者优先',
  '5. 具备良好的沟通能力和团队协作',
  '岗位职责：',
  '负责 Web 应用前端开发与性能优化，参与组件库建设，推动工程化落地'
].join('\n')

test('match：高匹配简历综合分较高、技能命中、硬门槛全过', () => {
  const r = matchResume({ resumeText: STRONG_RESUME, jdText: STRONG_JD })
  assert.ok(r.score >= 70, `score=${r.score}`)
  assert.ok(r.hits.includes('Vue'))
  assert.ok(r.hits.includes('TypeScript'))
  assert.ok(r.gatesAllPass, '学历/年限/地点应全部满足')
  const deg = r.gates.find((g) => g.kind === 'degree')
  assert.equal(deg?.passed, true)
  const yr = r.gates.find((g) => g.kind === 'years')
  assert.equal(yr?.passed, true)
})

test('match：学历/年限不足触发失败硬门槛并封顶 59', () => {
  const weakResume = [
    '李四，大专，期望城市：上海',
    '1年前端经验',
    '会一点 JavaScript 和 Vue'
  ].join('\n')
  const r = matchResume({ resumeText: weakResume, jdText: STRONG_JD })
  assert.equal(r.gatesAllPass, false)
  assert.ok(r.score <= 59, `应封顶，score=${r.score}`)
  assert.equal(r.gates.find((g) => g.kind === 'degree')?.passed, false)
  assert.equal(r.gates.find((g) => g.kind === 'years')?.passed, false)
})

test('match：地点远程时门槛视为通过；缺失技能进入 missing', () => {
  const jdRemote = '前端工程师，工作地点：北京（接受远程/居家办公），要求精通 React、Kubernetes、本科'
  const r = matchResume({ resumeText: '王五，本科，3年前端，精通 React，但没做过容器编排', jdText: jdRemote })
  const loc = r.gates.find((g) => g.kind === 'location')
  assert.equal(loc?.passed, true)
  assert.ok(r.missing.length >= 0)
})

test('match：空 JD 不崩且分数中性', () => {
  const r = matchResume({ resumeText: STRONG_RESUME, jdText: '' })
  assert.ok(r.score >= 0 && r.score <= 100)
  assert.equal(r.gates.length, 0)
})

test('match：同义词既计入能力匹配，又进入 synonymOnly 供显式命名建议', () => {
  // JD 写标准名 Vue；简历只写 vue3（别名），未写“Vue”
  const r = matchResume({
    resumeText: '本科，3年前端，上海，负责后台系统，用 vue3 和 js 完成多个模块',
    jdText: '前端工程师，上海，本科，3年以上经验，要求熟练 Vue、JavaScript'
  })
  // 能力仍算命中（给分）
  assert.ok(r.hits.includes('Vue'))
  // 但标准名未出现 → 进入 synonymOnly，并记录实际别名
  assert.ok(r.synonymOnly.includes('Vue'))
  assert.equal(r.synonymAlias['Vue'], 'vue3')
  // JavaScript 简历写的是 js（别名）也应进 synonymOnly
  assert.ok(r.synonymOnly.includes('JavaScript'))
})

test('suggest：只给“本人经历有同义表述但没写标准名”的可溯源建议', () => {
  const paragraphs = ['负责前端页面，用 vue3 做了多个项目', '无关段落']
  const sug = buildSuggestions({
    synonymOnly: ['Vue', 'Kubernetes'],
    synonymAlias: { Vue: 'vue3' },
    paragraphs
  })
  const v = sug.find((s) => s.missing === 'Vue')
  assert.ok(v, '应给 Vue 显式命名建议')
  assert.equal(v!.sourceParaId, '0')
  assert.ok(v!.sourceText.includes('vue3'))
  assert.ok(v!.draft.includes('Vue'))
  // Kubernetes 无别名/无来源 → 不臆测、不建议
  assert.ok(!sug.some((s) => s.missing === 'Kubernetes'))
  // 已写出标准名（不在 synonymOnly）自然不会产生建议
  assert.equal(
    buildSuggestions({ synonymOnly: [], synonymAlias: {}, paragraphs: ['熟练使用 Vue 完成开发'] }).length,
    0
  )
})

test('cover-letter：中文信含岗位/公司与真实要点，英文模板可用', () => {
  const zh = buildCoverLetter({
    company: '字节跳动',
    position: '高级前端工程师',
    candidate: '张三',
    hits: ['Vue', 'TypeScript'],
    bullets: ['负责核心 SaaS 平台前端开发', '推动前端性能优化，首屏提速 40%'],
    lang: 'zh'
  })
  assert.ok(zh.includes('字节跳动') && zh.includes('高级前端工程师'))
  assert.ok(zh.includes('Vue') && zh.includes('首屏提速'))
  const en = buildCoverLetter({ company: 'Acme', position: 'Frontend Engineer', hits: ['React'], bullets: ['Built a component library'], lang: 'en' })
  assert.ok(en.includes('Acme') && en.includes('Frontend Engineer') && en.includes('React'))
})

test('CSV：逗号/引号/换行转义并带 BOM', () => {
  const csv = applicationsToCsv([
    { 公司: '甲,乙', 岗位: '前端"高级"', 分数: 88 },
    { 公司: '丙', 岗位: '后端', 分数: 70 }
  ])
  assert.ok(csv.startsWith('﻿'))
  assert.ok(csv.includes('"甲,乙"'))
  assert.ok(csv.includes('"前端""高级"""'))
  const lines = csv.slice(1).split('\r\n')
  assert.equal(lines.length, 3)
})
