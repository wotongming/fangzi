<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, shallowRef, type Component } from 'vue'
import { manifest } from './manifest'
import { useToolBilling } from '@/composables/useToolBilling'
import { useImmersive } from '@/composables/useImmersive'
import { bestKey, loadState, saveBest, saveSettings, type MiniGameSettings } from './lib/storage'
import FocusStage from './components/FocusStage.vue'
import Game2048 from './components/Game2048.vue'
import GameMemory from './components/GameMemory.vue'
import GameKlotski from './components/GameKlotski.vue'

type Diff = 'easy' | 'normal' | 'hard' | 'classic'
type Kind = 'dom' | 'gpu'
interface GameDef {
  id: string
  name: string
  icon: string
  desc: string
  pro: boolean
  difficulties: Diff[]
  kind: Kind
  /** 计费权益 key（专业版游戏） */
  feature?: string
  /** GPU 游戏的异步加载器（动态分包，仅在进入时拉取） */
  loader?: () => Promise<{ default: Component }>
  /** DOM 游戏静态组件 */
  comp?: Component
  /** 不可点击的“即将上线”占位 */
  soon?: boolean
}

const DOM: Record<string, Component> = {
  '2048': Game2048,
  memory: GameMemory,
  klotski: GameKlotski
}

const CLASSIC: GameDef[] = [
  { id: '2048', name: '2048', icon: '🔢', desc: '滑动合并数字，凑出 2048', pro: false, difficulties: ['classic'], kind: 'dom', comp: DOM['2048'] },
  { id: 'memory', name: '记忆翻牌', icon: '🃏', desc: '翻开卡片找出相同的一对', pro: false, difficulties: ['easy', 'normal', 'hard'], kind: 'dom', comp: DOM['memory'] },
  { id: 'klotski', name: '数字华容道', icon: '🧩', desc: '滑动数字块，按顺序复原', pro: true, difficulties: ['easy', 'normal'], kind: 'dom', feature: 'pro-library', comp: DOM['klotski'] }
]

const NEON: GameDef[] = [
  {
    id: 'glow-match',
    name: '炫光连消',
    icon: '✨',
    desc: '霓虹粒子连消，滑动交换，连锁全屏爆炸',
    pro: false,
    difficulties: ['classic'],
    kind: 'gpu',
    loader: () => import('./gpu-games/glow-match/glow-match.vue')
  },
  {
    id: 'neon-pulse',
    name: '霓虹脉冲',
    icon: '🎵',
    desc: '三轨下落节奏，点中光拍连击爆分',
    pro: true,
    difficulties: ['normal'],
    kind: 'gpu',
    feature: 'neon-library',
    loader: () => import('./gpu-games/neon-pulse/neon-pulse.vue')
  },
  {
    id: 'orbit-surge',
    name: '星轨穿梭',
    icon: '🌠',
    desc: '拖动光体穿越加速粒子星场，生存闪避',
    pro: true,
    difficulties: ['classic'],
    kind: 'gpu',
    feature: 'neon-library',
    loader: () => import('./gpu-games/orbit-surge/orbit-surge.vue')
  }
]

const DIFF_LABEL: Record<Diff, string> = { easy: '简单', normal: '普通', hard: '困难', classic: '经典' }

const billing = useToolBilling(manifest.id)
const imm = useImmersive()
const priceText = billing.priceText(billing.plan.priceCents)
const proOwned = computed(() => billing.isOwned('freemium-pro') || billing.isOwned('buyout'))
const buying = ref(false)
const payMsg = ref('')
const paywallFor = ref<GameDef | null>(null)

const best = ref<Record<string, number>>({})
const settings = ref<MiniGameSettings>({ muted: false, vibrate: true, particle: 'auto' })
let dirty = false
let flushTimer: ReturnType<typeof setInterval> | null = null

// —— 专注态（两层结构的第二层）——
interface Selected {
  def: GameDef
  diff: Diff
}
const selected = ref<Selected | null>(null)
const stageComp = shallowRef<Component | null>(null)
const nonce = ref(0)
const score = ref(0)
const combo = ref(0)
const paused = ref(false)

function bestOf(g: GameDef): number {
  const k = bestKey(g.id, g.difficulties[0] ?? 'classic')
  return best.value[k] ?? 0
}

function unlocked(g: GameDef): boolean {
  if (!g.pro) return true
  return billing.canUse(g.feature ?? 'pro-library').allowed || proOwned.value
}

/** 进入游戏（必须在点击手势内同步触发沉浸/系统全屏）。 */
function play(g: GameDef, diff?: Diff): void {
  if (g.soon) return
  if (!unlocked(g)) {
    paywallFor.value = g
    payMsg.value = ''
    return
  }
  const d = diff ?? g.difficulties[0] ?? 'classic'
  void imm.enter() // 手势内尽早请求系统全屏；被拒也保留应用内沉浸
  if (g.kind === 'gpu' && g.loader) {
    stageComp.value = defineAsyncComponent({
      loader: g.loader,
      loadingComponent: { template: '<div style="color:#9fb4d8;padding:40px;text-align:center">霓虹引擎加载中…</div>' },
      errorComponent: { template: '<div style="color:#ffb4b4;padding:40px;text-align:center">加载失败，请退出重试。</div>' }
    })
  } else {
    stageComp.value = g.comp ?? null
  }
  selected.value = { def: g, diff: d }
  score.value = 0
  combo.value = 0
  paused.value = false
  nonce.value++
}

const currentKey = computed(() =>
  selected.value ? bestKey(selected.value.def.id, selected.value.diff) : ''
)

function onScore(v: number): void {
  score.value = v
  const k = currentKey.value
  if (k && v > (best.value[k] ?? 0)) {
    best.value = { ...best.value, [k]: v }
    dirty = true
  }
}

async function flushBest(): Promise<void> {
  if (!dirty) return
  dirty = false
  await saveBest(best.value)
}

function restartStage(): void {
  score.value = 0
  combo.value = 0
  paused.value = false
  nonce.value++
}

async function exitStage(): Promise<void> {
  await flushBest()
  selected.value = null
  stageComp.value = null
  paused.value = false
  if (imm.active.value) void imm.exit()
}

async function toggleMute(): Promise<void> {
  const next = await saveSettings({ muted: !settings.value.muted })
  settings.value = next.settings
}

async function changeParticle(v: 'auto' | 'high' | 'low'): Promise<void> {
  settings.value = { ...settings.value, particle: v }
  await saveSettings({ particle: v })
}

async function upgrade(): Promise<void> {
  if (buying.value) return
  buying.value = true
  payMsg.value = ''
  try {
    await billing.buy('freemium-pro')
    payMsg.value = '专业版已解锁，完整游戏库都可以玩了'
    paywallFor.value = null
  } catch {
    payMsg.value = '下单未完成，可稍后再试；免费游戏不受影响'
  } finally {
    buying.value = false
  }
}

onMounted(async () => {
  const state = await loadState()
  best.value = state.best
  settings.value = state.settings
  flushTimer = setInterval(() => void flushBest(), 1500)
})
onBeforeUnmount(() => {
  if (flushTimer) clearInterval(flushTimer)
  void flushBest()
})
</script>

<template>
  <div class="mg">
    <!-- 第一层：选游戏页 -->
    <template v-if="!selected">
      <div class="intro card">
        <p class="intro-line">
          通勤排队、午休摸鱼，打开即玩。全部本机离线运行、无广告，最高分自动保存在这台设备。
          点进任意游戏即进入<strong class="neon-txt">全屏沉浸</strong>，画面里不留任何多余信息。
        </p>
      </div>

      <section class="zone">
        <h2 class="zone-title">经典益智</h2>
        <div class="grid">
          <button v-for="g in CLASSIC" :key="g.id" class="gcard" @click="play(g)">
            <span class="gc-top">
              <span class="gc-ico">{{ g.icon }}</span>
              <span v-if="!g.pro" class="tag-pill free">免费</span>
              <span v-else-if="!unlocked(g)" class="tag-pill pro">🔒 专业版</span>
              <span v-else class="tag-pill owned">✓ 已解锁</span>
            </span>
            <span class="gc-name">{{ g.name }}</span>
            <span class="gc-desc">{{ g.desc }}</span>
            <span class="gc-meta">
              <em v-if="bestOf(g)">最高 {{ bestOf(g) }}</em>
              <span v-else class="faint">即点即玩 · 全屏沉浸</span>
            </span>
            <span v-if="g.difficulties.length > 1" class="diffs" @click.stop>
              <i
                v-for="d in g.difficulties"
                :key="d"
                class="diff-chip"
                @click="play(g, d)"
              >{{ DIFF_LABEL[d] }}</i>
            </span>
          </button>
        </div>
      </section>

      <section class="zone">
        <h2 class="zone-title"><span class="neon-txt">炫光 NEON</span> · GPU 粒子全屏</h2>
        <div class="grid">
          <button v-for="g in NEON" :key="g.id" class="gcard" @click="play(g)">
            <span class="gc-top">
              <span class="gc-ico">{{ g.icon }}</span>
              <span v-if="!g.pro" class="tag-pill free">免费</span>
              <span v-else-if="!unlocked(g)" class="tag-pill pro">🔒 专业版</span>
              <span v-else class="tag-pill owned">✓ 已解锁</span>
            </span>
            <span class="gc-name">{{ g.name }}</span>
            <span class="gc-desc">{{ g.desc }}</span>
            <span class="gc-meta">
              <em v-if="bestOf(g)">最高 {{ bestOf(g) }}</em>
              <span v-else class="faint">即点即玩 · 全屏沉浸</span>
            </span>
          </button>
        </div>
      </section>

      <!-- 专业版付费墙（在选游戏页内） -->
      <div v-if="paywallFor" class="card paywall">
        <div class="pw-icon">{{ paywallFor.icon }}</div>
        <h3>「{{ paywallFor.name }}」是专业版游戏</h3>
        <p class="faint">
          免费版可畅玩 2048、记忆翻牌、炫光连消。升级专业版一次买断，解锁数字华容道以及霓虹脉冲、
          星轨穿梭等更多 GPU 炫光游戏，后续持续加入，无广告。
        </p>
        <button class="btn btn-primary big" :disabled="buying" @click="upgrade">
          {{ buying ? '下单中…' : `升级专业版 ${priceText}（买断）` }}
        </button>
        <p v-if="payMsg" class="pay-msg">{{ payMsg }}</p>
        <button class="link" @click="paywallFor = null">先玩免费游戏</button>
      </div>
    </template>

    <!-- 第二层：纯净全屏专注态 -->
    <FocusStage
      v-else
      :key="'stage-' + selected.def.id + ':' + selected.diff"
      :title="selected.def.name"
      :kind="selected.def.kind"
      :score="selected.def.kind === 'gpu' ? score : undefined"
      :combo="combo"
      :muted="settings.muted"
      :particle="settings.particle"
      v-model:paused="paused"
      @exit="exitStage"
      @restart="restartStage"
      @toggle-mute="toggleMute"
      @update:particle="changeParticle"
    >
      <component
        :is="stageComp"
        :key="'g-' + selected.def.id + ':' + selected.diff + ':' + nonce"
        :difficulty="selected.diff === 'classic' ? 'normal' : selected.diff"
        :paused="selected.def.kind === 'gpu' ? paused : undefined"
        v-bind="
          selected.def.kind === 'gpu'
            ? { muted: settings.muted, vibrate: settings.vibrate, particle: settings.particle }
            : {}
        "
        @score="onScore"
        @gameover="flushBest"
        @combo="(v: number) => (combo = v)"
      />
    </FocusStage>
  </div>
</template>

<style scoped>
.mg { display: flex; flex-direction: column; gap: 16px; }
.intro { padding: 14px 18px; }
.intro-line { margin: 0; color: var(--ink-soft); font-size: 14px; line-height: 1.7; }
.neon-txt {
  color: #6d5ef0;
  background: linear-gradient(90deg, #37c8ff, #8a5cff, #ff5cc8);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.zone { display: flex; flex-direction: column; gap: 10px; }
.zone-title { margin: 4px 2px 0; font-size: 15px; color: var(--ink-soft); }

.grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}
@media (min-width: 720px) {
  .grid { grid-template-columns: repeat(3, 1fr); }
}
.gcard {
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: left;
  padding: 14px;
  border: 1px solid var(--line);
  background: var(--surface);
  border-radius: var(--radius);
  color: var(--ink);
  min-height: 132px;
  transition: transform 0.12s ease, box-shadow 0.12s ease, border-color 0.12s ease;
}
.gcard:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow);
  border-color: var(--brand);
}
.gcard:active { transform: scale(0.98); }
.gc-top { display: flex; align-items: center; justify-content: space-between; }
.gc-ico { font-size: 26px; }
.gc-name { font-size: 16px; font-weight: 700; }
.gc-desc { font-size: 12.5px; color: var(--ink-faint); line-height: 1.5; min-height: 34px; }
.gc-meta { font-size: 12px; color: var(--ink-faint); }
.gc-meta em { font-style: normal; color: var(--brand-dark); font-weight: 600; }
.tag-pill {
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  padding: 4px 9px;
  border-radius: 999px;
  white-space: nowrap;
}
.tag-pill.free {
  color: #fff;
  background: linear-gradient(90deg, #2bbf8a, #27a0c9);
}
.tag-pill.pro {
  color: var(--ink-soft);
  background: #f1efe8;
  border: 1px solid var(--line);
}
.tag-pill.owned {
  color: var(--brand-dark);
  background: var(--brand-soft);
}

.diffs { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
.diff-chip {
  font-style: normal;
  font-size: 11px;
  padding: 2px 9px;
  border-radius: 999px;
  border: 1px solid var(--line);
  color: var(--ink-soft);
  background: var(--surface);
}
.diff-chip:active { background: var(--brand-soft); }

.paywall {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 10px;
  padding: 26px 18px;
}
.pw-icon { font-size: 46px; }
.paywall h3 { margin: 0; }
.paywall p { max-width: 480px; margin: 0; font-size: 14px; line-height: 1.7; }
.big { padding: 11px 22px; font-size: 16px; }
.pay-msg { color: var(--brand-dark); font-weight: 600; }
.link { border: none; background: transparent; color: var(--ink-faint); text-decoration: underline; font-size: 13px; }
</style>
