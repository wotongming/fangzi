<script setup lang="ts">
/**
 * 租赁证据链（rent-evidence）——入住交接水印拍照 / 报修工单归责 / 台账 / 证据包 PDF。
 * 全程浏览器本地处理，照片压缩为 JPEG 存 IndexedDB（fz-rent-evidence-v1），不上传。
 */
import { onMounted, onUnmounted, reactive, ref } from 'vue'
import { useToolBilling } from '@/composables/useToolBilling'
import { useSeo } from '@/composables/useSeo'
import {
  CHECKLIST_ITEMS,
  LEDGER_LABEL,
  RESP_LABEL,
  classifyResponsibility,
  formatStamp,
  genId,
  groupPhotosForPdf,
  summarizeEvidence,
  type LedgerEntry,
  type LedgerKind,
  type PhotoKind,
  type PhotoRecord,
  type RepairTicket
} from './lib/model'
import { allLedger, allPhotos, allTickets, deleteLedger, deletePhoto, deleteTicket, saveLedger, savePhoto, saveTicket } from './lib/store'
import { watermarkPhoto } from './lib/watermark'
import { buildEvidencePdf, downloadBlob } from './lib/export-pdf'

useSeo({
  title: '租赁证据链 - 入住交接时间戳拍照/报修归责/退租对比/证据包PDF（不上传）',
  description:
    '小房东与租客入住交接拍带时间戳水印的照片留基准，租期报修工单留痕初判责任，退租同位置对比，押金维修台账，一键导出证据 PDF。纯本地、照片不上传。',
  type: 'SoftwareApplication',
  keywords: ['租房证据', '入住交接', '退租对比', '押金纠纷', '报修留痕', '时间戳拍照', '证据包PDF', '本地存储']
})

useToolBilling('rent-evidence')

const tab = ref<'photos' | 'tickets' | 'ledger' | 'export'>('photos')

const photos = ref<PhotoRecord[]>([])
const tickets = ref<RepairTicket[]>([])
const ledger = ref<LedgerEntry[]>([])
const toast = ref('')

async function refresh() {
  photos.value = (await allPhotos()).sort((a, b) => b.at.localeCompare(a.at))
  tickets.value = (await allTickets()).sort((a, b) => b.at.localeCompare(a.at))
  ledger.value = (await allLedger()).sort((a, b) => b.at.localeCompare(a.at))
}
onMounted(refresh)

function say(msg: string) {
  toast.value = msg
  setTimeout(() => (toast.value = ''), 2200)
}

// ---------- 照片（入住/退租交接） ----------
const photoForm = reactive({
  kind: 'move-in' as PhotoKind,
  item: CHECKLIST_ITEMS[0] as string,
  note: ''
})
const addingPhoto = ref(false)

async function onPickPhoto(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  addingPhoto.value = true
  try {
    const at = new Date().toISOString()
    const dataUrl = await watermarkPhoto(file, at, photoForm.note)
    const rec: PhotoRecord = {
      id: genId(),
      at,
      kind: photoForm.kind,
      item: photoForm.item,
      note: photoForm.note,
      dataUrl
    }
    await savePhoto(rec)
    photoForm.note = ''
    await refresh()
    say('已保存带时间戳水印的交接照片')
  } catch (err) {
    say('照片处理失败：' + (err as Error).message)
  } finally {
    addingPhoto.value = false
  }
}

async function removePhoto(p: PhotoRecord) {
  if (!confirm('删除这张交接照片？')) return
  await deletePhoto(p.id)
  await refresh()
}

// ---------- 报修工单 ----------
const ticketForm = reactive({ title: '', description: '', cost: '' })
const ticketPhotos = ref<File[]>([])
const ticketPreviews = ref<string[]>([])
const ticketBusy = ref(false)

function revokePreviews() {
  for (const u of ticketPreviews.value) URL.revokeObjectURL(u)
  ticketPreviews.value = []
}

function onTicketFiles(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files ? Array.from(input.files) : []
  input.value = ''
  revokePreviews()
  ticketPhotos.value = files
  ticketPreviews.value = files.map((f) => URL.createObjectURL(f))
}

function removeTicketPreview(i: number) {
  URL.revokeObjectURL(ticketPreviews.value[i]!)
  ticketPreviews.value.splice(i, 1)
  ticketPhotos.value.splice(i, 1)
}

onUnmounted(revokePreviews)

async function submitTicket() {
  if (!ticketForm.title.trim()) {
    say('请填写报修标题')
    return
  }
  ticketBusy.value = true
  try {
    const at = new Date().toISOString()
    const responsibility = classifyResponsibility(ticketForm.title + ticketForm.description)
    const photoIds: string[] = []
    for (const f of ticketPhotos.value) {
      const dataUrl = await watermarkPhoto(f, at, '报修：' + ticketForm.title)
      const rec: PhotoRecord = { id: genId(), at, kind: 'repair', item: '报修', note: ticketForm.title, dataUrl }
      await savePhoto(rec)
      photoIds.push(rec.id)
    }
    const ticket: RepairTicket = {
      id: genId(),
      at,
      title: ticketForm.title.trim(),
      description: ticketForm.description.trim(),
      responsibility,
      costCents: Math.round(Number(ticketForm.cost || 0) * 100),
      photoIds
    }
    await saveTicket(ticket)
    ticketForm.title = ''
    ticketForm.description = ''
    ticketForm.cost = ''
    ticketPhotos.value = []
    revokePreviews()
    await refresh()
    say('工单已记录，责任初判：' + RESP_LABEL[responsibility])
  } finally {
    ticketBusy.value = false
  }
}

async function removeTicket(t: RepairTicket) {
  if (!confirm('删除这条报修工单？')) return
  await deleteTicket(t.id)
  await refresh()
}

// ---------- 台账 ----------
const ledgerForm = reactive({ kind: 'deposit' as LedgerKind, amount: '', note: '' })

async function submitLedger() {
  const amountCents = Math.round(Number(ledgerForm.amount || 0) * 100)
  if (!amountCents) {
    say('请填写金额')
    return
  }
  await saveLedger({ id: genId(), at: new Date().toISOString(), kind: ledgerForm.kind, amountCents, note: ledgerForm.note.trim() })
  ledgerForm.amount = ''
  ledgerForm.note = ''
  await refresh()
  say('已记账')
}

async function removeLedger(e: LedgerEntry) {
  if (!confirm('删除这笔台账？')) return
  await deleteLedger(e.id)
  await refresh()
}

// ---------- 导出 ----------
const exporting = ref(false)
async function exportPdf() {
  exporting.value = true
  try {
    const rows = summarizeEvidence(photos.value, tickets.value, ledger.value)
    const sections = groupPhotosForPdf(photos.value, tickets.value)
    const blob = await buildEvidencePdf(rows, sections)
    downloadBlob(blob, `租赁证据包_${formatStamp(new Date().toISOString()).replace(/[-: ]/g, '')}.pdf`)
    say('证据包 PDF 已导出（照片原件在应用内相册）')
  } catch (err) {
    say('导出失败：' + (err as Error).message)
  } finally {
    exporting.value = false
  }
}

const repairPhotosOf = (t: RepairTicket) => photos.value.filter((p) => t.photoIds.includes(p.id))
</script>

<template>
  <div class="rw">
    <nav class="tabs">
      <button :class="{ on: tab === 'photos' }" @click="tab = 'photos'">交接照片（{{ photos.length }}）</button>
      <button :class="{ on: tab === 'tickets' }" @click="tab = 'tickets'">报修工单（{{ tickets.length }}）</button>
      <button :class="{ on: tab === 'ledger' }" @click="tab = 'ledger'">台账（{{ ledger.length }}）</button>
      <button :class="{ on: tab === 'export' }" @click="tab = 'export'">证据包</button>
    </nav>

    <div v-if="toast" class="toast">{{ toast }}</div>

    <!-- 交接照片 -->
    <section v-if="tab === 'photos'">
      <div class="card">
        <h3>拍带时间戳水印的交接照</h3>
        <p class="hint">拍摄时刻会白字黑条烧进照片底部，不可事后篡改；入住拍一组、退租在同位置再拍一组对比。</p>
        <div class="row">
          <label>类型
            <select v-model="photoForm.kind">
              <option value="move-in">入住交接</option>
              <option value="move-out">退租复核</option>
            </select>
          </label>
          <label>位置
            <select v-model="photoForm.item">
              <option v-for="i in CHECKLIST_ITEMS" :key="i" :value="i">{{ i }}</option>
            </select>
          </label>
        </div>
        <input v-model="photoForm.note" placeholder="备注（如：墙原有色差约 30cm）" />
        <label class="filebtn">
          {{ addingPhoto ? '处理中…' : '📷 拍照/选图' }}
          <input type="file" accept="image/*" capture="environment" hidden @change="onPickPhoto" />
        </label>
      </div>

      <div class="grid">
        <figure v-for="p in photos" :key="p.id">
          <img :src="p.dataUrl" :alt="p.item" />
          <figcaption>
            <b>{{ p.kind === 'move-in' ? '入住' : p.kind === 'move-out' ? '退租' : '报修' }} · {{ p.item }}</b>
            <small>{{ formatStamp(p.at) }}</small>
            <small v-if="p.note">{{ p.note }}</small>
            <button class="del" @click="removePhoto(p)">删除</button>
          </figcaption>
        </figure>
        <p v-if="photos.length === 0" class="empty">还没有照片，先按上面拍第一张交接照。</p>
      </div>
    </section>

    <!-- 工单 -->
    <section v-else-if="tab === 'tickets'">
      <div class="card">
        <h3>新增报修工单</h3>
        <input v-model="ticketForm.title" placeholder="标题（如：厨房水龙头漏水）" />
        <textarea v-model="ticketForm.description" rows="2" placeholder="补充情况（用于自动初判责任）"></textarea>
        <div class="row">
          <input v-model="ticketForm.cost" type="number" placeholder="维修费用 ¥" />
          <label class="filebtn small">📷 现场照片（可多选）<input type="file" accept="image/*" multiple hidden @change="onTicketFiles" /></label>
        </div>
        <div v-if="ticketPreviews.length" class="previews">
          <div v-for="(u, i) in ticketPreviews" :key="i" class="pv">
            <img :src="u" alt="" />
            <button class="pvdel" title="移除" @click="removeTicketPreview(i)">×</button>
          </div>
        </div>
        <button class="primary" :disabled="ticketBusy" @click="submitTicket">{{ ticketBusy ? '保存中…' : '保存工单' }}</button>
      </div>
      <div class="list">
        <div v-for="t in tickets" :key="t.id" class="item">
          <div class="itemhead">
            <b>{{ t.title }}</b>
            <span :class="['tag', t.responsibility]">{{ RESP_LABEL[t.responsibility] }}</span>
          </div>
          <small>{{ formatStamp(t.at) }} · 费用 ¥{{ (t.costCents / 100).toFixed(0) }}</small>
          <p v-if="t.description">{{ t.description }}</p>
          <div class="thumbrow">
            <img v-for="p in repairPhotosOf(t)" :key="p.id" :src="p.dataUrl" alt="" />
          </div>
          <button class="del" @click="removeTicket(t)">删除</button>
        </div>
        <p v-if="tickets.length === 0" class="empty">还没有工单。</p>
      </div>
    </section>

    <!-- 台账 -->
    <section v-else-if="tab === 'ledger'">
      <div class="card">
        <h3>记一笔</h3>
        <div class="row">
          <select v-model="ledgerForm.kind">
            <option v-for="(label, k) in LEDGER_LABEL" :key="k" :value="k">{{ label }}</option>
          </select>
          <input v-model="ledgerForm.amount" type="number" placeholder="金额 ¥" />
        </div>
        <input v-model="ledgerForm.note" placeholder="备注（如：2026-11 月房租 / 换水龙头）" />
        <button class="primary" @click="submitLedger">记账</button>
      </div>
      <div class="list">
        <div v-for="e in ledger" :key="e.id" class="item">
          <b>{{ LEDGER_LABEL[e.kind] }} ¥{{ (e.amountCents / 100).toFixed(0) }}</b>
          <small>{{ formatStamp(e.at) }}</small>
          <span v-if="e.note">{{ e.note }}</span>
          <button class="del" @click="removeLedger(e)">删</button>
        </div>
        <p v-if="ledger.length === 0" class="empty">还没有记录。</p>
      </div>
    </section>

    <!-- 导出 -->
    <section v-else>
      <div class="card">
        <h3>导出证据包 PDF</h3>
        <p class="hint">汇总入住/退租照片清单、全部报修工单（含责任初判与费用）、押金租金维修台账，按时间线排成 PDF，可直接给调解员/律师。照片原件请在「交接照片」里逐张查看保存。</p>
        <ul class="stat">
          <li>入住交接照：{{ photos.filter((p) => p.kind === 'move-in').length }} 张</li>
          <li>退租复核照：{{ photos.filter((p) => p.kind === 'move-out').length }} 张</li>
          <li>报修工单：{{ tickets.length }} 条</li>
          <li>台账：{{ ledger.length }} 笔</li>
        </ul>
        <button class="primary" :disabled="exporting" @click="exportPdf">{{ exporting ? '导出中…' : '📄 导出证据包 PDF' }}</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.rw { max-width: 860px; margin: 0 auto; padding: 12px; }
.tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
.tabs button { flex: 1; min-width: 80px; padding: 10px 6px; border: 1px solid #d7dce5; border-radius: 10px; background: #fff; font-size: 14px; cursor: pointer; }
.tabs button.on { border-color: #2563eb; background: #eff6ff; color: #2563eb; font-weight: 600; }
.card { border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px; margin-bottom: 14px; background: #fff; }
.card h3 { margin: 0 0 6px; font-size: 16px; }
.hint { color: #6b7280; font-size: 13px; line-height: 1.6; }
.row { display: flex; gap: 10px; margin: 8px 0; flex-wrap: wrap; }
input, textarea, select { width: 100%; box-sizing: border-box; padding: 10px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 15px; margin: 4px 0; }
.row > * { flex: 1; min-width: 120px; }
.filebtn { display: inline-block; padding: 10px 16px; border-radius: 8px; background: #111827; color: #fff; cursor: pointer; margin: 6px 0; font-size: 14px; }
.filebtn.small { background: #374151; font-size: 13px; padding: 8px 12px; }
.primary { width: 100%; margin-top: 8px; padding: 12px; border: 0; border-radius: 10px; background: #2563eb; color: #fff; font-size: 15px; cursor: pointer; }
.primary:disabled { opacity: .6; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px; }
figure { margin: 0; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; background: #fff; }
figure img { width: 100%; display: block; }
figcaption { padding: 8px; font-size: 12px; display: flex; flex-direction: column; gap: 2px; }
figcaption small { color: #6b7280; }
.del { align-self: flex-start; margin-top: 4px; font-size: 12px; color: #b91c1c; background: none; border: 1px solid #fecaca; border-radius: 6px; padding: 2px 8px; cursor: pointer; }
.list .item { border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; background: #fff; }
.itemhead { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.tag { font-size: 12px; padding: 2px 8px; border-radius: 999px; }
.tag.landlord { background: #dcfce7; color: #15803d; }
.tag.tenant { background: #fee2e2; color: #b91c1c; }
.tag.unknown { background: #f3f4f6; color: #4b5563; }
.thumbrow { display: flex; gap: 6px; margin: 6px 0; flex-wrap: wrap; }
.thumbrow img { width: 72px; height: 72px; object-fit: cover; border-radius: 6px; }
.previews { display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0; }
.pv { position: relative; }
.pv img { width: 84px; height: 84px; object-fit: cover; border-radius: 8px; border: 1px solid #d1d5db; display: block; }
.pvdel { position: absolute; top: -6px; right: -6px; width: 20px; height: 20px; border-radius: 50%; border: 0; background: #111827; color: #fff; font-size: 13px; line-height: 1; cursor: pointer; }
.empty { color: #9ca3af; text-align: center; padding: 20px 0; }
.toast { position: fixed; left: 50%; top: 14px; transform: translateX(-50%); background: #111827; color: #fff; padding: 8px 16px; border-radius: 999px; font-size: 13px; z-index: 50; }
.stat { padding-left: 18px; line-height: 1.9; color: #374151; }
</style>
