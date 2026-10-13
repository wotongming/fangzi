<script setup lang="ts">
import { computed, ref } from 'vue'
import { compareBonusTax, type BonusComparison } from './tax'
import { useToolBilling } from '@/composables/useToolBilling'

const billing = useToolBilling('year-bonus-tax')

const bonus = ref(30000)
const salaryTaxable = ref(60000)

const result = computed<BonusComparison | null>(() => {
  if (!bonus.value || bonus.value <= 0) return null
  return compareBonusTax(bonus.value, salaryTaxable.value || 0)
})

const pct = (r: number) => (r * 100).toFixed(0) + '%'
const cny = (n: number) => '¥' + n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })

// —— 高级功能：批量测算与导出（freemium 付费门控）——
const showBatch = ref(false)
const batchText = ref('30000,60000\n50000,120000\n100000,200000')
const batchResult = ref('')
const buying = ref(false)

const batchDecision = computed(() => billing.canUse('batch'))

function runBatch() {
  if (!billing.canUse('batch').allowed) {
    showBatch.value = true
    return
  }
  const rows = ['年终奖,工资应纳税所得额,单独计税税额,并入综合所得税额,更优方式,可省税额']
  for (const line of batchText.value.split('\n')) {
    const [b, s] = line.split(/[,，\s]+/).map((x) => Number(x.trim()))
    if (!b || Number.isNaN(b)) continue
    const r = compareBonusTax(b, s || 0)
    rows.push(
      [r.bonus, r.salaryTaxable, r.separate.tax.toFixed(2), r.combined.taxAttributableToBonus.toFixed(2),
       r.better === 'separate' ? '单独计税' : '并入综合所得', r.saving.toFixed(2)].join(',')
    )
  }
  batchResult.value = rows.join('\n')
}

async function buyPro() {
  buying.value = true
  try {
    await billing.buy('freemium-pro')
  } finally {
    buying.value = false
  }
}

function downloadCsv() {
  // 加 BOM 保证 Excel 正确识别中文
  const blob = new Blob(['\ufeff' + batchResult.value], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = '年终奖计税批量结果.csv'
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="tool-pad">
    <div class="card box inputs">
      <label>
        年终奖（元）
        <input v-model.number="bonus" type="number" min="0" step="100" />
      </label>
      <label>
        年度工资应纳税所得额（元）
        <input v-model.number="salaryTaxable" type="number" min="0" step="1000" />
      </label>
      <p class="faint tip">
        “工资应纳税所得额”= 全年工资薪金 − 6 万元起征点 − 五险一金 − 专项附加扣除等后的余额；不确定可填 0，仅对比奖金部分差异。
      </p>
    </div>

    <div v-if="result" class="compare">
      <div class="card plan" :class="{ win: result.better === 'separate' }">
        <h3>方式一 · 单独计税</h3>
        <p class="tax">{{ cny(result.separate.tax) }}</p>
        <p class="muted">奖金÷12＝{{ cny(result.separate.bracketBase) }}，适用税率 {{ pct(result.separate.rate) }}，速算扣除
          {{ cny(result.separate.quickDeduction) }}</p>
        <p>到手：<b>{{ cny(result.separate.takeHome) }}</b></p>
        <span v-if="result.better === 'separate'" class="tag">推荐 · 更省税</span>
      </div>
      <div class="card plan" :class="{ win: result.better === 'combined' }">
        <h3>方式二 · 并入综合所得</h3>
        <p class="tax">{{ cny(result.combined.taxAttributableToBonus) }}</p>
        <p class="muted">并入后适用税率 {{ pct(result.combined.rate) }}，速算扣除 {{ cny(result.combined.quickDeduction) }}</p>
        <p>到手：<b>{{ cny(result.combined.takeHome) }}</b></p>
        <span v-if="result.better === 'combined'" class="tag">推荐 · 更省税</span>
      </div>
    </div>
    <div v-if="result" class="verdict card">
      选择“<b>{{ result.better === 'separate' ? '单独计税' : '并入综合所得' }}</b>”大约可少缴
      <b class="save">{{ cny(result.saving) }}</b> 个税。
      <span class="faint">结果为估算参考，实际以年度汇算为准。</span>
    </div>

    <div class="card box pro">
      <div class="pro-head">
        <h3>批量测算与 CSV 导出 <span class="tag accent">高级功能</span></h3>
        <span v-if="batchDecision.allowed" class="tag">已解锁</span>
      </div>
      <template v-if="batchDecision.allowed">
        <p class="muted">每行一条：年终奖,工资应纳税所得额（逗号或空格分隔）</p>
        <textarea v-model="batchText" class="ta" rows="5"></textarea>
        <div class="btns">
          <button class="btn btn-primary" @click="runBatch">批量测算</button>
          <button v-if="batchResult" class="btn" @click="downloadCsv">下载 CSV</button>
        </div>
        <pre v-if="batchResult" class="csv">{{ batchResult }}</pre>
      </template>
      <div v-else class="locked">
        <p>一次上传成百上千人的奖金数据批量测算并导出，适合 HR 发奖前核算。</p>
        <p class="price">解锁高级功能 · {{ billing.priceText(billing.plan.priceCents) }}（一次性）</p>
        <button class="btn btn-primary" :disabled="buying" @click="buyPro">
          {{ buying ? '支付中…' : '升级高级版（本地演示支付）' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tool-pad {
  display: grid;
  gap: 14px;
}
.box {
  padding: 16px;
}
.inputs {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: flex-end;
}
.inputs label {
  flex: 1;
  min-width: 220px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 14px;
}
input[type='number'] {
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 9px;
  font-size: 15px;
}
input:focus {
  outline: none;
  border-color: var(--brand);
}
.tip {
  width: 100%;
  font-size: 12px;
  margin: 0;
}
.compare {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
@media (max-width: 640px) {
  .compare {
    grid-template-columns: 1fr;
  }
}
.plan {
  padding: 18px;
  border: 2px solid transparent;
}
.plan.win {
  border-color: var(--brand);
  box-shadow: var(--shadow);
}
.plan h3 {
  margin: 0 0 10px;
  font-size: 15px;
}
.tax {
  font-size: 28px;
  font-weight: 700;
  color: var(--brand-dark);
  margin: 6px 0;
}
.verdict {
  padding: 14px 18px;
  font-size: 15px;
}
.save {
  color: var(--accent);
  font-size: 18px;
}
.pro-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.pro h3 {
  margin: 0 0 10px;
  font-size: 15px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.ta {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 9px;
  font-family: Consolas, monospace;
  font-size: 13px;
  resize: vertical;
}
.btns {
  margin-top: 10px;
  display: flex;
  gap: 10px;
}
.csv {
  margin-top: 10px;
  background: #f6f4ee;
  padding: 10px 12px;
  border-radius: 9px;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 260px;
  overflow: auto;
}
.locked {
  text-align: center;
  padding: 10px 0;
}
.price {
  font-size: 18px;
  font-weight: 700;
  color: var(--accent);
}
</style>
