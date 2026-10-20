<script setup lang="ts">
/**
 * DealBook —— 品牌商单台账 + 近 30 天报价参考区间。
 */
import { computed, reactive, ref } from 'vue'
import type { Account, Deal, DealResult } from '../lib/types'
import { centsToYuan } from '../lib/types'
import { priceRange } from '../lib/attribution'

const props = defineProps<{
  accounts: Account[]
  deals: Deal[]
}>()

const emit = defineEmits<{
  (e: 'add', p: { accountId: string; brand: string; date: number; amountCents: number; result: DealResult; note: string }): void
  (e: 'remove', id: string): void
}>()

const showForm = ref(false)
const form = reactive({ accountId: '', brand: '', date: todayStr(), amount: '', result: 'done' as DealResult, note: '' })

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function openForm() {
  if (!props.accounts.length) return
  form.accountId = props.accounts[0]!.id
  Object.assign(form, { brand: '', amount: '', result: 'done', note: '', date: todayStr() })
  showForm.value = true
}
function save() {
  const yuan = Number(form.amount)
  if (!form.brand.trim() || !Number.isFinite(yuan) || yuan < 0) return
  const d = new Date(form.date + 'T12:00:00')
  emit('add', {
    accountId: form.accountId,
    brand: form.brand.trim(),
    date: d.getTime(),
    amountCents: Math.round(yuan * 100),
    result: form.result,
    note: form.note.trim()
  })
  showForm.value = false
}

const sorted = computed(() => props.deals.slice().sort((a, b) => b.date - a.date))
const range = computed(() => priceRange(props.deals, Date.now(), 30))
const resultText: Record<DealResult, string> = { done: '已结', doing: '在谈', dead: '黄了' }
</script>

<template>
  <div class="deals">
    <div class="card">
      <div class="card-h">💰 近 30 天报价参考</div>
      <p v-if="!range" class="muted tiny">
        近 30 天还没有「已结」商单。录入几条后，这里会给出你最近成交价的 min–max 区间，下次品牌来问价心里有数。
      </p>
      <p v-else class="range">
        ¥{{ centsToYuan(range.minCents).toFixed(0) }} – ¥{{ centsToYuan(range.maxCents).toFixed(0) }}
        <span class="muted tiny">（基于近 30 天 {{ range.count }} 条已结商单）</span>
      </p>
    </div>

    <div class="card">
      <div class="card-h">📒 商单台账</div>
      <button class="btn primary" @click="openForm" :disabled="!accounts.length">＋ 记一条商单</button>
      <p v-if="!accounts.length" class="muted tiny">先在「台账」建账号。</p>
      <ul v-else-if="!deals.length" class="muted tiny">还没有商单记录。</ul>
      <ul v-else class="d-list">
        <li v-for="d in sorted" :key="d.id" class="d-item">
          <div>
            <strong>{{ d.brand }}</strong>
            <span class="muted tiny"> · {{ new Date(d.date).toLocaleDateString() }} · {{ resultText[d.result] }}</span>
            <div v-if="d.note" class="muted tiny">{{ d.note }}</div>
          </div>
          <div class="d-right">
            <span class="d-amt">¥{{ centsToYuan(d.amountCents).toFixed(2) }}</span>
            <button class="d-del" @click="emit('remove', d.id)">删</button>
          </div>
        </li>
      </ul>
    </div>

    <div v-if="showForm" class="modal-mask" @click.self="showForm = false">
      <div class="modal">
        <h3>记一条商单</h3>
        <label>账号</label>
        <select v-model="form.accountId">
          <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.platform }}@{{ a.nickname }}</option>
        </select>
        <label>品牌 *</label>
        <input type="text" v-model="form.brand" placeholder="如：某咖啡品牌" />
        <div class="grid2">
          <div>
            <label>金额（元）*</label>
            <input type="number" inputmode="decimal" v-model="form.amount" placeholder="如 800" />
          </div>
          <div>
            <label>日期</label>
            <input type="date" v-model="form.date" />
          </div>
        </div>
        <label>结果</label>
        <select v-model="form.result">
          <option value="done">已结</option>
          <option value="doing">在谈</option>
          <option value="dead">黄了</option>
        </select>
        <label>备注</label>
        <input type="text" v-model="form.note" placeholder="选填，如 图文+置顶" />
        <div class="row-ops">
          <button class="btn" @click="showForm = false">取消</button>
          <button class="btn primary" @click="save">保存</button>
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
.range {
  font-size: 1.6rem;
  font-weight: 800;
  color: #237a52;
  margin: 0.2rem 0;
}
.muted {
  color: #828a99;
}
.tiny {
  font-size: 0.78rem;
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
.d-list {
  list-style: none;
  margin: 0.6rem 0 0;
  padding: 0;
}
.d-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0;
  border-bottom: 1px dashed #e6e9ef;
}
.d-amt {
  font-weight: 700;
}
.d-del {
  background: none;
  border: none;
  color: #c2483a;
  cursor: pointer;
  font-size: 0.8rem;
  margin-left: 0.4rem;
}
.row-ops {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.6rem;
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
