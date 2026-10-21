/**
 * 合成宇宙 19 天体通关节奏 · 蒙特卡洛平衡仿真（可复跑：node --import tsx scripts/merge-planet-balance-sim.mjs）
 *
 * 目的：在动一行业务代码前，用「理想合并流体模型」验证动态投放池 SPAWN_MAX_BY_REACH 的
 * 通关总步数落在目标区间（理想步数约 150–230，折真实对局约 20–35 分钟，中枢 25–30）。
 *
 * 模型假设（注释即口径，与 test/merge-planet.test.ts 的仿真断言一致）：
 *  - 理想模型：每次投放的球都能与同级别球立刻成对合并（玩家最优放置），不考虑错放/浪费/堆堵；
 *  - 真实折算：真实对局并非每投必合，错放/等待/死亡线压力使「真实投放步数 ≈ 理想步数 × 1.6」；
 *  - 平均每步真实墙钟：投放冷却 0.38s + 落地稳定 ~1.8s + 瞄准 ~1.5s + 连锁观察 ~1.8s ≈ 5.5s。
 *  => 估算通关分钟 = 理想步数 × 1.6 × 5.5s / 60。
 */
import { rollSpawnTier, maxSpawnForReach, FINAL_TIER, TIER_COUNT } from '../src/tools/mini-games/gpu-games/merge-planet/game/logic.ts'

/** 单个种子跑一局理想合并，返达通关所需投放步数。 */
function simulateOnce(seed) {
  let s = seed >>> 0
  const rng = () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
  const counts = new Array(TIER_COUNT).fill(0)
  let maxR = 0
  let steps = 0
  while (maxR < FINAL_TIER) {
    const tier = rollSpawnTier(maxR, rng)
    counts[tier]++
    steps++
    // 理想合并：从低到高，成对即合（新合成的球本步继续向上合并）
    for (let t = 0; t < TIER_COUNT - 1; t++) {
      while (counts[t] >= 2) {
        counts[t] -= 2
        counts[t + 1]++
      }
    }
    for (let t = TIER_COUNT - 1; t >= 0; t--) {
      if (counts[t] > 0) {
        if (t > maxR) maxR = t
        break
      }
    }
  }
  return steps
}

const runs = Number(process.env.SIM_RUNS ?? 600)
const realOverhead = 1.6
const secPerStep = 5.5
const out = []
for (let k = 0; k < runs; k++) out.push(simulateOnce(k * 7919 + 13))
out.sort((a, b) => a - b)
const mean = out.reduce((a, b) => a + b, 0) / out.length
const p50 = out[Math.floor(out.length / 2)]
const p10 = out[Math.floor(out.length * 0.1)]
const p90 = out[Math.floor(out.length * 0.9)]
const toMin = (steps) => ((steps * realOverhead * secPerStep) / 60).toFixed(1)

console.log(`理想投放步数（${runs} 局）：mean=${mean.toFixed(0)} p50=${p50} p10=${p10} p90=${p90}`)
console.log(`折算真实通关分钟（×${realOverhead} 错放开销、×${secPerStep}s/步）：mean≈${toMin(mean)}min p50≈${toMin(p50)}min [p10..p90]=${toMin(p10)}..${toMin(p90)}min`)
console.log(`参考：开局 maxReached=0 只掉陨石；进度到 R=${FINAL_TIER - 1} 时投放上沿=${maxSpawnForReach(FINAL_TIER - 1)}`)
