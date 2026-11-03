<template>
  <div class="rw">
    <h2>{{ manifest.name }}</h2>
    <p class="tag">{{ manifest.tagline }}</p>

    <div class="row">
      <label>年份 <input type="number" v-model.number="form.year" min="2000" max="2100" /></label>
      <label>指标名 <input v-model="form.name" placeholder="如 总胆固醇" /></label>
      <label>数值 <input type="number" step="0.01" v-model.number="form.value" /></label>
      <label>单位 <input v-model="form.unit" placeholder="如 mmol/L" /></label>
      <label>参考上限 <input type="number" step="0.01" v-model.number="form.refHigh" placeholder="可空" /></label>
    </div>
    <div class="row">
      <button class="primary" @click="onSave">{{ form.editId ? '✓ 保存修改' : '＋ 录入本年测量' }}</button>
      <button v-if="form.editId" @click="cancelEdit">取消编辑</button>
      <span v-if="msg" class="msg">{{ msg }}</span>
    </div>

    <div class="row toolbar">
      <input class="search" v-model="keyword" placeholder="🔍 搜索指标名…" />
      <button @click="expandAll">全部展开</button>
      <button @click="collapseAll">全部收起</button>
    </div>

    <div v-for="item in filteredList" :key="item.name" class="card">
      <div class="card-head" @click="toggle(item.name)" style="cursor:pointer">
        <strong>{{ item.name }}</strong>
        <span class="unit">单位：{{ item.unit }}</span>
        <span class="badge" :class="item.status">{{ statusLabel(item.status) }}</span>
        <span class="arrow">{{ collapsed.has(item.name) ? '▸' : '▾' }}</span>
      </div>
      <template v-if="!collapsed.has(item.name)">
        <p class="note">{{ item.note }}</p>
        <svg viewBox="0 0 300 130" class="chart" preserveAspectRatio="xMidYMid meet">
          <line v-if="item.refHigh" x1="36" :y1="yOf(item.refHigh, item)" x2="292" :y2="yOf(item.refHigh, item)" stroke="#e57373" stroke-dasharray="4 3" />
          <polyline :points="item.points" fill="none" stroke="#4a90d9" stroke-width="2" />
          <circle v-for="(p, i) in item.dots" :key="i" :cx="p.x" :cy="p.y" r="3.5" :fill="p.color" />
          <text v-for="(p, i) in item.dots" :key="'t'+i" :x="p.x" :y="Math.max(8, p.y - 6)" font-size="8" text-anchor="middle" fill="#666">{{ p.v }}</text>
          <text v-for="(p, i) in item.dots" :key="'y'+i" :x="p.x" :y="122" font-size="8" text-anchor="middle" fill="#999">{{ p.year }}</text>
        </svg>
        <div class="recs">
          <div v-for="r in item.records" :key="r.id" class="rec">
            <span>{{ r.year }}：{{ r.value }} {{ r.unit }}<template v-if="r.refHigh != null">（上限 {{ r.refHigh }}）</template></span>
            <span class="rec-op">
              <button @click="onEdit(r)">编辑</button>
              <button @click="onDeleteRecord(r)">删</button>
            </span>
          </div>
        </div>
      </template>
    </div>

    <div class="card" v-if="actionList.length">
      <h3>复查行动清单</h3>
      <ul><li v-for="a in actionList" :key="a.name">【{{ statusLabel(a.status) }}】{{ a.name }} —— {{ a.note }}</li></ul>
      <button class="primary" @click="exportPdf">导出复查清单 PDF</button>
    </div>
    <p v-else-if="records.length" class="empty">全部指标趋势平稳，暂无复查项 👍</p>
  </div>
</template>

<script lang="ts">
import { defineComponent, reactive, ref, computed, onMounted } from 'vue'
import { manifest } from './manifest'
import { allRecords, saveRecord, deleteRecord } from './lib/store'
import { buildActionList, genId, groupByName, trendStatus, type MetricRecord, type TrendStatus } from './lib/model'
import { PDFDocument } from 'pdf-lib'

interface ChartItem {
  name: string
  unit: string
  refHigh: number | null
  status: TrendStatus
  note: string
  points: string
  maxV: number
  records: MetricRecord[]
  dots: Array<{ x: number; y: number; v: number; year: number; color: string }>
}

export default defineComponent({
  name: 'HealthTrendTool',
  setup() {
    const records = ref<MetricRecord[]>([])
    const msg = ref('')
    const form = reactive({ editId: '' as string, year: new Date().getFullYear(), name: '', value: NaN, unit: '', refHigh: NaN })
    const chartList = ref<ChartItem[]>([])
    const actionList = ref<ReturnType<typeof buildActionList>>([])
    const keyword = ref('')
    const collapsed = ref(new Set<string>())

    const rebuild = () => {
      const groups = groupByName(records.value)
      const list: ChartItem[] = []
      for (const [name, arr] of groups) {
        const { status, note } = trendStatus(name, arr)
        const maxV = Math.max(...arr.map(r => r.value), ...arr.map(r => r.refHigh ?? 0), 1)
        const xs = arr.map((_, i) => 36 + (i * 256) / Math.max(arr.length - 1, 1))
        const dots = arr.map((r, i) => ({ x: xs[i]!, y: 100 - (r.value / maxV) * 80, v: r.value, year: r.year, color: status === 'abnormal' ? '#e57373' : '#4a90d9' }))
        list.push({
          name, unit: arr[0]!.unit, refHigh: arr[arr.length - 1]!.refHigh ?? null, status, note, maxV, records: arr,
          points: dots.map(d => `${d.x},${d.y}`).join(' '),
          dots
        })
        // 有预警默认展开，平稳默认折叠
        if (status === 'ok') collapsed.value.add(name)
        else collapsed.value.delete(name)
      }
      chartList.value = list
      actionList.value = buildActionList(records.value)
    }

    const load = async () => { records.value = await allRecords(); rebuild() }
    onMounted(load)

    const onSave = async () => {
      if (!form.name || Number.isNaN(form.value)) { msg.value = '指标名和数值必填'; return }
      const id = form.editId || genId()
      await saveRecord({ id, year: form.year, name: form.name.trim(), value: form.value, unit: form.unit.trim(), refLow: null, refHigh: Number.isNaN(form.refHigh) ? null : form.refHigh })
      msg.value = form.editId ? '已更新 ✓' : '已录入 ✓'
      form.editId = ''
      await load()
    }
    const cancelEdit = () => { form.editId = ''; msg.value = '' }

    const onEdit = (r: MetricRecord) => {
      form.editId = r.id
      form.year = r.year
      form.name = r.name
      form.value = r.value
      form.unit = r.unit
      form.refHigh = r.refHigh ?? NaN
      msg.value = `正在编辑 ${r.name} ${r.year} 年…`
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }

    const onDeleteRecord = async (r: MetricRecord) => {
      if (!confirm(`删除 ${r.name} ${r.year} 年的记录（${r.value} ${r.unit}）？`)) return
      await deleteRecord(r.id)
      msg.value = `已删除 ${r.name} ${r.year}`
      await load()
    }

    const toggle = (name: string) => {
      const s = new Set(collapsed.value)
      if (s.has(name)) s.delete(name); else s.add(name)
      collapsed.value = s
    }
    const expandAll = () => { collapsed.value = new Set() }
    const collapseAll = () => { collapsed.value = new Set(chartList.value.map(c => c.name)) }

    const filteredList = computed(() =>
      chartList.value.filter(c => !keyword.value.trim() || c.name.includes(keyword.value.trim()))
    )

    const yOf = (v: number, item: ChartItem) => 100 - (v / item.maxV) * 80

    const statusLabel = (s: TrendStatus) => s === 'abnormal' ? '已超限' : s === 'climb' ? '缓慢爬升' : '平稳'

    const exportPdf = async () => {
      const doc = document.createElement('canvas')
      const c = doc.getContext('2d')!
      const W = 595, H = 842
      doc.width = W; doc.height = H
      c.fillStyle = '#fff'; c.fillRect(0, 0, W, H)
      c.fillStyle = '#222'; c.font = 'bold 18px "PingFang SC","Microsoft YaHei"'
      c.fillText('体检指标复查清单', 40, 50)
      c.font = '11px "PingFang SC","Microsoft YaHei"'; c.fillStyle = '#666'
      c.fillText(`生成日期 ${new Date().toISOString().slice(0, 10)} · 本地生成，数据不上传`, 40, 72)
      c.fillStyle = '#222'
      let y = 110
      for (const a of actionList.value) {
        c.fillStyle = a.status === 'abnormal' ? '#c62828' : '#ef6c00'
        c.font = 'bold 13px "PingFang SC","Microsoft YaHei"'
        c.fillText(`【${statusLabel(a.status)}】${a.name}`, 40, y); y += 20
        c.fillStyle = '#444'; c.font = '11px "PingFang SC","Microsoft YaHei"'
        c.fillText(a.note, 55, y); y += 34
      }
      const jpg = doc.toDataURL('image/jpeg', 0.92)
      const pdf = await PDFDocument.create()
      const page = pdf.addPage([W, H])
      const img = await pdf.embedJpg(new Uint8Array(await (await fetch(jpg)).arrayBuffer()))
      page.drawImage(img, { x: 0, y: 0, width: W, height: H })
      const bytes = await pdf.save()
      const url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url; a.download = `体检复查清单_${Date.now()}.pdf`; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
    }

    return { manifest, records, msg, form, chartList, actionList, keyword, collapsed, filteredList, onSave, cancelEdit, onEdit, onDeleteRecord, toggle, expandAll, collapseAll, exportPdf, statusLabel, yOf }
  }
})
</script>

<style scoped>
.rw { max-width: 780px; margin: 0 auto; padding: 16px; font-size: 14px; box-sizing: border-box; width: 100%; }
.tag { color: #666; overflow-wrap: break-word; }
.row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin: 10px 0; }
.row.small { margin: 6px 0 0; }
.row.toolbar { align-items: center; }
.search { flex: 1 1 160px; padding: 6px 8px; border: 1px solid #ccc; border-radius: 6px; }
.row label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #666; flex: 1 1 140px; max-width: 100%; }
.row input { padding: 6px 8px; border: 1px solid #ccc; border-radius: 6px; width: 100%; box-sizing: border-box; }
.primary { background: #2563eb; color: #fff; border: none; padding: 8px 16px; border-radius: 8px; cursor: pointer; }
button { padding: 4px 10px; border: 1px solid #ccc; border-radius: 6px; background: #fff; cursor: pointer; font-size: 13px; }
.msg { color: #16a34a; }
.card { border: 1px solid #eee; border-radius: 10px; padding: 12px; margin: 12px 0; }
.card-head { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.arrow { margin-left: auto; color: #999; }
.unit { color: #999; font-size: 12px; }
.badge { padding: 2px 8px; border-radius: 99px; font-size: 12px; }
.badge.ok { background: #dcfce7; color: #166534; }
.badge.climb { background: #ffedd5; color: #c2410c; }
.badge.abnormal { background: #fee2e2; color: #991b1b; }
.note { color: #555; font-size: 13px; margin: 6px 0; }
.chart { width: 100%; height: 130px; }
.recs { margin-top: 6px; }
.rec { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; border-top: 1px dashed #eee; font-size: 13px; }
.rec-op { display: flex; gap: 6px; }
.empty { color: #999; text-align: center; margin: 24px 0; }
</style>
