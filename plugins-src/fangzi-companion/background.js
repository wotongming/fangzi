/**
 * 方子助手 —— MV3 Service Worker
 * 功能：
 *  1. 划词右键菜单：把选中文本作为 query 打开方子站点（免费）
 *  2. 划词 AI 解读菜单：高级功能，携带 ai=1，由方子站点侧校验付费权益（Freemium）
 * 站点地址由用户在弹窗 / 选项页配置（chrome.storage.sync），未配置时打开设置页。
 */

const STORAGE_KEY = 'fangziSettings'
const DEFAULT_SETTINGS = { siteUrl: '', licenseKey: '' }

const MENU_SEARCH = 'fangzi-search'
const MENU_AI = 'fangzi-ai-explain'

async function getSettings() {
  const obj = await chrome.storage.sync.get(STORAGE_KEY)
  return { ...DEFAULT_SETTINGS, ...(obj[STORAGE_KEY] || {}) }
}

function setSettings(patch) {
  return getSettings().then((cur) => {
    const next = { ...cur, ...patch }
    return chrome.storage.sync.set({ [STORAGE_KEY]: next })
  })
}

function normalizeBase(url) {
  if (!url) return ''
  let u = url.trim()
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u
  if (!u.endsWith('/')) u += '/'
  return u
}

function buildFangziUrl(settings, text, ai) {
  const base = normalizeBase(settings.siteUrl)
  const params = new URLSearchParams()
  if (text) params.set('q', text)
  if (ai) params.set('ai', '1')
  if (ai && settings.licenseKey) params.set('lic', settings.licenseKey)
  return base + '?' + params.toString()
}

async function openFangzi(text, ai) {
  const settings = await getSettings()
  if (!settings.siteUrl) {
    await chrome.tabs.create({ url: chrome.runtime.getURL('options.html?first=1') })
    return
  }
  await chrome.tabs.create({ url: buildFangziUrl(settings, text, ai) })
}

function createMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_SEARCH,
      title: chrome.i18n.getMessage('menuSearch') || '用方子搜索“%s”',
      contexts: ['selection']
    })
    chrome.contextMenus.create({
      id: MENU_AI,
      title: chrome.i18n.getMessage('menuAi') || '方子 AI 解读“%s”（高级）',
      contexts: ['selection']
    })
  })
}

chrome.runtime.onInstalled.addListener(() => {
  createMenus()
})
chrome.runtime.onStartup.addListener(() => {
  createMenus()
})

chrome.contextMenus.onClicked.addListener((info) => {
  const text = info.selectionText || ''
  if (info.menuItemId === MENU_SEARCH) {
    openFangzi(text, false)
  } else if (info.menuItemId === MENU_AI) {
    openFangzi(text, true)
  }
})

// 弹窗读取 / 保存设置
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'getSettings') {
    getSettings().then((s) => sendResponse({ ok: true, settings: s }))
    return true
  }
  if (msg?.type === 'setSettings') {
    setSettings(msg.patch || {}).then(() => sendResponse({ ok: true }))
    return true
  }
})
