import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  angle,
  dist,
  kneeValgusRatio,
  personPresent,
  pickSide,
  PoseSmoother,
  VIS_THRESHOLD
} from '../src/tools/pose-fitness-coach/lib/pose-geometry'
import { LM, type Landmark, type Pose } from '../src/tools/pose-fitness-coach/lib/types'

function pt(x: number, y: number, visibility = 0.99): Landmark {
  return { x, y, z: 0, visibility }
}

test('angle：直角/直线/折角', () => {
  const o = pt(0, 0)
  assert.ok(Math.abs(angle(pt(0, 1), o, pt(1, 0)) - 90) < 1)
  assert.ok(angle(pt(0, 1), o, pt(0, -1)) > 175)
  assert.ok(angle(pt(0, 1), o, pt(0, 0.5)) < 5)
})

test('dist 欧氏距离', () => {
  assert.equal(dist(pt(0, 0), pt(3, 4)), 5)
})

test('personPresent：空/低可见为 false，核心链可见为 true', () => {
  assert.equal(personPresent(null), false)
  assert.equal(personPresent([]), false)
  const low: Pose = Array.from({ length: 33 }, () => pt(0.5, 0.5, 0.1))
  assert.equal(personPresent(low), false)
  const ok: Pose = Array.from({ length: 33 }, () => pt(0.5, 0.5, 0.2))
  for (const i of [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP, LM.L_KNEE, LM.R_KNEE, LM.L_ANKLE, LM.R_ANKLE]) {
    ok[i] = pt(0.5, 0.5, 0.9)
  }
  assert.equal(personPresent(ok), true)
})

test('pickSide：选可见度更高一侧', () => {
  const pose: Pose = Array.from({ length: 33 }, () => pt(0.5, 0.5, 0.99))
  assert.equal(pickSide(pose), 'left')
  for (const i of [LM.R_SHOULDER, LM.R_HIP, LM.R_KNEE, LM.R_ANKLE]) pose[i] = pt(0.7, 0.5, 0.99)
  for (const i of [LM.L_SHOULDER, LM.L_HIP, LM.L_KNEE, LM.L_ANKLE]) pose[i] = pt(0.3, 0.5, 0.2)
  assert.equal(pickSide(pose), 'right')
  for (const i of [LM.R_SHOULDER, LM.R_HIP, LM.R_KNEE, LM.R_ANKLE]) pose[i] = pt(0.7, 0.5, 0.1)
  assert.equal(pickSide(pose), null)
})

test('PoseSmoother：低可见点沿用上一帧，正常点做 EMA', () => {
  const sm = new PoseSmoother(0.5)
  const a: Pose = [pt(0, 0, 0.99)]
  const r1 = sm.smooth(a)
  assert.equal(r1.valid[0], true)
  const b: Pose = [pt(1, 0, 0.1)] // 突然低可见
  const r2 = sm.smooth(b)
  assert.equal(r2.valid[0], false)
  assert.equal(r2.out[0]!.x, 0) // 沿用上一帧
  const c: Pose = [pt(1, 0, 0.99)]
  const r3 = sm.smooth(c)
  assert.ok(Math.abs(r3.out[0]!.x - 0.5) < 1e-9) // EMA 0.5
})

test('kneeValgusRatio：正常≈1，膝内扣明显<1，缺点返回 null', () => {
  const pose: Pose = Array.from({ length: 33 }, () => pt(0.5, 0.5, 0.99))
  pose[LM.L_ANKLE] = pt(0.3, 0.9)
  pose[LM.R_ANKLE] = pt(0.7, 0.9)
  pose[LM.L_KNEE] = pt(0.31, 0.5)
  pose[LM.R_KNEE] = pt(0.69, 0.5)
  const normal = kneeValgusRatio(pose)!
  assert.ok(normal > 0.9 && normal <= 1)
  pose[LM.L_KNEE] = pt(0.46, 0.5)
  pose[LM.R_KNEE] = pt(0.54, 0.5)
  assert.ok(kneeValgusRatio(pose)! < 0.3)
  pose[LM.L_ANKLE] = pt(0, 0, 0)
  assert.equal(kneeValgusRatio(pose), null)
})

test('VIS_THRESHOLD 常量存在', () => {
  assert.ok(VIS_THRESHOLD > 0 && VIS_THRESHOLD <= 1)
})
