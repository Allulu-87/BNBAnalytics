/* BNB Analytics — the per-booking payments, analysed on their own.
   Watchman profit, water bottles and fruits, broken down by day, month or year,
   with paid vs. still-owed alongside. Rendered as a Dashboard section. */
window.App = window.App || {};
window.App.Views = window.App.Views || {};

(function (App) {
  'use strict';

  var U = App.U, DB = App.DB, An = App.An, Charts = App.Charts;

  var gran = 'month';          // day | month | year
  var basis = 'accrual';       // accrual | date_paid
  var mode = 'chart';          // chart | table

  var GRANS = [
    ['day', 'By day'],
    ['month', 'By month'],
    ['year', 'By year']
  ];

  /** Charge kind → categorical slot. Fixed: the colour follows the kind, never
      its rank, so filtering never repaints the survivors. */
  function kindColors() {
    var c = Charts.colors();
    return { watchman: c.s1, water: c.s2, fruits: c.s3 };
  }

  function tile(label, value, foot, opts) {
    var o = opts || {};
    var kids = [U.el('div', { class: 'label' }, [
      o.color ? U.el('span', {
        class: 'legend-swatch',
        style: 'background:' + o.color + ';display:inline-block;margin-inline-end:.35rem'
      }) : null,
      label
    ])];
    var val = U.el('div', { class: 'value' + (o.neg ? ' money-neg' : '') });
    val.appendChild(U.el('span', { class: 'cur', text: U.currency }));
    val.appendChild(document.createTextNode(value));
    kids.push(val);
    if (foot) kids.push(U.el('div', { class: 'foot', text: foot }));
    return U.el('div', { class: 'tile' + (o.hero ? ' tile-hero' : '') }, kids);
  }

  /** Compact control row for the section head — not a page-level filter bar. */
  function controls(rerender) {
    var granBox = U.el('div', { class: 'presets' });
    GRANS.forEach(function (g) {
      granBox.appendChild(U.el('button', {
        class: 'chip', type: 'button',
        'aria-pressed': gran === g[0] ? 'true' : 'false',
        onclick: function () { gran = g[0]; rerender(); }
      }, [g[1]]));
    });

    var basisSel = U.el('select', {
      'aria-label': 'Date each payment counts on',
      onchange: function () { basis = this.value; rerender(); }
    }, Object.keys(An.CHARGE_BASES).map(function (k) {
      return U.el('option', { value: k, text: An.CHARGE_BASES[k], selected: basis === k });
    }));

    return U.el('div', {
      class: 'row', style: 'gap:.5rem', role: 'group', 'aria-label': 'Breakdown options'
    }, [
      granBox,
      U.el('div', { style: 'flex:0 1 200px;min-width:150px' }, [basisSel])
    ]);
  }

  /**
   * The per-booking payments analysis, appended to whatever container it is
   * given. It is a section of the Dashboard rather than a tab of its own, so it
   * does NOT clear `root` — the dashboard owns that.
   */
  App.Views.chargesSection = function (root) {
    // go through render() so the scroll position survives the rebuild
    var rerender = App.refresh;
    var f = App.state.filter();
    var col = kindColors();
    var draws = [];

    var sum = An.chargeSummary(f, basis);

    root.appendChild(U.el('div', { class: 'section-head' }, [
      U.el('h2', { text: 'Per-booking payments' }),
      U.el('p', {
        text: 'Watchman, water and fruits on their own. Everything recorded is ' +
          'counted here; only the paid part is deducted from the profit above.'
      })
    ]));

    if (!sum.total.n) {
      root.appendChild(U.el('div', { class: 'card' }, [
        U.el('div', { class: 'empty' }, [
          U.el('div', { html: '<strong>No per-booking payments in this period.</strong>' }),
          U.el('p', {
            class: 'small muted',
            text: basis === 'date_paid'
              ? 'Nothing is marked as paid yet — set the basis to "When the booking happened" to include unpaid charges.'
              : 'Open a booking on the Reservations tab to record the watchman, water and fruit costs.'
          })
        ])
      ]));
      return;
    }

    /* ── over time ─────────────────────────────────────────────────────── */

    var pv = An.chargePeriods(f, gran, basis);
    var series = sum.kinds
      .filter(function (k) { return k.amount > 0; })
      .map(function (k) {
        return {
          label: k.label, color: col[k.key], key: k.key,
          values: pv.rows.map(function (r) { return r[k.key] || 0; })
        };
      });

    var card = U.el('div', { class: 'card' });
    card.appendChild(U.el('div', { class: 'card-head' }, [
      U.el('div', null, [
        U.el('h3', { text: 'Over time' }),
        U.el('p', {
          text: 'Stacked by charge type, in ' + U.currency + ' · ' +
            An.CHARGE_BASES[basis].toLowerCase() + '.'
        })
      ]),
      U.el('div', { class: 'spacer' }),
      U.el('div', { class: 'row', role: 'group', 'aria-label': 'View as' },
        [['chart', 'Chart'], ['table', 'Table']].map(function (p) {
          return U.el('button', {
            class: 'chip', type: 'button',
            'aria-pressed': mode === p[0] ? 'true' : 'false',
            onclick: function () { mode = p[0]; rerender(); }
          }, [p[1]]);
        }))
    ]));
    // grouping + basis belong to this section, so they sit in its own head
    card.appendChild(U.el('div', { style: 'margin:-.35rem 0 .8rem' }, [controls(rerender)]));

    if (mode === 'chart' && series.length) {
      card.appendChild(Charts.legend(series));
      var wrap = U.el('div', { class: 'chart-wrap' });
      card.appendChild(wrap);
      draws.push(function () {
        Charts.stackedColumns(wrap, {
          labels: pv.rows.map(function (r) { return An.periodLabel(r.k, gran, true); }),
          tipLabels: pv.rows.map(function (r) { return An.periodLabel(r.k, gran, false); }),
          series: series,
          ariaLabel: 'Per-booking payments by ' + gran
        });
      });
    } else {
      card.appendChild(periodTable(pv, sum));
    }
    root.appendChild(card);

    /* ── the full ledger table (always present, chart or not) ──────────── */

    if (mode === 'chart') {
      var detail = U.el('div', { class: 'card' });
      detail.appendChild(U.el('div', { class: 'card-head' }, [
        U.el('div', null, [
          U.el('h3', { text: 'Full breakdown' }),
          U.el('p', { text: 'Every period with a payment, and what it was made of.' })
        ])
      ]));
      detail.appendChild(periodTable(pv, sum));
      root.appendChild(detail);
    }

    /* ── by charge type ────────────────────────────────────────────────── */

    var kindCard = U.el('div', { class: 'card' });
    kindCard.appendChild(U.el('div', { class: 'card-head' }, [
      U.el('div', null, [
        U.el('h3', { text: 'By charge type' }),
        U.el('p', { text: 'Share of the per-booking total, and what is still owed.' })
      ])
    ]));
    kindCard.appendChild(Charts.table(
      ['Charge', 'Bookings', 'Entries', 'Amount', 'Share', 'Paid', 'Pending'],
      sum.kinds.map(function (k) {
        return [k.label, k.bookings, k.n, U.fmtNum(k.amount, 2),
          (sum.total.amount ? U.fmtNum(k.amount / sum.total.amount * 100, 1) : '0.0') + '%',
          U.fmtNum(k.paid, 2), U.fmtNum(k.unpaid, 2)];
      }),
      ['Total', '', sum.total.n, U.fmtNum(sum.total.amount, 2), '100.0%',
        U.fmtNum(sum.total.paid, 2), U.fmtNum(sum.total.unpaid, 2)]
    ));
    root.appendChild(kindCard);

    draws.forEach(function (fn) { fn(); });
  };

  /** Period × kind table — the WCAG-clean twin of the stacked chart. */
  function periodTable(pv, sum) {
    var kinds = pv.kinds;
    var head = ['Period'].concat(kinds.map(function (k) { return k.label; }))
      .concat(['Entries', 'Total', 'Paid', 'Unpaid']);

    var rows = pv.rows.map(function (r) {
      return [An.periodLabel(r.k, gran, false)]
        .concat(kinds.map(function (k) { return r[k.key] ? U.fmtNum(r[k.key], 2) : '—'; }))
        .concat([r.n, U.fmtNum(r.total, 2), U.fmtNum(r.paid, 2), U.fmtNum(r.unpaid, 2)]);
    });

    var foot = ['Total']
      .concat(kinds.map(function (k) {
        var kk = sum.kinds.filter(function (x) { return x.key === k.key; })[0];
        return kk && kk.amount ? U.fmtNum(kk.amount, 2) : '—';
      }))
      .concat([sum.total.n, U.fmtNum(sum.total.amount, 2),
        U.fmtNum(sum.total.paid, 2), U.fmtNum(sum.total.unpaid, 2)]);

    return Charts.table(head, rows, foot);
  }
})(window.App);
