/**
 * 流式 CSV/TSV 解析 Worker：
 * - inspect：扫描全文得到表头、列类型（前 2000 行采样）、总行数；
 * - build：按选定 X/Y 列与点数上限，流式读入 typed array，回传归一化坐标（transferable）。
 *
 * Worker 源码为内联纯 JS 字符串（Worker 内不经 TS 编译，禁止类型注解）。
 * 大文件通过 file.stream() + TextDecoder 增量解码，主线程仅收到进度与最终 ArrayBuffer。
 */

const WORKER_SOURCE = `
'use strict'
var NUMBER_RE = /^[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?$/

function inferType(sample) {
  var numeric = 0, dateish = 0, total = 0
  for (var i = 0; i < sample.length; i++) {
    var v = sample[i]
    if (!v) continue
    total++
    if (NUMBER_RE.test(v)) numeric++
    else if (!isNaN(Date.parse(v))) dateish++
  }
  if (total === 0) return 'string'
  if (numeric / total >= 0.9) return 'number'
  if (dateish / total >= 0.9) return 'date'
  return 'string'
}

function cellNumber(value, type) {
  var v = value == null ? '' : String(value).trim()
  if (!v) return NaN
  if (type === 'number') return NUMBER_RE.test(v) ? Number(v) : NaN
  if (type === 'date') return Date.parse(v)
  return NaN
}

// 带引号感知的 CSV/TSV 行扫描器；onRow(fields, lineText)
function makeScanner(delim, onRow) {
  var buf = ''
  var inQuotes = false
  return {
    feed: function (chunk) {
      buf += chunk
      var start = 0
      for (var i = 0; i < buf.length; i++) {
        var ch = buf[i]
        if (ch === '"') {
          if (inQuotes && buf[i + 1] === '"') { i++; continue }
          inQuotes = !inQuotes
        } else if ((ch === '\\n' || ch === '\\r') && !inQuotes) {
          var line = buf.slice(start, i)
          start = (ch === '\\r' && buf[i + 1] === '\\n') ? i + 2 : i + 1
          if (ch === '\\r' && buf[i + 1] === '\\n') i++
          if (line.length > 0) onRow(line)
        }
      }
      buf = buf.slice(start)
    },
    flush: function () {
      if (buf.length > 0) { onRow(buf); buf = '' }
    }
  }
}

function splitLine(line, delim) {
  var out = []
  var cur = ''
  var q = false
  for (var i = 0; i < line.length; i++) {
    var ch = line[i]
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else q = false
      } else cur += ch
    } else if (ch === '"') q = true
    else if (ch === delim) { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out
}

async function readChunks(file, onText) {
  var reader = file.stream().getReader()
  var decoder = new TextDecoder('utf-8')
  while (true) {
    var r = await reader.read()
    if (r.done) break
    onText(decoder.decode(r.value, { stream: true }))
  }
  onText(decoder.decode())
}

function delimOf(name) {
  return /\\.tsv($|\\?)/i.test(name) ? '\\t' : ','
}

self.onmessage = async function (e) {
  var msg = e.data
  try {
    var delim = delimOf(msg.sourceName || '')
    if (msg.kind === 'inspectCsv') {
      var headers = null
      var samples = null
      var totalRows = 0
      var scanner = makeScanner(delim, function (line) {
        var fields = splitLine(line, delim)
        if (headers === null) {
          headers = fields.map(function (h, i) { return (h && h.trim()) || ('列' + (i + 1)) })
          samples = headers.map(function () { return [] })
          return
        }
        totalRows++
        if (totalRows <= 2000) {
          for (var c = 0; c < headers.length; c++) samples[c].push(fields[c] != null ? fields[c] : '')
        }
      })
      await readChunks(msg.file, function (t) { scanner.feed(t) })
      scanner.flush()
      var types = samples.map(function (s) { return inferType(s) })
      self.postMessage({ ok: true, headers: headers, types: types, totalRows: totalRows })
      return
    }

    if (msg.kind === 'buildCsv' || msg.kind === 'buildText') {
      var h = msg.headers
      var types = msg.types
      var xIdx = msg.xIdx
      var yIdx = msg.yIdx
      var limit = msg.limit
      var cap = Math.max(1, Math.min(limit, msg.totalHint || limit))
      var rawX = new Float64Array(cap)
      var rawY = new Float64Array(cap)
      var n = 0
      var xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity
      var rawLines = cap <= 100000 ? [] : null
      var isHeader = true
      var total = 0
      var lastTick = 0
      var sc = makeScanner(delim, function (line) {
        var fields = splitLine(line, delim)
        if (isHeader) { isHeader = false; return }
        total++
        if (n >= limit) {
          if (total - lastTick > 100000) { lastTick = total; self.postMessage({ progress: true, counted: total }) }
          return
        }
        var x = cellNumber(fields[xIdx], types[xIdx])
        var y = cellNumber(fields[yIdx], types[yIdx])
        if (isNaN(x) || isNaN(y)) return
        rawX[n] = x; rawY[n] = y
        if (x < xMin) xMin = x
        if (x > xMax) xMax = x
        if (y < yMin) yMin = y
        if (y > yMax) yMax = y
        if (rawLines) rawLines.push(line)
        n++
        if (n - lastTick > 100000) { lastTick = n; self.postMessage({ progress: true, loaded: n }) }
      })
      if (msg.kind === 'buildCsv') {
        await readChunks(msg.file, function (t) { sc.feed(t) })
      } else {
        sc.feed(msg.text)
      }
      sc.flush()
      if (n === 0) throw new Error('所选 X/Y 列没有可用的数值数据')

      var xr = xMax - xMin
      var yr = yMax - yMin
      var rx = rawX.subarray(0, n)
      var ry = rawY.subarray(0, n)
      var xy = new Float32Array(n * 2)
      for (var i2 = 0; i2 < n; i2++) {
        xy[i2 * 2] = xr === 0 ? 0.5 : (rx[i2] - xMin) / xr
        xy[i2 * 2 + 1] = yr === 0 ? 0.5 : (ry[i2] - yMin) / yr
      }
      var outX = Float64Array.from(rx)
      var outY = Float64Array.from(ry)
      var columns = h.map(function (name, idx) {
        return {
          name: name, index: idx, type: types[idx],
          min: idx === xIdx ? xMin : idx === yIdx ? yMin : NaN,
          max: idx === xIdx ? xMax : idx === yIdx ? yMax : NaN
        }
      })
      self.postMessage(
        {
          ok: true,
          payload: {
            headers: h,
            columns: columns,
            xIdx: xIdx,
            yIdx: yIdx,
            rowCount: n,
            totalRows: Math.max(total, n),
            truncated: total > n,
            sourceName: msg.sourceName,
            rawLines: rawLines
          },
          xy: xy.buffer,
          rawX: outX.buffer,
          rawY: outY.buffer
        },
        [xy.buffer, outX.buffer, outY.buffer]
      )
      return
    }
    throw new Error('未知任务：' + msg.kind)
  } catch (err) {
    self.postMessage({ ok: false, error: err && err.message ? err.message : String(err) })
  }
}
`

let workerUrl: string | null = null

/** 每次返回独立 Worker（任务结束由调用方 terminate）；blob URL 全局复用 */
export function createLoadWorker(): Worker {
  if (!workerUrl) {
    workerUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }))
  }
  return new Worker(workerUrl)
}
