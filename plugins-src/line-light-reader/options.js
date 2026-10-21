'use strict'

function load() { return chrome.storage.local.get({ llr_excerpts: [], llr_settings: {}, llr_code: '' }) }

function render(list) {
  const ul = document.getElementById('list')
  ul.innerHTML = ''
  list.forEach((it) => {
    const li = document.createElement('li')
    const d = new Date(it.savedAt).toLocaleString()
    li.innerHTML = `<div><b>${it.title}</b> <span class="meta">${d}</span></div>
      <div>${it.text.slice(0, 160)}</div><div class="meta">${it.url}</div>`
    ul.appendChild(li)
  })
}

function download(name, text, type) {
  const blob = new Blob([text], { type })
  const a = document.createElement('a')
  const url = URL.createObjectURL(blob)
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

load().then(({ llr_excerpts, llr_settings, llr_code }) => {
  render(llr_excerpts)
  document.getElementById('dyslexic').checked = !!llr_settings.dyslexic
  document.getElementById('code').value = llr_code || ''
  document.getElementById('dyslexic').onchange = (e) =>
    chrome.storage.local.set({ llr_settings: { ...llr_settings, dyslexic: e.target.checked } })
  document.getElementById('md').onclick = () => {
    const md = llr_excerpts.map((it) => `### ${it.title}\n\n> ${it.text}\n\n来源：${it.url} · ${new Date(it.savedAt).toLocaleString()}\n`).join('\n---\n')
    download('excerpts.md', md, 'text/markdown')
  }
  document.getElementById('json').onclick = () =>
    download('excerpts.json', JSON.stringify(llr_excerpts, null, 2), 'application/json')
  document.getElementById('clear').onclick = () =>
    chrome.storage.local.set({ llr_excerpts: [] }).then(() => render([]))
  document.getElementById('apply').onclick = async () => {
    const code = document.getElementById('code').value.trim()
    await chrome.storage.local.set({ llr_code: code })
    document.getElementById('licMsg').textContent = 'beta 期无需许可码即可使用全部功能；将来上线买断后在此验签解锁 Pro。'
  }
})
