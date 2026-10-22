/**
 * 《挽星弓》50 关离线生成 + 可解性求解器。
 *
 * 运行：node --import tsx scripts/generate-gravity-sling-levels.mjs
 *
 * - 布局由 level-design.ts 的确定性种子生成；
 * - 求解器复用 sling-core.ts 中的 createInitialState/stepFrame/gravityAccel，不另写物理；
 * - 每关搜索到满足最小角度窗口与门体净空的弹道后才提交；
 * - 产物：game/levels.generated.ts（运行时关卡/证据）、docs/level-evidence.json（归档证据）。
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LEVEL_COUNT,
  MIN_ANGLE_WINDOW_DEG,
  MIN_CLEARANCE,
  MAX_BODIES,
  generateLevel
} from '../src/tools/mini-games/gpu-games/gravity-sling/game/level-design.ts'
import { solveLevel } from '../src/tools/mini-games/gpu-games/gravity-sling/game/sling-core.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const gameDir = join(root, 'src/tools/mini-games/gpu-games/gravity-sling/game')
const docsDir = join(root, 'src/tools/mini-games/gpu-games/gravity-sling/docs')

const levels = []
const solutions = []
const failures = []

for (let index = 0; index < LEVEL_COUNT; index += 1) {
  const baseSeed = index * 1_000_003 + 7
  let accepted = null
  let acceptedEvidence = null

  for (let retries = 0; retries < 300; retries += 1) {
    const relaxed = retries > 140
    const level = generateLevel(index, baseSeed + retries, relaxed)
    const evidence = solveLevel(level, { timeoutMs: 650, maxSteps: 1200 })
    const nonCollect = level.bodies.filter((b) => b.kind !== 'collect').length
    const ok =
      evidence &&
      evidence.angleWindowDeg >= MIN_ANGLE_WINDOW_DEG &&
      evidence.clearance >= MIN_CLEARANCE &&
      nonCollect <= MAX_BODIES
    if (ok) {
      accepted = level
      acceptedEvidence = { ...evidence, seed: baseSeed + retries, retries, relaxed, bodyCount: nonCollect }
      break
    }
  }

  if (!accepted || !acceptedEvidence) {
    failures.push(index + 1)
    continue
  }
  levels.push(accepted)
  solutions.push(acceptedEvidence)
  console.log(
    `level ${index + 1}: seed=${acceptedEvidence.seed} retries=${acceptedEvidence.retries} ` +
      `angle=${acceptedEvidence.angleDeg}° power=${acceptedEvidence.power} steps=${acceptedEvidence.steps} ` +
      `window=${acceptedEvidence.angleWindowDeg}° clearance=${acceptedEvidence.clearance} bodies=${acceptedEvidence.bodyCount}`
  )
}

if (failures.length) {
  console.error('未通过可解性约束的关卡：', failures.join(', '))
  process.exit(1)
}

const generated = `/**
 * 本文件由 scripts/generate-gravity-sling-levels.mjs 离线生成，请勿手工编辑。
 * 生成时间：${new Date().toISOString()}
 */
import type { LevelConfig, SolveEvidence } from './level-design'

export const LEVELS: LevelConfig[] = ${JSON.stringify(levels, null, 2)}

export const SOLUTIONS: SolveEvidence[] = ${JSON.stringify(solutions, null, 2)}
`

mkdirSync(dirname(join(gameDir, 'levels.generated.ts')), { recursive: true })
writeFileSync(join(gameDir, 'levels.generated.ts'), generated, 'utf8')
mkdirSync(docsDir, { recursive: true })
writeFileSync(
  join(docsDir, 'level-evidence.json'),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      levelCount: LEVEL_COUNT,
      minimumAngleWindowDeg: MIN_ANGLE_WINDOW_DEG,
      minimumClearance: MIN_CLEARANCE,
      maxBodies: MAX_BODIES,
      solutions
    },
    null,
    2
  ),
  'utf8'
)

const windows = solutions.map((s) => s.angleWindowDeg)
const clearances = solutions.map((s) => s.clearance)
const retries = solutions.map((s) => s.retries)
console.log('\n汇总：')
console.log(`  关卡数：${levels.length}`)
console.log(`  角度窗口：最小 ${Math.min(...windows)}° / 最大 ${Math.max(...windows)}°`)
console.log(`  门体净空：最小 ${Math.min(...clearances)} / 最大 ${Math.max(...clearances)}`)
console.log(`  seed 重试：最少 ${Math.min(...retries)} / 最多 ${Math.max(...retries)}`)
