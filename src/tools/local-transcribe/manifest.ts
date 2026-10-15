import type { ToolManifest } from '@/core/types'

export const manifest: ToolManifest = {
  id: 'local-transcribe',
  name: '离线语音转写与会议纪要',
  tagline:
    '把录音、会议、采访音频拖进浏览器即可本地转写：Whisper 本地模型生成带时间戳的文字稿，可同步播放定位、编辑分段、导出文本 / Markdown / SRT 字幕，并自动抽取要点与待办；音频全程不出设备，首次加载模型后可离线使用。',
  category: 'work',
  type: 'web',
  targetUsers: ['商务 / 职场会议频繁的人', '律师 / 法务 / 金融 / HR 等合规敏感岗位', '记者 / 自媒体 / 播客创作者', '学生 / 医生 / 研究人员'],
  scenarios: [
    '开完周会 / 评审会 / 客户会后，把录音转成带时间戳的文字稿并整理会议纪要、待办',
    '采访、播客、访谈录音整理成文稿，还要导出 SRT 字幕',
    '涉密的人事谈话、客户电话、案件讨论不能上传任何云端转写服务，需要离线本地识别',
    '在出差、会场等弱网 / 断网环境下用手机或电脑录音并转写',
    '不想按分钟为云端语音转文字 / Otter 类产品持续付费',
    '课堂、讲座、问诊录音转文字，点击波形即可回听核对'
  ],
  painPoints: [
    '敏感录音上传公有云有合规红线，但本地缺少好用的浏览器转写工具',
    '云端语音转文字按时长持续收费，长会议账单高',
    '弱网 / 断网时云端转写直接不可用',
    '转写稿没有时间戳、不能回听定位，核对错别字很费劲'
  ],
  keywords: [
    '语音转文字', '录音转文字', '语音识别', '录音转文字稿', '音频转文字', '会议纪要', '会议记录',
    '离线转写', '本地转写', '录音整理', '采访转写', '访谈整理', '字幕', 'srt 字幕', '字幕制作',
    'whisper', '语音转写', '录音转写', '播客转文字', '课堂录音', '数据不出端', '隐私', 'asr',
    'speech to text', 'transcription', 'local transcription'
  ],
  billing: {
    mode: 'freemium',
    currency: 'CNY',
    priceCents: 4990,
    features: [
      { key: 'transcribe-60', label: '每月 60 分钟本地转写（Whisper tiny 多语模型）', free: true },
      { key: 'model-tiny', label: '本地 Whisper tiny 模型，首次下载后离线可用', free: true },
      { key: 'mic-import', label: '麦克风录音 + 导入常见音频（wav/mp3/m4a/ogg/flac/webm）', free: true },
      { key: 'export-basic', label: '带时间戳文字稿，导出文本 / Markdown / SRT 字幕', free: true },
      { key: 'history-local', label: '转写历史与抽取式纪要（要点 / 待办 / 决定）本地保存', free: true },
      { key: 'unlimited-minutes', label: '专业版：转写时长不限，长会议 / 批量音频无月度额度限制', free: false }
    ]
  },
  createdAt: '2026-10-15',
  updatedAt: '2026-10-15',
  version: '1.0.0',
  status: 'beta',
  author: 'fangzi'
}
