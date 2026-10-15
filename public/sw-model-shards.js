/*
 * 方子 · 自托管大模型分片合并层（Service Worker importScripts 引入）
 *
 * 背景：EdgeOne Pages 免费版「单文件 ≤ 25MiB」，而 whisper-tiny 的 decoder q8 约 30.7MB。
 * 做法：构建期把该 onnx 切成 .part0/.part1/…（每片 < 25MiB）随静态站发布，并在 /mf/shards.json
 *       记录每个逻辑文件的分片数；运行时浏览器经同源 /mf/ 请求完整文件名时，本脚本严格按清单
 *       拉取分片并合并返回——大陆网络直连同源、不依赖 huggingface.co / 第三方镜像，首次成功后
 *       写入 Cache 可离线。
 *
 * 用精确清单而非“探测到 404”：静态托管对不存在的 .partN 也可能 SPA 回退成 200 HTML，
 * 探测式会把 HTML 拼进 onnx；按 shards.json 的确定片数拉取可彻底避免。
 */
(function () {
  'use strict'

  var PREFIX = '/mf/'
  var MANIFEST_URL = '/mf/shards.json'
  var CACHE_NAME = 'fangzi-model-files'

  var manifestPromise = null
  function getShardMap() {
    if (manifestPromise) return manifestPromise
    manifestPromise = fetch(MANIFEST_URL, { mode: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : { shards: {} } })
      .then(function (j) { return (j && j.shards) || {} })
      .catch(function () { return {} })
    return manifestPromise
  }

  function contentType(path) {
    if (path.endsWith('.json')) return 'application/json; charset=utf-8'
    if (path.endsWith('.txt')) return 'text/plain; charset=utf-8'
    return 'application/octet-stream'
  }

  self.addEventListener('fetch', function (event) {
    var req = event.request
    if (req.method !== 'GET') return
    var url = new URL(req.url)
    if (url.origin !== self.location.origin) return
    if (url.pathname.indexOf(PREFIX) !== 0) return
    // 清单本身直接走网络/默认缓存
    if (url.pathname === MANIFEST_URL) return
    event.respondWith(handle(url))
  })

  async function fetchShards(pathname, count) {
    var chunks = []
    for (var i = 0; i < count; i++) {
      var r = await fetch(pathname + '.part' + i, { mode: 'same-origin', cache: 'no-store' })
      if (!r.ok) throw new Error('missing model shard ' + i + ' for ' + pathname)
      var ct = r.headers.get('content-type') || ''
      var buf = new Uint8Array(await r.arrayBuffer())
      // 双保险：静态回退的 HTML 绝不允许进入模型字节流
      if (ct.indexOf('text/html') !== -1 || (buf.length > 0 && buf[0] === 0x3c)) {
        throw new Error('model shard returned HTML (fallback?) ' + i + ' for ' + pathname)
      }
      chunks.push(buf)
    }
    var total = chunks.reduce(function (a, c) { return a + c.byteLength }, 0)
    var out = new Uint8Array(total)
    var off = 0
    chunks.forEach(function (c) { out.set(c, off); off += c.byteLength })
    return out.buffer
  }

  async function handle(url) {
    var cache
    try { cache = await caches.open(CACHE_NAME) } catch (e) { cache = null }

    if (cache) {
      try {
        var hit = await cache.match(new Request(url.pathname, { method: 'GET' }), { ignoreSearch: true })
        if (hit) return hit
      } catch (e) { /* 缓存不可用时走网络 */ }
    }

    var rel = url.pathname.slice(PREFIX.length - 1) // 保留前导 '/'，与清单 key 对齐
    var shardMap = await getShardMap()
    var buffer
    if (Object.prototype.hasOwnProperty.call(shardMap, rel)) {
      buffer = await fetchShards(url.pathname, shardMap[rel])
    } else {
      var r = await fetch(url.pathname, { mode: 'same-origin', cache: 'no-store' })
      if (!r.ok) return r
      buffer = await r.arrayBuffer()
    }

    var res = new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType(url.pathname),
        'Content-Length': String(buffer.byteLength),
        'Cache-Control': 'public, max-age=86400'
      }
    })
    if (cache) {
      try { await cache.put(new Request(url.pathname, { method: 'GET' }), res.clone()) } catch (e) { /* 配额不足等忽略 */ }
    }
    return res
  }
})()
