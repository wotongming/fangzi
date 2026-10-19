/**
 * 莫比环跑酷 Three.js 渲染器（纯呈现层，不做规则判定）。
 * 规则真相来自 game/logic；本文件只根据 GameState 快照 + 插值 alpha 绘制。
 * 通过 stage 组件动态 import() 懒加载，three 只出现在独立异步 chunk，不进首屏。
 * 玩家是原创卡通奔跑小人（three/Character.ts），随光带标架站立、奔跑、翻面前空翻。
 */
import * as THREE from 'three'
import { frameAt, pointOn, pointAtOffset, RIBBON_WIDTH, LANE_OFFSET, STAND_OFF } from '../game/geometry'
import type { GameState } from '../game/types'
import { buildCharacter, type CharacterRig } from './Character'
import { characterOf, DEFAULT_CHARACTER_ID } from '../game/characters'

export type Fidelity = 'high' | 'low'

export interface RendererOptions {
  fidelity: Fidelity
  reduceMotion: boolean
  characterId?: string
}

interface Palette {
  bg: number
  ribbon: number
  edge: number
  wall: number
  gap: number
  shard: number
}

export const PALETTES: Record<string, Palette> = {
  aurora: { bg: 0x05060f, ribbon: 0x0c1530, edge: 0x39e6ff, wall: 0xff3b6b, gap: 0x2dffa0, shard: 0xfff27a },
  ember: { bg: 0x100507, ribbon: 0x2a0e12, edge: 0xff8a3c, wall: 0xff2f5d, gap: 0xffb14d, shard: 0x7dffc0 },
  violet: { bg: 0x0a0716, ribbon: 0x181033, edge: 0xb07bff, wall: 0xff4f9a, gap: 0x57f0ff, shard: 0xfff0a8 }
}

function paletteOf(key: string): Palette {
  return (PALETTES[key] ?? PALETTES.aurora) as Palette
}

const SEG = 220
const SEG_LEN = 0.32 // 米/段
const BEHIND = 16
const STRIPS = 8
const GATE_POOL = 16
const SHARD_POOL = 28
const PARTICLES = 360
const CAM_BACK = 3.4
const CAM_AHEAD = 7

function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
    else if (mat) mat.dispose()
  })
}

export class MobiusRenderer {
  private canvas: HTMLCanvasElement
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private opts: RendererOptions
  private palette: Palette = paletteOf('aurora')

  private ribbon!: THREE.Mesh
  private ribbonMat!: THREE.MeshBasicMaterial
  private edgeLines!: THREE.LineSegments
  private gatePool: THREE.Group[] = []
  private shardPool: THREE.Mesh[] = []
  private player!: THREE.Group
  private feetHalo!: THREE.Mesh
  private rig: CharacterRig | null = null
  private charId = DEFAULT_CHARACTER_ID
  private star!: THREE.Points

  private particles!: THREE.Points
  private pPos!: Float32Array
  private pVel!: Float32Array
  private pLife!: Float32Array
  private pCursor = 0

  private smoothedLane = LANE_OFFSET // 平滑后的车道横向有符号偏移
  private lastFace: 0 | 1 | -1 = -1
  private shake = 0
  private clock = new THREE.Clock()
  private disposed = false
  private dpr = 1

  constructor(canvas: HTMLCanvasElement, opts: RendererOptions) {
    this.canvas = canvas
    this.opts = opts
    this.charId = opts.characterId ?? DEFAULT_CHARACTER_ID
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: opts.fidelity === 'high',
      alpha: false,
      powerPreference: 'high-performance'
    })
    this.renderer.setClearColor(this.palette.bg, 1)
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.05, 220)
    this.build()
    this.resize()
  }

  setPalette(key: string): void {
    const p = paletteOf(key)
    this.palette = p
    this.renderer.setClearColor(p.bg, 1)
    this.ribbonMat.color.setHex(p.ribbon)
    ;(this.edgeLines.material as THREE.LineBasicMaterial).color.setHex(p.edge)
  }

  /** 切换原创角色：重建小人（颜色/造型来自角色定义，与主题解耦）。 */
  setCharacter(id: string): void {
    if (id === this.charId && this.rig) return
    this.charId = id
    if (this.rig) {
      this.player.remove(this.rig.root)
      this.rig.dispose()
      this.rig = null
    }
    this.rig = buildCharacter(characterOf(id))
    this.player.add(this.rig.root)
  }

  setFidelity(f: Fidelity): void {
    this.opts.fidelity = f
    this.resize()
  }
  setReduceMotion(v: boolean): void {
    this.opts.reduceMotion = v
  }

  private build(): void {
    const p: Palette = this.palette

    // 远处星点（随相机平移保持包围感，纯背景）
    const starN = this.opts.fidelity === 'high' ? 500 : 180
    const sp = new Float32Array(starN * 3)
    for (let i = 0; i < starN; i++) {
      sp[i * 3] = (Math.random() - 0.5) * 120
      sp[i * 3 + 1] = (Math.random() - 0.5) * 60
      sp[i * 3 + 2] = (Math.random() - 0.5) * 120
    }
    const sg = new THREE.BufferGeometry()
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3))
    this.star = new THREE.Points(
      sg,
      new THREE.PointsMaterial({ color: 0x8fa6ff, size: 0.35, transparent: true, opacity: 0.55 })
    )
    this.scene.add(this.star)

    // 环带（连续带面，横跨 across）
    const verts = (SEG + 1) * (STRIPS + 1)
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array(verts * 3)
    const idx: number[] = []
    for (let i = 0; i < SEG; i++) {
      for (let j = 0; j < STRIPS; j++) {
        const a = i * (STRIPS + 1) + j
        const b = a + 1
        const c = a + (STRIPS + 1)
        const d = c + 1
        idx.push(a, c, b, b, c, d)
      }
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setIndex(idx)
    this.ribbonMat = new THREE.MeshBasicMaterial({
      color: p.ribbon,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92
    })
    this.ribbon = new THREE.Mesh(g, this.ribbonMat)
    this.scene.add(this.ribbon)

    // 两侧发光边线
    const ePos = new Float32Array((SEG + 1) * 2 * 3)
    const eg = new THREE.BufferGeometry()
    eg.setAttribute('position', new THREE.BufferAttribute(ePos, 3))
    this.edgeLines = new THREE.LineSegments(
      eg,
      new THREE.LineBasicMaterial({ color: p.edge, transparent: true, opacity: 0.9 })
    )
    this.scene.add(this.edgeLines)

    // 闸门池：墙（占一车道）+ 缺口侧微光框
    for (let i = 0; i < GATE_POOL; i++) {
      const grp = new THREE.Group()
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, LANE_OFFSET * 2, RIBBON_WIDTH / 2),
        new THREE.MeshBasicMaterial({ color: p.wall, transparent: true, opacity: 0.55 })
      )
      const wallEdge = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(0.52, LANE_OFFSET * 2.04, RIBBON_WIDTH / 2 + 0.02)),
        new THREE.LineBasicMaterial({ color: p.wall })
      )
      wall.add(wallEdge)
      const gap = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.04, RIBBON_WIDTH / 2),
        new THREE.MeshBasicMaterial({ color: p.gap, transparent: true, opacity: 0.5 })
      )
      grp.add(wall, gap)
      grp.visible = false
      this.scene.add(grp)
      this.gatePool.push(grp)
    }

    // 光屑池
    const shardGeo = new THREE.OctahedronGeometry(0.16)
    for (let i = 0; i < SHARD_POOL; i++) {
      const m = new THREE.Mesh(
        shardGeo,
        new THREE.MeshBasicMaterial({ color: p.shard, transparent: true, opacity: 0.95 })
      )
      m.visible = false
      this.scene.add(m)
      this.shardPool.push(m)
    }

    // 玩家：原创卡通奔跑小人 + 脚下光环
    this.player = new THREE.Group()
    this.feetHalo = new THREE.Mesh(
      new THREE.RingGeometry(0.24, 0.36, 26),
      new THREE.MeshBasicMaterial({ color: p.edge, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })
    )
    this.feetHalo.rotation.x = -Math.PI / 2
    this.feetHalo.position.y = 0.01
    this.player.add(this.feetHalo)
    this.setCharacter(this.charId)
    this.scene.add(this.player)

    // 粒子池
    this.pPos = new Float32Array(PARTICLES * 3)
    this.pVel = new Float32Array(PARTICLES * 3)
    this.pLife = new Float32Array(PARTICLES)
    const pg = new THREE.BufferGeometry()
    pg.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3))
    this.particles = new THREE.Points(
      pg,
      new THREE.PointsMaterial({
        color: 0xbfefff,
        size: this.opts.fidelity === 'high' ? 0.28 : 0.2,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    )
    this.particles.frustumCulled = false
    this.scene.add(this.particles)
  }

  resize(): void {
    const w = this.canvas.clientWidth || this.canvas.parentElement?.clientWidth || 1
    const h = this.canvas.clientHeight || this.canvas.parentElement?.clientHeight || 1
    this.dpr = Math.min(window.devicePixelRatio || 1, this.opts.fidelity === 'high' ? 2 : 1.25)
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  private burst(world: THREE.Vector3, color: number, count: number, power: number): void {
    if (this.opts.fidelity === 'low') count = Math.floor(count / 2)
    const mat = this.particles.material as THREE.PointsMaterial
    mat.color.setHex(color)
    for (let n = 0; n < count; n++) {
      const i = this.pCursor
      this.pCursor = (this.pCursor + 1) % PARTICLES
      this.pPos[i * 3] = world.x
      this.pPos[i * 3 + 1] = world.y
      this.pPos[i * 3 + 2] = world.z
      this.pVel[i * 3] = (Math.random() - 0.5) * power
      this.pVel[i * 3 + 1] = Math.random() * power
      this.pVel[i * 3 + 2] = (Math.random() - 0.5) * power
      this.pLife[i] = 0.5 + Math.random() * 0.4
    }
  }

  private updateRibbon(playerU: number): void {
    const posAttr = this.ribbon.geometry.getAttribute('position') as THREE.BufferAttribute
    const arr = posAttr.array as Float32Array
    let vi = 0
    for (let i = 0; i <= SEG; i++) {
      const u = playerU - BEHIND + i * SEG_LEN
      for (let j = 0; j <= STRIPS; j++) {
        const t = j / STRIPS
        const off = (t - 0.5) * RIBBON_WIDTH
        const c = pointAtOffset(u, off)
        arr[vi++] = c.x
        arr[vi++] = c.y
        arr[vi++] = c.z
      }
    }
    posAttr.needsUpdate = true
    this.ribbon.geometry.computeVertexNormals()
    this.ribbon.geometry.computeBoundingSphere()

    const eAttr = this.edgeLines.geometry.getAttribute('position') as THREE.BufferAttribute
    const ea = eAttr.array as Float32Array
    let ei = 0
    for (let i = 0; i <= SEG; i++) {
      const u = playerU - BEHIND + i * SEG_LEN
      for (const side of [-1, 1]) {
        const c = pointAtOffset(u, (side * RIBBON_WIDTH) / 2)
        ea[ei++] = c.x
        ea[ei++] = c.y
        ea[ei++] = c.z
      }
    }
    eAttr.needsUpdate = true
  }

  private handleEvents(s: GameState, playerWorld: THREE.Vector3): void {
    if (s.events.includes('flip')) {
      this.rig?.flip()
      this.burst(playerWorld, this.palette.edge, 12, 3)
    }
    if (s.events.includes('near')) {
      this.shake = this.opts.reduceMotion ? 0.04 : 0.22
      this.burst(playerWorld, this.palette.edge, 26, 4)
    }
    if (s.events.includes('perfect')) {
      this.shake = this.opts.reduceMotion ? 0.05 : 0.3
      this.burst(playerWorld, this.palette.edge, 40, 5.5)
    }
    if (s.events.includes('collect')) this.burst(playerWorld, this.palette.shard, 10, 2.4)
    if (s.events.includes('death')) {
      this.shake = this.opts.reduceMotion ? 0.08 : 0.5
      this.burst(playerWorld, this.palette.wall, 60, 7)
    }
    if (s.events.includes('twist-in') && !this.opts.reduceMotion) {
      this.burst(playerWorld, this.palette.edge, 14, 3)
    }
  }

  private updateParticles(dt: number, playerU: number): void {
    const pos = this.pPos
    const vel = this.pVel
    const life = this.pLife
    let alive = false
    for (let i = 0; i < PARTICLES; i++) {
      if ((life[i] ?? 0) <= 0) continue
      alive = true
      life[i] = (life[i] ?? 0) - dt
      vel[i * 3 + 1] = (vel[i * 3 + 1] ?? 0) - 6 * dt // 轻微重力
      pos[i * 3] = (pos[i * 3] ?? 0) + (vel[i * 3] ?? 0) * dt
      pos[i * 3 + 1] = (pos[i * 3 + 1] ?? 0) + (vel[i * 3 + 1] ?? 0) * dt
      pos[i * 3 + 2] = (pos[i * 3 + 2] ?? 0) + (vel[i * 3 + 2] ?? 0) * dt
      if ((pos[i * 3] ?? 0) < playerU - BEHIND) life[i] = 0
    }
    ;(this.particles.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    this.particles.visible = alive || life.some((l) => (l ?? 0) > 0)
  }

  private tmp = new THREE.Vector3()
  private look = new THREE.Vector3()
  private camPos = new THREE.Vector3()
  private upWorld = new THREE.Vector3(0, 1, 0)
  private curUp = new THREE.Vector3(0, 1, 0)
  private vT = new THREE.Vector3()
  private vN = new THREE.Vector3()
  private vA = new THREE.Vector3()
  private playerWorld = new THREE.Vector3()
  private _basis = new THREE.Matrix4()

  render(s: GameState, alpha: number): void {
    if (this.disposed) return
    const dt = Math.min(0.05, this.clock.getDelta())
    // 渲染用插值弧长（仅供视觉，碰撞仍以离散逻辑为准）
    const interpU = s.distance + (s.status === 'running' ? s.speed * (1 / 120) * alpha : 0)

    // 车道横向平滑（翻转不瞬移）
    const targetLane = s.face === 0 ? LANE_OFFSET : -LANE_OFFSET
    this.smoothedLane += (targetLane - this.smoothedLane) * Math.min(1, dt * 14)

    this.updateRibbon(interpU)

    const frame = frameAt(interpU)
    // 玩家世界坐标（平滑车道 across + 沿带面法向轻微抬高，小人脚部在本地原点）
    this.playerWorld
      .set(frame.center.x, frame.center.y, frame.center.z)
      .addScaledVector(this.vA.set(frame.across.x, frame.across.y, frame.across.z), this.smoothedLane)
      .addScaledVector(this.vN.set(frame.normal.x, frame.normal.y, frame.normal.z), STAND_OFF + 0.02)
    this.player.position.copy(this.playerWorld)
    // 定向到光带标架：本地 +X=切线(前进) +Y=法向(站立) +Z=横向
    this._basis.makeBasis(
      this.vT.set(frame.tangent.x, frame.tangent.y, frame.tangent.z),
      this.vN.set(frame.normal.x, frame.normal.y, frame.normal.z),
      this.vA.set(frame.across.x, frame.across.y, frame.across.z)
    )
    this.player.quaternion.setFromRotationMatrix(this._basis)

    // 切面兜底：事件丢失时也能按 face 变化触发空翻
    if (this.lastFace !== -1 && this.lastFace !== s.face) this.rig?.flip()
    this.lastFace = s.face
    this.rig?.update(dt, s.speed, s.status === 'running')

    this.handleEvents(s, this.playerWorld)

    // 闸门
    let gi = 0
    for (const gate of s.gates) {
      if (gi >= GATE_POOL) break
      const rel = gate.u - interpU
      if (rel < -2 || rel > 46) continue
      const grp = this.gatePool[gi++]!
      grp.visible = true
      const gf = frameAt(gate.u)
      grp.position.set(gf.center.x, gf.center.y, gf.center.z)
      this._basis.makeBasis(
        this.vT.set(gf.tangent.x, gf.tangent.y, gf.tangent.z),
        this.vN.set(-gf.normal.x, -gf.normal.y, -gf.normal.z),
        this.vA.set(gf.across.x, gf.across.y, gf.across.z)
      )
      grp.quaternion.setFromRotationMatrix(this._basis)
      const wall = grp.children[0] as THREE.Mesh
      const gap = grp.children[1] as THREE.Mesh
      const wallSide = gate.wallFace === 0 ? 1 : -1
      const gapSide = -wallSide
      wall.position.set(0, 0, wallSide * (RIBBON_WIDTH / 4))
      gap.position.set(0, 0.02, gapSide * (RIBBON_WIDTH / 4))
      const passed = gate.passed
      ;(wall.material as THREE.MeshBasicMaterial).opacity = passed ? 0.12 : 0.55
      ;(gap.material as THREE.MeshBasicMaterial).opacity = passed ? 0.12 : 0.5
    }
    for (; gi < GATE_POOL; gi++) {
      const gx = this.gatePool[gi]
      if (gx) gx.visible = false
    }

    // 光屑
    let si = 0
    for (const sh of s.shards) {
      if (si >= SHARD_POOL) break
      const rel = sh.u - interpU
      if (rel < -2 || rel > 46) continue
      const m = this.shardPool[si++]!
      if (sh.taken) {
        m.visible = false
        continue
      }
      m.visible = true
      const c = pointOn(sh.u, sh.face)
      m.position.set(c.x, c.y, c.z)
      m.rotation.y += dt * 2
      const pulse = 1 + Math.sin(this.clock.elapsedTime * 6 + sh.u) * 0.15
      m.scale.setScalar(pulse)
    }
    for (; si < SHARD_POOL; si++) {
      const sx = this.shardPool[si]
      if (sx) sx.visible = false
    }

    this.updateParticles(dt, interpU)

    // 相机：贴面跟随，相机 up 用带面法线（半扭转时自然翻滚），降低动态时回正世界上
    const backF = frameAt(Math.max(0, interpU - CAM_BACK))
    this.tmp
      .set(backF.center.x, backF.center.y, backF.center.z)
      .addScaledVector(new THREE.Vector3(backF.across.x, backF.across.y, backF.across.z), this.smoothedLane)
      .addScaledVector(new THREE.Vector3(backF.normal.x, backF.normal.y, backF.normal.z), 0.55)
    this.camPos.copy(this.tmp)
    this.look.set(frame.center.x, frame.center.y, frame.center.z).addScaledVector(
      new THREE.Vector3(frame.tangent.x, frame.tangent.y, frame.tangent.z),
      CAM_AHEAD
    )

    const wantUp = this.opts.reduceMotion
      ? this.upWorld
      : new THREE.Vector3(frame.normal.x, frame.normal.y, frame.normal.z)
    this.curUp.lerp(wantUp, Math.min(1, dt * 6)).normalize()

    if (this.shake > 0.001 && !this.opts.reduceMotion) {
      this.camPos.x += (Math.random() - 0.5) * this.shake
      this.camPos.y += (Math.random() - 0.5) * this.shake
      this.camPos.z += (Math.random() - 0.5) * this.shake
      this.shake *= Math.pow(0.001, dt)
    } else {
      this.shake = 0
    }
    this.camera.position.copy(this.camPos)
    this.camera.up.copy(this.curUp)
    this.camera.lookAt(this.look)

    // 星点跟随玩家，保持包围
    this.star.position.x = frame.center.x

    this.renderer.render(this.scene, this.camera)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.rig?.dispose()
    disposeObject(this.scene)
    this.renderer.dispose()
  }
}
