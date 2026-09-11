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

  /** Whole nights between two ISO dates. 0 if either is missing or out of
      order — a stay that ends before it starts is not a negative stay. */
  U.nightsBetween = function (aISO, bISO) {
    if (!U.isISO(aISO) || !U.isISO(bISO)) return 0;
    var a = new Date(aISO + 'T00:00:00Z'), b = new Date(bISO + 'T00:00:00Z');
    var d = Math.round((b - a) / 86400000);
    return d > 0 ? d : 0;
  };

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

  /* ── pagination ───────────────────────────────────────────────────────── */

  U.PAGE_SIZES = [10, 25, 50, 100];

  /**
   * Page state for one table, with the chosen size remembered across sessions.
   * @param {string} key  distinguishes the tables in storage
   */
  U.pageState = function (key) {
    var size = U.PAGE_SIZES[0];
    try {
      var saved = parseInt(localStorage.getItem('bnb:page:' + key), 10);
      if (U.PAGE_SIZES.indexOf(saved) !== -1) size = saved;
    } catch (e) { /* private mode — the session default is fine */ }
    return { key: key, page: 1, size: size, sig: null };
  };

  /**
   * Slice `rows` for the current page.
   *
   * `state` is mutated: the page is clamped to what actually exists, so a filter
   * that shortens the list can never strand you on an empty page past the end.
   * Pass `sig` — anything that identifies the current filter and sort — and a
   * change to it returns you to page 1, since a re-ordered list makes "page 3"
   * mean something else entirely.
   */
  U.page = function (rows, state, sig) {
    if (sig !== undefined && sig !== state.sig) {
      if (state.sig !== null) state.page = 1;
      state.sig = sig;
    }
    var size = state.size > 0 ? state.size : U.PAGE_SIZES[0];
    var pages = Math.max(1, Math.ceil(rows.length / size));
    if (!(state.page > 0)) state.page = 1;
    if (state.page > pages) state.page = pages;

    var from = (state.page - 1) * size;
    return {
      rows: rows.slice(from, from + size),
      page: state.page, pages: pages, size: size, total: rows.length,
      first: rows.length ? from + 1 : 0,
      last: Math.min(from + size, rows.length)
    };
  };

  /**
   * The strip under a paged table: rows-per-page, position, prev/next.
   * Returns null when everything already fits on one default-sized page —
   * controls for a list that cannot be paged are just noise.
   * @param {object}   p         the result of U.page
   * @param {object}   state     the same state object, mutated on interaction
   * @param {Function} onChange  re-render (typically App.refresh)
   * @param {string}   noun      what is being counted, e.g. 'reservations'
   */
  U.pager = function (p, state, onChange, noun) {
    if (p.total <= U.PAGE_SIZES[0] && p.pages <= 1) return null;

    var sizeSel = U.el('select', {
      'aria-label': 'Rows per page',
      onchange: function () {
        /* Keep the row you were looking at on screen instead of jumping to the
           top — changing the page size is a zoom, not a navigation. */
        var anchor = (state.page - 1) * p.size;
        state.size = parseInt(this.value, 10) || U.PAGE_SIZES[0];
        state.page = Math.floor(anchor / state.size) + 1;
        try {
          localStorage.setItem('bnb:page:' + state.key, String(state.size));
        } catch (e) { /* ignore */ }
        onChange();
      }
    }, U.PAGE_SIZES.map(function (n) {
      return U.el('option', { value: n, text: n, selected: n === p.size });
    }));

    function step(delta, label, aria, disabled) {
      return U.el('button', {
        class: 'btn btn-sm', type: 'button', disabled: !!disabled, 'aria-label': aria,
        onclick: function () { state.page = p.page + delta; onChange(); }
      }, [label]);
    }

    return U.el('div', { class: 'pager', role: 'navigation', 'aria-label': 'Pagination' }, [
      U.el('label', { class: 'pager-rows' }, ['Rows', sizeSel]),
      U.el('span', {
        class: 'pager-count',
        text: p.first + '–' + p.last + ' of ' + p.total + ' ' + (noun || 'rows')
      }),
      U.el('span', { style: 'flex:1' }),
      step(-1, '‹ Prev', 'Previous page', p.page <= 1),
      U.el('span', { class: 'pager-at', text: 'Page ' + p.page + ' of ' + p.pages }),
      step(1, 'Next ›', 'Next page', p.page >= p.pages)
    ]);
  };

  /* ── files ────────────────────────────────────────────────────────────── */

  U.download = function (filename, blob) {
    var url = URL.createObjectURL(blob);
    var a = U.el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
  };

  var MAX_TOASTS = 3;

  function dropToast(el) {
    if (!el) return;
    clearTimeout(el._toastTimer);
    el.style.transition = 'opacity .2s';
    el.style.opacity = '0';
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
  }

  function armToast(el, bad) {
    clearTimeout(el._toastTimer);
    el._toastTimer = setTimeout(function () { dropToast(el); }, bad ? 4200 : 2400);
  }

  /**
   * Transient message. Repeating the same one — say, tapping "processed" four
   * times without an amount — does NOT stack four copies: the toast already on
   * screen simply has its timer restarted. Unrelated messages still stack, but
   * never more than MAX_TOASTS at once, so they can't cover the screen.
   */
  U.toast = function (msg, bad) {
    var host = U.$('#toasts');
    if (!host) return;
    msg = String(msg);

    var existing = null;
    U.$$('.toast', host).forEach(function (el) {
      if (el.dataset.msg === msg) existing = el;
    });

    if (existing) {
      // replay the nudge so a repeat still registers, without new text
      existing.classList.remove('toast-bump');
      void existing.offsetWidth;                 // force reflow to restart it
      existing.classList.add('toast-bump');
      armToast(existing, bad);
      return;
    }

    var t = U.el('div', {
      class: 'toast' + (bad ? ' bad' : ''),
      dataset: { msg: msg },
      text: msg
    });
    host.appendChild(t);

    var all = U.$$('.toast', host);
    while (all.length > MAX_TOASTS) dropToast(all.shift());

    armToast(t, bad);
  };

  App.U = U;
})(window.App);
