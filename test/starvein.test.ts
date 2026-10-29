/**
 * 《星脉》（starvein）纯逻辑单测：星图生成确定性、节拍判定、combo 计分、
 * 潮汐蔓延、收线倍率、评级、必可达不变量、快照往返与损坏回退。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  generateStarMap,
  bfsPath,
  nearestBeatOffsetMs,
  judge,
  tideFront,
  gradeOf,
  addNodeScore,
  serializeSave,
  validateSave,
  stageForRun,
  distToSegment,
  AUTO_SAVE_KEY,
  SAVE_VERSION,
  CHAIN_ID,
  MAX_ENERGY,
  EXIT_MULT,
  type StarMap
} from '../src/tools/mini-games/gpu-games/starvein/game/vein-core.ts'

test('星图生成确定性：同 seed 同 stage 结果一致', () => {
  const a = generateStarMap(1234, 1)
  const b = generateStarMap(1234, 1)
  assert.equal(a.nodes.length, b.nodes.length)
  assert.deepEqual(a.nodes.map((n) => [n.x, n.y]), b.nodes.map((n) => [n.x, n.y]))
})

test('必可达不变量：50 个 seed × 3 个难度段全部核心→出口 BFS 可达', () => {
  for (let seed = 1; seed <= 50; seed++) {
    for (const stage of [1, 2, 3]) {
      const map = generateStarMap(seed * 97 + stage, stage)
      const path = bfsPath(map)
      assert.ok(path, `seed=${seed} stage=${stage} 无可达通路`)
      assert.equal(path![0], map.core)
      assert.equal(path![path!.length - 1], map.exit)
    }
  }
})

test('难度曲线：节点数/BPM/窗口/潮汐随段递增且有界', () => {
  const s1 = stageForRun(1)
  const s2 = stageForRun(3)
  const s3 = stageForRun(9)
  assert.ok(s1.nodeCount < s2.nodeCount && s2.nodeCount < s3.nodeCount)
  assert.ok(s1.bpm < s2.bpm && s2.bpm <= s3.bpm)
  assert.ok(s1.windowMs > s2.windowMs && s2.windowMs >= s3.windowMs)
  assert.ok(s1.tideSpeed < s2.tideSpeed && s2.tideSpeed < s3.tideSpeed)
})

test('节拍判定：节拍中心 = PERFECT，远离节拍 = GOOD', () => {
  const bpm = 100
  assert.equal(judge(0, bpm, 180), 'perfect')
  assert.equal(judge(0.3, bpm, 180), 'good')
  // 半周期处偏移最大 = 300ms > 180
  assert.ok(nearestBeatOffsetMs(0.3, bpm) > 250)
})

test('combo 计分：PERFECT 累加 combo 并放大收益，GOOD 不增 combo', () => {
  let r = addNodeScore(0, 0, true)
  assert.equal(r.combo, 1)
  r = addNodeScore(r.score, r.combo, true)
  assert.equal(r.combo, 2)
  const withGood = addNodeScore(0, 2, false)
  assert.equal(withGood.combo, 2)
  assert.ok(withGood.score > 0)
})

test('潮汐前沿：时间推进 + 抬手犹豫 1.5s 内 +30%', () => {
  const spec = stageForRun(1)
  const a = tideFront(1, spec, 2)
  const b = tideFront(1, spec, -1)
  assert.ok(a > b)
  assert.ok(Math.abs(a / b - 1.3) < 1e-9)
})

test('评级 S/A/B/C 阈值分层', () => {
  assert.equal(gradeOf(0.9, 0.7), 'S')
  assert.equal(gradeOf(0.7, 0.5), 'A')
  assert.equal(gradeOf(0.5, 0.1), 'B')
  assert.equal(gradeOf(0.1, 0), 'C')
})

test('收线倍率：EXIT_MULT=1.5 且能量上限 5', () => {
  assert.equal(EXIT_MULT, 1.5)
  assert.equal(MAX_ENERGY, 5)
  const final = Math.round(1000 * EXIT_MULT)
  assert.equal(final, 1500)
})

test('点到线段距离：垂线段与端点', () => {
  assert.equal(distToSegment(0, 1, 0, 0, 10, 0), 1)
  assert.equal(distToSegment(-5, 0, 0, 0, 10, 0), 5)
})

test('快照往返：序列化→校验通过，关键字段落盘', () => {
  const payload = serializeSave(
    {
      seed: 42,
      stage: 2,
      run: 3,
      t: 12.5,
      score: 800,
      combo: 3,
      maxCombo: 5,
      energy: 4,
      lit: { 2: 'perfect', 3: 'good' },
      swallowed: { 4: true }
    },
    111
  )
  assert.equal(payload.version, SAVE_VERSION)
  assert.equal(payload.chain, CHAIN_ID)
  const back = validateSave(JSON.parse(JSON.stringify(payload)))
  assert.ok(back)
  assert.equal(back!.score, 800)
  assert.equal(back!.lit[2], 'perfect')
})

test('快照损坏回退：版本/工具/链不符与脏数据均返回 null', () => {
  assert.equal(validateSave(null), null)
  assert.equal(validateSave({ version: 999, tool: 'starvein', chain: CHAIN_ID }), null)
  assert.equal(validateSave({ version: SAVE_VERSION, tool: 'other', chain: CHAIN_ID }), null)
  assert.equal(validateSave({ version: SAVE_VERSION, tool: 'starvein', chain: 'x' }), null)
  assert.equal(validateSave({ version: SAVE_VERSION, tool: 'starvein', chain: CHAIN_ID, seed: 'bad' }), null)
})

test('存储键独立：不与其它游戏串键', () => {
  assert.equal(AUTO_SAVE_KEY, 'fangzi:starvein:auto-save:v1')
  assert.ok(!AUTO_SAVE_KEY.includes('gravity-sling'))
  assert.ok(!AUTO_SAVE_KEY.includes('merge-planet'))
})
