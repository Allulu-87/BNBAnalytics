/* BNB Analytics — small shared helpers.
   Classic script (no ES modules) on purpose: module scripts are CORS-blocked
   on file://, and this app must run by double-clicking index.html too. */
window.App = window.App || {};

(function (App) {
  'use strict';

  var U = {};

  /* ── numbers & money ──────────────────────────────────────────────────── */

  U.round = function (n, dp) {
    if (!isFinite(n)) return 0;
    var f = Math.pow(10, dp == null ? 3 : dp);
    // shift through the string form so .5 cases round half-up predictably
    return Math.round((n + Number.EPSILON) * f) / f;
  };

  /** Tolerant numeric parse: strips currency words/symbols, thousands commas,
      Arabic-Indic digits and stray spaces. Returns 0 for anything unusable. */
  U.parseNum = function (v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    if (v == null) return 0;
    var s = String(v).trim();
    if (!s) return 0;
    // Arabic-Indic and Extended Arabic-Indic digits → ASCII
    s = s.replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); })
         .replace(/[۰-۹]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0); });
    var neg = /^\(.*\)$/.test(s) || /-/.test(s);
    s = s.replace(/[^0-9.]/g, '');
    if (!s) return 0;
    // keep only the first dot as the decimal separator
    var parts = s.split('.');
    if (parts.length > 2) s = parts.shift() + '.' + parts.join('');
    var n = parseFloat(s);
    if (!isFinite(n)) return 0;
    return neg ? -n : n;
  };

  U.decimals = 3;
  U.currency = 'JD';

  /** Group digits with commas, at a fixed decimal count. */
  U.fmtNum = function (n, dp) {
    if (dp == null) dp = U.decimals;
    if (!isFinite(n)) n = 0;
    var neg = n < 0;
    var s = Math.abs(U.round(n, dp)).toFixed(dp);
    var bits = s.split('.');
    bits[0] = bits[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + bits.join('.');
  };

  /** Money as text, e.g. "JD 1,234.500". */
  U.fmtMoney = function (n, dp) {
    return U.currency + ' ' + U.fmtNum(n, dp);
  };

  /** Money for a stat tile. Keeps the currency's own precision so tiles read
      consistently against each other, and only compacts once a value would
      otherwise blow out its card. */
  U.fmtMoneyTile = function (n) {
    var a = Math.abs(n || 0);
    if (a >= 1e6) return U.fmtNum(n / 1e6, 2) + 'M';
    if (a >= 1e5) return U.fmtNum(n / 1e3, 1) + 'K';
    return U.fmtNum(n, U.decimals);
  };

  /* ── dates ────────────────────────────────────────────────────────────── */

  U.MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  U.todayISO = function () {
    var d = new Date();
    return U.iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
  };

  U.iso = function (y, m, d) {
    return String(y).padStart(4, '0') + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  };

  U.isISO = function (s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); };

  /** '2026-08' → 'Aug 2026' */
  U.monthLabel = function (ym) {
    if (!ym || ym.length < 7) return ym || '';
    var y = ym.slice(0, 4), m = parseInt(ym.slice(5, 7), 10);
    return (U.MONTHS[m - 1] || '?') + ' ' + y;
  };

  /** '2026-08' → 'Aug' (for dense axes) */
  U.monthShort = function (ym) {
    var m = parseInt(String(ym).slice(5, 7), 10);
    return U.MONTHS[m - 1] || '?';
  };

  U.prettyDate = function (isoStr) {
    if (!U.isISO(isoStr)) return isoStr || '—';
    var y = isoStr.slice(0, 4), m = parseInt(isoStr.slice(5, 7), 10), d = parseInt(isoStr.slice(8, 10), 10);
    return d + ' ' + U.MONTHS[m - 1] + ' ' + y;
  };

  /** Inclusive list of 'YYYY-MM' between two ISO dates. */
  U.monthsBetween = function (fromISO, toISO) {
    var out = [];
    if (!U.isISO(fromISO) || !U.isISO(toISO)) return out;
    var y = parseInt(fromISO.slice(0, 4), 10), m = parseInt(fromISO.slice(5, 7), 10);
    var ey = parseInt(toISO.slice(0, 4), 10), em = parseInt(toISO.slice(5, 7), 10);
    var guard = 0;
    while ((y < ey || (y === ey && m <= em)) && guard++ < 600) {
      out.push(String(y) + '-' + String(m).padStart(2, '0'));
      m++; if (m > 12) { m = 1; y++; }
    }
    return out;
  };

  U.addMonths = function (isoStr, delta) {
    var y = parseInt(isoStr.slice(0, 4), 10), m = parseInt(isoStr.slice(5, 7), 10) + delta;
    y += Math.floor((m - 1) / 12);
    m = ((m - 1) % 12 + 12) % 12 + 1;
    var dim = new Date(y, m, 0).getDate();
    var d = Math.min(parseInt(isoStr.slice(8, 10), 10), dim);
    return U.iso(y, m, d);
  };

  U.lastDayOfMonth = function (y, m) { return new Date(y, m, 0).getDate(); };

  /* ── DOM ──────────────────────────────────────────────────────────────── */

  U.esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  U.el = function (tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.keys(v).forEach(function (d) { n.dataset[d] = v[d]; });
      else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) {
      if (c == null) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  };

  U.svgEl = function (tag, attrs) {
    var n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    return n;
  };

  U.clear = function (node) { while (node && node.firstChild) node.removeChild(node.firstChild); return node; };

  U.$ = function (sel, root) { return (root || document).querySelector(sel); };
  U.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  U.debounce = function (fn, ms) {
    var t;
    return function () {
      var self = this, args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms == null ? 200 : ms);
    };
  };

  /* ── files ────────────────────────────────────────────────────────────── */

  U.download = function (filename, blob) {
    var url = URL.createObjectURL(blob);
    var a = U.el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
  };

  U.toast = function (msg, bad) {
    var host = U.$('#toasts');
    if (!host) return;
    var t = U.el('div', { class: 'toast' + (bad ? ' bad' : ''), text: msg });
    host.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .25s';
      t.style.opacity = '0';
      setTimeout(function () { t.remove(); }, 260);
    }, bad ? 4200 : 2400);
  };

  App.U = U;
})(window.App);
