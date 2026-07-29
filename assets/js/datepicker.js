/* BNB Analytics — date inputs, via flatpickr (vendored, MIT).
   Native <input type="date"> looks different in every browser and can't be
   themed; flatpickr gives one consistent, dark-mode-aware picker everywhere.

   Contract for callers, identical whether or not flatpickr actually loaded:
     • input.value is ALWAYS ISO yyyy-mm-dd (or '') — the rest of the app and
       the SQLite columns keep speaking ISO, the picker only changes display.
     • opts.onPick(iso, input) fires once per user change.
     • DP.set(input, iso) writes a date programmatically without firing onPick.

   Attachment is deferred: flatpickr inserts its alt input as a sibling of the
   original, so the original must already be in the document. Views build their
   DOM detached, so attach() queues and app.js calls mount() after appending. */
window.App = window.App || {};

(function (App) {
  'use strict';

  var U = App.U;
  var DP = { live: [] };
  var queue = [];

  var ALT_FORMAT = 'j M Y';   // "6 Aug 2026" — same shape as U.prettyDate

  /* On a touch screen a typable date field is actively harmful: tapping it
     raises the soft keyboard, which resizes the viewport, which moves the
     field out from under the calendar and drops focus. So on coarse pointers
     the field is read-only — tapping it opens the calendar and nothing else. */
  var COARSE = (function () {
    try {
      return (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
        ('ontouchstart' in window && !window.matchMedia('(pointer: fine)').matches);
    } catch (e) { return false; }
  })();

  DP.available = function () { return typeof window.flatpickr === 'function'; };

  /** Queue a picker for the next mount(). Returns the input for chaining. */
  DP.attach = function (input, opts) {
    queue.push([input, opts || {}]);
    return input;
  };

  /** Build every queued picker. Call once the view is in the document. */
  DP.mount = function () {
    var pending = queue;
    queue = [];
    pending.forEach(function (pair) {
      var input = pair[0];
      // the view may have been replaced before we got here
      if (!input || (input.isConnected === false)) return;
      try { build(input, pair[1]); }
      catch (e) { fallback(input, pair[1]); }
    });
  };

  /** Tear down live pickers before their DOM is discarded, so flatpickr does
      not leave orphaned calendars attached to <body>. */
  DP.destroyAll = function () {
    DP.live.forEach(function (fp) {
      try { fp.destroy(); } catch (e) { /* DOM already gone */ }
    });
    DP.live.length = 0;
  };

  /** Set a date without triggering onPick. Keeps the visible text in sync. */
  DP.set = function (input, iso) {
    if (!input) return;
    if (input._flatpickr) input._flatpickr.setDate(iso || null, false);
    else input.value = iso || '';
  };

  DP.get = function (input) { return (input && input.value) || ''; };

  /* ── internals ────────────────────────────────────────────────────────── */

  function fallback(input, opts) {
    // no flatpickr (or it threw) — fall back to the browser's own picker
    input.type = 'date';
    if (opts.onPick) {
      input.addEventListener('change', function () { opts.onPick(input.value || '', input); });
    }
  }

  function build(input, opts) {
    if (!DP.available()) return fallback(input, opts);
    if (input._flatpickr) return input._flatpickr;

    var fp = window.flatpickr(input, {
      dateFormat: 'Y-m-d',          // what lands in input.value, and in SQLite
      altInput: true,
      altFormat: ALT_FORMAT,        // what the user reads
      altInputClass: 'dp-input',
      allowInput: !COARSE,          // typing on desktop, tap-only on touch
      disableMobile: true,          // same picker on Android as on desktop
      monthSelectorType: 'dropdown',   // jump months when back-dating a bill
      minDate: opts.minDate || null,
      maxDate: opts.maxDate || null,
      defaultDate: input.value || null,
      onChange: function () {
        if (opts.onPick) opts.onPick(input.value || '', input);
      },
      onReady: function (sel, str, inst) { decorate(inst, input, opts); }
    });

    DP.live.push(fp);
    return fp;
  }

  function decorate(fp, input, opts) {
    // flatpickr builds a fresh alt input, so re-apply the accessible name
    if (fp.altInput) {
      var label = input.getAttribute('aria-label');
      if (label) fp.altInput.setAttribute('aria-label', label);
      fp.altInput.setAttribute('placeholder', opts.placeholder || 'Pick a date');
      if (input.getAttribute('title')) fp.altInput.setAttribute('title', input.getAttribute('title'));

      if (COARSE) {
        /* readOnly is what actually suppresses the soft keyboard; inputmode and
           the autocomplete/spellcheck hints stop keyboards that ignore it. */
        fp.altInput.readOnly = true;
        fp.altInput.setAttribute('inputmode', 'none');
        fp.altInput.setAttribute('autocomplete', 'off');
        fp.altInput.setAttribute('autocorrect', 'off');
        fp.altInput.setAttribute('spellcheck', 'false');
      }
    }

    // Today / Clear — without a Clear there is no way to un-set a date once
    // picked, which matters for the optional "date paid" fields.
    if (!fp.calendarContainer || fp.calendarContainer.querySelector('.dp-foot')) return;

    var foot = U.el('div', { class: 'dp-foot' }, [
      U.el('button', {
        type: 'button', class: 'dp-foot-btn',
        onclick: function () { fp.setDate(U.todayISO(), true); fp.close(); }
      }, ['Today']),
      U.el('button', {
        type: 'button', class: 'dp-foot-btn dp-foot-clear',
        onclick: function () { fp.clear(true); fp.close(); }
      }, ['Clear'])
    ]);
    fp.calendarContainer.appendChild(foot);
  }

  App.DP = DP;
})(window.App);
