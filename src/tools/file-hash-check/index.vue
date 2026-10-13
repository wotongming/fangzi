<script setup lang="ts">
import { computed, ref } from 'vue'
import { md5 } from './md5'

const file = ref<File | null>(null)
const hashes = ref<Record<string, string>>({})
const computing = ref(false)
const progress = ref(0)
const expected = ref('')
const dragOver = ref(false)
let dragDepth = 0

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

async function readBuffer(f: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onprogress = (e) => {
      if (e.lengthComputable) progress.value = Math.round((e.loaded / e.total) * 100)
    }
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(f)
  })
}

async function hex(algo: 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512', buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest(algo, buf)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function handleFiles(files: FileList | null) {
  const f = files?.[0]
  if (!f) return
  file.value = f
  hashes.value = {}
  expected.value = ''
  computing.value = true
  progress.value = 0
  try {
    const buf = await readBuffer(f)
    progress.value = 100
    const u8 = new Uint8Array(buf)
    const [sha1, sha256, sha384, sha512, md5hex] = await Promise.all([
      hex('SHA-1', buf),
      hex('SHA-256', buf),
      hex('SHA-384', buf),
      hex('SHA-512', buf),
      Promise.resolve(md5(u8))
    ])
    hashes.value = { MD5: md5hex, 'SHA-1': sha1, 'SHA-256': sha256, 'SHA-384': sha384, 'SHA-512': sha512 }
  } catch (e) {
    hashes.value = { 错误: e instanceof Error ? e.message : String(e) }
  } finally {
    computing.value = false
  }
}

function onDrop(e: DragEvent) {
  dragDepth = 0
  dragOver.value = false
  void handleFiles(e.dataTransfer?.files ?? null)
}
function onDragEnter() {
  dragDepth++
  dragOver.value = true
}
function onDragLeave() {
  dragDepth--
  if (dragDepth <= 0) dragOver.value = false
}

const matchResult = computed(() => {
  const want = expected.value.trim().toLowerCase()
  if (!want || Object.keys(hashes.value).length === 0) return null
  for (const [algo, value] of Object.entries(hashes.value)) {
    if (value.toLowerCase() === want) return { ok: true, algo }
  }
  // 部分匹配（用户只粘贴了前几位）也提示，但长度需 >= 8
  if (want.length >= 8) {
    for (const [algo, value] of Object.entries(hashes.value)) {
      if (value.toLowerCase().startsWith(want)) return { ok: true, algo: `${algo}（前缀匹配）` }
    }
  }
  return { ok: false, algo: '' }
})

async function copy(v: string) {
  try {
    await navigator.clipboard.writeText(v)
  } catch {
    /* ignore */
  }
}
</script>

<template>
  <div class="tool-pad">
    <label
      class="dropzone card"
      :class="{ over: dragOver }"
      @dragover.prevent
      @dragenter.prevent="onDragEnter"
      @dragleave="onDragLeave"
      @drop.prevent="onDrop"
    >
      <input type="file" hidden @change="handleFiles(($event.target as HTMLInputElement).files)" />
      <div v-if="!file" class="dz-inner">
        <p class="dz-title">点击选择文件，或把文件拖到这里</p>
        <p class="faint">全程在本机浏览器计算，文件不会被上传</p>
      </div>
      <div v-else class="dz-inner">
        <p class="dz-title">{{ file.name }}</p>
        <p class="faint">{{ humanSize(file.size) }} · 点击可重新选择</p>
      </div>
    </label>

    <div v-if="computing" class="card box">
      <p>正在计算… {{ progress }}%</p>
      <div class="progress"><div :style="{ width: progress + '%' }"></div></div>
      <p class="faint">大文件需要读取到内存，请稍候</p>
    </div>

    <div v-if="Object.keys(hashes).length" class="card box">
      <h3>哈希值</h3>
      <ul class="hashlist">
        <li v-for="(v, algo) in hashes" :key="algo">
          <span class="algo">{{ algo }}</span>
          <code>{{ v }}</code>
          <button class="btn btn-ghost" @click="copy(v)">复制</button>
        </li>
      </ul>

      <h3>校验官方值</h3>
      <input v-model="expected" class="inp" placeholder="粘贴官网给出的 MD5 / SHA256 等值进行比对" />
      <p v-if="matchResult" :class="matchResult.ok ? 'ok' : 'bad'">
        {{ matchResult.ok ? `✓ 校验一致（${matchResult.algo}），文件完整可信` : '✗ 不一致：文件可能被篡改或已损坏，请勿运行' }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.tool-pad {
  display: grid;
  gap: 14px;
}
.dropzone {
  display: block;
  border: 2px dashed var(--line);
  border-radius: var(--radius);
  padding: 40px 20px;
  text-align: center;
  cursor: pointer;
  transition: all 0.15s;
}
.dropzone.over {
  border-color: var(--brand);
  background: var(--brand-soft);
}
.dz-title {
  font-size: 16px;
  margin: 0 0 6px;
  font-weight: 600;
}
.box {
  padding: 14px 16px;
}
.box h3 {
  margin: 14px 0 10px;
  font-size: 15px;
}
.box h3:first-child {
  margin-top: 0;
}
.progress {
  height: 8px;
  background: #eeeae0;
  border-radius: 4px;
  overflow: hidden;
}
.progress div {
  height: 100%;
  background: var(--brand);
  transition: width 0.2s;
}
.hashlist {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}
.hashlist li {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}
.algo {
  width: 74px;
  flex-shrink: 0;
  font-weight: 600;
  color: var(--ink-soft);
}
.hashlist code {
  flex: 1;
  word-break: break-all;
  font-family: Consolas, monospace;
  color: var(--brand-dark);
}
.inp {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 9px;
  font-family: Consolas, monospace;
  font-size: 13px;
}
.inp:focus {
  outline: none;
  border-color: var(--brand);
}
.ok {
  color: var(--brand-dark);
  font-weight: 600;
}
.bad {
  color: var(--danger);
  font-weight: 600;
}
</style>
