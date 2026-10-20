/**
 * claim-pack.ts —— 理赔资料包（Pro）：勾选资产 → manifest.json + 自含打印样式清单.html
 * + 凭证/<assetId>/<docId>.jpg，fflate（MIT，已在依赖）打包 ZIP。
 * HTML 自带打印样式，浏览器 window.print 即可另存 PDF，不引重型 PDF 库。
 */
import { strToU8, zipSync } from 'fflate'
import { DOC_KIND_LABELS, formatCents, type Asset, type Doc } from './models'

export interface ClaimDocMeta {
  id: string
  kind: Doc['kind']
  note?: string
}

export interface ClaimAssetMeta {
  id: string
  name: string
  category: string
  location: string
  purchaseDate?: string
  priceCents?: number
  brandModel?: string
  serialNo?: string
  warrantyEnd?: string
  docs: ClaimDocMeta[]
}

export interface ClaimManifest {
  version: 1
  exportedAt: string
  tool: 'home-vault'
  assets: ClaimAssetMeta[]
}

/** 组装 manifest（资产-凭证映射，纯函数可测）。 */
export function buildClaimManifest(selected: Asset[], docs: Doc[]): ClaimManifest {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    tool: 'home-vault',
    assets: selected.map((a) => ({
      id: a.id,
      name: a.name,
      category: a.category,
      location: a.location,
      purchaseDate: a.purchaseDate,
      priceCents: a.priceCents,
      brandModel: a.brandModel,
      serialNo: a.serialNo,
      warrantyEnd: a.warrantyEnd,
      docs: docs
        .filter((d) => d.assetId === a.id)
        .map((d) => ({ id: d.id, kind: d.kind, note: d.note }))
    }))
  }
}

function escHtml(s: string | undefined): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 自包含打印清单 HTML（纯函数可测）。 */
export function buildClaimHtml(manifest: ClaimManifest): string {
  const rows = manifest.assets
    .map((a, i) => {
      const docs = a.docs.map((d) => DOC_KIND_LABELS[d.kind]).join('、') || '—'
      return `<tr>
  <td>${i + 1}</td>
  <td>${escHtml(a.name)}</td>
  <td>${escHtml(a.category)}</td>
  <td>${escHtml(a.location)}</td>
  <td>${a.purchaseDate ? escHtml(a.purchaseDate) : '—'}</td>
  <td>${a.priceCents != null ? `¥${formatCents(a.priceCents)}` : '—'}</td>
  <td>${escHtml(a.brandModel ?? '')}</td>
  <td>${escHtml(a.serialNo ?? '')}</td>
  <td>${docs}</td>
</tr>`
    })
    .join('\n')
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>家庭财产理赔清单</title>
<style>
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: #1f2430; margin: 24px; }
  h1 { font-size: 20px; }
  .meta { color: #667; font-size: 13px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #f0f3f8; }
  .note { margin-top: 16px; font-size: 12px; color: #667; }
  @media print { body { margin: 8mm; } }
</style>
</head>
<body>
<h1>家庭财产理赔清单</h1>
<div class="meta">由方子家庭资产档案库在本机生成 · ${escHtml(manifest.exportedAt)} · 共 ${manifest.assets.length} 项资产</div>
<table>
<thead><tr><th>#</th><th>名称</th><th>类别</th><th>位置</th><th>购入日期</th><th>购入价</th><th>品牌/型号</th><th>序列号</th><th>凭证</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
<p class="note">本清单与压缩包内「凭证」目录照片一一对应；数据由用户本人录入，工具不参与定损，赔付以保险公司核定为准。</p>
</body>
</html>`
}

async function blobToU8(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

/** 打包理赔 ZIP 并返回 Blob。 */
export async function buildClaimZip(selected: Asset[], docs: Doc[]): Promise<Blob> {
  const manifest = buildClaimManifest(selected, docs)
  const files: Record<string, Uint8Array> = {
    'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
    '清单.html': strToU8(buildClaimHtml(manifest))
  }
  for (const a of selected) {
    for (const d of docs.filter((x) => x.assetId === a.id)) {
      files[`凭证/${a.id}/${d.id}.jpg`] = await blobToU8(d.photoBlob)
    }
  }
  const zipped = zipSync(files, { level: 6 })
  return new Blob([zipped], { type: 'application/zip' })
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
