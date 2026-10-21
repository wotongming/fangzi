/**
 * content.js —— 行光阅读器注入层（仅由 background 在用户点图标时 executeScript 注入）。
 * 自包含；不修改原页链接/图片/代码结构，退出时按捕获的 innerHTML 完整还原。
 * 依赖先注入：vendor/Readability.js（全局 Readability）、vendor/sentences.js（全局 LLR.splitSentences）。
 */
'use strict'

const ROOT_ID = 'llr-root'
const STYLE_ID = 'llr-style'
const READER_ID = 'llr-reader'
const FOCUS_ID = 'llr-focus'

const DEFAULTS = {
  guide: true,
  focusRow: true,
  clean: true,
  dyslexic: false,
  lineHeight: 1.8,
  gap: 0.9,      // 段距（em）
  width: 720,
  rate: 1
}

const state = {
  active: false,
  settings: { ...DEFAULTS },
  originals: new Map(), // element -> 原始 innerHTML
  paragraphs: [],
  cleanUsed: false,
  tts: { speaking: false, paused: false, idx: 0, sentences: [], utterance: null, timer: null, lastAt: 0 }
}

/* ---------- 颜色纯函数（与 lib/gradient.ts 同规则） ---------- */
function textColor(ratio) {
  const r = Math.min(1, Math.max(0, ratio))
  const h = Math.round(210 - (210 - 28) * r)
  return `hsl(${h}, 58%, 42%)`
}
function lineBg(ratio) {
  const r = Math.min(1, Math.max(0, ratio))
  const h = Math.round(210 - (210 - 28) * r)
  return `hsl(${h}, 62%, 88%)`
}

/* ---------- 样式 ---------- */
function fontUrl(path) {
  try { return chrome.runtime.getURL(path) } catch { return path }
}

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return
  const st = document.createElement('style')
  st.id = STYLE_ID
  st.textContent = `
  @font-face{font-family:'OpenDyslexic';font-weight:400;font-style:normal;src:url('${fontUrl('fonts/OpenDyslexic-400.woff2')}') format('woff2')}
  @font-face{font-family:'OpenDyslexic';font-weight:700;font-style:normal;src:url('${fontUrl('fonts/OpenDyslexic-700.woff2')}') format('woff2')}
  #${ROOT_ID} .llr-bar{position:fixed;top:12px;right:12px;z-index:2147483647;display:flex;gap:6px;flex-wrap:wrap;max-width:80vw;font-family:system-ui,sans-serif}
  #${ROOT_ID} .llr-btn{background:#16213e;color:#eaf2ff;border:1px solid #5b7bb4;border-radius:10px;padding:7px 11px;font-size:13px;cursor:pointer}
  #${ROOT_ID} .llr-btn.on{background:#37e0ff;color:#0a0e1e}
  #${ROOT_ID} .llr-btn.icon{min-width:36px;padding:7px 10px}
  .llr-line{border-radius:2px}
  body.llr-focus .llr-target{opacity:.32;transition:opacity .15s}
  body.llr-focus .llr-target.llr-active{opacity:1}
  #${FOCUS_ID}{position:fixed;left:0;right:0;z-index:2147483646;pointer-events:none;background:rgba(55,224,255,.10);border-top:1px solid rgba(55,224,255,.35);border-bottom:1px solid rgba(55,224,255,.35);transition:top .12s,height .12s}
  #llr-shadow{position:fixed;inset:0;z-index:1;background:#f7f9fc}
  #${READER_ID}{position:relative;z-index:10;max-width:var(--llr-w,720px);margin:24px auto;padding:0 16px;font-family:system-ui,sans-serif}
  #${READER_ID} h1{font-size:1.7em;line-height:1.4}
  #${READER_ID} p,#${READER_ID} li{line-height:var(--llr-lh,1.8);margin-bottom:var(--llr-gap,.9em)}
  body.llr-dyslexic #${READER_ID} p,body.llr-dyslexic #${READER_ID} li,
  body.llr-dyslexic .llr-target{font-family:'OpenDyslexic',system-ui,sans-serif}
  .llr-tts-on{background:rgba(255,214,120,.35)!important;border-radius:3px}
  `
  document.head.appendChild(st)
}

/* ---------- 选区 / 段落采集 ---------- */
function targetSelector() {
  return 'p, li, h2, h3, h4'
}

function collectParagraphs() {
  const scope = document.getElementById(READER_ID) || document.body
  return [...scope.querySelectorAll(targetSelector())]
    .filter((el) => el.innerText && el.innerText.trim().length > 12)
}

function isComplex(el) {
  return !!el.querySelector('pre, table, img, iframe, svg, video, figure, blockquote, ul, ol, code')
}

function captureOrigin(el) {
  if (!state.originals.has(el)) state.originals.set(el, el.innerHTML)
}

function restoreOriginals() {
  for (const [el, html] of state.originals) el.innerHTML = html
  state.originals.clear()
}

/* ---------- 逐行引导色 ---------- */
function measureCharY(textNode, index) {
  const range = document.createRange()
  range.setStart(textNode, index)
  range.setEnd(textNode, index + 1)
  const rects = range.getClientRects()
  if (rects.length) return rects[0].top
  // 空白字符继承前一个字符位置
  return index > 0 ? measureCharY(textNode, index - 1) : 0
}

function textNodesOf(el) {
  const out = []
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeValue && n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP)
  })
  let n
  while ((n = walker.nextNode())) out.push(n)
  return out
}

/** 对一个简单段落做行级文字上色（行号按本段视觉行计算）。 */
function guideParagraph(el, ratio) {
  captureOrigin(el)
  const nodes = textNodesOf(el)
  const perNode = nodes.map((node) => {
    const text = node.nodeValue
    const tops = [...text].map((_, i) => measureCharY(node, i))
    const lines = []
    const lineOfChar = []
    for (let i = 0; i < tops.length; i++) {
      let line = lines.find((l) => Math.abs(l.anchor - tops[i]) <= 4)
      if (!line) { line = { anchor: tops[i], members: [] }; lines.push(line) }
      line.members.push(i)
      line.anchor = line.members.reduce((s, m) => s + tops[m], 0) / line.members.length
      lineOfChar[i] = lines.indexOf(line)
    }
    return { node, text, lineOfChar, lineCount: lines.length }
  })
  const totalLines = perNode.reduce((s, p) => s + p.lineCount, 1)
  let base = 0
  for (const p of perNode) {
    for (let i = 0; i < p.text.length; i++) {
      const lineIdx = base + p.lineOfChar[i]
      const lineRatio = totalLines > 1 ? lineIdx / (totalLines - 1) : 0
      // 段落位置占 70%、段内行位置占 30%，形成跨段连续的冷暖渐变
      const r = ratio * 0.7 + lineRatio * 0.3
      const span = document.createElement('span')
      span.className = 'llr-line'
      span.style.color = textColor(r)
      span.textContent = p.text[i]
      p.node.parentNode.insertBefore(span, p.node)
    }
    base += p.lineCount
  }
  nodes.forEach((n) => n.parentNode && n.parentNode.removeChild(n))
}

function applyGuide() {
  state.paragraphs = collectParagraphs()
  const total = state.paragraphs.length
  state.paragraphs.forEach((el, i) => {
    el.classList.add('llr-target')
    const ratio = total > 1 ? i / (total - 1) : 0
    if (isComplex(el)) {
      // 复杂版面整段浅色兜底，不包裹行 span、不破坏内部结构
      captureOrigin(el)
      el.style.background = lineBg(ratio)
      return
    }
    guideParagraph(el, ratio)
  })
}

function refreshGuide() {
  restoreOriginals()
  document.querySelectorAll('.llr-target').forEach((el) => el.classList.remove('llr-target'))
  document.querySelectorAll('.llr-line').forEach((n) => n.remove())
  applyGuide()
}

/* ---------- 纯净阅读（Readability） ---------- */
function applyClean() {
  if (typeof Readability === 'undefined') return
  let article = null
  try {
    article = new Readability(document.cloneNode(true), { charThreshold: 200 }).parse()
  } catch (e) {
    console.warn('Readability 解析失败，回退原页', e)
  }
  if (!article || !article.content || article.content.length < 200) {
    state.cleanUsed = false
    return
  }
  state.cleanUsed = true
  const reader = document.createElement('div')
  reader.id = READER_ID
  reader.innerHTML = `<h1></h1><div class="llr-body"></div>`
  reader.querySelector('h1').textContent = article.title || document.title
  reader.querySelector('.llr-body').innerHTML = article.content
  // 隐藏原页主体噪声，只保留阅读容器
  document.body.classList.add('llr-cleaned')
  document.body.style.setProperty('--llr-w', state.settings.width + 'px')
  document.body.style.setProperty('--llr-lh', state.settings.lineHeight)
  document.body.style.setProperty('--llr-gap', state.settings.gap + 'em')
  // 用一个包裹层把原页面隐藏，阅读容器浮于其上
  const shadow = document.createElement('div')
  shadow.id = 'llr-shadow'
  document.body.insertBefore(shadow, document.body.firstChild)
  document.body.appendChild(reader)
}

/* ---------- 焦点行 ---------- */
function ensureFocusOverlay() {
  if (!document.getElementById(FOCUS_ID)) {
    const o = document.createElement('div')
    o.id = FOCUS_ID
    document.body.appendChild(o)
  }
}

function moveFocus() {
  const overlay = document.getElementById(FOCUS_ID)
  if (!overlay) return
  const mid = window.innerHeight / 2
  let best = null
  let bestD = Infinity
  for (const el of state.paragraphs) {
    const r = el.getBoundingClientRect()
    if (r.height === 0) continue
    const d = Math.abs(r.top + r.height / 2 - mid)
    if (d < bestD) { bestD = d; best = el }
  }
  if (!best) return
  state.paragraphs.forEach((p) => p.classList.remove('llr-active'))
  best.classList.add('llr-active')
  const r = best.getBoundingClientRect()
  overlay.style.top = Math.max(0, r.top - 4) + 'px'
  overlay.style.height = r.height + 8 + 'px'
}

function onFocusRow() {
  if (!state.settings.focusRow) {
    document.body.classList.remove('llr-focus')
    document.getElementById(FOCUS_ID)?.remove()
    return
  }
  document.body.classList.add('llr-focus')
  ensureFocusOverlay()
  moveFocus()
}

/* ---------- 排版 ---------- */
function applyTypography() {
  document.body.style.setProperty('--llr-w', state.settings.width + 'px')
  document.body.style.setProperty('--llr-lh', state.settings.lineHeight)
  document.body.style.setProperty('--llr-gap', state.settings.gap + 'em')
  state.paragraphs.forEach((el) => {
    el.style.lineHeight = state.settings.lineHeight
    el.style.marginBottom = state.settings.gap + 'em'
    el.style.maxWidth = state.settings.width + 'px'
  })
}

function applyDyslexic() {
  document.body.classList.toggle('llr-dyslexic', state.settings.dyslexic)
}

/* ---------- TTS ---------- */
function ttsText() {
  return state.paragraphs.map((p) => p.innerText).join('\n')
}

function speakNext() {
  const t = state.tts
  if (!t.speaking || t.idx >= t.sentences.length) { t.speaking = false; return }
  const text = t.sentences[t.idx]
  const u = new SpeechSynthesisUtterance(text)
  u.rate = state.settings.rate
  t.utterance = u
  t.lastAt = Date.now()
  highlightSentence(t.idx)
  const advance = () => { t.idx++; speakNext() }
  u.onend = advance
  u.onerror = advance
  window.speechSynthesis.speak(u)
}

function highlightSentence(idx) {
  document.querySelectorAll('.llr-tts-on').forEach((n) => n.classList.remove('llr-tts-on'))
  // 在段落里定位包含该句首段文字的元素并高亮其行 span
  const needle = state.tts.sentences[idx]?.slice(0, 16)
  if (!needle) return
  for (const el of state.paragraphs) {
    if (el.innerText.includes(needle)) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('llr-tts-on')
      break
    }
  }
}

function ttsToggle() {
  if (!('speechSynthesis' in window)) { alert('当前浏览器不支持语音合成'); return }
  const t = state.tts
  if (t.speaking && !t.paused) {
    window.speechSynthesis.pause()
    t.paused = true
    return
  }
  if (t.speaking && t.paused) {
    window.speechSynthesis.resume()
    t.paused = false
    return
  }
  t.sentences = (globalThis.LLR?.splitSentences || splitFallback)(ttsText())
  t.idx = 0
  t.speaking = true
  t.paused = false
  // 看门狗：5s 巡检，疑似卡死（>10s 未推进）pause→resume 规避 Chrome ~15s 中断
  t.timer = setInterval(() => {
    if (t.speaking && !t.paused && Date.now() - t.lastAt > 10000) {
      window.speechSynthesis.pause()
      window.speechSynthesis.resume()
      t.lastAt = Date.now()
    }
  }, 5000)
  speakNext()
}

function ttsPrev() {
  const t = state.tts
  if (t.idx > 0) t.idx--
  if (t.speaking) { window.speechSynthesis.cancel(); speakNext() }
}

function ttsNext() {
  const t = state.tts
  if (t.idx < t.sentences.length - 1) t.idx++
  if (t.speaking) { window.speechSynthesis.cancel(); speakNext() }
}

function splitFallback(text) {
  return text.split(/(?<=[。.!?！？])/).map((s) => s.trim()).filter(Boolean)
}

function stopTts() {
  const t = state.tts
  clearInterval(t.timer)
  if ('speechSynthesis' in window) window.speechSynthesis.cancel()
  t.speaking = false; t.paused = false; t.sentences = []; t.idx = 0
}

/* ---------- 摘录 ---------- */
function saveExcerpt() {
  const sel = window.getSelection()
  const text = sel?.toString().trim()
  if (!text) { alert('先在页面上选中要摘录的文字'); return }
  const title = document.title || document.querySelector('h1')?.textContent || '未命名页面'
  const item = { title, url: location.href, text, savedAt: Date.now() }
  chrome.storage.local.get({ llr_excerpts: [] }).then(({ llr_excerpts }) => {
    const list = [item, ...llr_excerpts]
    chrome.storage.local.set({ llr_excerpts: list.slice(0, 500) })
    alert(`已摘录 ${list.length} 条（可在扩展选项页导出 Markdown/JSON）`)
  })
}

/* ---------- 工具条 ---------- */
function buildBar() {
  document.getElementById(ROOT_ID)?.remove()
  const root = document.createElement('div')
  root.id = ROOT_ID
  root.innerHTML = `
    <div class="llr-bar">
      <button class="llr-btn" data-k="guide">引导色</button>
      <button class="llr-btn" data-k="focusRow">焦点行</button>
      <button class="llr-btn" data-k="clean">纯净阅读</button>
      <button class="llr-btn" data-k="dyslexic">Dyslexic 字体</button>
      <button class="llr-btn icon" data-k="ttsPrev" title="上一句">⏮</button>
      <button class="llr-btn" data-k="tts" title="播放/暂停朗读">朗读</button>
      <button class="llr-btn icon" data-k="ttsNext" title="下一句">⏭</button>
      <button class="llr-btn" data-k="excerpt">摘录</button>
      <button class="llr-btn" data-k="exit">退出</button>
    </div>`
  document.body.appendChild(root)
  root.querySelectorAll('.llr-btn').forEach((b) => b.addEventListener('click', () => onAction(b.dataset.k)))
  syncBar()
}

function syncBar() {
  document.querySelectorAll('#' + ROOT_ID + ' .llr-btn').forEach((b) => {
    const k = b.dataset.k
    if (['guide', 'focusRow', 'clean', 'dyslexic'].includes(k)) b.classList.toggle('on', !!state.settings[k])
  })
}

function onAction(k) {
  if (k === 'exit') return deactivate()
  if (k === 'guide') { state.settings.guide = !state.settings.guide; refreshGuide(); syncBar(); return }
  if (k === 'focusRow') { state.settings.focusRow = !state.settings.focusRow; onFocusRow(); syncBar(); return }
  if (k === 'clean') { state.settings.clean = !state.settings.clean; deactivate(true); activate(); return }
  if (k === 'dyslexic') { state.settings.dyslexic = !state.settings.dyslexic; applyDyslexic(); syncBar(); return }
  if (k === 'tts') ttsToggle()
  if (k === 'ttsPrev') ttsPrev()
  if (k === 'ttsNext') ttsNext()
  if (k === 'excerpt') saveExcerpt()
  chrome.storage.local.set({ llr_settings: state.settings })
}

/* ---------- 生命周期 ---------- */
let resizeTimer = null
function debounceResize() {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => { if (state.active && state.settings.guide) refreshGuide() }, 250)
}

function activate() {
  injectStyle()
  buildBar()
  if (state.settings.clean) applyClean()
  if (state.settings.guide) applyGuide()
  applyTypography()
  applyDyslexic()
  if (state.settings.focusRow) onFocusRow()
  document.addEventListener('scroll', moveFocus, { passive: true })
  window.addEventListener('resize', debounceResize)
  if (document.fonts?.ready) document.fonts.ready.then(debounceResize)
  state.active = true
}

function deactivate(keepSettings = false) {
  stopTts()
  document.querySelectorAll('#' + ROOT_ID).forEach((n) => n.remove())
  document.getElementById(STYLE_ID)?.remove()
  document.getElementById(READER_ID)?.remove()
  document.getElementById('llr-shadow')?.remove()
  restoreOriginals()
  document.querySelectorAll('.llr-target,.llr-line,.llr-active,.llr-tts-on').forEach((el) => {
    el.classList?.remove('llr-target', 'llr-active', 'llr-tts-on')
  })
  document.querySelectorAll('.llr-line').forEach((n) => n.remove())
  document.body.classList.remove('llr-cleaned', 'llr-focus', 'llr-dyslexic')
  document.body.style.removeProperty('--llr-w')
  document.body.style.removeProperty('--llr-lh')
  document.body.style.removeProperty('--llr-gap')
  document.querySelectorAll('.llr-target').forEach((el) => { el.style.background = ''; el.style.lineHeight = ''; el.style.marginBottom = ''; el.style.maxWidth = '' })
  document.removeEventListener('scroll', moveFocus)
  window.removeEventListener('resize', debounceResize)
  clearTimeout(resizeTimer)
  state.active = false
  if (!keepSettings) state.settings = { ...DEFAULTS }
}

// 测试接缝：暴露内部状态供 E2E 断言（不影响功能）
globalThis.__llr = state

chrome.storage.local.get({ llr_settings: DEFAULTS }).then((s) => {
  state.settings = { ...DEFAULTS, ...s.llr_settings }
  // 重复点图标 = 退出
  if (document.getElementById(ROOT_ID)) return deactivate()
  activate()
})
