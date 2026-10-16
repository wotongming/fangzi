import type { ToolManifest } from '@/core/types'

export const manifest: ToolManifest = {
  id: 'gpu-data-viz',
  name: 'GPU大数据可视化面板',
  tagline: '百万级数据点 60fps 浏览器内可视化：CSV/JSON 拖入即析，GPU 聚合、缩放刷选、报告导出，数据不出端',
  category: 'developer',
  type: 'web',
  targetUsers: ['数据分析师', '量化/金融研究员', 'IoT 与工业运维工程师', '临床/科研人员', '开发者'],
  scenarios: [
    '打开一个上百万行的 CSV，普通图表卡死或被迫抽样，想全量 60fps 缩放刷选',
    '分析金融 tick / 传感器 / 实验数据，降采样会漏掉异常尖峰，需要浏览器内全量查看',
    '拖入 CSV/JSON 立刻画散点密度图与热力图，框选异常区域导出筛选结果',
    '不想为几百万点搭服务端聚合，也不想买数千美元的商业图表库授权',
    '日志 / 交易 / 行为数据含隐私，只能在本地浏览器分析，不能上传云端'
  ],
  painPoints: [
    'SVG/Canvas 图表库在 10 万点以上卡顿、冻结甚至 OOM',
    '为流畅浏览被迫降采样，可能漏掉交易信号、心律失常或告警片段',
    '服务端聚合架构昂贵，商业 GPU 图表库授权数千美元一年',
    '大数据文件只能上专业 BI / 写代码，浏览器里没有平价趁手的分析面板'
  ],
  keywords: [
    '大数据可视化', '百万点', 'gpu 渲染', 'webgpu', 'webgl', '散点图', '热力图', '密度图', '折线图',
    'csv 可视化', 'csv 图表', 'json 图表', '时序数据', 'tick 数据', '传感器数据', '波形',
    '缩放', '框选', '刷选', 'brushing', '数据探索', 'eda', '高性能图表', 'scatter', 'heatmap',
    '本地分析', '不上传', 'data visualization'
  ],
  billing: {
    mode: 'freemium',
    currency: 'CNY',
    priceCents: 2990,
    features: [
      { key: 'basic', label: '≤50 万点 / 三种图型 / 缩放刷选 / PNG 截图', free: true },
      { key: 'full-data', label: '全量数据（>50 万点，百万级流畅渲染）', free: false },
      { key: 'export-report', label: '刷选结果 CSV 导出与分析报告', free: false },
      { key: 'embed', label: '嵌入式图表组件（Web Component）', free: false }
    ],
    subscription: { priceCentsPerMonth: 890, priceCentsPerYear: 8800 },
    usagePack: { priceCentsPerUnit: 129, unit: '次', freePerDay: 2 },
    platformSplit: {
      enabled: true,
      partnerRatePct: 20,
      note: '支持渠道分销：合作站点按售价 20% 分成，订单通过计费框架统一记录。'
    }
  },
  createdAt: '2026-10-15',
  updatedAt: '2026-10-15',
  version: '1.0.0',
  status: 'stable',
  author: 'fangzi'
}
