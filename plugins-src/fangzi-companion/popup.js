const $ = (id) => document.getElementById(id)

function send(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (res) => resolve(res || { ok: false }))
  })
}

async function load() {
  const res = await send({ type: 'getSettings' })
  if (res.ok && res.settings) {
    $('siteUrl').value = res.settings.siteUrl || ''
    $('licenseKey').value = res.settings.licenseKey || ''
  }
  if (new URLSearchParams(location.search).get('first')) {
    $('status').textContent = '请先填写方子站点地址并保存'
  }
}

$('save').addEventListener('click', async () => {
  await send({
    type: 'setSettings',
    patch: { siteUrl: $('siteUrl').value.trim(), licenseKey: $('licenseKey').value.trim() }
  })
  $('status').textContent = '已保存'
  setTimeout(() => window.close(), 700)
})

$('open').addEventListener('click', async () => {
  const res = await send({ type: 'getSettings' })
  let url = res.ok && res.settings?.siteUrl ? res.settings.siteUrl.trim() : ''
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url
  if (!url.endsWith('/')) url += '/'
  chrome.tabs.create({ url })
})

load()
