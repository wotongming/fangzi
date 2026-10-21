/**
 * 打包行光阅读器扩展为 Chromium zip（根目录直接含 manifest.json，无多余顶层文件夹），
 * 输出 manifest 所需 sha256 / sizeBytes 到 stdout JSON。纯本地、无远程。
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { zipSync } from 'fflate'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'plugins-src/line-light-reader')
const OUT_DIR = join(ROOT, 'public/plugins/line-light-reader')
const OUT_ZIP = join(OUT_DIR, 'line-light-reader-chrome-0.1.0.zip')

function walk(dir, base = dir) {
  const out = {}
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (name === 'lib') continue // lib/*.ts 为 Node 单测纯逻辑源，不进扩展包（content.js 已内联所需逻辑）
    if (statSync(full).isDirectory()) Object.assign(out, walk(full, base))
    else out[relative(base, full).replace(/\\/g, '/')] = new Uint8Array(readFileSync(full))
  }
  return out
}

mkdirSync(OUT_DIR, { recursive: true })
const files = walk(SRC)
const zipped = Buffer.from(zipSync(files, { level: 9 }))
writeFileSync(OUT_ZIP, zipped)

const sha = createHash('sha256').update(zipped).digest('hex')
console.log(JSON.stringify({
  packageUrl: '/plugins/line-light-reader/line-light-reader-chrome-0.1.0.zip',
  sha256: sha,
  sizeBytes: zipped.length,
  files: Object.keys(files)
}, null, 2))
