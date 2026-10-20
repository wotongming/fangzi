<script setup lang="ts">
/**
 * 家庭资产档案库 —— 全部数据只存本机 IndexedDB，离线可用，不上云。
 * 边界：只管理用户本人录入的物品档案与本人拍照的凭证；不抓取第三方版权内容，
 * 不做实时云同步；双人协作 = 加密备份包互传合并。
 */
import { computed, onMounted, onUnmounted, reactive, ref, toRaw } from 'vue'
import { useToolBilling } from '@/composables/useToolBilling'
import { useSeo } from '@/composables/useSeo'
import { manifest } from './manifest'
import {
  CATEGORY_PRESETS,
  DOC_KIND_LABELS,
  EXPIRY_KIND_LABELS,
  FREE_ASSET_LIMIT,
  formatCents,
  todayStr,
  uid,
  yuanToCents,
  type Asset,
  type Box,
  type BoxItem,
  type Doc,
  type DocKind,
  type ExpiryItem,
  type ExpiryKind
} from './lib/models'
import {
  clearAll,
  getAllAssets,
  getAllBoxes,
  getAllBoxItems,
  getAllDocs,
  putAsset,
  putBox,
  putBoxItem,
  putDoc,
  readManualExpiry,
  removeAsset,
  removeBox,
  removeBoxItem,
  removeDoc,
  writeManualExpiry
} from './lib/store'
import { compressPhoto } from './lib/photos'
import { buildExpiryIcs, buildExpiryRows, downloadIcs, EXPIRY_LEVEL_LABELS } from './lib/expiry'
import { isBarcodeDetectorSupported, renderBoxQrSvg } from './lib/qrcode'
import { buildClaimHtml, buildClaimManifest, buildClaimZip, downloadBlob } from './lib/claim-pack'
import { exportBackup, importBackup, summarizeImport } from './lib/backup'
import { OCR_NOTICE } from './lib/ocr'

useSeo({
  title: '家庭资产档案库 - 发票保修卡归档/到期提醒/搬家QR箱单/理赔资料包/加密备份',
  description:
    '把家电数码证件保单的发票保修卡拍照归档到本机，保修保险年检到期分级提醒并导出系统日历；搬家生成纸箱二维码标签、搜索即知物品在几号箱；勾选资产一键导出理赔清单与凭证 ZIP；口令加密备份换机合并。数据不出设备、离线可用。',
  type: 'WebApplication',
  keywords: manifest.keywords
})

const billing = useToolBilling(manifest.id)
const canUnlimited = computed(() => billing.canUse('unlimited-assets').allowed)
const canClaim = computed(() => billing.canUse('claim-pack').allowed)
const canBackup = computed(() => billing.canUse('backup').allowed)
const priceText = computed(() => billing.priceText(billing.plan.priceCents))
async function upgrade() {
  await billing.buy('freemium-pro')
}

// —— 数据 ——
const loaded = ref(false)
const assets = ref<Asset[]>([])
const docs = ref<Doc[]>([])
const boxes = ref<Box[]>([])
const boxItems = ref<BoxItem[]>([])
const manualExpiry = ref<ExpiryItem[]>([])

const toast = ref('')
function notify(msg: string) {
  toast.value = msg
  setTimeout(() => (toast.value = ''), 3000)
}

// 照片对象 URL 缓存
const urlMap = new Map<string, string>()
function docUrl(d: Doc): string {
  const hit = urlMap.get(d.id)
  if (hit) return hit
  const url = URL.createObjectURL(d.photoBlob)
  urlMap.set(d.id, url)
  return url
}
onUnmounted(() => urlMap.forEach((u) => URL.revokeObjectURL(u)))

async function reload() {
  const [a, d, b, bi] = await Promise.all([getAllAssets(), getAllDocs(), getAllBoxes(), getAllBoxItems()])
  assets.value = a.sort((x, y) => y.updatedAt - x.updatedAt)
  docs.value = d
  boxes.value = b.sort((x, y) => x.createdAt - y.createdAt)
  boxItems.value = bi
  manualExpiry.value = readManualExpiry()
  loaded.value = true
}
onMounted(reload)

// —— Tab 与搜索 ——
type Tab = 'vault' | 'calendar' | 'moving' | 'claim' | 'backup'
const tab = ref<Tab>('vault')
function switchTab(t: Tab) {
  tab.value = t
}
const search = ref('')

const docsOfAsset = (assetId: string) => docs.value.filter((d) => d.assetId === assetId)
const boxOfAsset = computed(() => {
  const map = new Map<string, Box>()
  for (const it of boxItems.value) {
    const b = boxes.value.find((x) => x.id === it.boxId)
    if (b) map.set(it.assetId, b)
  }
  return map
})

const filteredAssets = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return assets.value
  return assets.value.filter((a) =>
    [a.name, a.category, a.location, a.brandModel ?? '', a.serialNo ?? '', a.notes ?? '']
      .join(' ')
      .toLowerCase()
      .includes(q)
  )
})

// —— 资产表单 / 免费 50 卡门 ——
const showAssetForm = ref(false)
const editingId = ref<string | null>(null)
const form = reactive({
  name: '',
  category: '家电',
  location: '',
  purchaseDate: '',
  priceYuan: '',
  brandModel: '',
  serialNo: '',
  warrantyEnd: '',
  notes: ''
})
interface PendingDoc {
  kind: DocKind
  note: string
  blob: Blob
  url: string
  bytes: number
}
const pendingDocs = ref<PendingDoc[]>([])
const showUpgrade = ref(false)

function openAssetForm(a?: Asset) {
  if (!a && assets.value.length >= FREE_ASSET_LIMIT && !canUnlimited.value) {
    showUpgrade.value = true
    notify(`免费版最多 ${FREE_ASSET_LIMIT} 张资产卡片，升级后不限量`)
    return
  }
  editingId.value = a?.id ?? null
  pendingDocs.value = []
  form.name = a?.name ?? ''
  form.category = a?.category ?? '家电'
  form.location = a?.location ?? ''
  form.purchaseDate = a?.purchaseDate ?? ''
  form.priceYuan = a?.priceCents != null ? String(a.priceCents / 100) : ''
  form.brandModel = a?.brandModel ?? ''
  form.serialNo = a?.serialNo ?? ''
  form.warrantyEnd = a?.warrantyEnd ?? ''
  form.notes = a?.notes ?? ''
  showAssetForm.value = true
}

const pendingKind = ref<DocKind>('invoice')
async function onPickPhoto(file: File | null) {
  if (!file) return
  try {
    const out = await compressPhoto(file)
    pendingDocs.value.push({ kind: pendingKind.value, note: '', blob: out.blob, url: URL.createObjectURL(out.blob), bytes: out.bytes })
    notify('照片已压缩（去 EXIF），保存资产后挂到凭证链')
  } catch {
    notify('图片读取失败，请换一张试试')
  }
}
function removePending(i: number) {
  const p = pendingDocs.value[i]
  if (p) {
    URL.revokeObjectURL(p.url)
    pendingDocs.value.splice(i, 1)
  }
}

async function saveAsset() {
  if (!form.name.trim()) {
    notify('请填写物品名称')
    return
  }
  const now = Date.now()
  const existing = editingId.value ? assets.value.find((x) => x.id === editingId.value) : undefined
  const flat = toRaw(form)
  const asset: Asset = {
    id: existing?.id ?? uid('ast'),
    name: flat.name.trim(),
    category: flat.category.trim() || '其它',
    location: flat.location.trim(),
    purchaseDate: flat.purchaseDate || undefined,
    priceCents: yuanToCents(flat.priceYuan),
    brandModel: flat.brandModel.trim() || undefined,
    serialNo: flat.serialNo.trim() || undefined,
    warrantyEnd: flat.warrantyEnd || undefined,
    notes: flat.notes.trim() || undefined,
    boxId: existing?.boxId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  }
  await putAsset(asset)
  for (const p of pendingDocs.value) {
    await putDoc({ id: uid('doc'), assetId: asset.id, kind: p.kind, note: p.note || undefined, photoBlob: p.blob, createdAt: now })
    URL.revokeObjectURL(p.url)
  }
  pendingDocs.value = []
  showAssetForm.value = false
  await reload()
  notify(existing ? '已保存修改' : '已加入档案')
}

async function deleteAsset(id: string) {
  if (!confirm('删除这张资产卡片？其凭证照片也会一并删除。')) return
  for (const d of docsOfAsset(id)) await removeDoc(d.id)
  for (const it of boxItems.value.filter((x) => x.assetId === id)) await removeBoxItem(it.id)
  await removeAsset(id)
  await reload()
  notify('已删除')
}

async function deleteDoc(id: string) {
  await removeDoc(id)
  await reload()
}

// —— 到期日历 ——
const rows = computed(() => buildExpiryRows(assets.value, manualExpiry.value, todayStr()))
const levelBadge = (lv: string) => ({ expired: 'lv-expired', soon7: 'lv-soon7', soon30: 'lv-soon30', ok: 'lv-ok' }[lv] ?? 'lv-ok')

function exportIcs() {
  if (rows.value.length === 0) {
    notify('暂无到期项可导出')
    return
  }
  downloadIcs(buildExpiryIcs(rows.value, todayStr()))
  notify('已导出 .ics（提前 30 天 / 7 天双提醒）')
}

// 手动到期项
const showManualForm = ref(false)
const manual = reactive({ title: '', dueDate: '', kind: 'license' as ExpiryKind })
function openManual() {
  manual.title = ''
  manual.dueDate = ''
  manual.kind = 'license'
  showManualForm.value = true
}
function saveManual() {
  if (!manual.title.trim() || !manual.dueDate) {
    notify('请填写名称与到期日')
    return
  }
  const next = [...manualExpiry.value, { id: uid('exp'), title: manual.title.trim(), dueDate: manual.dueDate, kind: manual.kind }]
  manualExpiry.value = next
  writeManualExpiry(next)
  showManualForm.value = false
  notify('已加入到期日历')
}
function removeManual(id: string) {
  const next = manualExpiry.value.filter((x) => x.id !== id)
  manualExpiry.value = next
  writeManualExpiry(next)
}

// —— 搬家箱单 ——
const qrSvg = ref<Record<string, string>>({})
const showBoxForm = ref(false)
const boxForm = reactive({ code: '', destRoom: '', note: '' })
const scanSupported = isBarcodeDetectorSupported()

async function openBoxForm() {
  boxForm.code = String(boxes.value.length + 1)
  boxForm.destRoom = ''
  boxForm.note = ''
  showBoxForm.value = true
}
async function saveBox() {
  if (!boxForm.destRoom.trim()) {
    notify('请填写目的地房间（如 卧室区）')
    return
  }
  const box: Box = {
    id: uid('box'),
    code: boxForm.code.trim() || String(boxes.value.length + 1),
    destRoom: boxForm.destRoom.trim(),
    note: boxForm.note.trim() || undefined,
    createdAt: Date.now()
  }
  await putBox(box)
  showBoxForm.value = false
  await reload()
  // 建箱即生成 QR（懒加载 qrcode chunk）
  try {
    const r = await renderBoxQrSvg(box.id)
    qrSvg.value = { ...qrSvg.value, [box.id]: r.svg }
  } catch {
    notify('QR 生成失败，可稍后在箱单卡片上重试')
  }
  notify(`已建 ${box.code} 号箱，QR 标签已生成`)
}
async function retryQr(box: Box) {
  const r = await renderBoxQrSvg(box.id)
  qrSvg.value = { ...qrSvg.value, [box.id]: r.svg }
}
async function deleteBox(id: string) {
  if (!confirm('删除该箱号？箱内物品关联会一并移除，物品本身不删。')) return
  for (const it of boxItems.value.filter((x) => x.boxId === id)) await removeBoxItem(it.id)
  await removeBox(id)
  await reload()
}

// 手输/点选箱号挂物品
const assignAssetId = ref('')
const assignBoxId = ref('')
async function assignItem() {
  if (!assignAssetId.value || !assignBoxId.value) {
    notify('请选择物品与箱号')
    return
  }
  await putBoxItem({ id: uid('bitem'), boxId: assignBoxId.value, assetId: assignAssetId.value, ts: Date.now() })
  const a = assets.value.find((x) => x.id === assignAssetId.value)
  if (a) {
    await putAsset({ ...toRaw(a), boxId: assignBoxId.value, updatedAt: Date.now() })
  }
  assignAssetId.value = ''
  await reload()
  notify('已挂入箱单')
}
async function unassign(item: BoxItem) {
  await removeBoxItem(item.id)
  await reload()
}

// —— 理赔资料包（Pro） ——
const selected = ref<Set<string>>(new Set())
function toggleSelect(id: string) {
  const s = new Set(selected.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  selected.value = s
}
async function exportClaim() {
  if (!canClaim.value) {
    showUpgrade.value = true
    return
  }
  const picked = assets.value.filter((a) => selected.value.has(a.id))
  if (picked.length === 0) {
    notify('请先勾选要理赔的资产')
    return
  }
  const zip = await buildClaimZip(picked, docs.value)
  downloadBlob(zip, `理赔资料包_${todayStr().replace(/-/g, '')}.zip`)
  notify('理赔资料包 ZIP 已导出（清单.html + 凭证照片 + manifest.json）')
}
function previewClaimHtml() {
  if (!canClaim.value) {
    showUpgrade.value = true
    return
  }
  const picked = assets.value.filter((a) => selected.value.has(a.id))
  if (picked.length === 0) {
    notify('请先勾选要理赔的资产')
    return
  }
  const html = buildClaimHtml(buildClaimManifest(picked, docs.value))
  const w = window.open('', '_blank')
  if (w) {
    w.document.write(html)
    w.document.close()
  }
}

// —— 备份 / 导入（Pro） ——
const backupPwd = ref('')
const importPwd = ref('')
const importMsg = ref('')
async function doExportBackup() {
  if (!canBackup.value) {
    showUpgrade.value = true
    return
  }
  if (!backupPwd.value) {
    notify('请设置备份口令（遗忘将无法解开备份包）')
    return
  }
  try {
    const name = await exportBackup(backupPwd.value)
    backupPwd.value = ''
    notify(`已导出加密备份 ${name}`)
  } catch (e) {
    notify(e instanceof Error ? e.message : '加密导出失败')
  }
}
async function onImportFile(file: File | null) {
  if (!file) return
  if (!canBackup.value) {
    showUpgrade.value = true
    return
  }
  if (!importPwd.value) {
    notify('请输入备份口令')
    return
  }
  try {
    const c = await importBackup(file, importPwd.value)
    importMsg.value = summarizeImport(c)
    importPwd.value = ''
    await reload()
    notify(`导入完成：${importMsg.value}`)
  } catch (e) {
    importMsg.value = ''
    notify(e instanceof Error ? e.message : '导入失败')
  }
}
const confirmClear = ref(false)
async function doClear() {
  if (!confirmClear.value) {
    confirmClear.value = true
    notify('再次点击「清空全库」确认删除全部本机数据')
    return
  }
  await clearAll()
  confirmClear.value = false
  await reload()
  notify('已清空本机档案')
}

function printLabel() {
  window.print()
}
</script>

<template>
  <div class="hv-app">
    <div class="apphead">
      <h1 class="brand">🏠 家庭资产档案库</h1>
      <nav class="seg" aria-label="功能导航">
        <button :class="{ on: tab === 'vault' }" @click="switchTab('vault')">🗂️ 档案</button>
        <button :class="{ on: tab === 'calendar' }" @click="switchTab('calendar')">📅 到期
          <i v-if="rows.some(r => r.level !== 'ok')" class="seg-badge">{{ rows.filter(r => r.level !== 'ok').length }}</i>
        </button>
        <button :class="{ on: tab === 'moving' }" @click="switchTab('moving')">📦 搬家箱单</button>
        <button :class="{ on: tab === 'claim' }" @click="switchTab('claim')">🧾 理赔</button>
        <button :class="{ on: tab === 'backup' }" @click="switchTab('backup')">⚙️ 备份</button>
      </nav>
    </div>

    <!-- ============ 档案 ============ -->
    <section v-if="tab === 'vault'" class="page">
      <div class="book-head">
        <input class="search" v-model="search" placeholder="搜索名称 / 类别 / 位置 / 型号 / 序列号" />
        <button class="btn primary" @click="openAssetForm()">＋ 录一件</button>
      </div>
      <p v-if="loaded && assets.length === 0" class="muted tiny">
        还没有档案。把冰箱、洗衣机、笔记本、证件、保单的发票保修卡拍照录进来，数据只存这台设备。
      </p>
      <div class="grid">
        <article v-for="a in filteredAssets" :key="a.id" class="card asset-card">
          <div class="asset-top">
            <strong class="asset-name">{{ a.name }}</strong>
            <span class="chip">{{ a.category }}</span>
          </div>
          <div class="kv"><span class="lb">位置</span>{{ a.location || '未填' }}</div>
          <div v-if="a.brandModel" class="kv"><span class="lb">型号</span>{{ a.brandModel }}</div>
          <div v-if="a.serialNo" class="kv"><span class="lb">序列号</span>{{ a.serialNo }}</div>
          <div v-if="a.purchaseDate" class="kv"><span class="lb">购入</span>{{ a.purchaseDate }}<span v-if="a.priceCents != null"> · ¥{{ formatCents(a.priceCents) }}</span></div>
          <div v-if="a.warrantyEnd" class="kv"><span class="lb">保修至</span>{{ a.warrantyEnd }}</div>
          <div v-if="boxOfAsset.has(a.id)" class="kv box-hint">📦 在 {{ boxOfAsset.get(a.id)!.code }} 号箱 · {{ boxOfAsset.get(a.id)!.destRoom }}</div>
          <div class="doc-row">
            <div v-for="d in docsOfAsset(a.id)" :key="d.id" class="doc-thumb">
              <img :src="docUrl(d)" :alt="DOC_KIND_LABELS[d.kind]" />
              <span class="doc-kind">{{ DOC_KIND_LABELS[d.kind] }}</span>
              <button class="doc-del" @click="deleteDoc(d.id)" title="删除凭证">×</button>
            </div>
          </div>
          <div class="row-ops">
            <button class="btn small" @click="openAssetForm(a)">编辑</button>
            <button class="btn small ghost danger-text" @click="deleteAsset(a.id)">删除</button>
          </div>
        </article>
      </div>
      <p v-if="!canUnlimited" class="muted tiny">免费版 {{ assets.length }}/{{ FREE_ASSET_LIMIT }} 张卡片；升级后不限量。</p>
    </section>

    <!-- ============ 到期日历 ============ -->
    <section v-if="tab === 'calendar'" class="page">
      <div class="book-head">
        <h2 class="page-h">到期看板 <small class="muted">逾期红 · 7 天内橙 · 30 天内黄</small></h2>
        <div class="row-ops">
          <button class="btn small" @click="openManual()">＋ 登记到期项</button>
          <button class="btn small" @click="exportIcs">导出 .ics</button>
        </div>
      </div>
      <p v-if="rows.length === 0" class="muted">还没有到期项：资产的保修截止会自动出现在这里，也可手动登记证件/保险/年检。</p>
      <ul class="due-list">
        <li v-for="r in rows" :key="r.id" class="due-item" :class="levelBadge(r.level)">
          <div class="due-main">
            <strong>{{ r.title }}</strong>
            <span class="muted tiny">{{ EXPIRY_KIND_LABELS[r.kind] }} · 到期 {{ r.dueDate }}</span>
          </div>
          <span class="level-tag" :class="levelBadge(r.level)">
            {{ EXPIRY_LEVEL_LABELS[r.level] }}<template v-if="r.days != null && r.days >= 0">（{{ r.days }} 天）</template>
            <template v-else-if="r.days != null">（已逾期 {{ -r.days }} 天）</template>
          </span>
          <button v-if="r.assetId" class="btn tiny ghost" @click="switchTab('vault')">去档案</button>
          <button v-else class="btn tiny ghost danger-text" @click="removeManual(r.id)">删除</button>
        </li>
      </ul>
      <p class="compliance">.ics 导入手机/电脑系统日历后，提前 30 天与 7 天各提醒一次；工具本身不做后台推送。</p>
    </section>

    <!-- ============ 搬家箱单 ============ -->
    <section v-if="tab === 'moving'" class="page">
      <div class="book-head">
        <h2 class="page-h">纸箱 QR 箱单</h2>
        <button class="btn small primary" @click="openBoxForm()">＋ 建箱</button>
      </div>
      <p v-if="!scanSupported" class="muted tiny">当前浏览器不支持原生扫码，已自动走「手输 / 点选箱号」降级路径，功能不受影响。</p>

      <div class="card assign-card">
        <div class="card-h">把物品挂入箱（手输 / 点选降级）</div>
        <div class="grid2">
          <select v-model="assignAssetId" aria-label="选择物品">
            <option value="">选择物品</option>
            <option v-for="a in assets" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
          <select v-model="assignBoxId" aria-label="选择箱号">
            <option value="">选择箱号</option>
            <option v-for="b in boxes" :key="b.id" :value="b.id">{{ b.code }} 号箱 · {{ b.destRoom }}</option>
          </select>
        </div>
        <button class="btn primary block" @click="assignItem">挂入箱</button>
      </div>

      <div v-for="b in boxes" :key="b.id" class="card box-card">
        <div class="box-top">
          <strong>{{ b.code }} 号箱 · {{ b.destRoom }}</strong>
          <span class="muted tiny">{{ b.note || '' }}</span>
        </div>
        <div v-if="qrSvg[b.id]" class="qr-box" v-html="qrSvg[b.id]"></div>
        <div v-else class="row-ops">
          <button class="btn tiny" @click="retryQr(b)">生成 QR 标签</button>
        </div>
        <div class="row-ops">
          <button class="btn tiny ghost" @click="printLabel">打印标签</button>
          <button class="btn tiny ghost danger-text" @click="deleteBox(b.id)">删箱</button>
        </div>
        <ul class="box-items">
          <li v-for="it in boxItems.filter(x => x.boxId === b.id)" :key="it.id">
            {{ assets.find(a => a.id === it.assetId)?.name ?? '(物品已删)' }}
            <button class="doc-del" @click="unassign(it)">×</button>
          </li>
          <li v-if="boxItems.filter(x => x.boxId === b.id).length === 0" class="muted tiny">箱内暂无物品</li>
        </ul>
      </div>
    </section>

    <!-- ============ 理赔 ============ -->
    <section v-if="tab === 'claim'" class="page">
      <h2 class="page-h">理赔资料包 <small class="muted">专业版 · 清单 HTML + 凭证照片 ZIP</small></h2>
      <div v-if="!canClaim" class="card upgrade-card">
        <div class="card-h">🔒 理赔资料包为专业版功能</div>
        <p class="muted tiny">勾选资产后一键导出含清单与全部凭证照片的 ZIP，直接发给保险公司；一次买断 {{ priceText }}。</p>
        <button class="btn primary block" @click="upgrade">升级专业版</button>
      </div>
      <template v-else>
        <label v-for="a in assets" :key="a.id" class="claim-row">
          <input type="checkbox" :checked="selected.has(a.id)" @change="toggleSelect(a.id)" />
          <span>{{ a.name }}</span>
          <span class="muted tiny">{{ docsOfAsset(a.id).length }} 份凭证</span>
        </label>
        <div class="row-ops">
          <button class="btn primary" @click="exportClaim">导出理赔 ZIP</button>
          <button class="btn" @click="previewClaimHtml">预览/打印清单</button>
        </div>
      </template>
    </section>

    <!-- ============ 备份 ============ -->
    <section v-if="tab === 'backup'" class="page">
      <h2 class="page-h">加密备份 / 导入合并 <small class="muted">专业版 · 口令不出设备</small></h2>
      <div v-if="!canBackup" class="card upgrade-card">
        <div class="card-h">🔒 加密备份为专业版功能</div>
        <p class="muted tiny">全库（含照片）PBKDF2 + AES-GCM-256 加密成单个 JSON，换机导入自动合并；一次买断 {{ priceText }}。</p>
        <button class="btn primary block" @click="upgrade">升级专业版</button>
      </div>
      <template v-else>
        <div class="card">
          <div class="card-h">导出加密备份</div>
          <label>备份口令（请牢记，遗忘无法解开）</label>
          <input type="password" v-model="backupPwd" placeholder="至少 6 位，建议字母+数字" />
          <button class="btn primary block" @click="doExportBackup">导出 home-vault-backup-日期.json</button>
        </div>
        <div class="card">
          <div class="card-h">导入备份包（合并：同 id 取较新）</div>
          <label>备份口令</label>
          <input type="password" v-model="importPwd" placeholder="导出时设置的口令" />
          <label class="btn file-btn">选择备份 JSON
            <input type="file" accept="application/json,.json" class="hidden-file" @change="onImportFile(($event.target as HTMLInputElement).files?.[0] ?? null)" />
          </label>
          <p v-if="importMsg" class="muted tiny">上次导入：{{ importMsg }}</p>
        </div>
        <div class="card danger-card">
          <div class="card-h danger-text">清空全库</div>
          <p class="muted tiny">删除本机全部资产、凭证、箱单与到期项（不可恢复，请先导出备份）。</p>
          <button class="btn small danger-text" :class="{ armed: confirmClear }" @click="doClear">{{ confirmClear ? '再次点击确认清空' : '清空全库' }}</button>
        </div>
      </template>
      <p class="compliance">本工具不做实时云同步；双人协作 = 导出包微信互传后导入合并。OCR 为实验增强，当前手动录入完全可用。</p>
      <p class="muted tiny">{{ OCR_NOTICE }}</p>
    </section>

    <!-- ============ 资产弹层 ============ -->
    <div v-if="showAssetForm" class="modal-mask" @click.self="showAssetForm = false">
      <div class="modal">
        <h3>{{ editingId ? '编辑资产' : '录一件资产' }}</h3>
        <label>名称 *</label>
        <input type="text" v-model="form.name" placeholder="如 西门子冰箱" />
        <div class="grid2">
          <div>
            <label>类别</label>
            <input list="hv-cats" v-model="form.category" />
            <datalist id="hv-cats"><option v-for="c in CATEGORY_PRESETS" :key="c" :value="c"></option></datalist>
          </div>
          <div><label>存放位置</label><input type="text" v-model="form.location" placeholder="如 厨房-冰箱位" /></div>
          <div><label>购入日期</label><input type="date" v-model="form.purchaseDate" /></div>
          <div><label>购入价（元）</label><input type="number" inputmode="decimal" v-model="form.priceYuan" placeholder="0.00" /></div>
          <div><label>品牌/型号</label><input type="text" v-model="form.brandModel" /></div>
          <div><label>序列号</label><input type="text" v-model="form.serialNo" /></div>
          <div><label>保修截止</label><input type="date" v-model="form.warrantyEnd" /></div>
        </div>
        <label>备注</label>
        <textarea rows="2" v-model="form.notes"></textarea>

        <label>挂凭证照片（自动压缩去 EXIF/GPS）</label>
        <div class="grid2">
          <select v-model="pendingKind" aria-label="凭证类型">
            <option v-for="(label, k) in DOC_KIND_LABELS" :key="k" :value="k">{{ label }}</option>
          </select>
          <label class="btn file-btn">拍照/选图
            <input type="file" accept="image/*" capture="environment" class="hidden-file" @change="onPickPhoto(($event.target as HTMLInputElement).files?.[0] ?? null)" />
          </label>
        </div>
        <div v-for="(p, i) in pendingDocs" :key="i" class="doc-thumb pending">
          <img :src="p.url" alt="待存凭证" />
          <span class="doc-kind">{{ DOC_KIND_LABELS[p.kind] }}</span>
          <button class="doc-del" @click="removePending(i)">×</button>
        </div>

        <div class="row-ops">
          <button class="btn" @click="showAssetForm = false">取消</button>
          <button class="btn primary" @click="saveAsset">保存资产</button>
        </div>
      </div>
    </div>

    <!-- ============ 手动到期弹层 ============ -->
    <div v-if="showManualForm" class="modal-mask" @click.self="showManualForm = false">
      <div class="modal">
        <h3>登记到期项</h3>
        <label>名称 *（如 护照 / 车险续保 / 车辆年检）</label>
        <input type="text" v-model="manual.title" />
        <div class="grid2">
          <div>
            <label>类型</label>
            <select v-model="manual.kind">
              <option value="license">证件</option>
              <option value="insurance">保险</option>
              <option value="inspection">年检/年审</option>
              <option value="warranty">保修</option>
            </select>
          </div>
          <div><label>到期日 *</label><input type="date" v-model="manual.dueDate" /></div>
        </div>
        <div class="row-ops">
          <button class="btn" @click="showManualForm = false">取消</button>
          <button class="btn primary" @click="saveManual">保存</button>
        </div>
      </div>
    </div>

    <!-- ============ 建箱弹层 ============ -->
    <div v-if="showBoxForm" class="modal-mask" @click.self="showBoxForm = false">
      <div class="modal">
        <h3>新建纸箱</h3>
        <div class="grid2">
          <div><label>箱号</label><input type="text" v-model="boxForm.code" placeholder="1" /></div>
          <div><label>目的地房间 *</label><input type="text" v-model="boxForm.destRoom" placeholder="卧室区" /></div>
        </div>
        <label>备注</label>
        <input type="text" v-model="boxForm.note" placeholder="易碎 / 重物" />
        <div class="row-ops">
          <button class="btn" @click="showBoxForm = false">取消</button>
          <button class="btn primary" @click="saveBox">建箱并生成 QR</button>
        </div>
      </div>
    </div>

    <!-- ============ 升级弹层 ============ -->
    <div v-if="showUpgrade" class="modal-mask" @click.self="showUpgrade = false">
      <div class="modal">
        <h3>专业版功能</h3>
        <ul class="feat">
          <li>资产卡片数量不限（免费 50 张）</li>
          <li>理赔资料包 ZIP（清单 HTML + 凭证照片）</li>
          <li>口令加密备份导出与双人导入合并</li>
          <li>拍照文字识别（实验，即将上线）</li>
        </ul>
        <p class="muted">一次买断 {{ priceText }}（也可订阅 月 ¥3.9 / 年 ¥29.9），所有数据仍只保存在你的设备。</p>
        <div class="row-ops">
          <button class="btn" @click="showUpgrade = false">再想想</button>
          <button class="btn primary" @click="upgrade">升级专业版</button>
        </div>
      </div>
    </div>

    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>

<style scoped>
.hv-app {
  --brand: #3b7dd8;
  --brand-d: #2a5fb0;
  --ink: #1f2430;
  --muted: #828a99;
  --line: #e6e9ef;
  --bg: #f4f6fa;
  --card: #ffffff;
  min-height: 100%;
  background: var(--bg);
  color: var(--ink);
  padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 0.5rem);
}
.apphead {
  position: sticky;
  top: 0;
  z-index: 20;
  background: var(--bg);
  border-bottom: 1px solid var(--line);
  padding: 0.6rem 0.85rem 0.45rem;
}
.brand {
  font-size: 1.15rem;
  margin: 0 0 0.5rem;
}
.seg {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 0.3rem;
}
.seg button {
  position: relative;
  border: 1px solid var(--line);
  background: var(--card);
  border-radius: 0.6rem;
  padding: 0.5rem 0.1rem;
  font-size: 0.8rem;
  color: #5c6370;
  min-height: 44px;
}
.seg button.on {
  border-color: var(--brand);
  background: #e8f0fd;
  color: var(--brand-d);
  font-weight: 700;
}
.seg-badge {
  position: absolute;
  top: -0.3rem;
  right: 0.15rem;
  background: #e0675a;
  color: #fff;
  font-style: normal;
  font-size: 0.62rem;
  min-width: 1rem;
  height: 1rem;
  line-height: 1rem;
  border-radius: 999px;
  padding: 0 0.2rem;
}
.page {
  padding: 0.85rem 0.85rem calc(1rem + env(safe-area-inset-bottom, 0px));
  max-width: 860px;
  margin: 0 auto;
  overflow-x: hidden;
}
select {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}
.page-h {
  font-size: 1.15rem;
  margin: 0.2rem 0 0.6rem;
}
.page-h small {
  display: block;
  font-size: 0.78rem;
  font-weight: 400;
  margin-top: 0.15rem;
}
.book-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  margin-bottom: 0.6rem;
  flex-wrap: wrap;
}
.search {
  flex: 1;
  min-width: 180px;
  border: 1px solid var(--line);
  border-radius: 0.6rem;
  padding: 0.6rem 0.75rem;
  font-size: 16px;
  box-sizing: border-box;
}
.grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.7rem;
}
@media (min-width: 700px) {
  .grid {
    grid-template-columns: 1fr 1fr;
  }
}
.card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 0.9rem;
  padding: 0.9rem;
  margin-bottom: 0.8rem;
}
.card-h {
  font-weight: 700;
  margin-bottom: 0.55rem;
}
.asset-top {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  justify-content: space-between;
}
.asset-name {
  font-size: 1rem;
}
.chip {
  background: #eef2f8;
  color: #556;
  border-radius: 999px;
  padding: 0.15rem 0.6rem;
  font-size: 0.75rem;
}
.kv {
  font-size: 0.86rem;
  margin: 0.25rem 0;
}
.kv .lb {
  display: inline-block;
  color: var(--brand-d);
  margin-right: 0.35rem;
}
.box-hint {
  color: #237a52;
  font-weight: 600;
}
.doc-row {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin: 0.5rem 0;
}
.doc-thumb {
  position: relative;
  width: 5rem;
}
.doc-thumb img {
  width: 5rem;
  height: 5rem;
  object-fit: cover;
  border-radius: 0.5rem;
  border: 1px solid var(--line);
}
.doc-thumb.pending {
  margin-top: 0.4rem;
}
.doc-kind {
  display: block;
  font-size: 0.7rem;
  color: var(--muted);
  text-align: center;
}
.doc-del {
  position: absolute;
  top: -0.4rem;
  right: -0.2rem;
  width: 1.6rem;
  height: 1.6rem;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: #fff;
  color: #c2483a;
  font-size: 1rem;
  line-height: 1;
}
.row-ops {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.6rem;
  flex-wrap: wrap;
}
.btn {
  appearance: none;
  border: 1px solid var(--line);
  background: var(--card);
  color: var(--ink);
  border-radius: 0.6rem;
  padding: 0.55rem 0.9rem;
  font-size: 0.9rem;
  cursor: pointer;
  min-height: 44px;
}
.btn.primary {
  background: var(--brand);
  border-color: var(--brand);
  color: #fff;
}
.btn.primary:active {
  background: var(--brand-d);
}
.btn.ghost {
  background: transparent;
}
.btn.small {
  padding: 0.35rem 0.65rem;
  font-size: 0.82rem;
  min-height: 38px;
}
.btn.tiny {
  padding: 0.25rem 0.55rem;
  font-size: 0.76rem;
  min-height: 32px;
}
.btn.block {
  width: 100%;
  margin-top: 0.5rem;
  text-align: center;
}
.danger-text {
  color: #c2483a;
}
.danger-card {
  border-color: #e8a79f;
}
.btn.armed {
  background: #fdeceb;
  font-weight: 700;
}
.muted {
  color: var(--muted);
}
.tiny {
  font-size: 0.78rem;
}
.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem;
}
.due-list {
  list-style: none;
  margin: 0 0 0.8rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.due-item {
  background: var(--card);
  border: 1px solid var(--line);
  border-left-width: 6px;
  border-radius: 0.8rem;
  padding: 0.7rem 0.8rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  flex-wrap: wrap;
}
.due-item.lv-expired {
  border-left-color: #e0675a;
  background: #fdf3f2;
}
.due-item.lv-soon7 {
  border-left-color: #e8893a;
  background: #fdf5ec;
}
.due-item.lv-soon30 {
  border-left-color: #e6b93f;
  background: #fdf9ea;
}
.due-item.lv-ok {
  border-left-color: #4caf7d;
}
.level-tag {
  font-size: 0.8rem;
  font-weight: 700;
  white-space: nowrap;
}
.lv-expired .level-tag {
  color: #c2483a;
}
.lv-soon7 .level-tag {
  color: #c86a20;
}
.lv-soon30 .level-tag {
  color: #9a7a1e;
}
.lv-ok .level-tag {
  color: #237a52;
}
.box-card .qr-box {
  margin: 0.6rem 0;
  display: flex;
  justify-content: center;
}
.box-card .qr-box :deep(svg) {
  width: 160px;
  max-width: 100%;
  height: auto;
}
.box-items li {
  min-width: 0;
  overflow-wrap: anywhere;
}
.box-items li .doc-del {
  position: static;
  width: auto;
  height: auto;
  border: 0;
  background: transparent;
  font-size: 1rem;
  flex-shrink: 0;
}
.box-items {
  list-style: none;
  padding: 0;
  margin: 0.4rem 0 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.88rem;
}
.box-items li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}
.claim-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 0.7rem;
  padding: 0.65rem 0.8rem;
  margin-bottom: 0.5rem;
  min-height: 44px;
}
.claim-row input {
  width: 1.1rem;
  height: 1.1rem;
}
.upgrade-card {
  border-color: #bcd3f5;
  background: #f2f7ff;
}
.compliance {
  color: #a07a3a;
  font-size: 0.76rem;
  text-align: center;
  margin: 0.8rem 0.2rem;
  line-height: 1.5;
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
.modal label,
.page .card label {
  display: block;
  font-size: 0.82rem;
  color: #556;
  margin: 0.6rem 0 0.25rem;
}
.modal input,
.modal textarea,
.modal select,
.page .card input,
.page .card select,
.page .card textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--line);
  border-radius: 0.55rem;
  padding: 0.55rem 0.65rem;
  font-size: 16px;
  min-height: 44px;
  background: #fff;
}
.modal textarea {
  min-height: 64px;
}
.feat {
  padding-left: 1.2rem;
  margin: 0.5rem 0;
  line-height: 1.9;
  font-size: 0.9rem;
}
.file-btn {
  position: relative;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  min-height: 44px;
}
.hidden-file {
  position: absolute;
  inset: 0;
  opacity: 0;
}
.toast {
  position: fixed;
  left: 50%;
  bottom: calc(2.5rem + env(safe-area-inset-bottom, 0px));
  transform: translateX(-50%);
  background: rgba(31, 36, 48, 0.92);
  color: #fff;
  padding: 0.6rem 1rem;
  border-radius: 0.8rem;
  font-size: 0.85rem;
  z-index: 80;
  max-width: 90vw;
  text-align: center;
}
@media print {
  .apphead,
  .page,
  .row-ops,
  .toast {
    display: none !important;
  }
}
</style>
