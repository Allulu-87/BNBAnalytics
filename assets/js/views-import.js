/* BNB Analytics — CSV import.
   Two steps on purpose: analyse and show exactly what will happen, then
   commit. Re-importing a file you already loaded is safe — matching rows are
   reported as already-imported and skipped. */
window.App = window.App || {};
window.App.Views = window.App.Views || {};

(function (App) {
  'use strict';

  var U = App.U, DB = App.DB, CSV = App.CSV;

  var pending = null;      // result of CSV.analyse
  var fileName = '';

  function box(n, t) {
    return U.el('div', { class: 'box' }, [
      U.el('div', { class: 'n', text: String(n) }),
      U.el('div', { class: 't', text: t })
    ]);
  }

  function handleFile(file) {
    fileName = file.name;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        pending = CSV.analyse(String(reader.result));
      } catch (e) {
        pending = { ok: false, error: 'Could not read that file: ' + e.message, newRows: [], dupes: [], bad: [] };
      }
      App.refresh();
    };
    reader.onerror = function () {
      U.toast('Could not read that file', true);
    };
    reader.readAsText(file, 'utf-8');
  }

  App.Views['import'] = function (root) {
    U.clear(root);

    var rate = U.parseNum(DB.getSetting('watchman_rate'));

    /* ── step 1: choose a file ──────────────────────────────────────────── */

    var input = U.el('input', {
      type: 'file', accept: '.csv,text/csv,text/plain', style: 'display:none',
      onchange: function () { if (this.files && this.files[0]) handleFile(this.files[0]); }
    });

    var zone = U.el('div', {
      class: 'dropzone', tabindex: 0, role: 'button',
      'aria-label': 'Choose a reservations CSV file',
      onclick: function () { input.click(); },
      onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } },
      ondragover: function (e) { e.preventDefault(); this.classList.add('over'); },
      ondragleave: function () { this.classList.remove('over'); },
      ondrop: function (e) {
        e.preventDefault(); this.classList.remove('over');
        if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
      }
    }, [
      U.el('strong', { text: 'Drop reservations.csv here, or tap to choose' }),
      U.el('span', { text: 'Airbnb → Reservations → Export. New bookings are added, changed ones are updated.' })
    ]);

    var card = U.el('div', { class: 'card' });
    card.appendChild(U.el('div', { class: 'card-head' }, [
      U.el('div', null, [
        U.el('h2', { text: 'Import reservations' }),
        U.el('p', {
          text: 'Matched on listing + confirmation code. A booking whose Airbnb ' +
            'details changed is overwritten; your payment entries for it are kept.'
        })
      ])
    ]));
    card.appendChild(zone);
    card.appendChild(input);
    root.appendChild(card);

    if (!pending) {
      var counts = DB.counts();
      if (counts.reservations) {
        root.appendChild(U.el('div', { class: 'card' }, [
          U.el('div', { class: 'card-head' }, [
            U.el('div', null, [U.el('h3', { text: 'Already on file' })])
          ]),
          U.el('p', { class: 'small muted', style: 'margin:0' }, [
            counts.reservations + ' reservations across ' + counts.listings + ' listing' +
            (counts.listings === 1 ? '' : 's') + ' · ' + counts.charges +
            ' per-booking charges · ' + counts.expenses + ' expenses.'
          ])
        ]));
      }
      return;
    }

    /* ── step 2: review ─────────────────────────────────────────────────── */

    var review = U.el('div', { class: 'card' });
    review.appendChild(U.el('div', { class: 'card-head' }, [
      U.el('div', null, [
        U.el('h2', { text: 'Review: ' + fileName }),
        U.el('p', { text: pending.ok ? 'Nothing has been saved yet.' : 'This file could not be used.' })
      ]),
      U.el('div', { class: 'spacer' }),
      U.el('button', {
        class: 'btn', type: 'button',
        onclick: function () { pending = null; App.refresh(); }
      }, ['Choose another file'])
    ]));

    if (!pending.ok) {
      review.appendChild(U.el('div', { class: 'notice bad' }, [
        U.el('strong', { text: 'Import failed' }),
        pending.error
      ]));
      root.appendChild(review);
      return;
    }

    var changed = pending.changedRows || [];

    var sum = U.el('div', { class: 'import-summary' }, [
      box(pending.total, 'rows in file'),
      box(pending.newRows.length, 'new to import'),
      box(changed.length, 'changed — will update'),
      box(pending.dupes.length, 'unchanged'),
      box(pending.bad.length, 'unreadable')
    ]);
    review.appendChild(sum);

    review.appendChild(U.el('div', { class: 'notice' }, [
      U.el('strong', { text: 'Dates read as ' + (pending.dayFirst ? 'day/month/year' : 'month/day/year') }),
      'Detected from the file itself. ' +
      (rate > 0
        ? 'Each new booking gets a watchman charge of ' + U.fmtNum(rate, 3) + ' × nights, marked not-paid — edit any of them on the Reservations tab.'
        : 'The watchman rate is 0, so no charge will be seeded. Set it on the Data tab.')
    ]));

    if (pending.newRows.length) {
      var t = U.el('table', { class: 'data' });
      t.appendChild(U.el('thead', null, [
        U.el('tr', null, ['Code', 'Listing', 'Guest', 'Check-in', 'Check-out', 'Nights', 'Status', 'Earnings', 'Watchman'].map(function (h, i) {
          return U.el('th', { class: (i >= 5 && i !== 6 ? 'num' : ''), text: h });
        }))
      ]));
      var tb = U.el('tbody');
      pending.newRows.forEach(function (r) {
        tb.appendChild(U.el('tr', null, [
          U.el('td', null, [U.el('span', { class: 'mono small', text: r.confirmation_code })]),
          U.el('td', { class: 'wrap', text: r.listing_name }),
          U.el('td', { class: 'wrap', dir: 'auto', text: r.guest_name || '—' }),
          U.el('td', { text: U.prettyDate(r.start_date) }),
          U.el('td', { text: U.prettyDate(r.end_date) }),
          U.el('td', { class: 'num', text: r.nights }),
          U.el('td', { text: r.status || '—' }),
          U.el('td', { class: 'num', text: U.fmtNum(r.earnings, 2) }),
          U.el('td', { class: 'num', text: U.fmtNum(rate * r.nights, 2) })
        ]));
      });
      t.appendChild(tb);
      review.appendChild(U.el('h3', { style: 'margin:.9rem 0 .4rem', text: 'Will be imported' }));
      review.appendChild(U.el('div', { class: 'table-scroll' }, [t]));
    } else if (!changed.length) {
      review.appendChild(U.el('div', { class: 'notice warn' }, [
        U.el('strong', { text: 'Nothing new or changed in this file' }),
        'Every reservation in it is already on file and identical. No changes will be made.'
      ]));
    }

    /* ── what will be overwritten ───────────────────────────────────────── */

    if (changed.length) {
      review.appendChild(U.el('h3', { style: 'margin:.9rem 0 .4rem', text: 'Will be updated' }));
      review.appendChild(U.el('p', { class: 'small muted', style: 'margin:0 0 .5rem' }, [
        'Only the fields below are overwritten. Your watchman, tips, water and ' +
        'fruit entries for these bookings are not touched.'
      ]));

      var ct = U.el('table', { class: 'data' });
      ct.appendChild(U.el('thead', null, [
        U.el('tr', null, ['Code', 'Guest', 'Field', 'Currently', 'Becomes'].map(function (h) {
          return U.el('th', { text: h });
        }))
      ]));
      var ctb = U.el('tbody');
      changed.forEach(function (r) {
        r.changes.forEach(function (c, i) {
          ctb.appendChild(U.el('tr', null, [
            U.el('td', null, [i === 0
              ? U.el('span', { class: 'mono small', text: r.confirmation_code })
              : U.el('span', { class: 'muted small', text: '↳' })]),
            U.el('td', { class: 'wrap', dir: 'auto', text: i === 0 ? (r.guest_name || '—') : '' }),
            U.el('td', { text: c.label }),
            U.el('td', { class: 'muted', text: String(c.from) }),
            U.el('td', null, [U.el('strong', { text: String(c.to) })])
          ]));
        });
      });
      ct.appendChild(ctb);
      review.appendChild(U.el('div', { class: 'table-scroll' }, [ct]));

      // a changed night count invalidates the watchman figure, which is the
      // user's own input — flag it rather than silently rewriting it
      var nightsMoved = changed.filter(function (r) {
        return r.changes.some(function (c) { return c.key === 'nights'; });
      });
      if (nightsMoved.length) {
        review.appendChild(U.el('div', { class: 'notice warn', style: 'margin-top:.7rem' }, [
          U.el('strong', { text: 'Check the watchman amount on ' + nightsMoved.length + ' booking(s)' }),
          'The night count changed on ' +
          nightsMoved.map(function (r) { return r.confirmation_code; }).join(', ') +
          ', so the watchman charge you entered may no longer match. It is left ' +
          'exactly as you set it — open the booking and use its "use" link if you want the new figure.'
        ]));
      }

      var cancelled = changed.filter(function (r) {
        return r.changes.some(function (c) {
          return c.key === 'status' && /cancel/i.test(String(c.to));
        });
      });
      if (cancelled.length) {
        // clearing entered payments is destructive, so say exactly what goes
        var load = cancelled.reduce(function (a, r) {
          var l = DB.cancelledChargeLoad(r.id);
          a.n += l.n; a.total += l.total; a.paid += l.paid;
          return a;
        }, { n: 0, total: 0, paid: 0 });

        var msg = 'Their earnings and nights stop counting towards total earnings, ' +
          'net profit and nights sold, and they become view-only.';
        if (load.n) {
          msg += ' ' + load.n + ' payment entr' + (load.n === 1 ? 'y' : 'ies') +
            ' totalling ' + U.fmtMoney(load.total, 3) +
            (load.paid > 0.0005 ? ' (' + U.fmtMoney(load.paid, 3) + ' of it marked paid)' : '') +
            ' will be REMOVED from them. Download a backup first if you want to keep that record.';
        }

        review.appendChild(U.el('div', {
          class: 'notice ' + (load.n ? 'bad' : ''), style: 'margin-top:.7rem'
        }, [
          U.el('strong', { text: cancelled.length + ' booking(s) became cancelled' }),
          msg
        ]));
      }
    }

    if (pending.bad.length) {
      review.appendChild(U.el('h3', { style: 'margin:.9rem 0 .4rem', text: 'Skipped — could not read' }));
      var bt = U.el('table', { class: 'data' });
      bt.appendChild(U.el('thead', null, [U.el('tr', null, ['Line', 'Reason', 'Row'].map(function (h) {
        return U.el('th', { text: h });
      }))]));
      var bb = U.el('tbody');
      pending.bad.slice(0, 30).forEach(function (b) {
        bb.appendChild(U.el('tr', null, [
          U.el('td', { text: b.line }),
          U.el('td', { text: b.why }),
          U.el('td', { class: 'wrap small muted', text: String(b.raw).slice(0, 90) })
        ]));
      });
      bt.appendChild(bb);
      review.appendChild(U.el('div', { class: 'table-scroll' }, [bt]));
    }

    if (pending.dupes.length) {
      var shown = pending.dupes.slice(0, 12).map(function (d) { return d.code; }).join(', ');
      review.appendChild(U.el('p', { class: 'small muted', style: 'margin-top:.8rem' }, [
        'Already on file and unchanged: ' + shown +
        (pending.dupes.length > 12 ? ' and ' + (pending.dupes.length - 12) + ' more.' : '.')
      ]));
    }

    var actionBits = [];
    if (pending.newRows.length) actionBits.push('Import ' + pending.newRows.length + ' new');
    if (changed.length) actionBits.push('update ' + changed.length);

    review.appendChild(U.el('div', { class: 'row', style: 'margin-top:1rem' }, [
      U.el('button', {
        class: 'btn btn-primary', type: 'button',
        disabled: !(pending.newRows.length || changed.length),
        onclick: function () {
          try {
            var res = CSV.commit(pending.newRows, changed);
            App.persist();
            var parts = [];
            if (res.inserted) parts.push('imported ' + res.inserted);
            if (res.updated) parts.push('updated ' + res.updated);
            if (res.purged) parts.push('cleared ' + res.purged + ' cancelled charge' + (res.purged === 1 ? '' : 's'));
            U.toast(parts.length ? parts.join(', ') : 'Nothing to change');
            pending = null;
            App.go('reservations');
          } catch (e) {
            U.toast('Import failed: ' + e.message, true);
          }
        }
      }, [actionBits.length ? actionBits.join(' · ') : 'Nothing to do']),
      U.el('button', {
        class: 'btn', type: 'button',
        onclick: function () { pending = null; App.refresh(); }
      }, ['Cancel'])
    ]));

    root.appendChild(review);
  };
})(window.App);
