/**
 * 构建后清理：删除 onnxruntime-web 主 bundle 引用但 WASM EP 不会请求的
 * WebGPU 后端 wasm（jsep / asyncify），确保产物单文件 < EdgeOne Pages 25MiB 限制。
 * 删除依据：WASM EP（ort-wasm-simd-threaded.wasm，约 13.6MiB）运行时不会 fetch jsep/asyncify，
 * 这两个文件仅在 WebGPU EP 初始化时按需加载（本项目已收敛为 WASM-only）。
 */
import { rmSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const assetsDir = join(dist, 'assets')
const LIMIT = 25 * 1024 * 1024 // 25MiB
const removed = []
let maxSize = 0
let maxFile = ''

function scan(dir) {
  if (!exists(dir)) return
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      scan(full)
      continue
    }
    // WebGPU 后端 wasm（jsep/asyncify）：WASM-only 运行时不需要，且单文件可能超 25MiB
    if (/\.(jsep|asyncify|jspi).*\.wasm$/i.test(name)) {
      rmSync(full)
      removed.push(`${name} (${(st.size / 1024 / 1024).toFixed(1)}MiB)`)
      return
    }
    if (st.size > maxSize) {
      maxSize = st.size
      maxFile = full.replace(dist, '.')
    }
  }
}
function exists(p) {
  try {
    statSync(p)
    return true
  } catch {
    return false
  }
}

scan(assetsDir)
scan(join(dist, 'onnx'))

if (maxSize > LIMIT) {
  console.error(`❌ 仍有单文件超 25MiB：${maxFile} (${(maxSize / 1024 / 1024).toFixed(1)}MiB)`)
  process.exit(1)
}
console.log(`✅ 产物最大单文件：${maxFile} (${(maxSize / 1024 / 1024).toFixed(1)}MiB) < 25MiB`)
if (removed.length) console.log(`已清理 WebGPU 后端 wasm：\n  - ${removed.join('\n  - ')}`)
else console.log('无需要清理的 WebGPU 后端 wasm')
