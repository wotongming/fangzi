/**
 * 摄像头生命周期封装：仅工具运行时持有流，停止/离开页面必须释放 tracks。
 */
export interface CameraHandle {
  stream: MediaStream
  stop: () => void
  facing: 'user' | 'environment'
}

export async function startCamera(facing: 'user' | 'environment' = 'environment'): Promise<CameraHandle> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('当前浏览器不支持摄像头（需要 HTTPS 与较新浏览器）')
  }
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: facing },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    })
  } catch (e) {
    const name = (e as DOMException)?.name
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new Error('摄像头权限被拒绝，请在浏览器地址栏允许摄像头后重试')
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      throw new Error('未检测到可用摄像头')
    }
    throw new Error('摄像头启动失败：' + ((e as Error)?.message ?? name ?? '未知错误'))
  }
  return {
    stream,
    facing,
    stop: () => {
      stream.getTracks().forEach((t) => t.stop())
    }
  }
}
