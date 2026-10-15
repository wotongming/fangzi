/**
 * 音频输入：文件导入 / 麦克风录音 → 16kHz 单声道 Float32Array（Whisper 输入）。
 * 全程浏览器本地解码（WebAudio），不上传任何数据。
 * V1：支持浏览器可解码的音频（wav/mp3/m4a/ogg/flac/webm 等）；视频提音轨（ffmpeg.wasm）列 V1.1。
 */

export const TARGET_SR = 16000

export interface DecodedAudio {
  /** 16kHz 单声道 PCM */
  pcm: Float32Array
  /** 原始音频时长（秒） */
  durationSec: number
  sampleRate: number
}

function createAudioContext(): AudioContext {
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) throw new Error('当前浏览器不支持 WebAudio，无法解码音频')
  return new Ctor()
}

/**
 * 用浏览器原生解码器解码，再重采样到 16kHz 单声道。
 * 保留一个共享 AudioContext（部分浏览器对并发 context 数量有限制）。
 */
let sharedCtx: AudioContext | null = null

export async function decodeTo16k(file: Blob): Promise<DecodedAudio> {
  if (!sharedCtx) sharedCtx = createAudioContext()
  const arr = await file.arrayBuffer()
  let decoded: AudioBuffer
  try {
    // decodeAudioData 会“转走” ArrayBuffer，传入副本以便调用方保留原始数据
    decoded = await sharedCtx.decodeAudioData(arr.slice(0))
  } catch (err) {
    throw new Error(
      `无法解码该音频（${file.type || '未知格式'}）。请改用 wav / mp3 / m4a / ogg / flac；视频提音轨将在后续版本支持。`
    )
  }

  const durationSec = decoded.duration
  const length = Math.max(1, Math.ceil(durationSec * TARGET_SR))
  // 目标离线图：1 声道、16kHz；多声道源连接后自动 down-mix
  const offline = new OfflineAudioContext(1, length, TARGET_SR)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start(0)
  const rendered = await offline.startRendering()
  const pcm = rendered.getChannelData(0).slice(0)
  return { pcm, durationSec, sampleRate: TARGET_SR }
}

/** 麦克风录音会话 */
export interface MicSession {
  /** 实时音量 0~1（可选，用于 UI 电平条） */
  getLevel: () => number
  /** 停止并返回录音 Blob（默认 webm/opus） */
  stop: () => Promise<Blob>
  /** 放弃录音并释放麦克风 */
  cancel: () => void
}

export async function startMic(): Promise<MicSession> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    throw new Error('当前浏览器不支持麦克风录音，可改用导入音频文件')
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }
  })
  const recorder = new MediaRecorder(stream)
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data)
  }
  recorder.start(250)

  // 音量电平（Analyser 时域 RMS）
  let level = 0
  try {
    const audioCtx = createAudioContext()
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 512
    const node = audioCtx.createMediaStreamSource(stream)
    node.connect(analyser)
    const buf = new Uint8Array(analyser.fftSize)
    const tick = () => {
      if (recorder.state === 'inactive') return
      analyser.getByteTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) {
        const v = ((buf[i] ?? 128) - 128) / 128
        sum += v * v
      }
      level = Math.min(1, Math.sqrt(sum / buf.length) * 2.2)
      requestAnimationFrame(tick)
    }
    tick()
  } catch {
    // 电平采集失败不影响录音本身
  }

  const release = () => {
    stream.getTracks().forEach((t) => t.stop())
  }

  return {
    getLevel: () => level,
    stop: () =>
      new Promise<Blob>((resolve, reject) => {
        recorder.onstop = () => {
          release()
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
          if (blob.size === 0) {
            reject(new Error('未采集到声音，请检查麦克风权限与音量'))
            return
          }
          resolve(blob)
        }
        recorder.onerror = (e) => reject(new Error('录音失败：' + String((e as ErrorEvent).error ?? '')))
        if (recorder.state !== 'inactive') recorder.stop()
        else {
          release()
          reject(new Error('录音已停止'))
        }
      }),
    cancel: () => {
      if (recorder.state === 'inactive') {
        recorder.onstop = () => release()
        recorder.stop()
      } else {
        release()
      }
    }
  }
}
