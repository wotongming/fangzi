'use strict'
const DEFAULTS = { guide: true, focusRow: true, clean: true, dyslexic: false, lineHeight: 1.8, width: 720, rate: 1 }
const ids = ['guide', 'focusRow', 'clean']

chrome.storage.local.get({ llr_settings: DEFAULTS }).then(({ llr_settings }) => {
  const s = llr_settings
  ids.forEach((k) => (document.getElementById(k).checked = !!s[k]))
  const lh = document.getElementById('lineHeight')
  lh.value = s.lineHeight
  document.getElementById('lhVal').textContent = s.lineHeight
  const rate = document.getElementById('rate')
  rate.value = s.rate
  document.getElementById('rateVal').textContent = s.rate
  const save = () =>
    chrome.storage.local.set({
      llr_settings: {
        ...s,
        guide: document.getElementById('guide').checked,
        focusRow: document.getElementById('focusRow').checked,
        clean: document.getElementById('clean').checked,
        lineHeight: parseFloat(lh.value),
        rate: parseFloat(rate.value)
      }
    })
  ids.forEach((k) => document.getElementById(k).addEventListener('change', save))
  lh.oninput = () => { document.getElementById('lhVal').textContent = lh.value; save() }
  rate.oninput = () => { document.getElementById('rateVal').textContent = rate.value; save() }
})
document.getElementById('opts').onclick = () => chrome.runtime.openOptionsPage()
