/**
 * 合成宇宙（内部 id merge-planet）—— Canvas2D 程序化美术（无图片素材、无第三方 IP，全部代码实时绘制）。
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

/** 火流星（陨石 index0）：深炭黑岩石本体 + 烧蚀橙红熔壳亮边 + 暖黄熔岩裂纹 + 反向彗尾火焰。 */
function drawMeteor(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, seed: number, timeSec: number): void {
  const flicker = 1 + Math.sin(timeSec * 9 + seed) * 0.08
  // 反向彗尾火焰（固定朝左下，模拟运动反方向的拖尾），先画在岩石之后
  const tailA = Math.PI * 0.78
  const tx = x + Math.cos(tailA) * r * 0.9
  const ty = y + Math.sin(tailA) * r * 0.9
  for (let i = 3; i >= 1; i--) {
    const len = r * (0.9 + i * 0.32) * flicker
    const ex = tx + Math.cos(tailA) * len
    const ey = ty + Math.sin(tailA) * len
    const tg = ctx.createRadialGradient(tx, ty, 0, ex, ey, len)
    tg.addColorStop(0, `rgba(255,180,70,${0.32 / i})`)
    tg.addColorStop(1, 'rgba(255,90,30,0)')
    ctx.fillStyle = tg
    ctx.beginPath()
    ctx.ellipse(tx + Math.cos(tailA) * len * 0.5, ty + Math.sin(tailA) * len * 0.5, len * 0.55, len * 0.26, tailA, 0, Math.PI * 2)
    ctx.fill()
  }

  // 外层熔壳辉光（小尺寸也一眼可认的高饱和橙红）
  const halo = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 1.7 * flicker)
  halo.addColorStop(0, 'rgba(255,120,40,0.45)')
  halo.addColorStop(0.6, 'rgba(220,70,30,0.18)')
  halo.addColorStop(1, 'rgba(200,60,20,0)')
  ctx.fillStyle = halo
  ctx.beginPath()
  ctx.arc(x, y, r * 1.7 * flicker, 0, Math.PI * 2)
  ctx.fill()

  // 深炭黑岩石本体
  const body = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r)
  body.addColorStop(0, '#3b312d')
  body.addColorStop(0.6, '#1c1715')
  body.addColorStop(1, '#0a0808')
  ctx.fillStyle = body
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()

  clipCircle(ctx, x, y, r, () => {
    // 暗坑纹理
    for (let i = 0; i < 5; i++) {
      const a = hash01(seed * 11 + i) * Math.PI * 2
      const d = hash01(seed * 13 + i) * r * 0.6
      ctx.fillStyle = `rgba(0,0,0,${0.18 + hash01(seed + i) * 0.2})`
      ctx.beginPath()
      ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, r * (0.08 + hash01(i) * 0.1), 0, Math.PI * 2)
      ctx.fill()
    }
    // 暖黄熔岩裂纹（锯齿折线，发光）
    ctx.lineCap = 'round'
    for (let i = 0; i < 5; i++) {
      const a0 = hash01(seed * 21 + i) * Math.PI * 2
      let px = x + Math.cos(a0) * r * 0.2
      let py = y + Math.sin(a0) * r * 0.2
      ctx.strokeStyle = `rgba(255,${150 + Math.floor(hash01(i) * 60)},60,${0.5 + hash01(seed + i) * 0.3})`
      ctx.lineWidth = Math.max(0.7, r * 0.035)
      ctx.beginPath()
      ctx.moveTo(px, py)
      for (let s = 1; s <= 3; s++) {
        px += (hash01(seed * 31 + i * 7 + s) - 0.5) * r * 0.5
        py += (hash01(seed * 33 + i * 5 + s) - 0.5) * r * 0.5
        ctx.lineTo(px, py)
      }
      ctx.stroke()
    }
  })

  // 烧蚀熔壳亮边（橙红，朝尾侧更亮）
  const rim = ctx.createLinearGradient(x - r, y - r, x + r, y + r)
  rim.addColorStop(0, 'rgba(255,190,90,0.9)')
  rim.addColorStop(0.5, 'rgba(255,110,40,0.75)')
  rim.addColorStop(1, 'rgba(200,60,25,0.55)')
  ctx.lineWidth = r * 0.14
  ctx.strokeStyle = rim
  ctx.beginPath()
  ctx.arc(x, y, r * 0.96, 0, Math.PI * 2)
  ctx.stroke()
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
    case 0: // 陨石（火流星）：深炭黑岩石 + 烧蚀橙红熔壳 + 熔岩裂纹 + 彗尾火焰，与灰色岩石星球区分
      drawMeteor(ctx, x, y, r, seed, timeSec)
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
    case 10: // 红巨星：巨大橙红→暗红膨胀气晕 + 对流亮斑
      drawRedGiant(ctx, x, y, r, tier, timeSec, seed)
      break
    case 11: // 白矮星：小而极亮的白热/淡蓝致密星 + 紧凑辉光（游戏半径画大）
      drawWhiteDwarf(ctx, x, y, r, timeSec)
      break
    case 12: // 中子星(脉冲星)：蓝白致密球 + 两极锥形能量束 + 微弱脉冲
      drawNeutronStar(ctx, x, y, r, timeSec)
      break
    case 13: // 黑洞：纯黑引力透镜暗核 + 高速吸积盘 + 光子环
      drawBlackhole(ctx, x, y, r, timeSec)
      break
    case 14: // 球状星团：数十颗亮恒星聚成球形，中心密、边缘疏
      drawGlobular(ctx, x, y, r, seed)
      break
    case 15: // 旋涡星系：明亮核球 + 2~3 旋臂 + 尘带 + 倾斜盘面
      drawSpiralGalaxy(ctx, x, y, r, seed, timeSec)
      break
    case 16: // 星系团：多个星系光斑聚集在淡蓝暗物质光晕中
      drawGalaxyCluster(ctx, x, y, r, seed)
      break
    case 17: // 超星系团：纤维状/网状光点结构（大尺度纤维 + 空洞）
      drawSupercluster(ctx, x, y, r, seed)
      break
    case 18: // 宇宙(终极)：深邃多色星云 + 微缩星系网格全景 + 柔和外辉
      drawCosmos(ctx, x, y, r, seed, timeSec)
      break
  }

  // 黑洞(13)与宇宙结构类(14~18)为专属美术，不走统一高光阴影；0~12 仍叠体积感
  if (tierIndex <= 12) finishSphere(ctx, x, y, r)
  ctx.restore()
}

/** 红巨星：外层膨胀热气晕 + 橙红对流亮斑。 */
function drawRedGiant(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, tier: TierDef, timeSec: number, seed: number): void {
  const pulse = 1 + Math.sin(timeSec * 2.2) * 0.03
  // 外层热气晕
  const glow = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 1.75 * pulse)
  glow.addColorStop(0, 'rgba(255,120,60,0.55)')
  glow.addColorStop(0.55, 'rgba(230,80,40,0.25)')
  glow.addColorStop(1, 'rgba(200,60,30,0)')
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(x, y, r * 1.75 * pulse, 0, Math.PI * 2)
  ctx.fill()
  baseSphere(ctx, x, y, r, tier)
  clipCircle(ctx, x, y, r, () => {
    // 对流亮斑（不规则橙黄斑块）
    for (let i = 0; i < 12; i++) {
      const a = hash01(seed * 7 + i) * Math.PI * 2
      const d = hash01(seed * 8 + i) * r * 0.8
      ctx.fillStyle = `rgba(255,${150 + Math.floor(hash01(seed + i) * 70)},90,${0.18 + hash01(i + seed) * 0.22})`
      ctx.beginPath()
      ctx.ellipse(
        x + Math.cos(a) * d, y + Math.sin(a) * d,
        r * (0.16 + hash01(seed * 3 + i) * 0.18),
        r * (0.1 + hash01(i) * 0.12), a, 0, Math.PI * 2
      )
      ctx.fill()
    }
    // 暗红沉降区
    ctx.fillStyle = 'rgba(150,40,26,0.35)'
    ctx.beginPath()
    ctx.ellipse(x - r * 0.3, y + r * 0.35, r * 0.5, r * 0.3, 0.5, 0, Math.PI * 2)
    ctx.fill()
  })
}

/** 白矮星：极亮白热核心 + 淡蓝紧凑辉光。 */
function drawWhiteDwarf(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, timeSec: number): void {
  const pulse = 1 + Math.sin(timeSec * 4) * 0.05
  const halo = ctx.createRadialGradient(x, y, 0, x, y, r * 1.5 * pulse)
  halo.addColorStop(0, 'rgba(240,248,255,0.95)')
  halo.addColorStop(0.35, 'rgba(190,220,255,0.5)')
  halo.addColorStop(1, 'rgba(150,190,255,0)')
  ctx.fillStyle = halo
  ctx.beginPath()
  ctx.arc(x, y, r * 1.5 * pulse, 0, Math.PI * 2)
  ctx.fill()
  const core = ctx.createRadialGradient(x - r * 0.2, y - r * 0.25, 0, x, y, r)
  core.addColorStop(0, '#ffffff')
  core.addColorStop(0.55, '#e8f1ff')
  core.addColorStop(1, '#9fc0ee')
  ctx.fillStyle = core
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  // 致密高光点
  ctx.fillStyle = 'rgba(255,255,255,0.95)'
  ctx.beginPath()
  ctx.arc(x - r * 0.32, y - r * 0.36, r * 0.2, 0, Math.PI * 2)
  ctx.fill()
}

/** 中子星(脉冲星)：蓝白致密球 + 两极锥形光束 + 旋转脉冲明暗。 */
function drawNeutronStar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, timeSec: number): void {
  const beam = 0.55 + 0.45 * Math.sin(timeSec * 6)
  // 两极锥形能量束（绕竖直轴）
  ctx.save()
  ctx.translate(x, y)
  ctx.globalAlpha = 0.35 + beam * 0.4
  for (const dir of [-1, 1]) {
    const cone = ctx.createLinearGradient(0, 0, 0, dir * r * 2.4)
    cone.addColorStop(0, 'rgba(190,235,255,0.9)')
    cone.addColorStop(1, 'rgba(120,180,255,0)')
    ctx.fillStyle = cone
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.ellipse(0, dir * r * 1.2, r * 0.28, r * 1.2, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
  // 致密蓝白球
  const core = ctx.createRadialGradient(x - r * 0.25, y - r * 0.3, 0, x, y, r)
  core.addColorStop(0, '#eaf6ff')
  core.addColorStop(0.6, '#9fd4ff')
  core.addColorStop(1, '#3f7fd6')
  ctx.fillStyle = core
  ctx.beginPath()
  ctx.arc(x, y, r * 0.92, 0, Math.PI * 2)
  ctx.fill()
  // 磁层环
  ctx.strokeStyle = `rgba(180,225,255,${0.3 + beam * 0.4})`
  ctx.lineWidth = r * 0.05
  ctx.beginPath()
  ctx.ellipse(x, y, r * 1.15, r * 0.4, -0.4, 0, Math.PI * 2)
  ctx.stroke()
}

/** 球状星团：数十颗亮恒星，中心密、边缘疏，整体团成球。 */
function drawGlobular(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, seed: number): void {
  // 微弱金色团晕
  const glow = ctx.createRadialGradient(x, y, 0, x, y, r)
  glow.addColorStop(0, 'rgba(255,226,170,0.35)')
  glow.addColorStop(1, 'rgba(255,200,140,0)')
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  clipCircle(ctx, x, y, r, () => {
    for (let i = 0; i < 46; i++) {
      const u = hash01(seed * 11 + i)
      const v = hash01(seed * 13 + i * 3)
      // 向心聚集：用 sqrt(u) 控制半径，越中心越密
      const d = Math.sqrt(u) * r * 0.95
      const a = v * Math.PI * 2
      const sx = x + Math.cos(a) * d
      const sy = y + Math.sin(a) * d
      const sr = r * (0.03 + hash01(seed * 17 + i) * 0.07)
      const warm = hash01(seed * 19 + i)
      ctx.fillStyle = warm > 0.7 ? '#fff4d6' : warm > 0.4 ? '#ffe6b8' : '#ffd28a'
      ctx.globalAlpha = 0.5 + hash01(i + seed) * 0.5
      ctx.beginPath()
      ctx.arc(sx, sy, sr, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  })
}

/** 旋涡星系：亮核球 + 2~3 旋臂 + 尘带 + 倾斜盘面。 */
function drawSpiralGalaxy(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, seed: number, timeSec: number): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(-0.5 + hash01(seed) * 0.4)
  ctx.scale(1, 0.62)
  // 盘面淡蓝辉光
  const disk = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
  disk.addColorStop(0, 'rgba(220,236,255,0.5)')
  disk.addColorStop(0.6, 'rgba(120,170,235,0.22)')
  disk.addColorStop(1, 'rgba(90,130,220,0)')
  ctx.fillStyle = disk
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.fill()
  // 旋臂（对数螺线点列）
  const arms = 2 + Math.floor(hash01(seed * 3) * 2)
  for (let arm = 0; arm < arms; arm++) {
    for (let i = 0; i < 34; i++) {
      const t = i / 34
      const ang = arm * ((Math.PI * 2) / arms) + t * 4.2 + timeSec * 0.05
      const dd = t * r * 0.92
      const sx = Math.cos(ang) * dd
      const sy = Math.sin(ang) * dd
      const sr = r * (0.05 * (1 - t) + 0.015)
      ctx.fillStyle = `rgba(${170 + Math.floor(t * 60)},${200 + Math.floor(t * 30)},255,${0.55 * (1 - t) + 0.15})`
      ctx.beginPath()
      ctx.arc(sx, sy, sr, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  // 尘带（暗褐螺旋弧）
  ctx.strokeStyle = 'rgba(70,52,90,0.5)'
  ctx.lineWidth = r * 0.06
  ctx.beginPath()
  for (let i = 0; i <= 40; i++) {
    const t = i / 40
    const ang = t * 4.2
    const dd = t * r * 0.9
    const px = Math.cos(ang) * dd
    const py = Math.sin(ang) * dd
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.stroke()
  // 明亮核球
  const bulge = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.34)
  bulge.addColorStop(0, '#fff8ea')
  bulge.addColorStop(1, 'rgba(255,220,180,0)')
  ctx.fillStyle = bulge
  ctx.beginPath()
  ctx.arc(0, 0, r * 0.34, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** 星系团：多个星系光斑聚集在淡蓝暗物质光晕中。 */
function drawGalaxyCluster(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, seed: number): void {
  const halo = ctx.createRadialGradient(x, y, 0, x, y, r)
  halo.addColorStop(0, 'rgba(150,190,255,0.22)')
  halo.addColorStop(1, 'rgba(120,160,240,0)')
  ctx.fillStyle = halo
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  clipCircle(ctx, x, y, r, () => {
    for (let i = 0; i < 9; i++) {
      const a = hash01(seed * 5 + i) * Math.PI * 2
      const d = hash01(seed * 7 + i) * r * 0.8
      const gx = x + Math.cos(a) * d
      const gy = y + Math.sin(a) * d
      const gr = r * (0.12 + hash01(seed * 9 + i) * 0.12)
      // 小星系：核 + 短旋尾
      const gg = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr * 1.6)
      gg.addColorStop(0, 'rgba(235,244,255,0.9)')
      gg.addColorStop(1, 'rgba(150,195,255,0)')
      ctx.fillStyle = gg
      ctx.beginPath()
      ctx.ellipse(gx, gy, gr * 1.6, gr * 0.7, a, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(gx, gy, gr * 0.35, 0, Math.PI * 2)
      ctx.fill()
    }
  })
}

/** 超星系团：纤维/网状光点结构（大尺度纤维 + 空洞）。 */
function drawSupercluster(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, seed: number): void {
  clipCircle(ctx, x, y, r, () => {
    // 3 条主纤维（折线光点链）
    for (let f = 0; f < 3; f++) {
      let px = x + (hash01(seed + f * 3) - 0.5) * r * 1.6
      let py = y + (hash01(seed + f * 5) - 0.5) * r * 1.6
      for (let i = 0; i < 16; i++) {
        px += (hash01(seed * 31 + f * 16 + i) - 0.5) * r * 0.22
        py += (hash01(seed * 37 + f * 16 + i) - 0.5) * r * 0.22
        const sr = r * (0.03 + hash01(seed * 41 + i + f) * 0.05)
        ctx.fillStyle = f === 1 ? 'rgba(210,190,255,0.85)' : 'rgba(190,205,255,0.8)'
        ctx.beginPath()
        ctx.arc(px, py, sr, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    // 散布的稀疏暗点（空洞区）
    for (let i = 0; i < 12; i++) {
      const a = hash01(seed * 51 + i) * Math.PI * 2
      const d = hash01(seed * 53 + i) * r * 0.95
      ctx.fillStyle = 'rgba(150,165,220,0.25)'
      ctx.beginPath()
      ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, r * 0.02, 0, Math.PI * 2)
      ctx.fill()
    }
  })
}

/** 宇宙(终极)：深邃多色星云 + 微缩星系网格全景 + 柔和外辉。 */
function drawCosmos(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, seed: number, timeSec: number): void {
  // 外层柔辉
  const halo = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 1.5)
  halo.addColorStop(0, 'rgba(150,120,255,0.28)')
  halo.addColorStop(0.6, 'rgba(90,150,255,0.14)')
  halo.addColorStop(1, 'rgba(120,90,255,0)')
  ctx.fillStyle = halo
  ctx.beginPath()
  ctx.arc(x, y, r * 1.5, 0, Math.PI * 2)
  ctx.fill()
  clipCircle(ctx, x, y, r, () => {
    // 多色星云团
    const nebs: Array<[number, number, number, string]> = [
      [-0.4, -0.3, 0.55, 'rgba(120,90,220,0.4)'],
      [0.4, 0.2, 0.5, 'rgba(70,140,220,0.35)'],
      [0.1, 0.5, 0.45, 'rgba(200,90,190,0.3)'],
      [-0.2, 0.45, 0.4, 'rgba(90,180,190,0.3)']
    ]
    for (const [nx, ny, nr, col] of nebs) {
      const ng = ctx.createRadialGradient(x + nx * r, y + ny * r, 0, x + nx * r, y + ny * r, nr * r)
      ng.addColorStop(0, col)
      ng.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = ng
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
    // 微缩星系网格（均匀点阵 + 少量旋涡小点，缓慢呼吸）
    const breathe = 0.7 + 0.3 * Math.sin(timeSec * 2)
    for (let gy = -3; gy <= 3; gy++) {
      for (let gx = -3; gx <= 3; gx++) {
        const jx = (hash01(seed * 71 + gy * 7 + gx) - 0.5) * r * 0.1
        const jy = (hash01(seed * 73 + gy * 7 + gx) - 0.5) * r * 0.1
        const sx = x + (gx / 3) * r * 0.82 + jx
        const sy = y + (gy / 3) * r * 0.82 + jy
        ctx.fillStyle = `rgba(235,242,255,${0.5 * breathe + 0.2})`
        ctx.beginPath()
        ctx.arc(sx, sy, r * 0.025, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  })
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
