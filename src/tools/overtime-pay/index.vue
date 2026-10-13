<script setup lang="ts">
import { computed, ref } from 'vue'
import { calcOvertime, HOURS_PER_DAY, MONTHLY_WORK_DAYS } from './overtime'

const monthlyBase = ref(10000)
const weekdayHours = ref(10)
const restdayHours = ref(8)
const holidayHours = ref(8)

const result = computed(() =>
  calcOvertime({
    monthlyBase: monthlyBase.value || 0,
    weekdayHours: weekdayHours.value || 0,
    restdayHours: restdayHours.value || 0,
    holidayHours: holidayHours.value || 0
  })
)
const cny = (n: number) => '¥' + n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
</script>

<template>
  <div class="tool-pad">
    <div class="card box">
      <label class="base">
        月工资计算基数（元）
        <input v-model.number="monthlyBase" type="number" min="0" />
      </label>
      <p class="faint small">
        日工资＝基数 ÷ {{ MONTHLY_WORK_DAYS }} ＝ <b>{{ cny(result.dailyWage) }}</b>；小时工资＝日工资 ÷ {{ HOURS_PER_DAY }} ＝
        <b>{{ cny(result.hourlyWage) }}</b>
      </p>
    </div>

    <div class="card box">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>加班类型</th>
              <th>倍率</th>
              <th>小时数</th>
              <th>加班费</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>工作日延时加班<div class="faint hint">一般每日不超 1 小时，特殊不超 3 小时</div></td>
              <td>150%</td>
              <td><input v-model.number="weekdayHours" type="number" min="0" step="0.5" class="hinp" /></td>
              <td class="pay">{{ cny(result.weekdayPay) }}</td>
            </tr>
            <tr>
              <td>休息日加班（未安排补休）<div class="faint hint">能安排补休则优先补休</div></td>
              <td>200%</td>
              <td><input v-model.number="restdayHours" type="number" min="0" step="0.5" class="hinp" /></td>
              <td class="pay">{{ cny(result.restdayPay) }}</td>
            </tr>
            <tr>
              <td>法定节假日加班<div class="faint hint">不得以补休替代 300%</div></td>
              <td>300%</td>
              <td><input v-model.number="holidayHours" type="number" min="0" step="0.5" class="hinp" /></td>
              <td class="pay">{{ cny(result.holidayPay) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card total-box">
      <span>加班费合计</span>
      <b>{{ cny(result.total) }}</b>
    </div>
    <p class="faint small">
      注：综合计算工时制、不定时工时制的加班认定另有规定；工资基数不得低于当地最低工资标准及劳动合同约定。结果仅供参考。
    </p>
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
.base {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 14px;
  max-width: 320px;
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
.hinp {
  width: 90px;
  padding: 7px 10px;
  border: 1px solid var(--line);
  border-radius: 7px;
}
.table-wrap {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  border: 1px solid var(--line);
  padding: 10px 12px;
  text-align: left;
  font-size: 14px;
}
th {
  background: #f6f4ee;
}
.pay {
  font-weight: 600;
  color: var(--brand-dark);
  white-space: nowrap;
}
.hint {
  font-size: 12px;
}
.total-box {
  padding: 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.total-box span {
  color: var(--ink-soft);
}
.total-box b {
  font-size: 30px;
  color: var(--brand-dark);
}
.small {
  font-size: 12px;
}
</style>
