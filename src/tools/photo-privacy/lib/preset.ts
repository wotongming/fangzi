/**
 * preset.ts —— 发布场景预设：一键设置输出参数与“记得遮挡”提示清单。
 * 只改参数与提示，不替用户自动识别内容（不做人脸检测）。
 */
import type { RedactMode } from './redact'
import type { OutMime } from './process'

export interface Preset {
  id: string
  name: string
  outType: Exclude<OutMime, never>
  quality: number
  maxEdge: number
  redactMode: RedactMode
  /** 是否默认启用文件名清洗高级模板 */
  cleanName: boolean
  prefix: string
  /** 引导用户手动遮挡的敏感项 */
  checklist: string[]
  desc: string
}

export const PRESETS: Preset[] = [
  {
    id: 'secondhand',
    name: '二手交易',
    outType: 'image/jpeg',
    quality: 0.82,
    maxEdge: 1600,
    redactMode: 'mosaic',
    cleanName: true,
    prefix: 'item',
    checklist: ['门牌号 / 小区名 / 快递单', '车牌', '票据上的姓名电话', '室内能定位的特征'],
    desc: '去定位、适度压缩，适合商品图与交易配图'
  },
  {
    id: 'kids',
    name: '晒娃日常',
    outType: 'image/jpeg',
    quality: 0.85,
    maxEdge: 1920,
    redactMode: 'blur',
    cleanName: true,
    prefix: 'life',
    checklist: ['校服 / 校徽 / 园所名称', '家门牌号', '背景里的证件、票据', '其他孩子的正脸（如未获同意）'],
    desc: '去除定位与拍摄信息，保护孩子与家庭住址'
  },
  {
    id: 'idcard',
    name: '证件 / 票据',
    outType: 'image/jpeg',
    quality: 0.9,
    maxEdge: 2048,
    redactMode: 'solid',
    cleanName: true,
    prefix: 'doc',
    checklist: ['身份证号中间段（按需遮挡）', '银行卡号 / CVV', '住址详细门牌', '条码 / 二维码'],
    desc: '纯色遮挡更彻底，适合证件与票据留证'
  },
  {
    id: 'screenshot',
    name: '工作截图',
    outType: 'image/png',
    quality: 0.92,
    maxEdge: 0,
    redactMode: 'solid',
    cleanName: true,
    prefix: 'shot',
    checklist: ['姓名 / 手机号 / 邮箱', '地址 / 订单号', '群名 / 同事头像昵称', '内部链接、密钥、Token'],
    desc: '重绘剥离截图元数据并清洗系统生成的文件名'
  },
  {
    id: 'rights',
    name: '维权留证',
    outType: 'image/jpeg',
    quality: 0.95,
    maxEdge: 2560,
    redactMode: 'mosaic',
    cleanName: false,
    prefix: 'evidence',
    checklist: ['他人正脸 / 车牌（如不便公开）', '自己的联系方式（按需）'],
    desc: '尽量保留清晰度作为证据，仅去除 GPS 与设备信息'
  }
]

export function getPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id)
}
