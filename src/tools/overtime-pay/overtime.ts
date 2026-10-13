/**
 * 加班费计算（标准工时制）。
 * 日工资 = 月计薪基数 / 21.75；小时工资 = 日工资 / 8。
 * 工作日延时 150%、休息日且不能补休 200%、法定节假日 300%（《劳动法》第 44 条）。
 */

export const MONTHLY_WORK_DAYS = 21.75
export const HOURS_PER_DAY = 8

export interface OvertimeInput {
  monthlyBase: number
  weekdayHours: number // 工作日延时加班小时
  restdayHours: number // 休息日加班（未补休）
  holidayHours: number // 法定节假日加班
}

export interface OvertimeResult {
  hourlyWage: number
  dailyWage: number
  weekdayPay: number
  restdayPay: number
  holidayPay: number
  total: number
}

export function calcOvertime(input: OvertimeInput): OvertimeResult {
  const base = Math.max(0, input.monthlyBase)
  const dailyWage = base / MONTHLY_WORK_DAYS
  const hourlyWage = dailyWage / HOURS_PER_DAY
  const weekdayPay = hourlyWage * 1.5 * Math.max(0, input.weekdayHours)
  const restdayPay = hourlyWage * 2 * Math.max(0, input.restdayHours)
  const holidayPay = hourlyWage * 3 * Math.max(0, input.holidayHours)
  const r = (n: number) => Math.round(n * 100) / 100
  return {
    hourlyWage: r(hourlyWage),
    dailyWage: r(dailyWage),
    weekdayPay: r(weekdayPay),
    restdayPay: r(restdayPay),
    holidayPay: r(holidayPay),
    total: r(weekdayPay + restdayPay + holidayPay)
  }
}
