import type { WidgetConfig } from './types'

export function safeId(id: string): string {
  return (id || 'widget').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'widget'
}

export function widgetTag(c: WidgetConfig): string {
  return 'widget-fz-' + safeId(c.id)
}

export function widgetFileName(c: WidgetConfig): string {
  return widgetTag(c) + '.js'
}

/**
 * 组件运行时（纯 JS 字符串，烘焙进独立脚本）。
 * 约定：内部只允许单引号字符串与 + 拼接——禁止反引号、禁止 ${，
 * 以便安全地以内联 <script> 注入 srcdoc 预览且不发生模板冲突。
 * 与构建器通信：预览态（data-preview=1）提交时向 parent postMessage {__fzWidget:'submit'}。
 */
const RUNTIME = String.raw`
function (CFG) {
  var TAG = 'widget-fz-' + String(CFG.id || 'x');
  if (!window.customElements || customElements.get(TAG)) { return; }
  var T = (CFG.theme && CFG.theme.primary) || '#0f7a4f';
  var Rr = (CFG.theme && typeof CFG.theme.radius === 'number') ? CFG.theme.radius : 10;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }
  function money(n, cur) {
    var v = Number(n || 0);
    var s = (Math.round(v * 100) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (cur || '¥') + s;
  }
  var CSS = [
    ':host{display:block;}',
    '.w{font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;color:#1f2937;background:#fff;border:1px solid #e5e7eb;border-radius:' + (Rr + 8) + 'px;padding:20px;max-width:440px;box-sizing:border-box;box-shadow:0 1px 3px rgba(0,0,0,.06);}',
    '.t{font-size:17px;font-weight:700;margin:0 0 4px;}',
    '.d{color:#6b7280;font-size:13px;margin:0 0 14px;}',
    'label{display:block;font-size:13px;font-weight:600;margin:10px 0 5px;}',
    'input,textarea{width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid #d1d5db;border-radius:' + Rr + 'px;font:inherit;color:inherit;background:#fff;}',
    'input:focus,textarea:focus{outline:2px solid ' + T + '33;border-color:' + T + ';}',
    'textarea{min-height:74px;resize:vertical;}',
    '.btn{margin-top:14px;width:100%;border:0;cursor:pointer;background:' + T + ';color:#fff;font-weight:700;font-size:14px;padding:11px;border-radius:' + Rr + 'px;}',
    '.btn:active{filter:brightness(.94);}',
    '.ok{margin-top:12px;padding:10px 12px;border-radius:' + Rr + 'px;background:' + T + '14;color:' + T + ';font-size:13px;font-weight:600;display:none;}',
    '.bad{color:#dc2626;font-size:12px;margin-top:8px;display:none;}',
    '.stars{display:flex;gap:4px;margin:6px 0 2px;}',
    '.stars button{border:0;background:none;cursor:pointer;font-size:30px;line-height:1;padding:2px;color:#d1d5db;}',
    '.stars button.on{color:' + T + ';}',
    '.scale{display:flex;justify-content:space-between;font-size:12px;color:#9ca3af;margin-top:2px;}',
    '.chips{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0;}',
    '.chips button{border:1px solid #d1d5db;background:#fff;border-radius:999px;padding:8px 14px;cursor:pointer;font:inherit;}',
    '.chips button.on{border-color:' + T + ';background:' + T + '14;color:' + T + ';font-weight:700;}',
    '.res{margin-top:14px;padding:12px;border-radius:' + Rr + 'px;background:#f9fafb;border:1px solid #e5e7eb;}',
    '.res b{font-size:22px;color:' + T + ';}',
    '.lines{font-size:12px;color:#6b7280;margin-top:4px;}',
    '.cd{display:flex;gap:8px;justify-content:center;margin:8px 0 4px;}',
    '.cd div{background:#111827;color:#fff;border-radius:' + Rr + 'px;padding:10px 8px;min-width:54px;text-align:center;}',
    '.cd b{display:block;font-size:22px;}',
    '.cd span{font-size:11px;opacity:.7;}',
    '.done{font-size:16px;font-weight:700;color:' + T + ';text-align:center;padding:10px;}',
    '.badge{display:block;margin-top:14px;text-align:center;font-size:11px;color:#9ca3af;text-decoration:none;}'
  ].join('');

  function headHtml() {
    var h = '';
    if (CFG.title) { h += '<h3 class="t">' + esc(CFG.title) + '</h3>'; }
    if (CFG.description) { h += '<p class="d">' + esc(CFG.description) + '</p>'; }
    return h;
  }
  function badgeHtml() {
    return CFG.poweredBy === false ? '' : '<a class="badge" href="https://fangzi.app" target="_blank" rel="noopener">由方子生成</a>';
  }
  function footHtml() {
    return '<div class="ok" role="status"></div><div class="bad" role="alert"></div>' + badgeHtml();
  }
  function fieldHtml(f) {
    var star = f.required ? ' <span style="color:#dc2626">*</span>' : '';
    var ph = ' placeholder="' + esc(f.placeholder || '') + '"';
    var req = f.required ? ' data-req="1"' : '';
    var inp;
    if (f.type === 'textarea') {
      inp = '<textarea name="' + esc(f.name) + '"' + ph + req + '></textarea>';
    } else {
      var ty = f.type === 'email' ? 'email' : (f.type === 'number' ? 'number' : 'text');
      inp = '<input type="' + ty + '" name="' + esc(f.name) + '"' + ph + req + '>';
    }
    return '<label>' + esc(f.label) + star + '</label>' + inp;
  }
  function bodyHtml() {
    var b = '<div class="w">';
    if (CFG.kind === 'contact') {
      b += '<form class="frm">' + headHtml();
      (CFG.fields || []).forEach(function (f) { b += fieldHtml(f); });
      b += '<button class="btn" type="submit">' + esc(CFG.submitLabel || '提交') + '</button>' + footHtml() + '</form>';
    } else if (CFG.kind === 'feedback') {
      b += '<form class="frm">' + headHtml();
      b += '<div class="chips" data-role="chips">';
      (CFG.choices || []).forEach(function (c, i) {
        b += '<button type="button" data-i="' + i + '">' + esc(c) + '</button>';
      });
      b += '</div>';
      b += '<label>补充说明（选填）</label><textarea name="note"></textarea>';
      b += '<button class="btn" type="submit">' + esc(CFG.submitLabel || '提交反馈') + '</button>' + footHtml() + '</form>';
    } else if (CFG.kind === 'rating') {
      var n = CFG.max || 5;
      b += '<form class="frm">' + headHtml();
      b += '<div class="stars" data-role="stars">';
      for (var i = 1; i <= n; i++) { b += '<button type="button" data-v="' + i + '">★</button>'; }
      b += '</div><div class="scale"><span>' + esc(CFG.lowLabel || '非常不满意') + '</span><span>' + esc(CFG.highLabel || '非常满意') + '</span></div>';
      b += '<label>说说感受（选填）</label><textarea name="note"></textarea>';
      b += '<button class="btn" type="submit">' + esc(CFG.submitLabel || '提交评分') + '</button>' + footHtml() + '</form>';
    } else if (CFG.kind === 'calculator') {
      var c = CFG.calc || {};
      b += '<form class="frm">' + headHtml();
      b += '<label>' + esc(c.qtyLabel || '数量') + '</label><input type="number" min="0" step="1" name="qty" value="' + esc(c.qtyDefault || 1) + '">';
      b += '<div class="res"><div>合计</div><b data-role="total"></b><div class="lines" data-role="lines"></div></div>';
      b += '<button class="btn" type="submit">' + esc(CFG.submitLabel || '提交询价') + '</button>' + footHtml() + '</form>';
    } else if (CFG.kind === 'countdown') {
      b += headHtml();
      b += '<div class="cd" data-role="cd"></div><div class="done" data-role="done" style="display:none">' + esc((CFG.countdown && CFG.countdown.completeText) || '时间到！') + '</div>' + badgeHtml();
    }
    return b + '</div>';
  }

  class FzWidget extends HTMLElement { }
  FzWidget.prototype.connectedCallback = function () {
    var sr = this.attachShadow({ mode: 'open' });
    sr.innerHTML = '<style>' + CSS + '</style>' + bodyHtml();
    this.$ = function (sel) { return sr.querySelector(sel); };
    this.key = this.getAttribute('data-key') || CFG.id;
    this.endpoint = this.getAttribute('data-endpoint') || CFG.endpoint || '';
    this.isPreview = this.getAttribute('data-preview') === '1' || CFG.preview === true;
    this.choice = '';
    this.score = 0;
    this.bind();
    if (CFG.kind === 'countdown') { this.startCountdown(); }
    if (CFG.kind === 'calculator') { this.calc(); }
  };

  FzWidget.prototype.persist = function (data) {
    try {
      var k = 'fz-widget:' + CFG.id + ':submissions';
      var arr = JSON.parse(localStorage.getItem(k) || '[]');
      arr.unshift(data);
      localStorage.setItem(k, JSON.stringify(arr.slice(0, 200)));
    } catch (e) { /* 隐私模式等场景静默降级 */ }
  };
  FzWidget.prototype.emit = function (data) {
    this.persist(data);
    this.dispatchEvent(new CustomEvent('widget-submit', { bubbles: true, composed: true, detail: data }));
    if (this.endpoint) {
      try { fetch(this.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), keepalive: true }).catch(function () { }); } catch (e) { }
    }
    if (this.isPreview) {
      try { window.parent.postMessage({ __fzWidget: 'submit', id: CFG.id, data: data }, '*'); } catch (e) { }
    }
  };
  FzWidget.prototype.fail = function (msg) {
    var bad = this.$('.bad');
    if (bad) { bad.textContent = msg; bad.style.display = 'block'; }
  };
  FzWidget.prototype.collect = function (form) {
    var self = this, data = { ts: Date.now(), key: self.key, kind: CFG.kind };
    var bad = '';
    var nodes = form.querySelectorAll('[data-req]');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var v = (n.value || '').trim();
      if (!v) { bad = '请填写必填项'; break; }
      if (n.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { bad = '邮箱格式不正确'; break; }
    }
    if (bad) { return { ok: false, msg: bad }; }
    var named = form.querySelectorAll('[name]');
    for (var j = 0; j < named.length; j++) {
      var nm = named[j];
      if (nm.type === 'number') { data[nm.name] = Number(nm.value || 0); } else { data[nm.name] = nm.value; }
    }
    if (CFG.kind === 'feedback') {
      if (!self.choice) { return { ok: false, msg: '请选择一个评价' }; }
      data.choice = self.choice;
    }
    if (CFG.kind === 'rating') {
      if (!self.score) { return { ok: false, msg: '请先点击星级评分' }; }
      data.score = self.score;
    }
    return { ok: true, data: data };
  };
  FzWidget.prototype.bind = function () {
    var self = this;
    var form = self.$('.frm');
    if (!form) { return; }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      self.$('.bad') && (self.$('.bad').style.display = 'none');
      if (CFG.kind === 'calculator') {
        var r = self.calc();
        var data = { ts: Date.now(), key: self.key, kind: 'calculator', qty: r.qty, unitPrice: r.unit, fixedFee: r.fixed, total: r.total };
        self.emit(data);
      } else {
        var res = self.collect(form);
        if (!res.ok) { self.fail(res.msg); return; }
        self.emit(res.data);
      }
      var ok = self.$('.ok');
      if (ok) { ok.textContent = CFG.successText || '已提交，感谢反馈！'; ok.style.display = 'block'; }
      if (CFG.kind !== 'calculator') {
        form.reset(); self.choice = ''; self.score = 0;
        var chipsBox = self.$ ? self.$('[data-role="chips"]') : null;
        if (chipsBox) { var onBtns = chipsBox.querySelectorAll('button.on'); for (var ci = 0; ci < onBtns.length; ci++) { onBtns[ci].classList.remove('on'); } }
        if (typeof self.paint === 'function') { self.paint(0, 0); }
      }
    });

    var chips = self.$('[data-role="chips"]');
    if (chips) {
      chips.addEventListener('click', function (e) {
        var btn = e.target.closest('button'); if (!btn) { return; }
        var all = chips.querySelectorAll('button');
        for (var i = 0; i < all.length; i++) { all[i].classList.remove('on'); }
        btn.classList.add('on');
        self.choice = btn.textContent;
      });
    }
    var stars = self.$('[data-role="stars"]');
    if (stars) {
      var btns = stars.querySelectorAll('button');
      self.paint = function (hover, chosen) {
        var v = hover || chosen;
        for (var k = 0; k < btns.length; k++) { btns[k].classList.toggle('on', k < v); }
      };
      stars.addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) { return; }
        self.score = Number(b.getAttribute('data-v')); self.paint(0, self.score);
      });
      stars.addEventListener('mouseover', function (e) {
        var b = e.target.closest('button'); if (b) { self.paint(Number(b.getAttribute('data-v')), self.score); }
      });
      stars.addEventListener('mouseleave', function () { self.paint(0, self.score); });
    }
    var qty = form.querySelector('[name="qty"]');
    if (qty) { qty.addEventListener('input', function () { self.calc(); }); }
  };
  FzWidget.prototype.calc = function () {
    var c = CFG.calc || {};
    var form = this.$('.frm');
    var qty = Number(form.querySelector('[name="qty"]').value || 0);
    var unit = Number(c.unitPrice || 0), fixed = Number(c.fixedFee || 0), cur = c.currency || '¥';
    var total = qty * unit + fixed;
    var tot = this.$('[data-role="total"]');
    if (tot) { tot.textContent = money(total, cur); }
    var lines = this.$('[data-role="lines"]');
    if (lines) {
      lines.textContent = qty + ' × ' + money(unit, cur) + (fixed ? ' + ' + money(fixed, cur) : '');
    }
    return { qty: qty, unit: unit, fixed: fixed, total: Math.round(total * 100) / 100 };
  };
  FzWidget.prototype.startCountdown = function () {
    var self = this, box = self.$('[data-role="cd"]'), done = self.$('[data-role="done"]');
    var target = new Date((CFG.countdown && CFG.countdown.targetAt) || 0).getTime();
    var showSec = CFG.countdown ? CFG.countdown.showSeconds !== false : true;
    function box2(v, l) { return '<div><b>' + v + '</b><span>' + l + '</span></div>'; }
    function tick() {
      var ms = target - Date.now();
      if (ms <= 0) {
        if (box) { box.innerHTML = ''; }
        if (done) { done.style.display = 'block'; }
        clearInterval(self._t);
        self.dispatchEvent(new CustomEvent('widget-countdown-end', { bubbles: true, composed: true }));
        return;
      }
      var s = Math.floor(ms / 1000), d = Math.floor(s / 86400);
      var h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
      var pad = function (x) { return String(x).padStart(2, '0'); };
      var html = box2(d, '天') + box2(pad(h), '时') + box2(pad(m), '分');
      if (showSec) { html += box2(pad(ss), '秒'); }
      if (box) { box.innerHTML = html; }
    }
    tick();
    self._t = setInterval(tick, 1000);
  };

  customElements.define(TAG, FzWidget);
}
`

/** 生成自包含、零依赖的 Web Component 单文件脚本内容 */
export function widgetSource(cfg: WidgetConfig): string {
  const banner = '/*! 方子 embed-widget-builder 生成 · 标签 ' + widgetTag(cfg) + ' · 可任意站点嵌入（Shadow DOM 样式隔离）*/'
  // 转义配置中的 “<”：JSON.stringify 不转义斜杠，用户文本若含 </script> 会提前闭合内联脚本；
  // \u003c 在 JS 源码里被解析回 “<”，运行时字符串原值不变，同时杜绝脚本注入。
  const json = JSON.stringify(cfg).replace(/</g, '\\u003c')
  return banner + '\n(function () {\nvar __FZ = ' + RUNTIME + ';\n__FZ(' + json + ');\n})();\n'
}

/** 供生成器/测试在 Node 端校验产物关键结构（不执行脚本） */
export const RUNTIME_MARKERS = {
  define: 'customElements.define',
  shadow: "attachShadow("
} as const
