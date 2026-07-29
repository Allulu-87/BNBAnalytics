/* BNB Analytics — the per-booking payments, analysed on their own.
   Watchman profit, tips, water bottles and fruits, broken down by day, month
   or year, with paid vs. still-owed alongside. */
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
    return { watchman: c.s1, tips: c.s2, water: c.s3, fruits: c.s4 };
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

  function controls(rerender) {
    var row = U.el('div', { class: 'filterbar', role: 'group', 'aria-label': 'Breakdown options' });

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

    row.appendChild(U.el('div', { class: 'field', style: 'flex:1 1 240px' }, [
      U.el('label', { text: 'Group' }), granBox
    ]));
    row.appendChild(U.el('div', { class: 'field wide' }, [
      U.el('label', { text: 'Count each payment on' }), basisSel
    ]));
    return row;
  }

  App.Views.charges = function (root) {
    U.clear(root);
    // go through render() so the scroll position survives the rebuild
    var rerender = App.refresh;
    var f = App.state.filter();
    var col = kindColors();
    var draws = [];

    root.appendChild(controls(rerender));

    var sum = An.chargeSummary(f, basis);

    if (!sum.total.n) {
      root.appendChild(U.el('div', { class: 'card' }, [
        U.el('div', { class: 'empty' }, [
          U.el('div', { html: '<strong>No per-booking payments in this period.</strong>' }),
          U.el('p', {
            class: 'small muted',
            text: basis === 'date_paid'
              ? 'Nothing has been marked as paid yet — switch to "When the booking happened" to include unpaid charges.'
              : 'Open a booking on the Reservations tab to record the watchman, tips, water and fruit costs.'
          })
        ])
      ]));
      return;
    }

    /* ── tiles ──────────────────────────────────────────────────────────── */

    var kpi = U.el('div', { class: 'kpi-grid' });
    kpi.appendChild(tile('Total per-booking payments', U.fmtMoneyTile(sum.total.amount),
      sum.total.n + ' charges · ' + U.fmtMoney(sum.total.perNight, 3) + ' per night',
      { hero: true }));
    sum.kinds.forEach(function (k) {
      kpi.appendChild(tile(k.label, U.fmtMoneyTile(k.amount),
        k.n
          ? k.n + ' entries · ' + U.fmtMoney(k.unpaid, 2) + ' unpaid'
          : 'nothing recorded',
        { color: col[k.key] }));
    });
    kpi.appendChild(tile('Still to pay', U.fmtMoneyTile(sum.total.unpaid),
      U.fmtMoney(sum.total.paid, 2) + ' paid and deducted',
      { neg: sum.total.unpaid > 0 }));
    root.appendChild(kpi);

    root.appendChild(U.el('p', { class: 'small muted', style: 'margin:-.35rem 0 1rem' }, [
      'Totals here are everything recorded. Only the paid portion is deducted from ' +
      'profit on the Dashboard — the rest stays pending.'
    ]));

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
        U.el('h2', { text: 'Per-booking payments over time' }),
        U.el('p', {
          text: 'Stacked by charge type, ' + gran + ' by ' + gran + ', in ' + U.currency +
            ' · ' + An.CHARGE_BASES[basis].toLowerCase() + '.'
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
          U.el('h2', { text: 'Full breakdown' }),
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
        U.el('h2', { text: 'By charge type' }),
        U.el('p', { text: 'Share of the per-booking total, and what is still owed.' })
      ])
    ]));
    kindCard.appendChild(Charts.table(
      ['Charge', 'Bookings', 'Entries', 'Amount', 'Share', 'Paid', 'Unpaid'],
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
