import type { ExerciseDef } from './types'
import { createSquat } from './squat'
import { createPushup } from './pushup'
import { createLunge } from './lunge'
import { createBridge } from './bridge'
import { createShoulderPress } from './shoulderpress'
import { createPlank } from './plank'

export type { ExerciseDef } from './types'

const factories: Record<string, () => ExerciseDef> = {
  squat: createSquat,
  pushup: createPushup,
  lunge: createLunge,
  bridge: createBridge,
  shoulderpress: createShoulderPress,
  plank: createPlank
}

export const EXERCISE_ORDER = ['squat', 'pushup', 'lunge', 'bridge', 'shoulderpress', 'plank'] as const
export type ExerciseId = (typeof EXERCISE_ORDER)[number]

export function createExercise(id: string): ExerciseDef {
  const f = factories[id]
  if (!f) throw new Error(`未知动作：${id}`)
  return f()
}

export function listExercises(): ExerciseDef[] {
  return EXERCISE_ORDER.map((id) => factories[id]!())
}

export const EXERCISE_META: ReadonlyArray<{ id: string; name: string; free: boolean }> = listExercises().map((e) => ({
  id: e.id,
  name: e.name,
  free: e.free
}))

export function exerciseName(id: string): string {
  return EXERCISE_META.find((e) => e.id === id)?.name ?? id
}
