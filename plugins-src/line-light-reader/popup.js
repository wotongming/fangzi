'use strict'
const DEFAULTS = { guide: true, focusRow: true, clean: true, dyslexic: false, lineHeight: 1.8, gap: 0.9, width: 720, rate: 1 }
const checks = ['guide', 'focusRow', 'clean', 'dyslexic']
const sliders = ['lineHeight', 'gap', 'width', 'rate']

chrome.storage.local.get({ llr_settings: DEFAULTS }).then(({ llr_settings: s }) => {
  checks.forEach((k) => (document.getElementById(k).checked = !!s[k]))
  sliders.forEach((k) => {
    const el = document.getElementById(k)
    el.value = s[k]
    document.getElementById(k + 'Val').textContent = s[k]
  })
  const save = () =>
    chrome.storage.local.set({
      llr_settings: {
        ...s,
        ...Object.fromEntries(checks.map((k) => [k, document.getElementById(k).checked])),
        ...Object.fromEntries(sliders.map((k) => [k, parseFloat(document.getElementById(k).value)]))
      }
    })
  checks.forEach((k) => document.getElementById(k).addEventListener('change', save))
  sliders.forEach((k) => {
    document.getElementById(k).oninput = () => {
      document.getElementById(k + 'Val').textContent = document.getElementById(k).value
      save()
    }
  })
})
document.getElementById('opts').onclick = () => chrome.runtime.openOptionsPage()
