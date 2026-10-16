import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createExercise } from '../src/tools/pose-fitness-coach/lib/exercises'
import { CoachEngine } from '../src/tools/pose-fitness-coach/lib/coach'
import { LM, type Landmark, type Pose } from '../src/tools/pose-fitness-coach/lib/types'

const P = (x: number, y: number, visibility = 0.95): Landmark => ({ x, y, z: 0, visibility })

/** 侧面站立骨架（左侧为主，右侧 x 偏移），其余点给可见占位 */
function basePose(): Pose {
  const pose: Pose = Array.from({ length: 33 }, () => P(0.5, 0.5, 0.6))
  const L: Record<number, [number, number]> = {
    [LM.L_SHOULDER]: [0.42, 0.3],
    [LM.L_ELBOW]: [0.34, 0.42],
    [LM.L_WRIST]: [0.3, 0.52],
    [LM.L_HIP]: [0.42, 0.46],
    [LM.L_KNEE]: [0.41, 0.68],
    [LM.L_ANKLE]: [0.4, 0.9],
    [LM.L_HEEL]: [0.4, 0.93],
    [LM.L_FOOT]: [0.45, 0.93]
  }
  for (const [k, [x, y]] of Object.entries(L)) {
    const i = Number(k)
    pose[i] = P(x, y)
    pose[i + 1] = P(x + 0.18, y) // 右侧同高（11→12,13→14…索引恰为 +1）
  }
  pose[LM.NOSE] = P(0.42, 0.2)
  return pose
}

function setL(pose: Pose, idx: number, x: number, y: number): Pose {
  pose[idx] = P(x, y, 0.97)
  return pose
}

const VALID = new Array(33).fill(true)

function squatStand(): Pose {
  return basePose()
}
function squatBottom(): Pose {
  const p = basePose()
  return setL(setL(setL(p, LM.L_HIP, 0.36, 0.62), LM.L_KNEE, 0.5, 0.62), LM.L_ANKLE, 0.4, 0.9)
}
function squatShallow(): Pose {
  const p = basePose()
  return setL(setL(setL(p, LM.L_HIP, 0.3, 0.58), LM.L_KNEE, 0.45, 0.66), LM.L_ANKLE, 0.4, 0.9)
}

test('深蹲：完整 3 次往返计数=3', () => {
  const ex = createExercise('squat')
  let t = 0
  let reps = 0
  for (let rep = 0; rep < 3; rep++) {
    ex.evaluate(squatStand(), VALID, (t += 100))
    ex.evaluate(squatBottom(), VALID, (t += 100))
    ex.evaluate(squatBottom(), VALID, (t += 100))
    const up = ex.evaluate(squatStand(), VALID, (t += 100))
    reps = up.reps
  }
  assert.equal(reps, 3)
})

test('深蹲：半程（到位但深度不足）不计次', () => {
  const ex = createExercise('squat')
  let t = 0
  ex.evaluate(squatStand(), VALID, (t += 1300))
  ex.evaluate(squatShallow(), VALID, (t += 200))
  const up = ex.evaluate(squatStand(), VALID, (t += 200))
  assert.equal(up.reps, 0)
})

test('深蹲：无人/丢点帧不计数、不崩', () => {
  const ex = createExercise('squat')
  assert.equal(ex.evaluate([], VALID, 0).present, false)
  assert.equal(ex.evaluate(basePose(), VALID, 100).reps, 0)
})

function pushupTop(): Pose {
  const p = basePose()
  setL(p, LM.L_SHOULDER, 0.25, 0.5)
  setL(p, LM.L_ELBOW, 0.42, 0.5)
  setL(p, LM.L_WRIST, 0.6, 0.5)
  setL(p, LM.L_HIP, 0.62, 0.5)
  setL(p, LM.L_ANKLE, 0.95, 0.52)
  return p
}
function pushupBottom(): Pose {
  const p = basePose()
  setL(p, LM.L_SHOULDER, 0.3, 0.52)
  setL(p, LM.L_ELBOW, 0.45, 0.4)
  setL(p, LM.L_WRIST, 0.45, 0.62)
  setL(p, LM.L_HIP, 0.6, 0.52)
  setL(p, LM.L_ANKLE, 0.95, 0.54)
  return p
}

test('俯卧撑：2 次计数=2', () => {
  const ex = createExercise('pushup')
  let t = 0
  let reps = 0
  for (let r = 0; r < 2; r++) {
    ex.evaluate(pushupTop(), VALID, (t += 100))
    ex.evaluate(pushupBottom(), VALID, (t += 100))
    reps = ex.evaluate(pushupTop(), VALID, (t += 100)).reps
  }
  assert.equal(reps, 2)
})

test('弓步蹲：1 次计数', () => {
  const ex = createExercise('lunge')
  let t = 0
  ex.evaluate(basePose(), VALID, (t += 100))
  ex.evaluate(squatBottom(), VALID, (t += 100))
  assert.equal(ex.evaluate(basePose(), VALID, (t += 100)).reps, 1)
})

test('臀桥：顶髋到位 2 次计数=2', () => {
  const ex = createExercise('bridge')
  const bottom = (): Pose => {
    const p = basePose()
    setL(p, LM.L_SHOULDER, 0.2, 0.55)
    setL(p, LM.L_HIP, 0.42, 0.4)
    setL(p, LM.L_KNEE, 0.62, 0.55)
    return p
  }
  const top = (): Pose => {
    const p = basePose()
    setL(p, LM.L_SHOULDER, 0.2, 0.5)
    setL(p, LM.L_HIP, 0.5, 0.48)
    setL(p, LM.L_KNEE, 0.7, 0.5)
    return p
  }
  let t = 0
  let reps = 0
  for (let r = 0; r < 2; r++) {
    ex.evaluate(bottom(), VALID, (t += 100))
    ex.evaluate(top(), VALID, (t += 100))
    reps = ex.evaluate(bottom(), VALID, (t += 100)).reps
  }
  assert.equal(reps, 2)
})

function pressPose(elbowY: number, wristY: number): Pose {
  // 正面：双肩 y=.35，双肘/腕随推举高度变化
  const p = basePose()
  const xs = { l: 0.4, r: 0.6 }
  for (const [pfx, x] of [['l', xs.l], ['r', xs.r]] as const) {
    const s = pfx === 'l' ? LM.L_SHOULDER : LM.R_SHOULDER
    const e = pfx === 'l' ? LM.L_ELBOW : LM.R_ELBOW
    const w = pfx === 'l' ? LM.L_WRIST : LM.R_WRIST
    p[s] = P(x, 0.35)
    p[e] = P(x, elbowY)
    p[w] = P(x - 0.08, wristY)
  }
  // 顶部腕在肘正上方：用专门参数难统一，这里直接在两个用例里给坐标
  return p
}

test('站姿肩推：屈→伸 2 次计数=2', () => {
  const ex = createExercise('shoulderpress')
  const down = (): Pose => {
    const p = basePose()
    for (const s of [LM.L_SHOULDER, LM.R_SHOULDER]) p[s] = P(s === LM.L_SHOULDER ? 0.4 : 0.6, 0.35)
    for (const [e, w, x] of [
      [LM.L_ELBOW, LM.L_WRIST, 0.4],
      [LM.R_ELBOW, LM.R_WRIST, 0.6]
    ] as const) {
      p[e] = P(x, 0.45)
      p[w] = P(x - 0.08, 0.45)
    }
    return p
  }
  const up = (): Pose => {
    const p = basePose()
    for (const [s, e, w, x] of [
      [LM.L_SHOULDER, LM.L_ELBOW, LM.L_WRIST, 0.4],
      [LM.R_SHOULDER, LM.R_ELBOW, LM.R_WRIST, 0.6]
    ] as const) {
      p[s] = P(x, 0.35)
      p[e] = P(x, 0.25)
      p[w] = P(x, 0.12)
    }
    return p
  }
  let t = 0
  let reps = 0
  for (let r = 0; r < 2; r++) {
    ex.evaluate(down(), VALID, (t += 100))
    ex.evaluate(up(), VALID, (t += 100))
    reps = ex.evaluate(down(), VALID, (t += 100)).reps
  }
  assert.equal(reps, 2)
  void pressPose
})

test('平板：水平直线计时，塌腰期间不计；tally 汇总', () => {
  const ex = createExercise('plank')
  const good = (): Pose => {
    const p = basePose()
    setL(p, LM.L_SHOULDER, 0.2, 0.5)
    setL(p, LM.L_HIP, 0.5, 0.5)
    setL(p, LM.L_ANKLE, 0.8, 0.5)
    return p
  }
  const sag = (): Pose => {
    const p = basePose()
    setL(p, LM.L_SHOULDER, 0.2, 0.5)
    setL(p, LM.L_HIP, 0.5, 0.64) // 塌腰
    setL(p, LM.L_ANKLE, 0.8, 0.5)
    return p
  }
  let t = 0
  for (let i = 0; i < 11; i++) assert.equal(ex.evaluate(good(), VALID, (t += 100)).present, true)
  for (let i = 0; i < 5; i++) ex.evaluate(sag(), VALID, (t += 100))
  const f = ex.evaluate(good(), VALID, (t += 100))
  assert.ok(f.reps >= 1, `平板应计时≥1s，实际 ${f.reps}`)
  const tally = ex.tally!()
  assert.ok(tally.avgScore > 0 && tally.avgScore <= 100)
})

test('CoachEngine：深蹲一次完整训练 stop 汇总（reps/avgScore/duration）', () => {
  const eng = new CoachEngine('squat')
  eng.setMuted(true)
  eng.start()
  let t = performance.now()
  eng.onPose(squatStand(), t)
  // EMA 平滑需要连续帧才到位（与真实视频一致）
  for (let k = 0; k < 4; k++) eng.onPose(squatBottom(), (t += 60))
  for (let k = 0; k < 4; k++) eng.onPose(squatStand(), (t += 60))
  const res = eng.stop()
  assert.equal(res.reps, 1)
  assert.ok(res.avgScore >= 40 && res.avgScore <= 100)
  assert.ok(res.durationMs >= 0)
})
