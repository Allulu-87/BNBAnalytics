/* BNB Analytics — dashboard: totals, monthly/yearly analysis, cost mix.
   Filters live in one row above everything they scope (see app.js), never
   inside a chart card. Every chart ships a table-view twin. */
window.App = window.App || {};
window.App.Views = window.App.Views || {};

(function (App) {
  'use strict';

  var U = App.U, DB = App.DB, An = App.An, Charts = App.Charts;

  var viewMode = { monthly: 'chart', costs: 'chart' };

  function tile(label, value, foot, opts) {
    var o = opts || {};
    var kids = [U.el('div', { class: 'label', text: label })];
    var val = U.el('div', { class: 'value' + (o.neg ? ' money-neg' : '') });
    if (o.currency !== false) val.appendChild(U.el('span', { class: 'cur', text: U.currency }));
    val.appendChild(document.createTextNode(value));
    kids.push(val);
    if (o.delta) kids.push(U.el('div', { class: 'foot' }, [o.delta]));
    if (foot) kids.push(U.el('div', { class: 'foot', text: foot }));
    return U.el('div', { class: 'tile' + (o.hero ? ' tile-hero' : '') }, kids);
  }

  function deltaBadge(now, prev) {
    if (prev == null || !isFinite(prev) || prev === 0) return null;
    var pct = ((now - prev) / Math.abs(prev)) * 100;
    var up = pct >= 0;
    return U.el('span', { class: 'delta ' + (up ? 'up' : 'down') }, [
      (up ? '▲ ' : '▼ ') + U.fmtNum(Math.abs(pct), 1) + '% vs previous period'
    ]);
  }

  /** Segmented Chart / Table switch — the table view is the required relief
      for the light-mode aqua series and the WCAG-clean twin of every chart. */
  function toggle(key, onChange) {
    var wrap = U.el('div', { class: 'row', role: 'group', 'aria-label': 'View as' });
    [['chart', 'Chart'], ['table', 'Table']].forEach(function (pair) {
      wrap.appendChild(U.el('button', {
        class: 'chip', type: 'button',
        'aria-pressed': viewMode[key] === pair[0] ? 'true' : 'false',
        onclick: function () { viewMode[key] = pair[0]; onChange(); }
      }, [pair[1]]));
    });
    return wrap;
  }

  App.Views.dashboard = function (root) {
    var f = App.state.filter();
    U.clear(root);

    /* Charts need real layout to measure against, but rAF is throttled in a
       background tab and never fires — so queue the draws and run them
       synchronously once the whole view is in the document. */
    var draws = [];

    var counts = DB.counts();
    if (!counts.reservations && !counts.expenses) {
      root.appendChild(U.el('div', { class: 'card' }, [
        U.el('div', { class: 'empty' }, [
          U.el('div', { html: '<strong>Nothing to analyse yet.</strong>' }),
          U.el('p', { class: 'small muted', text: 'Import your Airbnb reservations.csv from the Import tab, then add your costs.' }),
          U.el('button', {
            class: 'btn btn-primary', style: 'margin-top:.6rem',
            onclick: function () { App.go('import'); }
          }, ['Go to Import'])
        ])
      ]));
      return;
    }

    var s = An.summary(f);
    var prevF = An.previousWindow(f);
    var prev = prevF ? An.summary(prevF) : null;
    var col = Charts.colors();

    /* ── stat tiles ─────────────────────────────────────────────────────── */

    var kpi = U.el('div', { class: 'kpi-grid' });
    kpi.appendChild(tile('Net profit', U.fmtMoneyTile(s.net),
      U.fmtNum(s.margin * 100, 1) + '% margin · ' + U.fmtMoney(s.netPerNight, 2) + ' per night', {
        hero: true, neg: s.net < 0,
        delta: prev ? deltaBadge(s.net, prev.net) : null
      }));
    kpi.appendChild(tile('Earnings in bank', U.fmtMoneyTile(s.earnings),
      s.bookings + ' booking' + (s.bookings === 1 ? '' : 's') + ' · ' + s.nights + ' nights' +
      (s.cancelled ? ' · ' + s.cancelled + ' cancelled, excluded' : '')));
    kpi.appendChild(tile('Awaiting bank', U.fmtMoneyTile(s.awaiting),
      s.awaitingCount
        ? s.awaitingCount + ' payout' + (s.awaitingCount === 1 ? '' : 's') + ' not received yet'
        : 'Every payout has arrived',
      { neg: s.awaiting > 0 }));
    kpi.appendChild(tile('Per-booking paid', U.fmtMoneyTile(s.bookingCosts),
      s.unpaidBooking > 0.0005
        ? U.fmtMoney(s.unpaidBooking, 2) + ' more not deducted yet'
        : 'Watchman, water, fruits'));
    kpi.appendChild(tile('Bills paid', U.fmtMoneyTile(s.expenses),
      s.unpaidExpenses > 0.0005
        ? U.fmtMoney(s.unpaidExpenses, 2) + ' more not deducted yet'
        : s.expenseCount + ' entr' + (s.expenseCount === 1 ? 'y' : 'ies')));
    kpi.appendChild(tile('Pending — not deducted', U.fmtMoneyTile(s.pending),
      (s.pending > 0.0005 || s.awaiting > 0.0005)
        ? 'Net becomes ' + U.fmtMoney(s.netAfterPending, 2) + ' once all settles'
        : 'Everything recorded is paid',
      { neg: s.pending > 0 }));
    kpi.appendChild(tile('Avg earnings / night', U.fmtMoneyTile(s.perNight),
      'Booked value · avg booking ' + U.fmtMoney(s.avgBooking, 2)));
    root.appendChild(kpi);

    root.appendChild(U.el('p', { class: 'small muted', style: 'margin:-.35rem 0 1rem' }, [
      'Money counts when it actually moves: earnings enter the figures once the ' +
      'payout is marked received in the bank, and costs are deducted once marked ' +
      'processed. Everything else sits in “awaiting” or “pending”.'
    ]));

    /* ── monthly performance ────────────────────────────────────────────── */

    var months = An.monthly(f);
    var monthCard = U.el('div', { class: 'card' });
    var mHead = U.el('div', { class: 'card-head' }, [
      U.el('div', null, [
        U.el('h2', { text: 'Monthly performance' }),
        U.el('p', { text: 'Earnings, costs actually paid, and net profit by month, in ' + U.currency + '.' })
      ]),
      U.el('div', { class: 'spacer' }),
      toggle('monthly', App.refresh)
    ]);
    monthCard.appendChild(mHead);

    var mSeries = [
      { label: 'Earnings', color: col.s1, values: months.map(function (m) { return m.earnings; }) },
      { label: 'Costs paid', color: col.s2, values: months.map(function (m) { return m.costs; }) },
      { label: 'Net profit', color: col.s3, values: months.map(function (m) { return m.net; }) }
    ];

    if (viewMode.monthly === 'chart') {
      monthCard.appendChild(Charts.legend(mSeries));
      var mWrap = U.el('div', { class: 'chart-wrap' });
      monthCard.appendChild(mWrap);
      draws.push(function () {
        Charts.groupedColumns(mWrap, {
          labels: months.map(function (m) { return U.monthShort(m.k) + (m.k.slice(5) === '01' ? " '" + m.k.slice(2, 4) : ''); }),
          tipLabels: months.map(function (m) { return U.monthLabel(m.k); }),
          series: mSeries,
          ariaLabel: 'Monthly earnings, costs and net profit'
        });
      });
    } else {
      monthCard.appendChild(Charts.table(
        ['Month', 'Bookings', 'Nights', 'In bank', 'Awaiting', 'Booking paid', 'Bills paid',
          'Costs paid', 'Net profit', 'Pending'],
        months.map(function (m) {
          return [U.monthLabel(m.k), m.bookings, m.nights, U.fmtNum(m.earnings, 2),
            U.fmtNum(m.awaiting, 2), U.fmtNum(m.bookingCosts, 2), U.fmtNum(m.expenses, 2),
            U.fmtNum(m.costs, 2), U.fmtNum(m.net, 2), U.fmtNum(m.pending, 2)];
        }),
        ['Total',
          months.reduce(function (a, m) { return a + m.bookings; }, 0),
          months.reduce(function (a, m) { return a + m.nights; }, 0),
          U.fmtNum(s.earnings, 2), U.fmtNum(s.awaiting, 2),
          U.fmtNum(s.bookingCosts, 2), U.fmtNum(s.expenses, 2),
          U.fmtNum(s.totalCosts, 2), U.fmtNum(s.net, 2), U.fmtNum(s.pending, 2)]
      ));
    }
    root.appendChild(monthCard);

    /* ── cost mix + yearly ──────────────────────────────────────────────── */

    var grid = U.el('div', { class: 'grid-2' });

    var costs = An.costBreakdown(f);
    var costCard = U.el('div', { class: 'card' });
    costCard.appendChild(U.el('div', { class: 'card-head' }, [
      U.el('div', null, [
        U.el('h2', { text: 'Where the money goes' }),
        U.el('p', { text: 'Every cost line in this period, largest first — recorded amounts, paid or not.' })
      ]),
      U.el('div', { class: 'spacer' }),
      toggle('costs', App.refresh)
    ]));
    if (viewMode.costs === 'chart') {
      var cWrap = U.el('div', { class: 'chart-wrap' });
      costCard.appendChild(cWrap);
      draws.push(function () {
        Charts.rankedBars(cWrap, {
          items: costs.map(function (c) {
            return { label: c.label, value: c.value, sub: c.group + ' · ' + c.n + ' entries' };
          }),
          color: col.s1,
          ariaLabel: 'Cost breakdown by category'
        });
      });
    } else {
      costCard.appendChild(Charts.table(
        ['Cost', 'Type', 'Entries', 'Recorded', 'Paid', 'Pending'],
        costs.map(function (c) {
          return [c.label, c.group, c.n, U.fmtNum(c.value, 2), U.fmtNum(c.paid, 2), U.fmtNum(c.unpaid, 2)];
        }),
        ['Total', '', '', U.fmtNum(s.committed, 2), U.fmtNum(s.deducted, 2), U.fmtNum(s.pending, 2)]
      ));
    }
    grid.appendChild(costCard);

    var years = An.yearly(f);
    var yCard = U.el('div', { class: 'card' });
    yCard.appendChild(U.el('div', { class: 'card-head' }, [
      U.el('div', null, [
        U.el('h2', { text: 'Yearly summary' }),
        U.el('p', { text: 'Attributed by ' + App.state.basisLabel().toLowerCase() + '.' })
      ])
    ]));
    yCard.appendChild(Charts.table(
      ['Year', 'Bookings', 'Nights', 'Earnings', 'Costs paid', 'Net profit', 'Margin', 'Pending'],
      years.map(function (y) {
        return [y.k, y.bookings, y.nights, U.fmtNum(y.earnings, 2), U.fmtNum(y.costs, 2),
          U.fmtNum(y.net, 2), (y.earnings ? U.fmtNum(y.net / y.earnings * 100, 1) : '0.0') + '%',
          U.fmtNum(y.pending, 2)];
      }),
      ['All', s.bookings, s.nights, U.fmtNum(s.earnings, 2), U.fmtNum(s.totalCosts, 2),
        U.fmtNum(s.net, 2), U.fmtNum(s.margin * 100, 1) + '%', U.fmtNum(s.pending, 2)]
    ));
    grid.appendChild(yCard);
    root.appendChild(grid);

    /* ── per listing ────────────────────────────────────────────────────── */

    var listings = DB.listings();
    if (listings.length > 1) {
      var byL = An.byListing(f);
      var lCard = U.el('div', { class: 'card' });
      lCard.appendChild(U.el('div', { class: 'card-head' }, [
        U.el('div', null, [
          U.el('h2', { text: 'By listing' }),
          U.el('p', { text: 'Expenses not tied to a listing are shared overhead and counted in each row.' })
        ])
      ]));
      lCard.appendChild(Charts.table(
        ['Listing', 'Bookings', 'Nights', 'Earnings', 'Costs paid', 'Net profit', 'Margin', 'Pending'],
        byL.map(function (r) {
          return [r.name, r.s.bookings, r.s.nights, U.fmtNum(r.s.earnings, 2),
            U.fmtNum(r.s.totalCosts, 2), U.fmtNum(r.s.net, 2),
            U.fmtNum(r.s.margin * 100, 1) + '%', U.fmtNum(r.s.pending, 2)];
        })
      ));
      root.appendChild(lCard);
    }

    /* ── outstanding ────────────────────────────────────────────────────── */

    var due = An.outstanding(f);
    if (due.length) {
      var dCard = U.el('div', { class: 'card' });
      dCard.appendChild(U.el('div', { class: 'card-head' }, [
        U.el('div', null, [
          U.el('h2', { text: 'Not paid yet' }),
          U.el('p', {
            text: due.length + ' item' + (due.length === 1 ? '' : 's') + ' totalling ' +
              U.fmtMoney(s.pending, 2) + ' — none of it deducted from profit yet.'
          })
        ])
      ]));
      dCard.appendChild(Charts.table(
        ['Item', 'For', 'Listing', 'Date', 'Amount'],
        due.slice(0, 60).map(function (d) {
          return [d.what, d.who, d.listing, U.prettyDate(d.date), U.fmtNum(d.amount, 2)];
        }),
        due.length > 60 ? ['Showing 60 of ' + due.length, '', '', '', U.fmtNum(s.pending, 2)] : null
      ));
      root.appendChild(dCard);
    }

    /* ── payouts still in transit ──────────────────────────────────────── */

    var awaiting = An.awaitingPayouts(f);
    if (awaiting.length) {
      var aCard = U.el('div', { class: 'card' });
      aCard.appendChild(U.el('div', { class: 'card-head' }, [
        U.el('div', null, [
          U.el('h2', { text: 'Awaiting bank' }),
          U.el('p', {
            text: awaiting.length + ' payout' + (awaiting.length === 1 ? '' : 's') +
              ' totalling ' + U.fmtMoney(s.awaiting, 2) +
              ' — earned, but not in earnings or net profit until marked received.'
          })
        ])
      ]));
      aCard.appendChild(Charts.table(
        ['Guest', 'Code', 'Listing', 'Checked out', 'Amount'],
        awaiting.slice(0, 60).map(function (a) {
          return [a.guest_name || '—', a.confirmation_code, a.listing_name,
            U.prettyDate(a.end_date), U.fmtNum(a.amount, 2)];
        }),
        awaiting.length > 60
          ? ['Showing 60 of ' + awaiting.length, '', '', '', U.fmtNum(s.awaiting, 2)]
          : null
      ));
      root.appendChild(aCard);
    }

    /* ── per-booking payments, merged in from its own former tab ────────── */

    if (App.Views.chargesSection) App.Views.chargesSection(root);

    // everything is in the document now — safe to measure and draw
    draws.forEach(function (fn) { fn(); });
  };
})(window.App);
