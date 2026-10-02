/* BNB Analytics — exports, backup/restore, settings.
   The .sqlite backup is the real one: it round-trips every table exactly.
   Excel/CSV exports are for reading and sharing, not for re-importing. */
window.App = window.App || {};
window.App.Views = window.App.Views || {};

(function (App) {
  'use strict';

  var U = App.U, DB = App.DB, An = App.An, Ex = App.Ex;

  /* ── export builders ──────────────────────────────────────────────────── */

  function reservationRows(f) {
    var head = ['Confirmation code', 'Listing', 'Status', 'Cancelled', 'Guest', 'Contact',
      'Adults', 'Children', 'Infants', 'Check-in', 'Check-out', 'Nights', 'Booked',
      'Earnings (Airbnb)', 'Payout received', 'Payout date',
      'Earnings in bank', 'Earnings awaiting bank',
      'Watchman', 'Water bottles', 'Fruits', 'Dry cleaning',
      'Costs recorded', 'Costs paid (deducted)', 'Costs pending (not deducted)',
      'Net profit', 'Currency', 'Notes'];
    var rows = [head];
    DB.reservations(f).forEach(function (r) {
      var c = DB.chargesFor(r.id);
      var amt = function (k) { return c[k] ? U.round(c[k].amount, 3) : 0; };
      rows.push([
        r.confirmation_code, r.listing_name, r.status || '', r.is_cancelled ? 'Yes' : 'No',
        r.guest_name || '', r.contact || '',
        r.adults, r.children, r.infants, r.start_date, r.end_date || '', r.nights_raw,
        r.booked_date || '',
        U.round(r.earnings_raw, 3),
        r.payout_received ? 'Yes' : 'No', r.payout_date || '',
        U.round(r.earnings, 3), U.round(r.earnings_awaiting, 3),
        amt('watchman'), amt('water'), amt('fruits'), amt('drycleaning'),
        U.round(r.cost_total, 3), U.round(r.cost_paid, 3), U.round(r.cost_unpaid, 3),
        U.round(r.net, 3), r.currency || U.currency, r.notes || ''
      ]);
    });
    return rows;
  }

  function chargeRows(f) {
    var kindLabel = {};
    DB.CHARGE_KINDS.forEach(function (k) { kindLabel[k.key] = k.label; });
    var rows = [['Confirmation code', 'Listing', 'Guest', 'Check-in', 'Charge',
      'Amount', 'Payment processed', 'Date paid', 'Note']];
    DB.reservations(f).forEach(function (r) {
      var c = DB.chargesFor(r.id);
      Object.keys(c).forEach(function (k) {
        rows.push([r.confirmation_code, r.listing_name, r.guest_name || '', r.start_date,
          kindLabel[k] || k, U.round(c[k].amount, 3), c[k].is_paid ? 'Yes' : 'No',
          c[k].date_paid || '', c[k].note || '']);
      });
    });
    return rows;
  }

  function expenseRows(f) {
    var rows = [['Date', 'Category', 'Detail', 'Listing', 'Amount',
      'Payment processed', 'Date paid', 'Note']];
    DB.expenses(f).forEach(function (e) {
      rows.push([e.expense_date, e.category, e.detail || '', e.listing_name || 'All listings',
        U.round(e.amount, 3), e.is_paid ? 'Yes' : 'No', e.date_paid || '', e.note || '']);
    });
    return rows;
  }

  var PERIOD_HEAD = ['Bookings', 'Nights', 'Earnings in bank', 'Awaiting bank',
    'Booking paid', 'Bills paid', 'Costs paid (deducted)', 'Net profit',
    'Pending (not deducted)', 'Margin %'];

  function periodRow(label, p) {
    return [label, p.bookings, p.nights, U.round(p.earnings, 3), U.round(p.awaiting, 3),
      U.round(p.bookingCosts, 3), U.round(p.expenses, 3), U.round(p.costs, 3),
      U.round(p.net, 3), U.round(p.pending, 3),
      p.earnings ? U.round(p.net / p.earnings * 100, 1) : 0];
  }

  function monthlyRows(f) {
    var rows = [['Month'].concat(PERIOD_HEAD)];
    An.monthly(f).forEach(function (m) { rows.push(periodRow(U.monthLabel(m.k), m)); });
    return rows;
  }

  function yearlyRows(f) {
    var rows = [['Year'].concat(PERIOD_HEAD)];
    An.yearly(f).forEach(function (y) { rows.push(periodRow(y.k, y)); });
    return rows;
  }

  function summaryRows(f) {
    var s = An.summary(f);
    return [
      ['BNB Analytics — summary', ''],
      ['Generated', new Date().toString()],
      ['Period', (f.from || 'start') + ' to ' + (f.to || 'today')],
      ['Attributed by', App.state.basisLabel()],
      ['Listing', f.listingId ? (DB.one('SELECT name FROM listings WHERE id = ?', [f.listingId]) || {}).name : 'All listings'],
      ['Currency', U.currency],
      ['', ''],
      ['Bookings (excluding cancelled)', s.bookings],
      ['Cancelled bookings (excluded)', s.cancelled],
      ['Nights', s.nights],
      ['Earnings in bank', U.round(s.earnings, 3)],
      ['Earnings awaiting bank', U.round(s.awaiting, 3)],
      ['Payouts not received', s.awaitingCount],
      ['Earnings booked (in bank + awaiting)', U.round(s.earningsEligible, 3)],
      ['', ''],
      ['Deducted — per-booking paid', U.round(s.bookingCosts, 3)],
      ['Deducted — bills paid', U.round(s.expenses, 3)],
      ['Deducted — total', U.round(s.deducted, 3)],
      ['Net profit', U.round(s.net, 3)],
      ['Margin %', U.round(s.margin * 100, 1)],
      ['', ''],
      ['Pending — per-booking', U.round(s.unpaidBooking, 3)],
      ['Pending — bills', U.round(s.unpaidExpenses, 3)],
      ['Pending — total (not deducted)', U.round(s.pending, 3)],
      ['Net profit once pending is paid', U.round(s.netAfterPending, 3)],
      ['', ''],
      ['Costs recorded (paid + pending)', U.round(s.committed, 3)],
      ['Avg earnings per night', U.round(s.perNight, 3)],
      ['Avg per booking', U.round(s.avgBooking, 3)]
    ];
  }

  /** Side notes are not date-scoped, so the filters don't apply to them. */
  function noteRows() {
    var rows = [['Added', 'Last edited', 'Note']];
    DB.notes().forEach(function (n) {
      rows.push([n.created_at || '', n.updated_at || '', n.body || '']);
    });
    return rows;
  }

  function costRows(f) {
    var rows = [['Cost', 'Type', 'Entries', 'Amount', 'Unpaid']];
    An.costBreakdown(f).forEach(function (c) {
      rows.push([c.label, c.group, c.n, U.round(c.value, 3), U.round(c.unpaid, 3)]);
    });
    return rows;
  }

  /** Per-booking charges pivoted by period — one sheet per granularity. */
  function chargePeriodRows(f, gran) {
    var pv = An.chargePeriods(f, gran, 'accrual');
    var rows = [['Period'].concat(
      pv.kinds.map(function (k) { return k.label; })
    ).concat(['Entries', 'Total', 'Paid', 'Unpaid'])];

    pv.rows.forEach(function (r) {
      rows.push([An.periodLabel(r.k, gran, false)].concat(
        pv.kinds.map(function (k) { return U.round(r[k.key] || 0, 3); })
      ).concat([r.n, U.round(r.total, 3), U.round(r.paid, 3), U.round(r.unpaid, 3)]));
    });

    var sum = An.chargeSummary(f, 'accrual');
    rows.push(['Total'].concat(
      sum.kinds.map(function (k) { return U.round(k.amount, 3); })
    ).concat([sum.total.n, U.round(sum.total.amount, 3),
      U.round(sum.total.paid, 3), U.round(sum.total.unpaid, 3)]));
    return rows;
  }

  /* ── managed lists ────────────────────────────────────────────────────────
     Listings and booking statuses are the two things every reservation has to
     be picked from, so they are edited here rather than typed into the booking
     form. Free text there meant the same property or the same state could be
     spelled three ways and then fail to group in the analysis. */

  /** One editable list: existing entries with their usage, plus an add row. */
  function listSection(opts) {
    var box = U.el('div', { style: 'flex:1 1 300px;min-width:0' });
    box.appendChild(U.el('h3', { text: opts.title, style: 'font-size:.88rem' }));
    box.appendChild(U.el('p', { class: 'small muted', style: 'margin:.15rem 0 .55rem' },
      [opts.hint]));

    var list = U.el('div', { class: 'manage-list' });
    if (!opts.items.length) {
      list.appendChild(U.el('div', { class: 'empty small', text: opts.empty }));
    }
    opts.items.forEach(function (item) {
      list.appendChild(U.el('div', { class: 'manage-row' }, [
        U.el('span', { class: 'mr-name', dir: 'auto', text: item.name }),
        U.el('span', { class: 'mr-use', text: item.use }),
        U.el('button', {
          class: 'btn btn-sm btn-danger', type: 'button',
          title: 'Remove ' + item.name,
          onclick: function () { opts.onRemove(item); }
        }, ['Remove'])
      ]));
    });
    box.appendChild(list);

    var input = U.el('input', {
      type: 'text', placeholder: opts.placeholder, 'aria-label': opts.placeholder,
      onkeydown: function (e) { if (e.key === 'Enter') { e.preventDefault(); add(); } }
    });
    function add() { opts.onAdd(input.value.trim()); }

    box.appendChild(U.el('div', { class: 'row', style: 'flex-wrap:nowrap' }, [
      U.el('div', { style: 'flex:1 1 auto;min-width:0' }, [input]),
      U.el('button', { class: 'btn', type: 'button', onclick: add }, ['Add'])
    ]));
    return box;
  }

  function listsCard() {
    var card = U.el('div', { class: 'card' });
    card.appendChild(U.el('div', { class: 'card-head' }, [
      U.el('div', null, [
        U.el('h2', { text: 'Listings & booking statuses' }),
        U.el('p', {
          text: 'The two dropdowns on the reservation form. Kept here so the ' +
            'same property or state is always spelled the same way.'
        })
      ])
    ]));

    /* listings */
    var listings = DB.listings().map(function (l) {
      var use = DB.listingUsage(l.id);
      return {
        id: l.id, name: l.name, usage: use,
        use: use.reservations
          ? use.reservations + (use.reservations === 1 ? ' booking' : ' bookings')
          : (use.expenses ? use.expenses + ' expenses' : 'unused')
      };
    });

    var listingBox = listSection({
      title: 'Listings',
      hint: 'A booking belongs to exactly one. Removing one is only possible ' +
        'once it has no reservations left.',
      empty: 'No listings yet — add one before entering a reservation.',
      placeholder: 'Name of the listing',
      items: listings,
      onAdd: function (name) {
        if (!name) { U.toast('Type the listing name first', true); return; }
        try {
          var r = DB.addListing(name);
          if (!r.created) { U.toast('That listing is already on the list', true); return; }
          App.persist();
          U.toast('Listing added');
          App.refresh();
        } catch (e) { U.toast(e.message, true); }
      },
      onRemove: function (item) {
        /* The foreign key cascades, so a listing with bookings would take them
           all with it. DB.deleteListing refuses; say why before it is tried. */
        if (item.usage.reservations) {
          U.toast('"' + item.name + '" still has ' + item.usage.reservations +
            ' reservation' + (item.usage.reservations === 1 ? '' : 's') +
            ' — remove those first', true);
          return;
        }
        var extra = item.usage.expenses
          ? '\n\nIts ' + item.usage.expenses + ' expense entr' +
            (item.usage.expenses === 1 ? 'y becomes' : 'ies become') + ' shared ' +
            '(All listings) rather than being deleted.'
          : '';
        if (!confirm('Remove the listing "' + item.name + '"?' + extra)) return;
        try {
          DB.deleteListing(item.id);
          App.persist();
          U.toast('Listing removed');
          App.refresh();
        } catch (e) { U.toast(e.message, true); }
      }
    });

    /* statuses */
    var managed = DB.statusOptions();
    var statusItems = managed.map(function (s) {
      var n = DB.statusUsage(s);
      return {
        name: s,
        use: n ? n + (n === 1 ? ' booking' : ' bookings') : 'unused'
      };
    });

    var statusBox = listSection({
      title: 'Booking statuses',
      hint: 'Anything containing "cancel" marks a booking cancelled, so it stops ' +
        'counting towards earnings and nights.',
      empty: 'No statuses — the built-in list will be used.',
      placeholder: 'Name of the status',
      items: statusItems,
      onAdd: function (name) {
        if (!name) { U.toast('Type the status first', true); return; }
        if (managed.some(function (s) { return s.toLowerCase() === name.toLowerCase(); })) {
          U.toast('That status is already on the list', true); return;
        }
        DB.setStatusOptions(managed.concat([name]));
        App.persist();
        U.toast('Status added');
        App.refresh();
      },
      onRemove: function (item) {
        /* Non-destructive: reservations keep whatever text they hold, this only
           stops the status being offered. Worth saying, since the count beside
           it looks like something is about to be lost. */
        var n = DB.statusUsage(item.name);
        if (!confirm('Stop offering "' + item.name + '"?' + (n
          ? '\n\nThe ' + n + ' booking' + (n === 1 ? '' : 's') + ' already using it ' +
            'keep it — they are not changed.'
          : ''))) return;
        DB.setStatusOptions(managed.filter(function (s) { return s !== item.name; }));
        App.persist();
        U.toast('Status removed');
        App.refresh();
      }
    });

    card.appendChild(U.el('div', { class: 'row', style: 'gap:1.4rem;align-items:flex-start' },
      [listingBox, statusBox]));

    /* Statuses that arrived with an import and are not on the list. Offering to
       adopt them is cheaper than making you retype them exactly. */
    var loose = DB.statuses().filter(function (s) { return managed.indexOf(s) === -1; });
    if (loose.length) {
      var row = U.el('div', { class: 'row', style: 'margin-top:.9rem' }, [
        U.el('span', { class: 'small muted', text: 'Seen in imported bookings:' })
      ]);
      loose.forEach(function (s) {
        row.appendChild(U.el('button', {
          class: 'btn btn-sm', type: 'button',
          title: 'Add "' + s + '" to the status list',
          onclick: function () {
            DB.setStatusOptions(managed.concat([s]));
            App.persist();
            U.toast('Status added');
            App.refresh();
          }
        }, ['+ ' + s]));
      });
      card.appendChild(row);
    }

    return card;
  }

  /* ── view ─────────────────────────────────────────────────────────────── */

  App.Views.data = function (root) {
    U.clear(root);
    var f = App.state.filter();
    var stamp = Ex.stamp();

    /* exports */
    var exportCard = U.el('div', { class: 'card' });
    exportCard.appendChild(U.el('div', { class: 'card-head' }, [
      U.el('div', null, [
        U.el('h2', { text: 'Export' }),
        U.el('p', { text: 'Uses the filters at the top of the page. Excel gets one workbook with eleven sheets.' })
      ])
    ]));

    exportCard.appendChild(U.el('div', { class: 'row' }, [
      U.el('button', {
        class: 'btn btn-primary', type: 'button',
        onclick: function () {
          try {
            var blob = Ex.xlsx([
              { name: 'Summary', rows: summaryRows(f) },
              { name: 'Monthly', rows: monthlyRows(f) },
              { name: 'Yearly', rows: yearlyRows(f) },
              { name: 'Reservations', rows: reservationRows(f) },
              { name: 'Booking charges', rows: chargeRows(f) },
              { name: 'Charges by day', rows: chargePeriodRows(f, 'day') },
              { name: 'Charges by month', rows: chargePeriodRows(f, 'month') },
              { name: 'Charges by year', rows: chargePeriodRows(f, 'year') },
              { name: 'Expenses', rows: expenseRows(f) },
              { name: 'Cost breakdown', rows: costRows(f) },
              { name: 'Side notes', rows: noteRows() }
            ]);
            U.download('bnb-analytics-' + stamp + '.xlsx', blob);
            U.toast('Excel workbook downloaded');
          } catch (e) { U.toast('Export failed: ' + e.message, true); }
        }
      }, ['⬇ Excel workbook (.xlsx)']),

      U.el('button', {
        class: 'btn', type: 'button',
        onclick: function () {
          U.download('reservations-with-costs-' + stamp + '.csv', Ex.csv(reservationRows(f)));
        }
      }, ['Reservations CSV']),

      U.el('button', {
        class: 'btn', type: 'button',
        onclick: function () {
          U.download('booking-charges-' + stamp + '.csv', Ex.csv(chargeRows(f)));
        }
      }, ['Booking charges CSV']),

      U.el('button', {
        class: 'btn', type: 'button',
        onclick: function () {
          U.download('booking-costs-by-month-' + stamp + '.csv',
            Ex.csv(chargePeriodRows(f, 'month')));
        }
      }, ['Booking costs by month CSV']),

      U.el('button', {
        class: 'btn', type: 'button',
        onclick: function () {
          U.download('expenses-' + stamp + '.csv', Ex.csv(expenseRows(f)));
        }
      }, ['Expenses CSV']),

      U.el('button', {
        class: 'btn', type: 'button',
        onclick: function () {
          U.download('monthly-analysis-' + stamp + '.csv', Ex.csv(monthlyRows(f)));
        }
      }, ['Monthly CSV']),

      U.el('button', {
        class: 'btn', type: 'button',
        onclick: function () {
          U.download('yearly-analysis-' + stamp + '.csv', Ex.csv(yearlyRows(f)));
        }
      }, ['Yearly CSV'])
    ]));
    root.appendChild(exportCard);

    /* backup / restore */
    var backupCard = U.el('div', { class: 'card' });
    backupCard.appendChild(U.el('div', { class: 'card-head' }, [
      U.el('div', null, [
        U.el('h2', { text: 'Backup & restore' }),
        U.el('p', { text: 'The .sqlite file is your complete database — keep a copy anywhere you like.' })
      ])
    ]));

    var restoreInput = U.el('input', {
      type: 'file', accept: '.sqlite,.db,.sqlite3,application/octet-stream', style: 'display:none',
      onchange: function () {
        var file = this.files && this.files[0];
        if (!file) return;
        if (!confirm('Restore from ' + file.name + '?\n\nThis replaces everything currently in the app.')) {
          this.value = ''; return;
        }
        var fr = new FileReader();
        fr.onload = function () {
          try {
            DB.replace(new Uint8Array(fr.result));
            App.persist();
            App.state.resetBounds();
            U.toast('Database restored');
            App.go('dashboard');
          } catch (e) {
            U.toast('That file is not a valid database', true);
          }
        };
        fr.readAsArrayBuffer(file);
      }
    });

    backupCard.appendChild(U.el('div', { class: 'row' }, [
      U.el('button', {
        class: 'btn btn-primary', type: 'button',
        onclick: function () {
          var bytes = DB.export();
          U.download('bnb-analytics-' + stamp + '.sqlite',
            new Blob([bytes], { type: 'application/octet-stream' }));
          U.toast('Backup downloaded (' + Math.max(1, Math.round(bytes.length / 1024)) + ' KB)');
        }
      }, ['⬇ Download .sqlite backup']),
      U.el('button', {
        class: 'btn', type: 'button',
        onclick: function () { restoreInput.click(); }
      }, ['⬆ Restore from backup']),
      restoreInput,
      U.el('span', { style: 'flex:1' }),
      U.el('button', {
        class: 'btn btn-danger', type: 'button',
        onclick: function () {
          if (!confirm('Erase everything?\n\nAll reservations, costs and expenses will be deleted. Download a backup first if you are not sure.')) return;
          if (!confirm('Really erase everything? This cannot be undone.')) return;
          App.Store.clear().then(function () {
            DB.db.close();
            DB.db = new DB.sql.Database();
            DB.migrate();
            App.persist();
            App.state.resetBounds();
            U.toast('All data erased');
            App.go('dashboard');
          });
        }
      }, ['Erase all data'])
    ]));

    var c = DB.counts();
    backupCard.appendChild(U.el('p', { class: 'small muted', style: 'margin:.75rem 0 0' }, [
      App.Store.describe() + ' · ' + c.listings + ' listings, ' + c.reservations +
      ' reservations, ' + c.charges + ' charges, ' + c.expenses + ' expenses, ' +
      c.notes + ' notes.'
    ]));
    root.appendChild(backupCard);

    /* settings */
    var setCard = U.el('div', { class: 'card' });
    setCard.appendChild(U.el('div', { class: 'card-head' }, [
      U.el('div', null, [
        U.el('h2', { text: 'Settings' }),
        U.el('p', {
          text: 'Default charge amounts. The watchman rate is per night; the ' +
            'others are per booking. Every new booking starts with all four — ' +
            'set one to 0 if it should start empty rather than pre-filled.'
        })
      ])
    ]));

    var rateIn = U.el('input', {
      type: 'number', step: '0.001', min: '0', inputmode: 'decimal',
      value: U.round(U.parseNum(DB.getSetting('watchman_rate')), 3),
      'aria-label': 'Watchman rate per night'
    });

    /* One field per charge kind that has a flat default, built from
       CHARGE_KINDS so adding a kind cannot leave its default unreachable. */
    var flatKinds = DB.CHARGE_KINDS.filter(function (k) { return !k.perNight; });
    var flatInputs = flatKinds.map(function (k) {
      return U.el('input', {
        type: 'number', step: '0.001', min: '0', inputmode: 'decimal',
        value: U.round(U.parseNum(DB.getSetting(k.settingKey)), 3),
        'aria-label': 'Default amount for ' + k.label
      });
    });
    var curIn = U.el('input', {
      type: 'text', value: DB.getSetting('currency') || 'JD', maxlength: '6',
      'aria-label': 'Currency label'
    });
    var decIn = U.el('select', { 'aria-label': 'Decimal places' },
      ['0', '1', '2', '3'].map(function (d) {
        return U.el('option', { value: d, text: d, selected: String(U.decimals) === d });
      }));

    var setFields = [
      U.el('div', { class: 'field', style: 'flex:1 1 165px' }, [
        U.el('label', { text: 'Watchman per night' }), rateIn
      ])
    ];
    flatKinds.forEach(function (k, i) {
      setFields.push(U.el('div', { class: 'field', style: 'flex:1 1 130px' }, [
        U.el('label', { text: k.label }), flatInputs[i]
      ]));
    });
    setFields.push(
      U.el('div', { class: 'field', style: 'flex:1 1 110px' }, [
        U.el('label', { text: 'Currency label' }), curIn
      ]),
      U.el('div', { class: 'field', style: 'flex:1 1 110px' }, [
        U.el('label', { text: 'Decimal places' }), decIn
      ]),
      U.el('button', {
        class: 'btn btn-primary', type: 'button',
        onclick: function () {
          DB.setSetting('watchman_rate', U.parseNum(rateIn.value));
          flatKinds.forEach(function (k, i) {
            DB.setSetting(k.settingKey, U.parseNum(flatInputs[i].value));
          });
          DB.setSetting('currency', String(curIn.value).trim() || 'JD');
          DB.setSetting('decimals', decIn.value);
          U.currency = DB.getSetting('currency');
          U.decimals = parseInt(decIn.value, 10);
          App.persist();
          U.toast('Settings saved');
          App.refresh();
        }
      }, ['Save settings'])
    );

    setCard.appendChild(U.el('div', { class: 'row', style: 'align-items:flex-end' }, setFields));

    setCard.appendChild(U.el('p', { class: 'small muted', style: 'margin:.75rem 0 0' }, [
      'Changing a default does not rewrite charges already recorded — open a booking ' +
      'on the Reservations tab and use its "use N" link to apply the new figure.'
    ]));
    root.appendChild(setCard);

    root.appendChild(listsCard());

    /* SQL console — it is a real database, so let it be queried */
    var sqlCard = U.el('div', { class: 'card' });
    sqlCard.appendChild(U.el('div', { class: 'card-head' }, [
      U.el('div', null, [
        U.el('h2', { text: 'SQL console' }),
        U.el('p', { text: 'Read-only scratchpad against the live SQLite database. Tables: listings, reservations, booking_charges, expenses; views: v_reservations, v_booking_costs.' })
      ])
    ]));
    var sqlIn = U.el('textarea', {
      rows: '3', spellcheck: 'false',
      style: 'font-family:ui-monospace,monospace;font-size:.8rem',
      text: 'SELECT listing_name, COUNT(*) AS bookings, ROUND(SUM(net),3) AS net\nFROM v_reservations GROUP BY listing_name ORDER BY net DESC;'
    });
    var sqlOut = U.el('div', { style: 'margin-top:.6rem' });
    sqlCard.appendChild(sqlIn);
    sqlCard.appendChild(U.el('div', { class: 'row', style: 'margin-top:.5rem' }, [
      U.el('button', {
        class: 'btn', type: 'button',
        onclick: function () {
          U.clear(sqlOut);
          var q = sqlIn.value.trim();
          if (!/^\s*(select|with|pragma|explain)\b/i.test(q)) {
            sqlOut.appendChild(U.el('div', { class: 'notice bad' }, ['Only SELECT / WITH / PRAGMA / EXPLAIN are allowed here.']));
            return;
          }
          try {
            var rows = DB.all(q.replace(/;\s*$/, ''));
            if (!rows.length) {
              sqlOut.appendChild(U.el('div', { class: 'empty', text: 'No rows.' }));
              return;
            }
            var keys = Object.keys(rows[0]);
            sqlOut.appendChild(App.Charts.table(keys, rows.map(function (r) {
              return keys.map(function (k) { return r[k] == null ? '—' : String(r[k]); });
            })));
            sqlOut.appendChild(U.el('p', { class: 'small muted', text: rows.length + ' row(s)' }));
          } catch (e) {
            sqlOut.appendChild(U.el('div', { class: 'notice bad' }, [e.message]));
          }
        }
      }, ['Run query'])
    ]));
    sqlCard.appendChild(sqlOut);
    root.appendChild(sqlCard);
  };
})(window.App);
