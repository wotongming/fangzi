/** MediaPipe Pose 33 点骨架连线（用于 Canvas 叠加） */
import { LM } from './types'

export const POSE_EDGES: ReadonlyArray<readonly [number, number]> = [
  // 面部
  [LM.L_EAR, LM.L_EYE], [LM.L_EYE, LM.NOSE], [LM.NOSE, LM.R_EYE], [LM.R_EYE, LM.R_EAR],
  // 躯干
  [LM.L_SHOULDER, LM.R_SHOULDER], [LM.L_SHOULDER, LM.L_HIP], [LM.R_SHOULDER, LM.R_HIP], [LM.L_HIP, LM.R_HIP],
  // 左臂
  [LM.L_SHOULDER, LM.L_ELBOW], [LM.L_ELBOW, LM.L_WRIST],
  // 右臂
  [LM.R_SHOULDER, LM.R_ELBOW], [LM.R_ELBOW, LM.R_WRIST],
  // 左腿
  [LM.L_HIP, LM.L_KNEE], [LM.L_KNEE, LM.L_ANKLE], [LM.L_ANKLE, LM.L_HEEL], [LM.L_HEEL, LM.L_FOOT],
  // 右腿
  [LM.R_HIP, LM.R_KNEE], [LM.R_KNEE, LM.R_ANKLE], [LM.R_ANKLE, LM.R_HEEL], [LM.R_HEEL, LM.R_FOOT]
]
