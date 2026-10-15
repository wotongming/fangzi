/*
 * 方子 · 自托管大模型分片合并层（Service Worker importScripts 引入）
 *
 * 背景：EdgeOne Pages 免费版「单文件 ≤ 25MiB」，而 whisper-tiny 的 decoder q8 约 30.7MB。
 * 做法：构建期把该 onnx 切成 .part0/.part1/…（每片 < 25MiB）随静态站发布，并在 /mf/shards.json
 *       记录每个逻辑文件的分片数与期望合并字节；运行时浏览器经同源 /mf/ 请求完整文件名时，本脚本
 *       严格按清单拉取分片、校验合并长度后返回——大陆网络直连同源、不依赖 huggingface.co / 第三方
 *       镜像，首次成功后写入 Cache 可离线。
 *
 * 健壮性（V1.0.2，针对真机 protobuf parsing failed）：
 *  - 用精确清单而非“探测到 404”：静态托管对不存在的 .partN 可能 SPA 回退成 200 HTML；
 *  - 非分片文件（encoder/config/tokenizer…）也必须校验类型，绝不把回退 HTML 写入缓存；
 *  - 缓存命中时复核字节数，不符即作废重取；CACHE_NAME 随版本升级，一次性清空历史脏缓存；
 *  - 合并后字节必须等于清单声明的期望长度，否则抛错，杜绝把损坏模型喂给 onnxruntime。
 */
(function () {
  'use strict'

  var PREFIX = '/mf/'
  var MANIFEST_URL = '/mf/shards.json'
  // 升级本版本号会让旧缓存整体失效（真机曾缓存到部署竞态下的错误响应）
  var CACHE_NAME = 'fangzi-model-files-v2'

  var manifestPromise = null
  function getManifest() {
    if (manifestPromise) return manifestPromise
    manifestPromise = fetch(MANIFEST_URL, { mode: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : { shards: {} } })
      .then(function (j) { return j || {} })
      .catch(function () { return { shards: {} } })
    return manifestPromise
  }

  function isHtml(ct, buf) {
    return ct.indexOf('text/html') !== -1 || (buf && buf.length > 0 && buf[0] === 0x3c /* '<' */)
  }
  function wantJson(path) {
    return /\.json$/i.test(path)
  }

  self.addEventListener('fetch', function (event) {
    var req = event.request
    if (req.method !== 'GET') return
    var url = new URL(req.url)
    if (url.origin !== self.location.origin) return
    if (url.pathname.indexOf(PREFIX) !== 0) return
    if (url.pathname === MANIFEST_URL) return // 清单本身走网络/默认缓存
    event.respondWith(handle(url))
  })

  async function openCache() {
    try { return await caches.open(CACHE_NAME) } catch (e) { return null }
  }
  function cacheKey(pathname) { return new Request(pathname, { method: 'GET' }) }

  async function fetchShards(pathname, spec) {
    var count = typeof spec === 'number' ? spec : spec.count
    var expected = typeof spec === 'object' ? spec.size : null
    var chunks = []
    for (var i = 0; i < count; i++) {
      var r = await fetch(pathname + '.part' + i, { mode: 'same-origin', cache: 'no-store' })
      if (!r.ok) throw new Error('missing model shard ' + i + ' for ' + pathname)
      var ct = r.headers.get('content-type') || ''
      var buf = new Uint8Array(await r.arrayBuffer())
      if (isHtml(ct, buf)) throw new Error('model shard returned HTML(fallback) ' + i + ' for ' + pathname)
      chunks.push(buf)
    }
    var total = chunks.reduce(function (a, c) { return a + c.byteLength }, 0)
    if (expected && total !== expected) {
      throw new Error('merged size mismatch for ' + pathname + ': ' + total + ' != ' + expected)
    }
    var out = new Uint8Array(total)
    var off = 0
    chunks.forEach(function (c) { out.set(c, off); off += c.byteLength })
    return out.buffer
  }

  async function fetchSingle(pathname) {
    var r = await fetch(pathname, { mode: 'same-origin', cache: 'no-store' })
    if (!r.ok) throw new Error('model file ' + r.status + ' ' + pathname)
    var ct = r.headers.get('content-type') || ''
    var buf = new Uint8Array(await r.arrayBuffer())
    // 任何 /mf 文件只要回退成 HTML，一律拒绝，绝不进缓存
    if (isHtml(ct, buf)) throw new Error('model file returned HTML(fallback): ' + pathname)
    if (wantJson(pathname) && ct.indexOf('json') === -1) {
      throw new Error('model json unexpected content-type: ' + ct + ' ' + pathname)
    }
    return buf.buffer
  }

  async function handle(url) {
    var cache = await openCache()
    var manifest = await getManifest()
    var shards = manifest.shards || {}
    var rel = url.pathname.slice(PREFIX.length - 1)
    var spec = shards[rel]
    var expected = spec && typeof spec === 'object' ? spec.size : null

    // 1) 命中缓存：分片文件复核字节数、任何文件拒绝 HTML，不符即作废重取
    if (cache) {
      try {
        var hit = await cache.match(cacheKey(url.pathname), { ignoreSearch: true })
        if (hit) {
          var hitCt = hit.headers.get('content-type') || ''
          var okLen = !expected || Number(hit.headers.get('content-length')) === expected
          var okType = hitCt.indexOf('text/html') === -1
          if (okLen && okType) return hit
          await cache.delete(cacheKey(url.pathname), { ignoreSearch: true })
        }
      } catch (e) { /* 缓存异常忽略，走网络 */ }
    }

    // 2) 网络：分片文件按清单合并（校验期望长度）；非分片直取（拒绝 HTML/错误类型）
    var buffer = spec
      ? await fetchShards(url.pathname, spec)
      : await fetchSingle(url.pathname)

    var res = new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': wantJson(url.pathname) ? 'application/json; charset=utf-8' : 'application/octet-stream',
        'Content-Length': String(buffer.byteLength),
        'Cache-Control': 'public, max-age=86400'
      }
    })
    if (cache) {
      try { await cache.put(cacheKey(url.pathname), res.clone()) } catch (e) { /* 配额不足等忽略 */ }
    }
    return res
  }
})()
