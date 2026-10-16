<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { manifest } from './manifest'
import { useToolBilling } from '@/composables/useToolBilling'
import { loadState, persistState, bestKey } from './lib/storage'
import Game2048 from './components/Game2048.vue'
import GameMemory from './components/GameMemory.vue'
import GameKlotski from './components/GameKlotski.vue'
import GameMatch3 from './components/GameMatch3.vue'

type Diff = 'easy' | 'normal' | 'hard' | 'classic'
interface GameDef {
  id: string
  name: string
  icon: string
  desc: string
  pro: boolean
  difficulties: Diff[]
}

const GAMES: GameDef[] = [
  { id: '2048', name: '2048', icon: '🔢', desc: '滑动合并数字，凑出 2048', pro: false, difficulties: ['classic'] },
  { id: 'memory', name: '记忆翻牌', icon: '🃏', desc: '翻开卡片找出相同的一对', pro: false, difficulties: ['easy', 'normal', 'hard'] },
  { id: 'klotski', name: '数字华容道', icon: '🧩', desc: '滑动数字块，按顺序复原', pro: true, difficulties: ['easy', 'normal'] },
  { id: 'match3', name: '三消', icon: '💠', desc: '交换相邻色块，连三消除', pro: true, difficulties: ['classic'] }
]

const DIFF_LABEL: Record<Diff, string> = {
  easy: '简单',
  normal: '普通',
  hard: '困难',
  classic: '经典'
}

const billing = useToolBilling(manifest.id)
const priceText = billing.priceText(billing.plan.priceCents)
const pro = computed(() => billing.isOwned('freemium-pro') || billing.isOwned('buyout'))
const buying = ref(false)
const payMsg = ref('')

const activeId = ref('2048')
const difficulty = ref<Diff>('classic')
const nonce = ref(0)
const score = ref(0)
const best = ref<Record<string, number>>({})
let dirty = false
let flushTimer: ReturnType<typeof setInterval> | null = null

const active = computed(() => GAMES.find((g) => g.id === activeId.value)!)
const currentKey = computed(() => bestKey(active.value.id, difficulty.value))
const bestScore = computed(() => best.value[currentKey.value] ?? 0)
const comp = computed(() => {
  switch (active.value.id) {
    case '2048': return Game2048
    case 'memory': return GameMemory
    case 'klotski': return GameKlotski
    default: return GameMatch3
  }
})

function selectGame(g: GameDef) {
  if (g.id === activeId.value) return
  activeId.value = g.id
  difficulty.value = g.difficulties[0]!
  score.value = 0
  nonce.value++
}

function setDiff(d: Diff) {
  if (d === difficulty.value) return
  difficulty.value = d
  score.value = 0
  nonce.value++
}

function restart() {
  score.value = 0
  nonce.value++
}

function onScore(v: number) {
  score.value = v
  if (v > (best.value[currentKey.value] ?? 0)) {
    best.value = { ...best.value, [currentKey.value]: v }
    dirty = true
  }
}

async function onGameOver() {
  if (dirty) {
    await persistState(best.value)
    dirty = false
  }
}

async function upgrade() {
  if (buying.value) return
  buying.value = true
  payMsg.value = ''
  try {
    await billing.buy('freemium-pro')
    payMsg.value = '专业版已解锁，完整游戏库都可以玩了'
  } catch {
    payMsg.value = '下单未完成，可稍后再试；免费游戏不受影响'
  } finally {
    buying.value = false
  }
}

onMounted(async () => {
  best.value = (await loadState()).best
  flushTimer = setInterval(() => {
    if (dirty) {
      dirty = false
      void persistState(best.value)
    }
  }, 1500)
})
onBeforeUnmount(() => {
  if (flushTimer) clearInterval(flushTimer)
  if (dirty) void persistState(best.value)
})
</script>

<template>
  <div class="mg">
    <div class="intro card">
      <p class="intro-line">通勤排队、午休摸鱼，打开即玩。全部在本机离线运行、无广告，单局几分钟，最高分会自动保存在这台设备。</p>
    </div>

    <div class="game-tabs" role="tablist">
      <button
        v-for="g in GAMES"
        :key="g.id"
        class="tab"
        :class="{ on: g.id === activeId }"
        @click="selectGame(g)"
      >
        <span class="tab-ico">{{ g.icon }}</span>
        <span class="tab-name">{{ g.name }}</span>
        <span v-if="g.pro && !pro" class="lock">🔒</span>
      </button>
    </div>

    <div class="panel card">
      <div class="bar">
        <div class="bar-left">
          <strong class="gname">{{ active.icon }} {{ active.name }}</strong>
          <span class="gdesc">{{ active.desc }}</span>
        </div>
        <div class="bar-right">
          <div class="sc"><span>本局</span><b>{{ score }}</b></div>
          <div class="sc"><span>最高</span><b>{{ bestScore }}</b></div>
          <button class="btn btn-ghost" @click="restart">重新开始</button>
        </div>
      </div>

      <div v-if="active.difficulties.length > 1" class="diffs">
        <button
          v-for="d in active.difficulties"
          :key="d"
          class="diff"
          :class="{ on: d === difficulty }"
          @click="setDiff(d)"
        >
          {{ DIFF_LABEL[d] }}
        </button>
      </div>

      <!-- 免费 / 已解锁：直接玩 -->
      <component
        :is="comp"
        v-if="!active.pro || pro"
        :key="activeId + ':' + difficulty + ':' + nonce"
        :difficulty="difficulty === 'classic' ? 'normal' : difficulty"
        @score="onScore"
        @gameover="onGameOver"
      />

      <!-- 专业版未解锁的游戏：付费墙 -->
      <div v-else class="paywall">
        <div class="pw-icon">{{ active.icon }}</div>
        <h3>「{{ active.name }}」是专业版游戏</h3>
        <p class="faint">免费版可畅玩 2048、记忆翻牌三档难度。升级专业版一次买断，解锁数字华容道、三消等完整游戏库，后续新游戏持续加入，无广告、无内耗。</p>
        <button class="btn btn-primary big" :disabled="buying" @click="upgrade">
          {{ buying ? '下单中…' : `升级专业版 ${priceText}（买断）` }}
        </button>
        <p v-if="payMsg" class="pay-msg">{{ payMsg }}</p>
        <button class="link" @click="selectGame(GAMES.find((x) => x.id === '2048')!)">先玩免费的 2048</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mg { display: flex; flex-direction: column; gap: 14px; }
.intro { padding: 14px 18px; }
.intro-line { margin: 0; color: var(--ink-soft); font-size: 14px; }

.game-tabs {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 4px;
  border: 1px solid var(--line);
  background: var(--surface);
  border-radius: var(--radius-sm);
  color: var(--ink-soft);
  position: relative;
}
.tab.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand-dark); }
.tab-ico { font-size: 22px; }
.tab-name { font-size: 13px; font-weight: 600; }
.lock { position: absolute; top: 4px; right: 6px; font-size: 11px; }

.panel { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.bar-left { display: flex; flex-direction: column; }
.gname { font-size: 17px; }
.gdesc { color: var(--ink-faint); font-size: 13px; }
.bar-right { display: flex; align-items: center; gap: 12px; }
.sc { display: flex; flex-direction: column; align-items: center; min-width: 52px; font-size: 12px; color: var(--ink-faint); }
.sc b { font-size: 18px; color: var(--brand-dark); }

.diffs { display: flex; gap: 8px; }
.diff {
  border: 1px solid var(--line);
  background: var(--surface);
  border-radius: 999px;
  padding: 5px 16px;
  font-size: 13px;
  color: var(--ink-soft);
}
.diff.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand-dark); font-weight: 600; }

.paywall {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 10px;
  padding: 26px 18px;
}
.pw-icon { font-size: 48px; }
.paywall h3 { margin: 0; }
.paywall p { max-width: 460px; margin: 0; font-size: 14px; }
.big { padding: 11px 22px; font-size: 16px; }
.pay-msg { color: var(--brand-dark); font-weight: 600; }
.link { border: none; background: transparent; color: var(--ink-faint); text-decoration: underline; font-size: 13px; }
</style>
