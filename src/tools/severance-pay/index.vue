<script setup lang="ts">
import { computed, ref } from 'vue'
import { calcSeverance, SCENARIO_META, type SeveranceScenario } from './severance'

const monthlyWage = ref(15000)
const localAvgWage = ref(12000)
const years = ref(3)
const months = ref(7)
const scenario = ref<SeveranceScenario>('negotiate')

const scenarios = Object.entries(SCENARIO_META) as Array<[SeveranceScenario, (typeof SCENARIO_META)[SeveranceScenario]]>

const result = computed(() =>
  calcSeverance({
    monthlyWage: monthlyWage.value || 0,
    localAvgWage: localAvgWage.value || 0,
    years: years.value || 0,
    months: months.value || 0,
    scenario: scenario.value
  })
)

const cny = (n: number) => '¥' + n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
</script>

<template>
  <div class="tool-pad">
    <div class="card box">
      <h3>情形认定</h3>
      <div class="scenarios">
        <button
          v-for="([key, meta]) in scenarios"
          :key="key"
          class="scenario"
          :class="{ active: scenario === key }"
          @click="scenario = key"
        >
          <b>{{ meta.label }}</b>
          <span class="faint">{{ meta.desc }}</span>
        </button>
      </div>
    </div>

    <div class="card box inputs">
      <label>
        离职前 12 个月平均工资（元/月）
        <input v-model.number="monthlyWage" type="number" min="0" />
      </label>
      <label>
        当地上年度职工月平均工资（元/月，用于三倍封顶）
        <input v-model.number="localAvgWage" type="number" min="0" />
      </label>
      <label>
        本单位工龄（年）
        <input v-model.number="years" type="number" min="0" max="60" />
      </label>
      <label>
        剩余月数（0-11）
        <input v-model.number="months" type="number" min="0" max="11" />
      </label>
    </div>

    <div class="card result-box">
      <p class="scenario-name">{{ result.scenarioLabel }}</p>
      <p class="total">{{ cny(result.total) }}</p>
      <p class="formula">{{ result.formula }}</p>
      <div class="breakdown">
        <div><span class="faint">补偿月数 N</span><b>{{ result.nFactor }}</b></div>
        <div>
          <span class="faint">月工资基数</span>
          <b>{{ cny(result.baseWage) }}</b>
          <span v-if="result.capped" class="tag accent">已按社平三倍封顶</span>
        </div>
        <div><span class="faint">经济补偿 N</span><b>{{ cny(result.economicComp) }}</b></div>
        <div v-if="result.noticePay > 0"><span class="faint">代通知金 +1</span><b>{{ cny(result.noticePay) }}</b></div>
        <div><span class="faint">违法解除 2N</span><b>{{ cny(result.illegalComp) }}</b></div>
      </div>
      <p class="note">{{ result.note }}</p>
      <p class="faint small">
        提示：经济补偿在当地上年职工平均工资 3 倍数额以内的部分免征个人所得税；超出部分按规定计税。本工具结果仅供参考。
      </p>
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
.box h3 {
  margin: 0 0 12px;
  font-size: 15px;
}
.scenarios {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
@media (max-width: 640px) {
  .scenarios {
    grid-template-columns: 1fr;
  }
}
.scenario {
  text-align: left;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 12px;
  background: #fdfdfb;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.scenario b {
  font-size: 14px;
}
.scenario.active {
  border-color: var(--brand);
  background: var(--brand-soft);
  color: var(--brand-dark);
}
.inputs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
@media (max-width: 640px) {
  .inputs {
    grid-template-columns: 1fr;
  }
}
.inputs label {
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
.result-box {
  padding: 20px;
  text-align: center;
}
.scenario-name {
  margin: 0;
  color: var(--ink-soft);
}
.total {
  font-size: 38px;
  font-weight: 700;
  color: var(--brand-dark);
  margin: 6px 0;
}
.formula {
  font-family: Consolas, monospace;
  color: var(--ink-soft);
  margin: 0 0 16px;
}
.breakdown {
  display: grid;
  gap: 8px;
  text-align: left;
  max-width: 420px;
  margin: 0 auto;
}
.breakdown > div {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  border-bottom: 1px dashed var(--line);
  padding-bottom: 6px;
}
.note {
  margin-top: 16px;
  font-size: 13px;
  background: #f6f4ee;
  border-radius: 9px;
  padding: 10px 12px;
  text-align: left;
}
.small {
  font-size: 12px;
  text-align: left;
}
</style>
