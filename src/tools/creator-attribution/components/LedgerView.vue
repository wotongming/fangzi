<script setup lang="ts">
/**
 * LedgerView —— 账号区 + 发布台账 + CSV 导入。
 * 免费层：账号 >3、内容 >30 在写入前拦截并提示升级。
 */
import { computed, reactive, ref } from 'vue'
import type { Account, Content, ContentFormat, MetricSnapshot } from '../lib/types'
import { centsToYuan, FORMAT_LABEL, FREE_ACCOUNT_LIMIT, FREE_CONTENT_LIMIT, PLATFORMS } from '../lib/types'
import { normalizeLooseTags } from '../lib/csv'
import MetricsInput from './MetricsInput.vue'

const props = defineProps<{
  accounts: Account[]
  contents: Content[]
  metrics: MetricSnapshot[]
  canUnlimited: boolean
  canCsv: boolean
}>()

const emit = defineEmits<{
  (e: 'addAccount', p: { platform: string; nickname: string }): void
  (e: 'removeAccount', id: string): void
  (
    e: 'addContent',
    p: { accountId: string; title: string; tags: string[]; format: ContentFormat; publishedAt: number; hours: number }
  ): void
  (e: 'removeContent', id: string): void
  (e: 'addMetric', p: { contentId: string; capturedAt: number; views: number; followersDelta: number; revenueYuan: number; note: string }): void
  (e: 'importFile', file: File): void
  (e: 'showUpgrade'): void
}>()

const todayStr = (() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})()

// —— 账号 ——
const showAccountForm = ref(false)
const aForm = reactive({ platform: '抖音', nickname: '' })
function openAddAccount() {
  if (props.accounts.length >= FREE_ACCOUNT_LIMIT && !props.canUnlimited) {
    emit('showUpgrade')
    return
  }
  aForm.platform = '抖音'
  aForm.nickname = ''
  showAccountForm.value = true
}
function saveAccount() {
  if (!aForm.nickname.trim()) return
  emit('addAccount', { platform: aForm.platform, nickname: aForm.nickname.trim() })
  showAccountForm.value = false
}
function removeAccount(id: string) {
  if (!confirm('删除该账号将一并删除其内容、数据快照与商单，不可恢复。')) return
  emit('removeAccount', id)
}

// —— 内容台账 ——
const showContentForm = ref(false)
const cForm = reactive({ accountId: '', title: '', tags: '', format: 'video' as ContentFormat, publishedAt: todayStr, hours: '' })
function openAddContent() {
  if (!props.accounts.length) return
  if (props.contents.length >= FREE_CONTENT_LIMIT && !props.canUnlimited) {
    emit('showUpgrade')
    return
  }
  cForm.accountId = props.accounts[0]!.id
  Object.assign(cForm, { title: '', tags: '', format: 'video', publishedAt: todayStr, hours: '' })
  showContentForm.value = true
}
function saveContent() {
  if (!cForm.title.trim()) return
  if (!cForm.accountId) return
  const d = new Date(cForm.publishedAt + 'T12:00:00')
  const hours = Number(cForm.hours)
  emit('addContent', {
    accountId: cForm.accountId,
    title: cForm.title.trim(),
    tags: normalizeLooseTags(cForm.tags),
    format: cForm.format,
    publishedAt: d.getTime(),
    hours: Number.isFinite(hours) && hours >= 0 ? hours : 0
  })
  showContentForm.value = false
}

const accountMap = computed(() => new Map(props.accounts.map((a) => [a.id, a])))
const contentsSorted = computed(() => props.contents.slice().sort((a, b) => b.publishedAt - a.publishedAt))
function revenueOf(c: Content): number {
  return props.metrics.filter((m) => m.contentId === c.id).reduce((s, m) => s + m.revenueCents, 0)
}
function viewsOf(c: Content): number {
  return props.metrics.filter((m) => m.contentId === c.id).reduce((s, m) => s + m.views, 0)
}

function onCsv(file: File | null) {
  if (!file) return
  if (!props.canCsv) {
    emit('showUpgrade')
    return
  }
  emit('importFile', file)
}
</script>

<template>
  <div class="ledger">
    <!-- 账号区 -->
    <div class="card">
      <div class="card-h">
        🎛️ 我的账号
        <small class="muted" v-if="!canUnlimited">（免费 {{ accounts.length }}/{{ FREE_ACCOUNT_LIMIT }}）</small>
      </div>
      <div v-if="!accounts.length" class="muted tiny">还没有账号，先建一个（如 抖音@老王、小红书@小李）。</div>
      <div class="acc-row">
        <span v-for="a in accounts" :key="a.id" class="acc-chip">
          {{ a.platform }}@{{ a.nickname }}
          <button class="acc-del" @click="removeAccount(a.id)" title="删除">×</button>
        </span>
        <button class="acc-chip add" @click="openAddAccount">＋ 账号</button>
      </div>
    </div>

    <!-- 台账 -->
    <div class="card">
      <div class="card-h">
        📝 发布台账
        <small class="muted" v-if="!canUnlimited">（免费 {{ contents.length }}/{{ FREE_CONTENT_LIMIT }}）</small>
      </div>
      <div class="row-ops">
        <button class="btn primary" @click="openAddContent" :disabled="!accounts.length">＋ 录内容</button>
        <label class="btn" :class="{ disabled: !canCsv }">
          CSV 导入
          <input type="file" accept=".csv,text/csv" class="hidden-file" @change="onCsv(($event.target as HTMLInputElement).files?.[0] ?? null)" />
        </label>
      </div>
      <p v-if="!accounts.length" class="muted tiny">先在上方建一个账号，再来录内容。</p>
      <p v-else-if="!contents.length" class="muted tiny">还没有内容，点「录内容」记下第一条，或用 CSV 批量导入历史台账。</p>
      <ul v-else class="c-list">
        <li v-for="c in contentsSorted" :key="c.id" class="c-item">
          <div class="c-top">
            <strong class="c-title">{{ c.title }}</strong>
            <button class="c-del" @click="emit('removeContent', c.id)">删</button>
          </div>
          <div class="c-meta muted tiny">
            {{ accountMap.get(c.accountId)?.platform ?? '?' }} · {{ FORMAT_LABEL[c.format] }} ·
            {{ new Date(c.publishedAt).toLocaleDateString() }} · 工时 {{ c.hours }}h
          </div>
          <div v-if="c.tags.length" class="c-tags">
            <span v-for="t in c.tags" :key="t" class="c-tag">#{{ t }}</span>
          </div>
          <div class="c-stats tiny">
            阅读 {{ viewsOf(c).toLocaleString() }} · 收益 ¥{{ centsToYuan(revenueOf(c)).toFixed(2) }}
          </div>
          <MetricsInput :content="c" :all-metrics="metrics" @add="(p) => emit('addMetric', p)" />
        </li>
      </ul>
    </div>

    <!-- 账号弹层 -->
    <div v-if="showAccountForm" class="modal-mask" @click.self="showAccountForm = false">
      <div class="modal">
        <h3>新建账号</h3>
        <label>平台</label>
        <select v-model="aForm.platform">
          <option v-for="p in PLATFORMS" :key="p" :value="p">{{ p }}</option>
        </select>
        <label>昵称</label>
        <input type="text" v-model="aForm.nickname" placeholder="如 老王的美食日记" />
        <div class="row-ops">
          <button class="btn" @click="showAccountForm = false">取消</button>
          <button class="btn primary" @click="saveAccount">保存</button>
        </div>
      </div>
    </div>

    <!-- 内容弹层 -->
    <div v-if="showContentForm" class="modal-mask" @click.self="showContentForm = false">
      <div class="modal">
        <h3>录一条内容</h3>
        <label>所属账号</label>
        <select v-model="cForm.accountId">
          <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.platform }}@{{ a.nickname }}</option>
        </select>
        <label>标题 *</label>
        <input type="text" v-model="cForm.title" placeholder="如：三分钟搞定 Basys 调试" />
        <label>主题标签（逗号分隔）</label>
        <input type="text" v-model="cForm.tags" placeholder="如：嵌入式, Debug, 工具" />
        <div class="grid2">
          <div>
            <label>形式</label>
            <select v-model="cForm.format">
              <option value="graphic">图文</option>
              <option value="video">视频</option>
              <option value="podcast">播客</option>
            </select>
          </div>
          <div>
            <label>发布时间</label>
            <input type="date" v-model="cForm.publishedAt" />
          </div>
        </div>
        <label>投入工时（小时，可 0.5）</label>
        <input type="number" inputmode="decimal" v-model="cForm.hours" placeholder="如 2.5" />
        <div class="row-ops">
          <button class="btn" @click="showContentForm = false">取消</button>
          <button class="btn primary" @click="saveContent">保存内容</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.card {
  background: #fff;
  border: 1px solid #e6e9ef;
  border-radius: 0.9rem;
  padding: 0.9rem;
  margin-bottom: 0.8rem;
}
.card-h {
  font-weight: 700;
  margin-bottom: 0.55rem;
}
.muted {
  color: #828a99;
}
.tiny {
  font-size: 0.78rem;
}
.acc-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.acc-chip {
  border: 1px solid #e6e9ef;
  background: #f4f6fa;
  border-radius: 999px;
  padding: 0.4rem 0.7rem;
  font-size: 0.85rem;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}
.acc-chip.add {
  color: #3b7dd8;
  cursor: pointer;
}
.acc-del {
  background: none;
  border: none;
  color: #c2483a;
  cursor: pointer;
  font-size: 1rem;
  padding: 0 0.1rem;
}
.row-ops {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.6rem;
}
.btn {
  appearance: none;
  border: 1px solid #e6e9ef;
  background: #fff;
  border-radius: 0.6rem;
  padding: 0.55rem 0.9rem;
  font-size: 0.88rem;
  cursor: pointer;
  min-height: 44px;
}
.btn.primary {
  background: #3b7dd8;
  border-color: #3b7dd8;
  color: #fff;
}
.btn.disabled {
  opacity: 0.6;
}
.hidden-file {
  display: none;
}
.c-list {
  list-style: none;
  margin: 0.4rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.c-item {
  border: 1px solid #e6e9ef;
  border-radius: 0.7rem;
  padding: 0.6rem 0.7rem;
}
.c-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}
.c-title {
  font-size: 0.95rem;
}
.c-del {
  background: none;
  border: none;
  color: #c2483a;
  cursor: pointer;
  font-size: 0.8rem;
}
.c-meta {
  margin-top: 0.15rem;
}
.c-tags {
  margin-top: 0.25rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}
.c-tag {
  background: #eef3fb;
  color: #2a5fb0;
  border-radius: 0.3rem;
  padding: 0.05rem 0.35rem;
  font-size: 0.74rem;
}
.c-stats {
  margin-top: 0.25rem;
  color: #444;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(20, 24, 32, 0.45);
  z-index: 50;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.modal {
  background: #fff;
  width: 100%;
  max-width: 560px;
  border-radius: 1rem 1rem 0 0;
  padding: 1rem 1.1rem calc(1.2rem + env(safe-area-inset-bottom, 0px));
  max-height: 88vh;
  overflow-y: auto;
}
@media (min-width: 640px) {
  .modal-mask {
    align-items: center;
  }
  .modal {
    border-radius: 1rem;
    margin: 1rem;
  }
}
.modal label {
  display: block;
  font-size: 0.82rem;
  color: #556;
  margin: 0.6rem 0 0.25rem;
}
.modal input,
.modal select {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #e6e9ef;
  border-radius: 0.55rem;
  padding: 0.55rem 0.65rem;
  font-size: 16px;
  background: #fff;
}
.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem;
}
</style>
