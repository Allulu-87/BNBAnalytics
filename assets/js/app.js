/* BNB Analytics — boot, navigation, and the one shared filter row. */
window.App = window.App || {};

(function (App) {
  'use strict';

  var U = App.U, DB = App.DB, Store = App.Store;

  /* Booking costs is no longer its own tab — it renders as a section inside the
     Dashboard (see views-charges.js → App.Views.chargesSection). */
  var TABS = [
    { id: 'reservations', label: 'Reservations' },
    { id: 'expenses', label: 'Expenses' },
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'import', label: 'Import' },
    { id: 'data', label: 'Data & export' }
  ];

  var active = 'reservations';

  /* ── shared filter state ──────────────────────────────────────────────── */

  var state = {
    from: '', to: '', listingId: '', basis: 'start_date', q: '', preset: 'all'
  };

  var BASIS_LABEL = {
    start_date: 'Check-in date',
    end_date: 'Check-out date',
    booked_date: 'Date booked'
  };

  state.filter = function () {
    return {
      from: state.from || null,
      to: state.to || null,
      listingId: state.listingId ? parseInt(state.listingId, 10) : null,
      basis: state.basis,
      q: state.q ? state.q.trim() : ''
    };
  };

  state.basisLabel = function () { return BASIS_LABEL[state.basis] || 'Check-in date'; };

  /** Widen the window to cover everything on record. */
  state.resetBounds = function () {
    var b = DB.dateBounds(state.basis);
    state.from = b.lo || '';
    state.to = b.hi || '';
    state.preset = 'all';
  };

  function applyPreset(p) {
    state.preset = p;
    var d = new Date();
    var y = d.getFullYear(), m = d.getMonth() + 1;
    if (p === 'all') { state.resetBounds(); state.preset = 'all'; return; }
    if (p === 'month') {
      state.from = U.iso(y, m, 1);
      state.to = U.iso(y, m, U.lastDayOfMonth(y, m));
    } else if (p === 'year') {
      state.from = U.iso(y, 1, 1);
      state.to = U.iso(y, 12, 31);
    } else if (p === 'ytd') {
      state.from = U.iso(y, 1, 1);
      state.to = U.todayISO();
    } else if (p === '12m') {
      state.to = U.todayISO();
      state.from = U.addMonths(state.to, -11).slice(0, 8) + '01';
    }
  }

  /* ── filter bar ───────────────────────────────────────────────────────── */

  function filterBar() {
    var bar = U.el('div', { class: 'filterbar', role: 'search' });

    var listings = DB.listings();
    var listingSel = U.el('select', {
      onchange: function () { state.listingId = this.value; render(); }
    }, [U.el('option', { value: '', text: 'All listings' })].concat(
      listings.map(function (l) {
        return U.el('option', {
          value: l.id, text: l.name + ' (' + l.n + ')',
          selected: String(state.listingId) === String(l.id)
        });
      })));

    var basisSel = U.el('select', {
      onchange: function () {
        state.basis = this.value;
        if (state.preset === 'all') state.resetBounds();
        render();
      }
    }, Object.keys(BASIS_LABEL).map(function (k) {
      return U.el('option', { value: k, text: BASIS_LABEL[k], selected: state.basis === k });
    }));

    // The two ends bound each other, so an inverted range can't be picked.
    var fromIn = App.DP.attach(
      U.el('input', { type: 'text', value: state.from, 'aria-label': 'From date' }),
      {
        maxDate: state.to || null,
        placeholder: 'Earliest',
        onPick: function (iso) { state.from = iso; state.preset = ''; render(); }
      }
    );
    var toIn = App.DP.attach(
      U.el('input', { type: 'text', value: state.to, 'aria-label': 'To date' }),
      {
        minDate: state.from || null,
        placeholder: 'Latest',
        onPick: function (iso) { state.to = iso; state.preset = ''; render(); }
      }
    );

    var search = U.el('input', {
      type: 'search', value: state.q, placeholder: 'Guest, code, contact…',
      'aria-label': 'Search',
      oninput: U.debounce(function () { state.q = this.value; render(); }, 260)
    });

    var presets = U.el('div', { class: 'presets' });
    [['month', 'This month'], ['ytd', 'Year to date'], ['12m', 'Last 12 months'],
      ['year', 'This year'], ['all', 'All time']].forEach(function (p) {
      presets.appendChild(U.el('button', {
        class: 'chip', type: 'button',
        'aria-pressed': state.preset === p[0] ? 'true' : 'false',
        onclick: function () { applyPreset(p[0]); render(); }
      }, [p[1]]));
    });

    bar.appendChild(U.el('div', { class: 'field wide' }, [U.el('label', { text: 'Listing' }), listingSel]));
    bar.appendChild(U.el('div', { class: 'field' }, [U.el('label', { text: 'From' }), fromIn]));
    bar.appendChild(U.el('div', { class: 'field' }, [U.el('label', { text: 'To' }), toIn]));
    bar.appendChild(U.el('div', { class: 'field' }, [U.el('label', { text: 'Attribute by' }), basisSel]));
    bar.appendChild(U.el('div', { class: 'field wide' }, [U.el('label', { text: 'Search' }), search]));
    bar.appendChild(U.el('div', { class: 'field', style: 'flex:1 1 100%' }, [
      U.el('label', { text: 'Quick range' }), presets
    ]));

    return bar;
  }

  /* ── collapsed by default ─────────────────────────────────────────────────
     The filters are occasional, so they start folded away and the choice is
     remembered. Collapsed, the strip still states what is currently applied —
     a hidden filter you have forgotten about is worse than no filter. */

  var PRESET_LABEL = {
    month: 'This month', ytd: 'Year to date', '12m': 'Last 12 months',
    year: 'This year', all: 'All time'
  };

  var filtersOpen = false;
  try { filtersOpen = localStorage.getItem('bnb:filters-open') === '1'; } catch (e) { /* ignore */ }

  function filterSummary() {
    var bits = [];

    if (state.listingId) {
      var l = DB.one('SELECT name FROM listings WHERE id = ?', [parseInt(state.listingId, 10)]);
      bits.push(l ? l.name : 'One listing');
    } else {
      bits.push('All listings');
    }

    if (PRESET_LABEL[state.preset]) bits.push(PRESET_LABEL[state.preset]);
    else if (state.from || state.to) {
      bits.push((state.from ? U.prettyDate(state.from) : 'start') +
        ' – ' + (state.to ? U.prettyDate(state.to) : 'today'));
    }

    if (state.basis !== 'start_date') bits.push(BASIS_LABEL[state.basis]);
    if (state.q) bits.push('"' + state.q + '"');

    return bits.join('  ·  ');
  }

  function filterPanel() {
    var wrap = U.el('div', { class: 'filterwrap' });

    var chev = U.el('span', {
      class: 'ft-chev',
      html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
        '<path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.2" ' +
        'stroke-linecap="round" stroke-linejoin="round"/></svg>'
    });

    wrap.appendChild(U.el('button', {
      class: 'filter-toggle', type: 'button',
      'aria-expanded': filtersOpen ? 'true' : 'false',
      title: filtersOpen ? 'Hide filters' : 'Show filters',
      onclick: function () {
        filtersOpen = !filtersOpen;
        try {
          localStorage.setItem('bnb:filters-open', filtersOpen ? '1' : '0');
        } catch (e) { /* private mode — the session still works */ }
        render();
      }
    }, [
      // wrapped in a span: U.el uses createElement, which cannot make SVG nodes
      U.el('span', {
        class: 'ft-icon',
        html: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
          '<path d="M3 5h18M6 12h12M10 19h4" stroke="currentColor" stroke-width="2" ' +
          'stroke-linecap="round"/></svg>'
      }),
      U.el('span', { class: 'ft-label', text: 'Filters' }),
      U.el('span', { class: 'ft-summary', text: filterSummary() }),
      chev
    ]));

    if (filtersOpen) wrap.appendChild(filterBar());
    return wrap;
  }

  /* ── render ───────────────────────────────────────────────────────────── */

  /**
   * Rebuild the chrome and the active view.
   *
   * Every edit re-renders the whole view, which briefly empties the page and
   * collapses its height — the browser then clamps the scroll offset, which
   * reads as "it jumped to the top". So the offset is captured and restored
   * around the rebuild. Only an explicit tab change asks for the top.
   */
  function render(opts) {
    var toTop = !!(opts && opts.toTop);
    var y = toTop ? 0 : (window.pageYOffset || document.documentElement.scrollTop || 0);

    /* Sideways position of each inner scroller, in document order. Rebuilding
       the view resets scrollLeft to 0, which throws away where the reader was
       in a wide table. */
    var prevEl = U.$('#view-' + active);
    var hScroll = (!toTop && prevEl)
      ? U.$$('.table-scroll', prevEl).map(function (el) { return el.scrollLeft; })
      : [];

    // flatpickr parks its calendars on <body>; drop them before their inputs go
    App.DP.destroyAll();

    // tabs
    U.$$('.tab').forEach(function (t) {
      t.setAttribute('aria-selected', t.dataset.tab === active ? 'true' : 'false');
    });

    // Every tab is scoped by the shared filters — including Data & export,
    // whose downloads honour them. Import is the one tab they don't apply to.
    var host = U.$('#filterbar-host');
    U.clear(host);
    if (active !== 'import') host.appendChild(filterPanel());

    TABS.forEach(function (t) {
      var v = U.$('#view-' + t.id);
      if (v) v.hidden = t.id !== active;
    });

    var view = App.Views[active];
    if (view) view(U.$('#view-' + active));

    // inputs are in the document now — flatpickr needs a parent to attach to
    App.DP.mount();

    if (hScroll.length) {
      var nowEl = U.$('#view-' + active);
      if (nowEl) {
        U.$$('.table-scroll', nowEl).forEach(function (el, i) {
          if (hScroll[i]) el.scrollLeft = hScroll[i];
        });
      }
    }

    if (toTop) window.scrollTo(0, 0);
    else if (y) window.scrollTo(0, y);
  }

  App.refresh = function () { render(); };
  App.state = state;

  // charts are sized in pixels against the container, so redraw on resize
  window.addEventListener('resize', U.debounce(function () {
    if (active === 'dashboard') render();
  }, 220));

  App.go = function (tab) {
    active = tab;
    try { history.replaceState(null, '', '#' + tab); } catch (e) { /* file:// */ }
    render({ toTop: true });
  };

  /* ── persistence ──────────────────────────────────────────────────────── */

  var saveTimer = null;
  /** Debounced: a burst of edits results in one write. */
  App.persist = function () {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { Store.save(DB.export()); }
      catch (e) { U.toast('Could not save: ' + e.message, true); }
    }, 250);
  };

  /* ── theme ────────────────────────────────────────────────────────────── */

  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem('bnb:theme'); } catch (e) { /* ignore */ }
    if (saved) document.documentElement.setAttribute('data-theme', saved);
    var btn = U.$('#theme-toggle');
    btn.addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme');
      var isDark = cur === 'dark' ||
        (!cur && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
      var next = isDark ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('bnb:theme', next); } catch (e) { /* ignore */ }
      render();   // charts read their colors from CSS variables
    });
  }

  /* ── boot ─────────────────────────────────────────────────────────────── */

  function buildChrome() {
    var tabs = U.$('#tabs');
    TABS.forEach(function (t) {
      tabs.appendChild(U.el('button', {
        class: 'tab', role: 'tab', type: 'button',
        dataset: { tab: t.id },
        'aria-selected': 'false',
        'aria-controls': 'view-' + t.id,
        onclick: function () { App.go(t.id); }
      }, [t.label]));
    });

    var main = U.$('#main');
    TABS.forEach(function (t) {
      main.appendChild(U.el('section', {
        class: 'view', id: 'view-' + t.id, role: 'tabpanel',
        'aria-label': t.label, hidden: true
      }));
    });
  }

  /* ── boot diagnostics ─────────────────────────────────────────────────────
     If startup stalls or fails, say exactly what is missing. Built with inline
     styles and no dependency on App.U, because a failure to load app.css or
     util.js is one of the things this has to be able to report. */

  var BOOT = window.__BOOT || { stage: 'html', errors: [], failedAssets: [] };
  var watchdog = null;

  function stage(name) { BOOT.stage = name; }

  function checks() {
    var cssLoaded = false;
    try {
      cssLoaded = getComputedStyle(document.documentElement)
        .getPropertyValue('--app-css-loaded').trim() === '1';
    } catch (e) { /* ignore */ }

    var A = window.App || {};
    var out = [
      ['assets/css/app.css', cssLoaded],
      ['vendor/sql-wasm.js', typeof window.initSqlJs === 'function'],
      ['vendor/sql-wasm-binary.js', typeof window.__SQLJS_WASM_B64__ === 'string'],
      ['vendor/flatpickr.min.js', typeof window.flatpickr === 'function'],
      ['js/util.js', !!A.U],
      ['js/datepicker.js', !!A.DP],
      ['js/store.js', !!A.Store],
      ['js/db.js', !!A.DB],
      ['js/csv.js', !!A.CSV],
      ['js/exporter.js', !!A.Ex],
      ['js/charts.js', !!A.Charts],
      ['js/analytics.js', !!A.An],
      ['js/views (5 + section)', !!(A.Views && A.Views.dashboard && A.Views.reservations &&
        A.Views.chargesSection && A.Views.expenses && A.Views['import'] && A.Views.data)],
      ['WebAssembly support', typeof WebAssembly === 'object']
    ];
    return out;
  }

  function report(headline, detail) {
    var rows = checks();
    var missing = rows.filter(function (r) { return !r[1]; })
      .map(function (r) { return r[0]; });

    var lines = [];
    lines.push('BNB Analytics — startup report');
    lines.push('stage reached : ' + BOOT.stage);
    lines.push('address       : ' + location.protocol + '//' + (location.host || '(none)'));
    lines.push('storage       : ' + ((window.App && App.Store && App.Store.mode) || 'not reached'));
    lines.push('user agent    : ' + navigator.userAgent);
    lines.push('');
    rows.forEach(function (r) { lines.push((r[1] ? '  ok      ' : '  MISSING ') + r[0]); });
    if (BOOT.failedAssets.length) {
      lines.push('');
      lines.push('files that failed to load: ' + BOOT.failedAssets.join(', '));
    }
    if (BOOT.errors.length) {
      lines.push('');
      lines.push('errors:');
      BOOT.errors.slice(0, 12).forEach(function (e) { lines.push('  ' + e); });
    }
    if (detail) { lines.push(''); lines.push('cause: ' + detail); }
    var text = lines.join('\n');

    var splash = document.getElementById('splash');
    if (!splash) {
      splash = document.createElement('div');
      document.body.appendChild(splash);
    }
    splash.innerHTML = '';
    splash.setAttribute('style',
      'position:fixed;inset:0;z-index:100;overflow:auto;padding:1.25rem;' +
      'background:#0d0d0d;color:#e8e8e4;' +
      'font:13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif');

    var h = document.createElement('h2');
    h.textContent = headline;
    h.setAttribute('style', 'margin:0 0 .5rem;font-size:1.05rem');
    splash.appendChild(h);

    var p = document.createElement('p');
    p.setAttribute('style', 'margin:0 0 .9rem;color:#b9b8b0;max-width:40rem');
    p.textContent = missing.length
      ? 'The browser could not load these files next to index.html: ' + missing.join(', ') +
        '. Phone browsers usually refuse to read a folder of local files like this. ' +
        'Serving the folder over http:// (or hosting it) fixes it.'
      : 'Every file loaded, so this is not a missing-file problem. The details below say where it stopped.';
    splash.appendChild(p);

    var ta = document.createElement('textarea');
    ta.readOnly = true;
    ta.value = text;
    ta.setAttribute('style',
      'width:100%;min-height:16rem;background:#1a1a19;color:#e8e8e4;' +
      'border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:.6rem;' +
      'font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre');
    splash.appendChild(ta);

    var btn = document.createElement('button');
    btn.textContent = 'Select all (then copy)';
    btn.setAttribute('style',
      'margin-top:.7rem;padding:.5rem .85rem;border-radius:8px;cursor:pointer;' +
      'border:1px solid rgba(255,255,255,.2);background:#2a78d6;color:#fff;' +
      'font:inherit;font-weight:600');
    btn.addEventListener('click', function () {
      ta.focus();
      ta.select();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(function () { /* manual copy */ });
      }
    });
    splash.appendChild(btn);

    try { console.error(text); } catch (e) { /* ignore */ }
  }

  function boot() {
    // If nothing has settled in 30s, stop pretending and explain why.
    watchdog = setTimeout(function () {
      report('Startup timed out', 'still at stage "' + BOOT.stage + '" after 30 seconds');
    }, 30000);

    buildChrome();
    initTheme();

    stage('store-init');
    Store.init()
      .then(function () { stage('store-load'); return Store.load(); })
      .then(function (bytes) { stage('db-open'); return DB.open(bytes); })
      .then(function () {
        stage('render');
        clearTimeout(watchdog);
        state.resetBounds();

        // migrate() may have swept out legacy zero-value rows; write the
        // cleaned database back so the fix is durable rather than re-run
        // from scratch on every boot.
        App.persist();

        var hash = (location.hash || '').replace('#', '');
        if (TABS.some(function (t) { return t.id === hash; })) active = hash;
        else if (!DB.counts().reservations) active = 'import';
        else active = 'reservations';

        var splash = U.$('#splash');
        if (splash) splash.remove();
        var modeEl = U.$('#storage-mode');
        if (modeEl) modeEl.textContent = Store.describe();
        render();

        if (Store.mode === 'memory') {
          U.toast('Browser storage is unavailable — export a backup before you close this tab', true);
        }
      })
      .catch(function (e) {
        clearTimeout(watchdog);
        report('Could not start', String((e && e.message) || e));
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window.App);
