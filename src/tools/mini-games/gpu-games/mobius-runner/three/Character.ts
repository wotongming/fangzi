/**
 * 原创 Q 版卡通奔跑小人（纯 three 几何体程序化拼搭，无任何外部模型/贴图/版权形象）。
 * 局部坐标：原点在脚底中心，+X=前进方向（光带切线），+Y=上方（带面法向），+Z=带宽横向。
 * 造型：大头 Q 版比例、圆润胶囊四肢、卡通三渲二（MeshToonMaterial），需场景配灯光（仅该角色受光）。
 */
import * as THREE from 'three'
import type { CharacterDef } from '../game/characters'

const ROOT_SCALE = 0.6

// 三渲二阶梯色阶（全角色共享一张 3 阶渐变贴图，配合灯光得到干净的卡通分色）
const gradientMap = new THREE.DataTexture(new Uint8Array([96, 176, 255]), 3, 1, THREE.RedFormat)
gradientMap.minFilter = THREE.NearestFilter
gradientMap.magFilter = THREE.NearestFilter
gradientMap.generateMipmaps = false
gradientMap.needsUpdate = true

function mat(color: number): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap })
}

/** 以顶端为枢轴的圆润肢体：胶囊向下延伸，总长度 = len + 2r。 */
function limb(r: number, len: number, color: number): THREE.Group {
  const g = new THREE.Group()
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 14), mat(color))
  m.position.y = -(len / 2 + r)
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
  const accentM = mat(def.accent)
  const white = mat(0xffffff)
  const dark = mat(0x2a2440)

  // —— 腿（枢轴在髋部）——
  const HIP_Y = 0.34
  const legL = limb(0.075, 0.15, def.style === 'hood' ? 0x412f96 : 0x33406b)
  const legR = limb(0.075, 0.15, def.style === 'hood' ? 0x412f96 : 0x33406b)
  legL.position.set(0, HIP_Y, 0.072)
  legR.position.set(0, HIP_Y, -0.072)
  // 圆头鞋
  const shoeGeo = new THREE.SphereGeometry(0.1, 16, 12)
  for (const leg of [legL, legR]) {
    const shoe = new THREE.Mesh(shoeGeo, accentM)
    shoe.scale.set(1.25, 0.62, 1.05)
    shoe.position.set(0.045, -0.3, 0)
    leg.add(shoe)
  }
  root.add(legL, legR)

  // —— 躯干（圆润胶囊，一点点 Q 弹肚皮感）——
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.14, 8, 18), suitM)
  torso.position.y = 0.5
  body.add(torso)

  // —— 手臂（枢轴在肩）——
  const armL = limb(0.062, 0.13, def.skin)
  const armR = limb(0.062, 0.13, def.skin)
  armL.position.set(0, 0.6, 0.158)
  armR.position.set(0, 0.6, -0.158)
  body.add(armL, armR)

  // —— 大头（Q 版：头身比偏大）——
  const head = new THREE.Group()
  head.position.y = 0.82
  body.add(head)
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.2, 26, 20), skin)
  head.add(skull)

  // 眼睛（朝 +X 前进方向）：眼白 + 深色瞳孔 + 高光
  const whiteGeo = new THREE.SphereGeometry(0.052, 14, 12)
  const pupilGeo = new THREE.SphereGeometry(0.028, 12, 10)
  const hiGeo = new THREE.SphereGeometry(0.01, 8, 6)
  for (const z of [0.072, -0.072]) {
    const w = new THREE.Mesh(whiteGeo, white)
    w.scale.set(0.72, 1.0, 1.0)
    w.position.set(0.168, 0.02, z)
    head.add(w)
    const pu = new THREE.Mesh(pupilGeo, dark)
    pu.scale.set(0.6, 1.0, 1.0)
    pu.position.set(0.202, 0.02, z)
    head.add(pu)
    const hi = new THREE.Mesh(hiGeo, white)
    hi.position.set(0.214, 0.034, z)
    head.add(hi)
  }
  // 腮红
  const cheekGeo = new THREE.SphereGeometry(0.034, 12, 10)
  for (const z of [0.118, -0.118]) {
    const c = new THREE.Mesh(cheekGeo, accentM)
    c.scale.set(0.5, 0.7, 0.4)
    c.position.set(0.158, -0.052, z)
    head.add(c)
  }
  // 小嘴（朝向 +X 的小扁球）
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), dark)
  mouth.scale.set(0.5, 0.32, 1.0)
  mouth.position.set(0.19, -0.085, 0)
  head.add(mouth)

  // —— 风格配饰（保持圆润）——
  if (def.style === 'cap') {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.214, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.52),
      hairM
    )
    dome.position.y = 0.02
    head.add(dome)
    const brim = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 10), hairM)
    brim.scale.set(1.5, 0.32, 1.1)
    brim.position.set(0.17, 0.062, 0)
    head.add(brim)
    const stud = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), accentM)
    stud.position.set(0, 0.226, 0)
    head.add(stud)
  } else if (def.style === 'bunny') {
    for (const z of [0.062, -0.062]) {
      const ear = limb(0.05, 0.2, def.hair)
      ear.position.set(-0.02, 0.2, z)
      ear.rotation.z = -0.14
      head.add(ear)
      const inner = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 0.15, 4, 10), accentM)
      inner.position.set(0.012, -0.12, 0)
      ear.children[0]!.add(inner)
    }
  } else if (def.style === 'cat') {
    for (const z of [0.1, -0.1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.17, 4), hairM)
      ear.position.set(0, 0.17, z)
      head.add(ear)
      const inner = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.1, 4), accentM)
      inner.position.set(0.008, -0.012, 0)
      ear.add(inner)
    }
    // 圆润微翘尾巴（两节胶囊）
    const tailG = new THREE.Group()
    const t1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.12, 4, 10), hairM)
    t1.position.set(0, 0.1, 0)
    tailG.add(t1)
    const t2 = new THREE.Mesh(new THREE.CapsuleGeometry(0.038, 0.1, 4, 10), hairM)
    t2.position.set(0.06, 0.2, 0)
    tailG.add(t2)
    tailG.position.set(-0.17, 0.42, 0)
    tailG.rotation.z = 0.9
    body.add(tailG)
  } else if (def.style === 'spike') {
    for (let i = 0; i < 6; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.15, 6), hairM)
      const ang = (i / 6) * Math.PI * 2
      spike.position.set(Math.cos(ang) * 0.04, 0.15, Math.sin(ang) * 0.04)
      spike.rotation.z = -0.5
      head.add(spike)
    }
  } else if (def.style === 'hood') {
    const hood = new THREE.Mesh(
      new THREE.SphereGeometry(0.232, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.72),
      hairM
    )
    hood.position.set(-0.02, 0.03, 0)
    head.add(hood)
    // 面罩（圆润）
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), accentM)
    visor.scale.set(0.55, 0.62, 2.2)
    visor.position.set(0.18, 0.03, 0)
    head.add(visor)
    // 小披风
    const cape = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.1, 6, 14), hairM)
    cape.scale.set(0.32, 1, 0.92)
    cape.position.set(-0.16, 0.46, 0)
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
      body.position.y = Math.abs(Math.cos(phase)) * 0.04
      body.rotation.z = -0.14
    } else {
      // 待机动画：轻微呼吸，手臂自然
      phase += dt * 2
      legL.rotation.z *= 0.8
      legR.rotation.z *= 0.8
      armL.rotation.z *= 0.8
      armR.rotation.z *= 0.8
      body.position.y = Math.sin(phase) * 0.012
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
