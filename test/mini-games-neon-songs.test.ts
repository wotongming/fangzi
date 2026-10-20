import assert from 'node:assert'
import { test } from 'node:test'
import {
  CHART_TRAVEL,
  buildChart,
  hitLane,
  newPulseFromSong,
  update
} from '../src/tools/mini-games/gpu-games/neon-pulse/logic'
import { SONGS, midiToFreq, songOf } from '../src/tools/mini-games/gpu-games/neon-pulse/melodies'

test('谱面编译：事件按到达时间排序、轨道在 0..2、生成时刻提前旅行时间', () => {
  const song = songOf('twinkle')
  const { events } = buildChart(song.notes, song.beat)
  assert.ok(events.length > 20)
  for (const e of events) {
    assert.ok(e.lane >= 0 && e.lane <= 2)
    assert.ok(e.midi != null)
    assert.ok(Math.abs(e.spawnAt - (e.arrival - CHART_TRAVEL)) < 1e-9)
  }
  for (let i = 1; i < events.length; i++) {
    assert.ok(events[i]!.arrival >= events[i - 1]!.arrival)
  }
})

test('每首曲目都能完整演奏到 win（不因漏击中途失败）', () => {
  for (const song of SONGS) {
    const s = newPulseFromSong(0, song.name, song.notes, song.beat)
    assert.equal(s.mode, 'song')
    const dt = 1 / 60
    let guard = 0
    while (!s.over && guard < 60 * 120) {
      update(s, dt)
      guard++
    }
    assert.ok(s.over, `${song.name} 应在合理时间内结束`)
    assert.equal(s.win, true, `${song.name} 谱面模式应判为通关`)
  }
})

test('命中谱面音符返回其 midi，且击打得分', () => {
  const song = songOf('ode')
  const s = newPulseFromSong(0, song.name, song.notes, song.beat)
  // 快进到第一个音符抵达判定线附近
  const first = s.chart![0]!
  const dt = 1 / 60
  while (s.elapsed < first.arrival) update(s, dt)
  const before = s.score
  const r = hitLane(s, first.lane)
  assert.notEqual(r.kind, 'empty')
  assert.equal(r.note?.midi, first.midi)
  assert.ok(s.score > before)
})

test('midiToFreq：A4=440，C5≈523.25', () => {
  assert.ok(Math.abs(midiToFreq(69) - 440) < 1e-6)
  assert.ok(Math.abs(midiToFreq(72) - 523.2511) < 0.01)
})
