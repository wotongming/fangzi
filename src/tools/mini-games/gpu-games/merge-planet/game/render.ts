/**
 * 合成大星球 —— Canvas2D 程序化美术（无图片素材、无第三方 IP，全部代码实时绘制）。
 *
 * 每颗星球：左上光源径向渐变明暗交界 + 环境光阴影 + 顶部高光点 + 专属表面特征
 * （地球海陆/火星红斑/木星条纹/月球环形山/太阳火焰辉光/黑洞吸积盘/土星半透明环）。
 * 背景为深空星空 + 星云渐变；本文件只负责画，不含物理与玩法判定。
 */
import { TIERS, FINAL_TIER, type TierDef } from './logic'

/** 确定性伪随机（同一 body 种子每帧结果一致，避免表面闪烁）。 */
export function hash01(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

export interface Star {
  x: number
  y: number
  r: number
  phase: number
  tint: number
}

/** 按画布尺寸生成一版静态星空（星云位置固定，避免每帧抖动）。 */
export function makeStarfield(w: number, h: number, count = 130): Star[] {
  const stars: Star[] = []
  for (let i = 0; i < count; i++) {
    stars.push({
      x: hash01(i * 3 + 1) * w,
      y: hash01(i * 3 + 2) * h,
      r: 0.4 + hash01(i * 3 + 3) * 1.3,
      phase: hash01(i * 7 + 5) * Math.PI * 2,
      tint: hash01(i * 11 + 9)
    })
  }
  return stars
}

/** 深空背景：纵向渐变 + 两团星云 + 闪烁星点。 */
export function drawSpaceBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  stars: Star[],
  timeSec: number
): void {
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, '#070b1c')
  g.addColorStop(0.5, '#0a0f26')
  g.addColorStop(1, '#0d0a22')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)

  // 星云（大半径低透明度径向团）
  const nebulae: Array<[number, number, number, string]> = [
    [w * 0.18, h * 0.22, w * 0.32, 'rgba(88,72,190,0.10)'],
    [w * 0.85, h * 0.62, w * 0.36, 'rgba(40,110,180,0.09)'],
    [w * 0.55, h * 0.9, w * 0.3, 'rgba(150,70,150,0.07)']
  ]
  for (const [nx, ny, nr, color] of nebulae) {
    const ng = ctx.createRadialGradient(nx, ny, 0, nx, ny, nr)
    ng.addColorStop(0, color)
    ng.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = ng
    ctx.fillRect(0, 0, w, h)
  }

  // 星点（缓慢呼吸闪烁）
  for (const s of stars) {
    const tw = 0.55 + 0.45 * Math.sin(timeSec * 1.4 + s.phase)
    ctx.globalAlpha = 0.35 + tw * 0.55
    ctx.fillStyle = s.tint > 0.8 ? '#cfe2ff' : s.tint > 0.5 ? '#ffffff' : '#bcd0ff'
    ctx.beginPath()
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

interface PaintOpts {
  /** 出生弹动缩放（1 为正常），由组件按时间计算 */
  popScale: number
  /** 全局秒，用于太阳脉动等 */
  timeSec: number
  /** 确定性种子（body.id），保证表面特征稳定 */
  seed: number
}

function baseSphere(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, tier: TierDef): void {
  const g = ctx.createRadialGradient(x - r * 0.38, y - r * 0.42, r * 0.1, x, y, r)
  g.addColorStop(0, `hsl(${tier.hue}, ${tier.sat}%, ${Math.min(88, tier.light + 22)}%)`)
  g.addColorStop(0.55, `hsl(${tier.hue}, ${tier.sat}%, ${tier.light}%)`)
  g.addColorStop(1, `hsl(${tier.hue}, ${tier.sat}%, ${Math.max(12, tier.light - 26)}%)`)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

/** 顶部高光点 + 右下环境阴影，统一叠在表面特征之后。 */
function finishSphere(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  // 高光
  const hl = ctx.createRadialGradient(x - r * 0.42, y - r * 0.46, 0, x - r * 0.42, y - r * 0.46, r * 0.5)
  hl.addColorStop(0, 'rgba(255,255,255,0.5)')
  hl.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = hl
  ctx.beginPath()
  ctx.ellipse(x - r * 0.36, y - r * 0.4, r * 0.34, r * 0.22, -0.5, 0, Math.PI * 2)
  ctx.fill()
  // 右下暗角（球体体积感）
  const sh = ctx.createRadialGradient(x + r * 0.5, y + r * 0.55, r * 0.2, x, y, r)
  sh.addColorStop(0, 'rgba(0,0,0,0.32)')
  sh.addColorStop(0.7, 'rgba(0,0,0,0)')
  ctx.fillStyle = sh
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

function clipCircle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fn: () => void): void {
  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.clip()
  fn()
  ctx.restore()
}

function craters(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, seed: number, n: number, color: string): void {
  for (let i = 0; i < n; i++) {
    const a = hash01(seed * 13 + i * 7) * Math.PI * 2
    const d = hash01(seed * 17 + i * 3) * r * 0.62
    const cx = x + Math.cos(a) * d
    const cy = y + Math.sin(a) * d
    const cr = r * (0.08 + hash01(seed * 19 + i) * 0.13)
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(cx, cy, cr, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'
    ctx.lineWidth = Math.max(0.6, r * 0.02)
    ctx.stroke()
  }
}

/** 画一颗星球（含土星环/黑洞吸积盘等专属特征）。 */
export function paintPlanet(
  ctx: CanvasRenderingContext2D,
  tierIndex: number,
  x: number,
  y: number,
  r: number,
  opts: PaintOpts
): void {
  const tier = TIERS[tierIndex]
  if (!tier) return
  const { popScale, timeSec, seed } = opts
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(popScale, popScale)
  ctx.translate(-x, -y)

  // 土星环（后半先画）
  if (tierIndex === 7) drawSaturnRing(ctx, x, y, r, true)

  switch (tierIndex) {
    case 0: // 陨石：灰褐色岩石 + 坑洼
      baseSphere(ctx, x, y, r, tier)
      clipCircle(ctx, x, y, r, () => {
        craters(ctx, x, y, r, seed, 6, 'rgba(40,32,28,0.5)')
        for (let i = 0; i < 5; i++) {
          ctx.fillStyle = `rgba(60,48,40,${0.18 + hash01(seed + i) * 0.2})`
          ctx.beginPath()
          ctx.arc(x + (hash01(seed * 5 + i) - 0.5) * r * 1.2, y + (hash01(seed * 6 + i) - 0.5) * r * 1.2, r * 0.22, 0, Math.PI * 2)
          ctx.fill()
        }
      })
      break
    case 1: // 月球：灰 + 深色月海 + 带明暗边的环形山
      baseSphere(ctx, x, y, r, tier)
      clipCircle(ctx, x, y, r, () => {
        for (let i = 0; i < 5; i++) {
          ctx.fillStyle = `rgba(86,92,108,${0.4 + hash01(seed + i) * 0.25})`
          ctx.beginPath()
          ctx.ellipse(
            x + (hash01(seed * 5 + i) - 0.5) * r * 1.1,
            y + (hash01(seed * 6 + i) - 0.5) * r * 1.1,
            r * (0.22 + hash01(i * seed) * 0.16),
            r * (0.15 + hash01(i) * 0.1),
            hash01(i) * 3, 0, Math.PI * 2
          )
          ctx.fill()
        }
        // 环形山：暗坑 + 受光侧壁亮线
        for (let i = 0; i < 7; i++) {
          const a = hash01(seed * 13 + i * 7) * Math.PI * 2
          const d = hash01(seed * 17 + i * 3) * r * 0.62
          const cx = x + Math.cos(a) * d
          const cy = y + Math.sin(a) * d
          const cr = r * (0.08 + hash01(seed * 19 + i) * 0.12)
          ctx.fillStyle = 'rgba(72,78,92,0.55)'
          ctx.beginPath()
          ctx.arc(cx, cy, cr, 0, Math.PI * 2)
          ctx.fill()
          ctx.strokeStyle = 'rgba(235,240,255,0.28)'
          ctx.lineWidth = Math.max(0.6, r * 0.02)
          ctx.beginPath()
          ctx.arc(cx, cy, cr, Math.PI * 0.9, Math.PI * 1.9)
          ctx.stroke()
        }
      })
      break
    case 2: // 水星：土灰多坑
      baseSphere(ctx, x, y, r, tier)
      clipCircle(ctx, x, y, r, () => craters(ctx, x, y, r, seed, 9, 'rgba(96,80,66,0.45)'))
      break
    case 3: // 火星：锈红 + 暗盆地 + 白斑极冠 + 陨石坑
      baseSphere(ctx, x, y, r, tier)
      clipCircle(ctx, x, y, r, () => {
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = `rgba(112,46,26,${0.35 + hash01(seed + i) * 0.2})`
          ctx.beginPath()
          ctx.ellipse(
            x + (hash01(seed * 5 + i) - 0.5) * r,
            y + (hash01(seed * 6 + i) - 0.5) * r,
            r * (0.26 + hash01(i) * 0.12), r * 0.16, 0.4, 0, Math.PI * 2
          )
          ctx.fill()
        }
        ctx.fillStyle = 'rgba(255,246,238,0.8)'
        ctx.beginPath()
        ctx.ellipse(x, y - r * 0.88, r * 0.32, r * 0.11, 0, 0, Math.PI * 2)
        ctx.fill()
        craters(ctx, x, y, r, seed, 5, 'rgba(104,42,24,0.45)')
      })
      break
    case 4: { // 地球：深蓝海洋 + 绿/褐大陆 + 白云 + 蓝色大气辉光
      baseSphere(ctx, x, y, r, tier)
      clipCircle(ctx, x, y, r, () => {
        for (let i = 0; i < 7; i++) {
          const gx = x + (hash01(seed * 3 + i) - 0.5) * r * 1.2
          const gy = y + (hash01(seed * 4 + i) - 0.5) * r * 1.2
          ctx.fillStyle = i % 2 ? 'rgba(66,142,80,0.92)' : 'rgba(172,146,96,0.92)'
          ctx.beginPath()
          ctx.ellipse(gx, gy, r * (0.18 + hash01(i * seed) * 0.16), r * (0.12 + hash01(i) * 0.1), hash01(i * 3) * 3, 0, Math.PI * 2)
          ctx.fill()
        }
        // 白云条带
        ctx.fillStyle = 'rgba(255,255,255,0.4)'
        for (let i = 0; i < 4; i++) {
          ctx.beginPath()
          ctx.ellipse(
            x + (hash01(seed * 9 + i) - 0.5) * r,
            y + (hash01(seed * 10 + i) - 0.5) * r,
            r * 0.32, r * 0.07, 0.3, 0, Math.PI * 2
          )
          ctx.fill()
        }
      })
      // 大气辉光（外圈亮蓝）
      const atmo = ctx.createRadialGradient(x, y, r * 0.92, x, y, r * 1.22)
      atmo.addColorStop(0, 'rgba(120,190,255,0)')
      atmo.addColorStop(0.8, 'rgba(130,200,255,0.4)')
      atmo.addColorStop(1, 'rgba(120,190,255,0)')
      ctx.fillStyle = atmo
      ctx.beginPath()
      ctx.arc(x, y, r * 1.22, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case 5: // 海王星：深蓝条纹 + 风暴斑
      baseSphere(ctx, x, y, r, tier)
      clipCircle(ctx, x, y, r, () => bands(ctx, x, y, r, ['rgba(30,80,190,0.5)', 'rgba(90,140,230,0.35)', 'rgba(24,64,160,0.5)']))
      ctx.fillStyle = 'rgba(10,30,90,0.6)'
      ctx.beginPath()
      ctx.ellipse(x + r * 0.2, y + r * 0.18, r * 0.2, r * 0.12, 0, 0, Math.PI * 2)
      ctx.fill()
      break
    case 6: // 天王星：淡青 + 细环
      baseSphere(ctx, x, y, r, tier)
      clipCircle(ctx, x, y, r, () => bands(ctx, x, y, r, ['rgba(150,220,214,0.4)', 'rgba(190,236,230,0.3)', 'rgba(120,200,196,0.35)']))
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(1.2)
      ctx.strokeStyle = 'rgba(210,240,238,0.35)'
      ctx.lineWidth = r * 0.06
      ctx.beginPath()
      ctx.ellipse(0, 0, r * 1.28, r * 0.4, 0, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
      break
    case 7: // 土星：金棕条纹 + 半透明环（前半在主体后补）
      baseSphere(ctx, x, y, r, tier)
      clipCircle(ctx, x, y, r, () => bands(ctx, x, y, r, ['rgba(214,182,120,0.5)', 'rgba(238,214,158,0.35)', 'rgba(190,156,100,0.5)']))
      drawSaturnRing(ctx, x, y, r, false)
      break
    case 8: // 木星：米棕交错条带 + 大红斑
      baseSphere(ctx, x, y, r, tier)
      clipCircle(ctx, x, y, r, () => bands(ctx, x, y, r, ['rgba(198,158,112,0.85)', 'rgba(242,226,198,0.7)', 'rgba(170,122,88,0.85)', 'rgba(234,208,172,0.65)']))
      ctx.fillStyle = 'rgba(200,84,56,0.9)'
      ctx.beginPath()
      ctx.ellipse(x + r * 0.28, y + r * 0.22, r * 0.27, r * 0.15, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = 'rgba(150,60,40,0.5)'
      ctx.lineWidth = Math.max(0.8, r * 0.02)
      ctx.stroke()
      break
    case 9: { // 太阳：金核 + 脉动火焰辉光
      const pulse = 1 + Math.sin(timeSec * 3) * 0.04
      const halo = ctx.createRadialGradient(x, y, r * 0.4, x, y, r * 1.9 * pulse)
      halo.addColorStop(0, 'rgba(255,200,90,0.7)')
      halo.addColorStop(0.5, 'rgba(255,140,50,0.3)')
      halo.addColorStop(1, 'rgba(255,110,30,0)')
      ctx.fillStyle = halo
      ctx.beginPath()
      ctx.arc(x, y, r * 1.9 * pulse, 0, Math.PI * 2)
      ctx.fill()
      baseSphere(ctx, x, y, r, tier)
      clipCircle(ctx, x, y, r, () => {
        for (let i = 0; i < 14; i++) {
          ctx.fillStyle = `rgba(255,224,130,${0.16 + hash01(seed + i) * 0.22})`
          ctx.beginPath()
          ctx.arc(
            x + (hash01(seed * 7 + i) - 0.5) * r * 1.3,
            y + (hash01(seed * 8 + i) - 0.5) * r * 1.3,
            r * 0.09,
            0,
            Math.PI * 2
          )
          ctx.fill()
        }
      })
      break
    }
    default: // 10 黑洞：纯黑核心 + 光子环 + 吸积盘
      drawBlackhole(ctx, x, y, r, timeSec)
      break
  }

  if (tierIndex !== 10) finishSphere(ctx, x, y, r)
  ctx.restore()
}

function bands(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, colors: string[]): void {
  const n = colors.length
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[i] ?? 'rgba(255,255,255,0.3)'
    const top = y - r + (2 * r * i) / n
    ctx.fillRect(x - r, top, r * 2, (2 * r) / n + 1)
  }
}

function drawSaturnRing(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, back: boolean): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(-0.32)
  ctx.scale(1, 0.36)
  if (back) {
    ctx.strokeStyle = 'rgba(230,206,160,0.62)'
    ctx.lineWidth = r * 0.17
    ctx.beginPath()
    ctx.ellipse(0, 0, r * 1.55, r * 1.55, 0, Math.PI, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(255,238,200,0.42)'
    ctx.lineWidth = r * 0.07
    ctx.beginPath()
    ctx.ellipse(0, 0, r * 1.78, r * 1.78, 0, Math.PI, Math.PI * 2)
    ctx.stroke()
  } else {
    ctx.strokeStyle = 'rgba(230,206,160,0.78)'
    ctx.lineWidth = r * 0.17
    ctx.beginPath()
    ctx.ellipse(0, 0, r * 1.55, r * 1.55, 0, 0, Math.PI)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(255,238,200,0.5)'
    ctx.lineWidth = r * 0.07
    ctx.beginPath()
    ctx.ellipse(0, 0, r * 1.78, r * 1.78, 0, 0, Math.PI)
    ctx.stroke()
  }
  ctx.restore()
}

function drawBlackhole(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, timeSec: number): void {
  // 吸积盘（椭圆橙金环，一侧更亮）
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(-0.28)
  ctx.scale(1, 0.34)
  const disk = ctx.createLinearGradient(-r * 2, 0, r * 2, 0)
  disk.addColorStop(0, 'rgba(255,150,60,0.15)')
  disk.addColorStop(0.5, 'rgba(255,200,110,0.85)')
  disk.addColorStop(1, 'rgba(120,160,255,0.25)')
  ctx.strokeStyle = disk
  ctx.lineWidth = r * 0.22
  ctx.beginPath()
  ctx.ellipse(0, 0, r * 1.7, r * 1.7, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
  // 事件视界纯黑盘
  ctx.fillStyle = '#000'
  ctx.beginPath()
  ctx.arc(x, y, r * 0.92, 0, Math.PI * 2)
  ctx.fill()
  // 光子环（细亮环，缓慢脉动）
  const pr = r * 0.96 * (1 + Math.sin(timeSec * 2.4) * 0.02)
  const ring = ctx.createRadialGradient(x, y, pr - 2, x, y, pr + 4)
  ring.addColorStop(0, 'rgba(180,210,255,0)')
  ring.addColorStop(0.5, 'rgba(200,225,255,0.9)')
  ring.addColorStop(1, 'rgba(180,210,255,0)')
  ctx.strokeStyle = ring
  ctx.lineWidth = r * 0.06
  ctx.beginPath()
  ctx.arc(x, y, pr, 0, Math.PI * 2)
  ctx.stroke()
}

export { FINAL_TIER }
