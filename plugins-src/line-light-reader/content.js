/**
 * content.js —— 行光阅读器注入层（仅由 background 在用户点图标时 executeScript 注入）。
 * 自包含：不依赖外部模块；不修改原页链接/图片/代码块结构，失败可一键退出还原。
 */
'use strict'

const ROOT_ID = 'llr-root'
const STYLE_ID = 'llr-style'

const DEFAULT_SETTINGS = {
  guide: true,
  focusRow: true,
  clean: true,
  dyslexic: false,
  lineHeight: 1.8,
  width: 720,
  rate: 1
}

function cssOf(ratio) {
  const h = Math.round(210 - (210 - 28) * Math.min(1, Math.max(0, ratio)))
  return `hsl(${h}, 62%, 88%)`
}

function splitSentences(text) {
  if (!text) return []
  const out = []
  let cur = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    cur += ch
    if ('.!?。！？'.includes(ch)) { out.push(cur.trim()); cur = '' }
  }
  if (cur.trim()) out.push(cur.trim())
  return out.filter(Boolean)
}

let state = { active: false, settings: { ...DEFAULT_SETTINGS }, saved: [] }

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return
  const st = document.createElement('style')
  st.id = STYLE_ID
  st.textContent = `
    #${ROOT_ID} .llr-bar{position:fixed;top:12px;right:12px;z-index:2147483647;display:flex;gap:6px;flex-wrap:wrap;max-width:80vw;font-family:system-ui,sans-serif}
    #${ROOT_ID} .llr-btn{background:#16213e;color:#eaf2ff;border:1px solid #5b7bb4;border-radius:10px;padding:7px 11px;font-size:13px;cursor:pointer}
    #${ROOT_ID} .llr-btn.on{background:#37e0ff;color:#0a0e1e}
    #${ROOT_ID} .llr-focus{position:fixed;left:0;right:0;z-index:2147483646;pointer-events:none;background:rgba(6,10,24,0.55);transition:top .12s,height .12s,opacity .12s}
    body.llr-clean #${ROOT_ID} article{max-width:var(--llr-w);margin:0 auto}
    body.llr-clean aside,body.llr-clean .ads,body.llr-clean #ads,body.llr-clean .advertisement{display:none!important}
    body.llr-dyslexic #${ROOT_ID} p,body.llr-dyslexic li{font-family:'OpenDyslexic',system-ui,sans-serif}
  `
  document.head.appendChild(st)
}

function collectParagraphs() {
  return [...document.querySelectorAll('article p, article li, article h2, article h3, main p, main li, main h2, main h3, body p')]
    .filter((el) => el.innerText && el.innerText.trim().length > 12)
}

function applyGuide() {
  const paras = collectParagraphs()
  paras.forEach((p, i) => {
    const ratio = paras.length > 1 ? i / (paras.length - 1) : 0
    p.style.background = cssOf(ratio)
  })
}

function applyClean() {
  document.body.classList.add('llr-clean')
  document.body.style.setProperty('--llr-w', state.settings.width + 'px')
  collectParagraphs().forEach((p) => { p.style.lineHeight = state.settings.lineHeight })
}

function buildBar() {
  let root = document.getElementById(ROOT_ID)
  if (root) root.remove()
  root = document.createElement('div')
  root.id = ROOT_ID
  root.innerHTML = `
    <div class="llr-bar">
      <button class="llr-btn" data-k="guide">引导色</button>
      <button class="llr-btn" data-k="focusRow">焦点行</button>
      <button class="llr-btn" data-k="clean">纯净阅读</button>
      <button class="llr-btn" data-k="tts">朗读</button>
      <button class="llr-btn" data-k="excerpt">摘录</button>
      <button class="llr-btn" data-k="exit">退出</button>
    </div>`
  document.body.appendChild(root)
  root.querySelectorAll('.llr-btn').forEach((b) => {
    b.addEventListener('click', () => onAction(b.dataset.k))
  })
  syncBar()
}

function syncBar() {
  document.querySelectorAll('#' + ROOT_ID + ' .llr-btn').forEach((b) => {
    const k = b.dataset.k
    if (['guide', 'focusRow', 'clean'].includes(k)) b.classList.toggle('on', !!state.settings[k])
  })
}

let focusOverlay = null
let tts = { speaking: false, idx: 0, sentences: [] }

function onFocusRow() {
  if (!state.settings.focusRow) { focusOverlay?.remove(); focusOverlay = null; return }
  if (!focusOverlay) {
    focusOverlay = document.createElement('div')
    focusOverlay.className = 'llr-focus'
    document.body.appendChild(focusOverlay)
  }
  document.addEventListener('scroll', moveFocus, { passive: true })
  moveFocus()
}

function moveFocus() {
  if (!focusOverlay) return
  const mid = window.innerHeight / 2
  const paras = collectParagraphs()
  let best = paras[0]
  let bestD = Infinity
  for (const p of paras) {
    const r = p.getBoundingClientRect()
    const d = Math.abs(r.top + r.height / 2 - mid)
    if (d < bestD) { bestD = d; best = p }
  }
  if (!best) return
  const r = best.getBoundingClientRect()
  focusOverlay.style.top = Math.max(0, r.top - 6) + 'px'
  focusOverlay.style.height = r.height + 12 + 'px'
  focusOverlay.style.opacity = '1'
}

function startTts() {
  if (!('speechSynthesis' in window)) { alert('当前浏览器不支持语音合成'); return }
  if (tts.speaking) { window.speechSynthesis.cancel(); tts.speaking = false; return }
  const text = collectParagraphs().map((p) => p.innerText).join('\n')
  tts.sentences = splitSentences(text)
  tts.idx = 0
  tts.speaking = true
  speakNext()
}

function speakNext() {
  if (!tts.speaking || tts.idx >= tts.sentences.length) { tts.speaking = false; return }
  const u = new SpeechSynthesisUtterance(tts.sentences[tts.idx])
  u.rate = state.settings.rate
  u.onend = () => { tts.idx++; speakNext() }
  u.onerror = () => { tts.idx++; speakNext() }
  window.speechSynthesis.speak(u)
}

function saveExcerpt() {
  const sel = window.getSelection()
  const text = sel?.toString().trim()
  if (!text) { alert('先在页面上选中要摘录的文字'); return }
  const item = { title: document.title, url: location.href, text, savedAt: Date.now() }
  chrome.storage.local.get({ llr_excerpts: [] }).then(({ llr_excerpts }) => {
    const list = [item, ...llr_excerpts]
    chrome.storage.local.set({ llr_excerpts: list.slice(0, 500) })
    alert(`已摘录 ${list.length} 条（可在扩展选项页导出 Markdown/JSON）`)
  })
}

function onAction(k) {
  if (k === 'exit') return deactivate()
  if (k === 'guide') { state.settings.guide = !state.settings.guide; applyGuide(); syncBar(); return }
  if (k === 'focusRow') { state.settings.focusRow = !state.settings.focusRow; onFocusRow(); syncBar(); return }
  if (k === 'clean') { state.settings.clean = !state.settings.clean; applyClean(); syncBar(); return }
  if (k === 'tts') startTts()
  if (k === 'excerpt') saveExcerpt()
  chrome.storage.local.set({ llr_settings: state.settings })
}

function activate() {
  injectStyle()
  buildBar()
  if (state.settings.guide) applyGuide()
  if (state.settings.focusRow) onFocusRow()
  if (state.settings.clean) applyClean()
  state.active = true
}

function deactivate() {
  document.querySelectorAll('#' + ROOT_ID).forEach((n) => n.remove())
  document.getElementById(STYLE_ID)?.remove()
  document.body.classList.remove('llr-clean', 'llr-dyslexic')
  document.querySelectorAll('p, li').forEach((el) => { el.style.background = ''; el.style.lineHeight = '' })
  focusOverlay?.remove(); focusOverlay = null
  if ('speechSynthesis' in window) window.speechSynthesis.cancel()
  state.active = false
}

chrome.storage.local.get({ llr_settings: DEFAULT_SETTINGS, llr_active: false }).then((s) => {
  state.settings = { ...DEFAULT_SETTINGS, ...s.llr_settings }
  // 重复点图标 = 退出
  if (document.getElementById(ROOT_ID)) return deactivate()
  activate()
})
