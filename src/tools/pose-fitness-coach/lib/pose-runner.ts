/**
 * MediaPipe PoseLandmarker 装载与帧推理（同源自托管，禁远程 CDN）。
 * GPU(WebGPU) 失败自动回退 CPU(WASM)，两者都失败抛出带可展示信息的错误。
 */
import { FilesetResolver, PoseLandmarker, type PoseLandmarkerResult } from '@mediapipe/tasks-vision'
import type { Pose } from './types'

export type Delegate = 'GPU' | 'CPU'

export interface PoseRunner {
  delegate: Delegate
  detect: (video: HTMLVideoElement, timestampMs: number) => Pose | null
  close: () => void
}

function baseUrl(): string {
  return ((import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/').replace(/\/?$/, '/')
}

export async function createPoseRunner(onLog?: (msg: string) => void): Promise<PoseRunner> {
  const base = baseUrl()
  const wasmPath = `${base}mf/mediapipe/wasm`
  const modelPath = `${base}mf/mediapipe/models/pose_landmarker_lite.task`
  onLog?.('正在加载本地姿态模型…')
  const vision = await FilesetResolver.forVisionTasks(wasmPath)

  async function tryDelegate(delegate: Delegate): Promise<PoseLandmarker> {
    return PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: modelPath, delegate },
      runningMode: 'VIDEO',
      numPoses: 1
    })
  }

  let landmarker: PoseLandmarker
  let delegate: Delegate = 'GPU'
  try {
    landmarker = await tryDelegate('GPU')
    onLog?.('已启用 GPU 加速')
  } catch (gpuErr) {
    onLog?.('GPU 不可用，切换到 CPU 兼容模式')
    landmarker = await tryDelegate('CPU')
    delegate = 'CPU'
    void gpuErr
  }

  let lastVideoTime = -1
  return {
    delegate,
    detect(video: HTMLVideoElement, timestampMs: number): Pose | null {
      if (video.readyState < 2 || video.videoWidth === 0) return null
      if (video.currentTime === lastVideoTime) return null
      lastVideoTime = video.currentTime
      let result: PoseLandmarkerResult
      try {
        result = landmarker.detectForVideo(video, timestampMs)
      } catch {
        return null
      }
      const lm = result?.landmarks?.[0]
      if (!lm || lm.length === 0) return null
      return lm as unknown as Pose
    },
    close() {
      try { landmarker.close() } catch { /* ignore */ }
    }
  }
}
