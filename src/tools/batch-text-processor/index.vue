<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useToolBilling } from '@/composables/useToolBilling'

const billing = useToolBilling('batch-text-processor')

const input = ref('苹果\n香蕉\n苹果\n\n  橙子  \n香蕉\n葡萄')
const output = ref('')
const blocked = ref(false)
const buying = ref(false)
const buyUnits = 10

const opts = reactive({
  trim: true,
  dropEmpty: true,
  dedupe: true,
  numbering: false,
  upper: false,
  lower: false,
  sort: 'none' as 'none' | 'asc' | 'desc',
  prefix: '',
  suffix: '',
  join: ''
})

// 计费版本变化时解除阻断状态
watch(billing.billingVersion, () => {
  blocked.value = false
})

const usage = computed(() => billing.usage())

function processLines(): string[] {
  let lines = input.value.split('\n')
  if (opts.trim) lines = lines.map((l) => l.trim())
  if (opts.dropEmpty) lines = lines.filter((l) => l.length > 0)
  if (opts.dedupe) lines = [...new Set(lines)]
  if (opts.upper) lines = lines.map((l) => l.toUpperCase())
  if (opts.lower) lines = lines.map((l) => l.toLowerCase())
  if (opts.sort === 'asc') lines.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
  if (opts.sort === 'desc') lines.sort((a, b) => b.localeCompare(a, 'zh-Hans-CN'))
  if (opts.prefix || opts.suffix) lines = lines.map((l) => opts.prefix + l + opts.suffix)
  if (opts.numbering) lines = lines.map((l, i) => `${i + 1}. ${l}`)
  return lines
}

function run() {
  const decision = billing.canUse()
  if (!decision.allowed) {
    blocked.value = true
    output.value = ''
    return
  }
  const lines = processLines()
  output.value = opts.join ? lines.join(opts.join) : lines.join('\n')
  billing.consume(1)
  blocked.value = false
}

const preview = computed(() => {
  // 未实际消耗时也给出只读预览（前 200 行），方便判断效果
  return processLines()
    .slice(0, 200)
    .join('\n')
})

async function buyPack() {
  buying.value = true
  try {
    await billing.buy('usage-pack', buyUnits)
    blocked.value = false
  } finally {
    buying.value = false
  }
}

const stats = computed(() => {
  const raw = input.value.split('\n')
  return { in: raw.length, out: processLines().length }
})
</script>

<template>
  <div class="tool-pad">
    <div v-if="blocked" class="paywall card">
      <p class="pw-title">本月免费额度（{{ usage?.freeQuota }} 次）已用完</p>
      <p class="muted">这是“按次计费”工具：每执行一次处理计 1 次。购买额度包后可继续使用，额度长期有效。</p>
      <p class="price">{{ buyUnits }} 次额度包 · {{ billing.priceText(billing.plan.pricePerUnitCents! * buyUnits) }}</p>
      <button class="btn btn-primary" :disabled="buying" @click="buyPack">
        {{ buying ? '支付中…' : `购买 ${buyUnits} 次（本地演示支付）` }}
      </button>
      <p class="faint small">当前为本地模拟支付，点击即到账；正式上线后跳转真实收银台。</p>
    </div>

    <div class="quota-bar" v-if="usage">
      本月剩余 <b>{{ usage.remaining }}</b> 次（免费 {{ usage.freeQuota }} 次 + 已购 {{ usage.purchasedQuota }} 次，已用
      {{ usage.used }} 次）
    </div>

    <div class="opts card">
      <label><input v-model="opts.trim" type="checkbox" /> 去除首尾空格</label>
      <label><input v-model="opts.dropEmpty" type="checkbox" /> 删除空行</label>
      <label><input v-model="opts.dedupe" type="checkbox" /> 去重</label>
      <label><input v-model="opts.numbering" type="checkbox" /> 自动编号</label>
      <label><input v-model="opts.upper" type="checkbox" /> 转大写</label>
      <label><input v-model="opts.lower" type="checkbox" /> 转小写</label>
      <label>
        排序
        <select v-model="opts.sort">
          <option value="none">不排序</option>
          <option value="asc">升序</option>
          <option value="desc">降序</option>
        </select>
      </label>
      <label>前缀 <input v-model="opts.prefix" class="mini" placeholder="如 0" /></label>
      <label>后缀 <input v-model="opts.suffix" class="mini" placeholder='如 ","' /></label>
      <label>合并为一行分隔符 <input v-model="opts.join" class="mini" placeholder="留空=换行" /></label>
    </div>

    <div class="io">
      <div class="card box">
        <h3>输入（{{ stats.in }} 行）</h3>
        <textarea v-model="input" class="ta" rows="14" spellcheck="false"></textarea>
      </div>
      <div class="center">
        <button class="btn btn-primary big" @click="run">开始处理（计 1 次）</button>
      </div>
      <div class="card box">
        <h3>结果（{{ stats.out }} 行）</h3>
        <textarea v-model="output" class="ta" rows="14" spellcheck="false" readonly placeholder="点击“开始处理”后生成结果（右侧下方为不扣次数的效果预览）"></textarea>
        <details>
          <summary class="faint">效果预览（不扣次数，最多 200 行）</summary>
          <pre class="preview">{{ preview }}</pre>
        </details>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tool-pad {
  display: grid;
  gap: 14px;
}
.paywall {
  padding: 18px;
  text-align: center;
  border-color: var(--accent);
}
.pw-title {
  font-size: 16px;
  font-weight: 700;
  margin: 0 0 6px;
}
.price {
  font-size: 20px;
  color: var(--accent);
  font-weight: 700;
}
.small {
  font-size: 12px;
}
.quota-bar {
  font-size: 13px;
  color: var(--ink-soft);
  background: var(--brand-soft);
  padding: 8px 14px;
  border-radius: 9px;
}
.opts {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 18px;
  padding: 12px 16px;
  font-size: 14px;
  align-items: center;
}
.opts label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.mini,
select {
  padding: 5px 8px;
  border: 1px solid var(--line);
  border-radius: 7px;
  width: 120px;
}
.io {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}
.box {
  padding: 12px 16px;
}
.box h3 {
  margin: 4px 0 10px;
  font-size: 14px;
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
.center {
  text-align: center;
}
.big {
  padding: 11px 30px;
  font-size: 15px;
}
.preview {
  background: #f6f4ee;
  border-radius: 9px;
  padding: 10px;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 240px;
  overflow: auto;
}
</style>
