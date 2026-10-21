/**
 * background.js —— MV3 service worker。
 * 仅在用户点击图标时，按依赖顺序注入：Readability → 切句工具 → content.js。
 * 不申请 <all_urls>，不后台定时、不跨站采集。
 */
'use strict'

const FILES = ['vendor/Readability.js', 'vendor/sentences.js', 'content.js']

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: FILES })
  } catch (e) {
    // chrome:// / 扩展商店等受限页面无法注入，静默忽略
    console.warn('line-light-reader: 无法在此页注入', e)
  }
})
