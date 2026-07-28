/* BNB Analytics — the numbers.
   Revenue is attributed on a configurable basis (check-in by default);
   per-booking charges follow their reservation, anytime expenses follow
   their own date. Expenses left unassigned to a listing are shared, so they
   count in every per-listing view. */
window.App = window.App || {};

(function (App) {
  'use strict';

  var U = App.U, DB = App.DB;
  var An = {};

  /* ── where-clause builders ────────────────────────────────────────────── */

  function resWhere(f, prefix) {
    var p = prefix || '';
    var w = [], v = [];
    var col = p + (f.basis || 'start_date');
    if (f.from) { w.push(col + ' >= ?'); v.push(f.from); }
    if (f.to) { w.push(col + ' <= ?'); v.push(f.to); }
    if (f.listingId) { w.push(p + 'listing_id = ?'); v.push(f.listingId); }
    return { sql: w.length ? ' WHERE ' + w.join(' AND ') : '', params: v };
  }

  function expWhere(f) {
    var w = [], v = [];
    if (f.from) { w.push('expense_date >= ?'); v.push(f.from); }
    if (f.to) { w.push('expense_date <= ?'); v.push(f.to); }
    // unassigned expenses are shared overhead — always included
    if (f.listingId) { w.push('(listing_id = ? OR listing_id IS NULL)'); v.push(f.listingId); }
    return { sql: w.length ? ' WHERE ' + w.join(' AND ') : '', params: v };
  }

  /* ── headline totals ──────────────────────────────────────────────────── */

  An.summary = function (f) {
    var rw = resWhere(f);
    var r = DB.one(
      'SELECT COUNT(*) AS bookings, IFNULL(SUM(earnings),0) AS earnings,' +
      ' IFNULL(SUM(nights),0) AS nights, IFNULL(SUM(cost_total),0) AS bookingCosts,' +
      ' IFNULL(SUM(cost_unpaid),0) AS bookingUnpaid' +
      ' FROM v_reservations' + rw.sql, rw.params) || {};

    var ew = expWhere(f);
    var e = DB.one(
      'SELECT IFNULL(SUM(amount),0) AS total,' +
      ' IFNULL(SUM(CASE WHEN is_paid = 0 THEN amount ELSE 0 END),0) AS unpaid,' +
      ' COUNT(*) AS n FROM expenses' + ew.sql, ew.params) || {};

    var earnings = r.earnings || 0;
    var bookingCosts = r.bookingCosts || 0;
    var expenses = e.total || 0;
    var totalCosts = bookingCosts + expenses;

    return {
      bookings: r.bookings || 0,
      nights: r.nights || 0,
      earnings: earnings,
      bookingCosts: bookingCosts,
      expenses: expenses,
      expenseCount: e.n || 0,
      totalCosts: totalCosts,
      net: earnings - totalCosts,
      unpaid: (r.bookingUnpaid || 0) + (e.unpaid || 0),
      unpaidBooking: r.bookingUnpaid || 0,
      unpaidExpenses: e.unpaid || 0,
      margin: earnings ? (earnings - totalCosts) / earnings : 0,
      perNight: r.nights ? earnings / r.nights : 0,
      netPerNight: r.nights ? (earnings - totalCosts) / r.nights : 0,
      avgBooking: r.bookings ? earnings / r.bookings : 0
    };
  };

  /* ── monthly / yearly series ──────────────────────────────────────────── */

  function bucket(f, len) {
    var rw = resWhere(f);
    var res = DB.all(
      'SELECT substr(' + (f.basis || 'start_date') + ',1,' + len + ') AS k,' +
      ' IFNULL(SUM(earnings),0) AS earnings, IFNULL(SUM(cost_total),0) AS bookingCosts,' +
      ' IFNULL(SUM(nights),0) AS nights, COUNT(*) AS bookings' +
      ' FROM v_reservations' + rw.sql +
      ' GROUP BY k HAVING k IS NOT NULL', rw.params);

    var ew = expWhere(f);
    var exp = DB.all(
      'SELECT substr(expense_date,1,' + len + ') AS k, IFNULL(SUM(amount),0) AS expenses' +
      ' FROM expenses' + ew.sql + ' GROUP BY k HAVING k IS NOT NULL', ew.params);

    var by = {};
    function slot(k) {
      if (!by[k]) by[k] = { k: k, earnings: 0, bookingCosts: 0, expenses: 0, nights: 0, bookings: 0 };
      return by[k];
    }
    res.forEach(function (r) {
      var s = slot(r.k);
      s.earnings = r.earnings; s.bookingCosts = r.bookingCosts;
      s.nights = r.nights; s.bookings = r.bookings;
    });
    exp.forEach(function (r) { slot(r.k).expenses = r.expenses; });

    Object.keys(by).forEach(function (k) {
      var s = by[k];
      s.costs = s.bookingCosts + s.expenses;
      s.net = s.earnings - s.costs;
    });
    return by;
  }

  /** Monthly rows across the filter window, gap-filled so the axis is continuous. */
  An.monthly = function (f) {
    var by = bucket(f, 7);
    var keys = Object.keys(by).sort();
    var from = f.from, to = f.to;
    if (!from || !to) {
      if (!keys.length) return [];
      from = (from || keys[0] + '-01');
      to = (to || keys[keys.length - 1] + '-28');
    }
    var months = U.monthsBetween(from.slice(0, 7) + '-01', to.slice(0, 7) + '-28');
    if (!months.length) months = keys;
    return months.map(function (m) {
      return by[m] || { k: m, earnings: 0, bookingCosts: 0, expenses: 0, costs: 0, net: 0, nights: 0, bookings: 0 };
    });
  };

  An.yearly = function (f) {
    var by = bucket(f, 4);
    return Object.keys(by).sort().map(function (k) { return by[k]; });
  };

  /* ── cost composition ─────────────────────────────────────────────────── */

  /** Every cost line in the window, per-booking charges and expenses alike. */
  An.costBreakdown = function (f) {
    var out = [];
    var kindLabel = {};
    DB.CHARGE_KINDS.forEach(function (k) { kindLabel[k.key] = k.label; });

    var rw = resWhere(f, 'r.');
    DB.all(
      'SELECT bc.kind AS k, SUM(bc.amount) AS amt,' +
      ' SUM(CASE WHEN bc.is_paid = 0 THEN bc.amount ELSE 0 END) AS unpaid, COUNT(*) AS n' +
      ' FROM booking_charges bc JOIN reservations r ON r.id = bc.reservation_id' +
      rw.sql + ' GROUP BY bc.kind', rw.params
    ).forEach(function (r) {
      out.push({
        label: kindLabel[r.k] || r.k, group: 'Per booking',
        value: r.amt || 0, unpaid: r.unpaid || 0, n: r.n
      });
    });

    var ew = expWhere(f);
    DB.all(
      'SELECT category, IFNULL(detail, \'\') AS detail, SUM(amount) AS amt,' +
      ' SUM(CASE WHEN is_paid = 0 THEN amount ELSE 0 END) AS unpaid, COUNT(*) AS n' +
      ' FROM expenses' + ew.sql +
      ' GROUP BY category, CASE WHEN category = \'Other\' THEN IFNULL(detail, \'\') ELSE \'\' END',
      ew.params
    ).forEach(function (r) {
      var label = (r.category === 'Other' && r.detail) ? 'Other — ' + r.detail : r.category;
      out.push({
        label: label, group: 'Anytime',
        value: r.amt || 0, unpaid: r.unpaid || 0, n: r.n
      });
    });

    // never surface an all-zero line — the chart already drops them, and the
    // table view must agree with the chart
    return out.filter(function (c) { return c.value > 0; })
      .sort(function (a, b) { return b.value - a.value; });
  };

  /* ── per-booking charges, on their own ───────────────────────────────────
     Two ways to date a charge, and they answer different questions:
       'accrual'   — the booking's own date (default). Every charge counts,
                     paid or not, and it lines up with the dashboard.
       'date_paid' — when the money actually left. Only settled charges.        */

  An.CHARGE_BASES = {
    accrual: 'When the booking happened',
    date_paid: 'When it was actually paid'
  };

  function chargeQuery(f, basis, groupLen) {
    var dateExpr = basis === 'date_paid' ? 'bc.date_paid' : 'r.' + (f.basis || 'start_date');
    var w = ['bc.amount > 0'], p = [];
    if (basis === 'date_paid') w.push('bc.is_paid = 1 AND bc.date_paid IS NOT NULL');
    if (f.from) { w.push(dateExpr + ' >= ?'); p.push(f.from); }
    if (f.to) { w.push(dateExpr + ' <= ?'); p.push(f.to); }
    if (f.listingId) { w.push('r.listing_id = ?'); p.push(f.listingId); }
    return {
      select: 'substr(' + dateExpr + ',1,' + groupLen + ') AS k',
      where: ' WHERE ' + w.join(' AND '),
      params: p
    };
  }

  /** Totals per charge kind over the window. */
  An.chargeSummary = function (f, basis) {
    var q = chargeQuery(f, basis, 10);
    var rows = DB.all(
      'SELECT bc.kind, SUM(bc.amount) AS amt,' +
      ' SUM(CASE WHEN bc.is_paid = 1 THEN bc.amount ELSE 0 END) AS paid,' +
      ' SUM(CASE WHEN bc.is_paid = 0 THEN bc.amount ELSE 0 END) AS unpaid,' +
      ' COUNT(*) AS n, COUNT(DISTINCT bc.reservation_id) AS bookings' +
      ' FROM booking_charges bc JOIN reservations r ON r.id = bc.reservation_id' +
      q.where + ' GROUP BY bc.kind', q.params);

    var byKind = {};
    rows.forEach(function (r) { byKind[r.kind] = r; });

    var kinds = DB.CHARGE_KINDS.map(function (k) {
      var r = byKind[k.key] || {};
      return {
        key: k.key, label: k.label,
        amount: r.amt || 0, paid: r.paid || 0, unpaid: r.unpaid || 0,
        n: r.n || 0, bookings: r.bookings || 0
      };
    });

    var total = kinds.reduce(function (a, k) {
      a.amount += k.amount; a.paid += k.paid; a.unpaid += k.unpaid; a.n += k.n;
      return a;
    }, { amount: 0, paid: 0, unpaid: 0, n: 0 });

    // nights in the same window, so we can express charges per night
    var rw = resWhere(f);
    total.nights = DB.scalar('SELECT IFNULL(SUM(nights),0) AS n FROM v_reservations' + rw.sql, rw.params) || 0;
    total.perNight = total.nights ? total.amount / total.nights : 0;

    return { kinds: kinds, total: total };
  };

  /**
   * Charges pivoted by period × kind.
   * @param {'day'|'month'|'year'} gran
   * @returns {{rows:Array, kinds:Array}} rows carry one field per charge kind
   */
  An.chargePeriods = function (f, gran, basis) {
    var len = gran === 'day' ? 10 : gran === 'year' ? 4 : 7;
    var q = chargeQuery(f, basis, len);
    var raw = DB.all(
      'SELECT ' + q.select + ', bc.kind, SUM(bc.amount) AS amt,' +
      ' SUM(CASE WHEN bc.is_paid = 1 THEN bc.amount ELSE 0 END) AS paid,' +
      ' SUM(CASE WHEN bc.is_paid = 0 THEN bc.amount ELSE 0 END) AS unpaid,' +
      ' COUNT(*) AS n' +
      ' FROM booking_charges bc JOIN reservations r ON r.id = bc.reservation_id' +
      q.where + ' GROUP BY k, bc.kind HAVING k IS NOT NULL ORDER BY k', q.params);

    /* Only periods with activity are returned — gap-filling days across a long
       range would produce thousands of empty columns. */
    var byPeriod = {}, order = [];
    raw.forEach(function (r) {
      if (!byPeriod[r.k]) {
        var slot = { k: r.k, total: 0, paid: 0, unpaid: 0, n: 0 };
        DB.CHARGE_KINDS.forEach(function (kind) { slot[kind.key] = 0; });
        byPeriod[r.k] = slot;
        order.push(r.k);
      }
      var s = byPeriod[r.k];
      s[r.kind] = (s[r.kind] || 0) + r.amt;
      s.total += r.amt;
      s.paid += r.paid;
      s.unpaid += r.unpaid;
      s.n += r.n;
    });

    return {
      rows: order.sort().map(function (k) { return byPeriod[k]; }),
      kinds: DB.CHARGE_KINDS
    };
  };

  /** Label for a period key, given the granularity that produced it. */
  An.periodLabel = function (k, gran, short) {
    if (gran === 'year') return k;
    if (gran === 'month') return short ? U.monthShort(k) + " '" + k.slice(2, 4) : U.monthLabel(k);
    var d = parseInt(k.slice(8, 10), 10);
    var m = U.MONTHS[parseInt(k.slice(5, 7), 10) - 1] || '?';
    return short ? d + ' ' + m : d + ' ' + m + ' ' + k.slice(0, 4);
  };

  /** Per-listing rollup, for the multi-property comparison table. */
  An.byListing = function (f) {
    var base = { from: f.from, to: f.to, basis: f.basis };
    var rows = DB.listings().map(function (l) {
      var s = An.summary({ from: base.from, to: base.to, basis: base.basis, listingId: l.id });
      return { id: l.id, name: l.name, s: s };
    });
    return rows.filter(function (r) { return r.s.bookings || r.s.earnings || r.s.totalCosts; });
  };

  /** Same-length window immediately before this one, for the delta on the hero. */
  An.previousWindow = function (f) {
    if (!f.from || !f.to) return null;
    var a = new Date(f.from + 'T00:00:00Z'), b = new Date(f.to + 'T00:00:00Z');
    var days = Math.round((b - a) / 86400000) + 1;
    if (!(days > 0)) return null;
    var pb = new Date(a.getTime() - 86400000);
    var pa = new Date(pb.getTime() - (days - 1) * 86400000);
    var isoOf = function (d) { return U.iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); };
    return { from: isoOf(pa), to: isoOf(pb), basis: f.basis, listingId: f.listingId };
  };

  /** Outstanding money, itemised — the "who do I still owe" list. */
  An.outstanding = function (f) {
    var rw = resWhere(f, 'r.');
    var kindLabel = {};
    DB.CHARGE_KINDS.forEach(function (k) { kindLabel[k.key] = k.label; });

    var charges = DB.all(
      'SELECT bc.kind, bc.amount, r.confirmation_code, r.guest_name, r.start_date, l.name AS listing_name' +
      ' FROM booking_charges bc' +
      ' JOIN reservations r ON r.id = bc.reservation_id' +
      ' JOIN listings l ON l.id = r.listing_id' +
      rw.sql + (rw.sql ? ' AND' : ' WHERE') + ' bc.is_paid = 0 AND bc.amount > 0' +
      ' ORDER BY r.start_date DESC', rw.params
    ).map(function (r) {
      return {
        what: kindLabel[r.kind] || r.kind,
        who: r.guest_name || r.confirmation_code,
        listing: r.listing_name,
        date: r.start_date,
        amount: r.amount
      };
    });

    var ew = expWhere(f);
    var exps = DB.all(
      'SELECT e.category, e.detail, e.amount, e.expense_date, l.name AS listing_name' +
      ' FROM expenses e LEFT JOIN listings l ON l.id = e.listing_id' +
      ew.sql + (ew.sql ? ' AND' : ' WHERE') + ' e.is_paid = 0 AND e.amount > 0' +
      ' ORDER BY e.expense_date DESC', ew.params
    ).map(function (r) {
      return {
        what: (r.category === 'Other' && r.detail) ? 'Other — ' + r.detail : r.category,
        who: '—',
        listing: r.listing_name || 'All listings',
        date: r.expense_date,
        amount: r.amount
      };
    });

    return charges.concat(exps).sort(function (a, b) {
      return (b.date || '').localeCompare(a.date || '');
    });
  };

  App.An = An;
})(window.App);
