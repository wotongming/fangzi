/**
 * 原创卡通奔跑小人（纯 three 几何体程序化拼搭，无任何外部模型/贴图/版权形象）。
 * 局部坐标：原点在脚底中心，+X=前进方向（光带切线），+Y=上方（带面法向），+Z=带宽横向。
 */
import * as THREE from 'three'
import type { CharacterDef } from '../game/characters'

const ROOT_SCALE = 0.62

function mat(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color })
}

/** 以顶端为枢轴的肢体：返回 group，网格向下延伸 len。 */
function limb(w: number, len: number, d: number, color: number): THREE.Group {
  const g = new THREE.Group()
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, len, d), mat(color))
  m.position.y = -len / 2
  g.add(m)
  return g
}

export interface CharacterRig {
  root: THREE.Group
  /** 每帧更新奔跑动画 */
  update: (dt: number, speed: number, running: boolean) => void
  /** 触发一次前空翻（0..1 由外部驱动更平滑，这里用内部计时器） */
  flip: () => void
  setRunPhase: (p: number) => void
  dispose: () => void
}

export function buildCharacter(def: CharacterDef): CharacterRig {
  const root = new THREE.Group()
  root.scale.setScalar(ROOT_SCALE)

  const flipG = new THREE.Group()
  const body = new THREE.Group() // 起伏/前倾
  root.add(flipG)
  flipG.add(body)

  const skin = mat(def.skin)
  const suitM = mat(def.suit)
  const hairM = mat(def.hair)
  const dark = mat(0x20243a)

  // —— 腿（枢轴在髋部）——
  const HIP_Y = 0.3
  const legL = limb(0.09, 0.26, 0.1, def.style === 'hood' ? 0x3a2a86 : 0x2b3357)
  const legR = limb(0.09, 0.26, 0.1, def.style === 'hood' ? 0x3a2a86 : 0x2b3357)
  legL.position.set(0, HIP_Y, 0.07)
  legR.position.set(0, HIP_Y, -0.07)
  // 鞋
  const shoeGeo = new THREE.BoxGeometry(0.13, 0.07, 0.11)
  for (const leg of [legL, legR]) {
    const shoe = new THREE.Mesh(shoeGeo, mat(def.accent))
    shoe.position.set(0.02, -0.26 + 0.03, 0)
    leg.add(shoe)
  }
  root.add(legL, legR)

  // —— 躯干 ——
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.26, 0.2), suitM)
  torso.position.y = 0.43
  body.add(torso)

  // —— 手臂（枢轴在肩）——
  const armL = limb(0.075, 0.23, 0.08, def.skin)
  const armR = limb(0.075, 0.23, 0.08, def.skin)
  armL.position.set(0, 0.54, 0.15)
  armR.position.set(0, 0.54, -0.15)
  body.add(armL, armR)

  // —— 头 ——
  const head = new THREE.Group()
  head.position.y = 0.66
  body.add(head)
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.16, 18, 14), skin)
  head.add(skull)
  // 眼睛（朝 +X 前进方向）
  const eyeGeo = new THREE.SphereGeometry(0.028, 10, 8)
  const eyeL = new THREE.Mesh(eyeGeo, dark)
  const eyeR = new THREE.Mesh(eyeGeo, dark)
  eyeL.position.set(0.145, 0.02, 0.06)
  eyeR.position.set(0.145, 0.02, -0.06)
  head.add(eyeL, eyeR)
  // 腮红
  const cheekGeo = new THREE.SphereGeometry(0.025, 8, 6)
  const cheekM = mat(def.accent)
  const c1 = new THREE.Mesh(cheekGeo, cheekM)
  const c2 = new THREE.Mesh(cheekGeo, cheekM)
  c1.position.set(0.13, -0.05, 0.1)
  c2.position.set(0.13, -0.05, -0.1)
  c1.scale.set(0.6, 0.6, 0.3)
  c2.scale.set(0.6, 0.6, 0.3)
  head.add(c1, c2)

  // —— 风格配饰 ——
  if (def.style === 'cap') {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), hairM)
    dome.position.y = 0.02
    head.add(dome)
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.13), hairM)
    brim.position.set(0.15, 0.06, 0)
    head.add(brim)
  } else if (def.style === 'bunny') {
    for (const z of [0.06, -0.06]) {
      const ear = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.04), hairM)
      ear.position.set(-0.02, 0.26, z)
      ear.rotation.z = -0.12
      head.add(ear)
      const inner = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, 0.045), cheekM)
      inner.position.set(0.01, 0.26, z)
      inner.rotation.z = -0.12
      head.add(inner)
    }
  } else if (def.style === 'cat') {
    for (const z of [0.09, -0.09]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.14, 4), hairM)
      ear.position.set(0, 0.16, z)
      head.add(ear)
      const inner = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.08, 4), cheekM)
      inner.position.set(0.005, 0.16, z)
      head.add(inner)
    }
    // 尾巴
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.26, 8), hairM)
    tail.position.set(-0.16, 0.42, 0)
    tail.rotation.z = Math.PI / 2.6
    body.add(tail)
  } else if (def.style === 'spike') {
    for (let i = 0; i < 5; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.13, 6), hairM)
      const ang = (i / 5) * Math.PI * 2
      spike.position.set(Math.cos(ang) * 0.05, 0.15, Math.sin(ang) * 0.05)
      spike.rotation.z = -0.5
      head.add(spike)
    }
  } else if (def.style === 'hood') {
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.72), hairM)
    hood.position.set(-0.02, 0.03, 0)
    head.add(hood)
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.24), mat(def.accent))
    visor.position.set(0.15, 0.03, 0)
    head.add(visor)
    // 小披风
    const cape = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.24, 0.22), hairM)
    cape.position.set(-0.15, 0.44, 0)
    body.add(cape)
  }

  // —— 动画状态 ——
  let phase = Math.random() * Math.PI * 2
  let flipT = -1 // <0 未在翻转
  const FLIP_DUR = 0.34

  function update(dt: number, speed: number, running: boolean): void {
    if (running) {
      const cadence = 7 + Math.max(0, speed) * 0.9
      phase += dt * cadence
      const s = Math.sin(phase)
      legL.rotation.z = s * 0.85
      legR.rotation.z = -s * 0.85
      armL.rotation.z = -s * 0.7
      armR.rotation.z = s * 0.7
      body.position.y = Math.abs(Math.cos(phase)) * 0.035
      body.rotation.z = -0.14
    } else {
      // 待机动画：轻微呼吸，手臂自然
      phase += dt * 2
      legL.rotation.z *= 0.8
      legR.rotation.z *= 0.8
      armL.rotation.z *= 0.8
      armR.rotation.z *= 0.8
      body.position.y = Math.sin(phase) * 0.01
      body.rotation.z = 0
    }

    if (flipT >= 0) {
      flipT = Math.min(1, flipT + dt / FLIP_DUR)
      const k = flipT
      // 前空翻（绕横向 Z），带一点收腿感
      flipG.rotation.z = -k * Math.PI * 2
      body.scale.set(1, 1 - Math.sin(k * Math.PI) * 0.12, 1)
      if (flipT >= 1) {
        flipT = -1
        flipG.rotation.z = 0
        body.scale.set(1, 1, 1)
      }
    }
  }

  function flip(): void {
    if (flipT < 0) flipT = 0
  }
  function setRunPhase(p: number): void {
    phase = p
  }

  function dispose(): void {
    const geos = new Set<THREE.BufferGeometry>()
    const mats = new Set<THREE.Material>()
    root.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.geometry) geos.add(m.geometry)
      const mm = m.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(mm)) mm.forEach((x) => mats.add(x))
      else if (mm) mats.add(mm)
    })
    geos.forEach((g) => g.dispose())
    mats.forEach((m) => m.dispose())
  }

  return { root, update, flip, setRunPhase, dispose }
}
