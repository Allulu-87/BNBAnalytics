/* BNB Analytics — reservations table + the per-booking cost editor.
   Each booking carries four charge slots (watchman profit, tips, water
   bottles, fruits); every one has an amount, a date paid, and a
   processed/not-processed flag. */
window.App = window.App || {};
window.App.Views = window.App.Views || {};

(function (App) {
  'use strict';

  var U = App.U, DB = App.DB;

  var sort = { by: 'start_date', dir: 'desc' };
  var openRow = null;      // reservation id whose editor is expanded
  var localFilter = { status: '', paid: '' };

  function statusBadge(st) {
    return U.el('span', { class: 'badge', text: st || '—' });
  }

  function paidBadge(r) {
    if (!r.cost_total) return U.el('span', { class: 'badge muted', text: 'no costs' });
    if (r.cost_unpaid > 0.0005) {
      return U.el('span', { class: 'badge due', text: U.fmtNum(r.cost_unpaid, 2) + ' due' });
    }
    return U.el('span', { class: 'badge paid', text: 'paid' });
  }

  /* ── the four charge editors ──────────────────────────────────────────── */

  function chargeCard(res, kind, existing, onSaved) {
    var row = existing || { amount: 0, date_paid: null, is_paid: 0, note: null };
    var rate = U.parseNum(DB.getSetting('watchman_rate'));

    var amount = U.el('input', {
      type: 'number', step: '0.001', min: '0', inputmode: 'decimal',
      value: row.amount ? U.round(row.amount, 3) : '',
      placeholder: '0.000',
      'aria-label': kind.label + ' amount'
    });
    var datePaid = U.el('input', {
      type: 'text', value: row.date_paid || '', 'aria-label': kind.label + ' date paid'
    });
    var isPaid = U.el('input', {
      type: 'checkbox', id: 'paid-' + res.id + '-' + kind.key
    });
    isPaid.checked = !!row.is_paid;

    var note = U.el('input', {
      type: 'text', value: row.note || '', placeholder: 'Note (optional)',
      'aria-label': kind.label + ' note'
    });

    function commit() {
      var amt = U.parseNum(amount.value);
      // A charge needs an amount to exist at all, so say so rather than letting
      // the tick silently vanish on the next render.
      if (!(amt > 0) && (isPaid.checked || note.value.trim())) {
        U.toast('Enter an amount for ' + kind.label.toLowerCase() + ' first');
        isPaid.checked = false;
      }
      // ticking "processed" with no date fills in today — the common case
      if (isPaid.checked && !datePaid.value) App.DP.set(datePaid, U.todayISO());
      DB.saveCharge(res.id, kind.key, {
        amount: amt,
        date_paid: datePaid.value || null,
        is_paid: isPaid.checked ? 1 : 0,
        note: note.value.trim() || null
      });
      App.persist();
      onSaved();
    }

    App.DP.attach(datePaid, { placeholder: 'Not paid yet', onPick: commit });

    amount.addEventListener('change', commit);
    note.addEventListener('change', commit);
    isPaid.addEventListener('change', commit);

    var head = U.el('div', { class: 'charge-head' }, [
      U.el('strong', { text: kind.label }),
      U.el('span', { class: 'hint', text: kind.key === 'watchman' ? U.fmtNum(rate, 3) + '/night × ' + res.nights : kind.hint })
    ]);

    var suggest = null;
    if (kind.key === 'watchman' && res.nights > 0) {
      var expect = U.round(rate * res.nights, 3);
      if (Math.abs(U.parseNum(amount.value) - expect) > 0.0005) {
        suggest = U.el('button', {
          class: 'btn btn-sm', type: 'button',
          onclick: function () { amount.value = expect; commit(); }
        }, ['Set ' + U.fmtNum(expect, 3)]);
      }
    }

    return U.el('div', { class: 'charge' }, [
      head,
      U.el('div', { class: 'row2' }, [
        U.el('div', { class: 'field' }, [U.el('label', { text: 'Amount (' + U.currency + ')' }), amount]),
        U.el('div', { class: 'field' }, [U.el('label', { text: 'Date paid' }), datePaid])
      ]),
      U.el('div', { class: 'paidline' }, [
        isPaid,
        U.el('label', { for: 'paid-' + res.id + '-' + kind.key, text: 'Payment processed' }),
        suggest ? U.el('span', { class: 'spacer', style: 'flex:1' }) : null,
        suggest
      ]),
      U.el('div', { style: 'margin-top:.4rem' }, [note])
    ]);
  }

  function detailBox(res, rerender) {
    var charges = DB.chargesFor(res.id);
    var grid = U.el('div', { class: 'charge-grid' });
    DB.CHARGE_KINDS.forEach(function (kind) {
      grid.appendChild(chargeCard(res, kind, charges[kind.key], rerender));
    });

    var totals = U.el('div', { class: 'row', style: 'margin-top:.75rem;gap:1rem' }, [
      U.el('span', { class: 'small' }, [
        U.el('span', { class: 'muted', text: 'Earnings ' }),
        U.el('strong', { text: U.fmtMoney(res.earnings, 3) })
      ]),
      U.el('span', { class: 'small' }, [
        U.el('span', { class: 'muted', text: 'Costs ' }),
        U.el('strong', { text: U.fmtMoney(res.cost_total, 3) })
      ]),
      U.el('span', { class: 'small' }, [
        U.el('span', { class: 'muted', text: 'Net ' }),
        U.el('strong', { class: res.net < 0 ? 'money-neg' : '', text: U.fmtMoney(res.net, 3) })
      ]),
      U.el('span', { class: 'spacer', style: 'flex:1' }),
      U.el('button', {
        class: 'btn btn-sm btn-danger', type: 'button',
        onclick: function () {
          if (!confirm('Delete this reservation and its costs?\n\n' +
            res.confirmation_code + ' · ' + (res.guest_name || '') +
            '\n\nIt will come back next time you import a CSV that contains it.')) return;
          DB.deleteReservation(res.id);
          App.persist();
          openRow = null;
          App.refresh();
          U.toast('Reservation deleted');
        }
      }, ['Delete reservation'])
    ]);

    var meta = U.el('p', { class: 'small muted', style: 'margin:.1rem 0 .7rem' }, [
      res.confirmation_code + ' · ' + (res.contact || 'no contact') + ' · ' +
      res.adults + ' adults, ' + res.children + ' children, ' + res.infants + ' infants · booked ' +
      U.prettyDate(res.booked_date)
    ]);

    return U.el('div', { class: 'detail-box' }, [meta, grid, totals]);
  }

  /* ── table ────────────────────────────────────────────────────────────── */

  var COLS = [
    { key: 'confirmation_code', label: 'Code' },
    { key: 'listing_name', label: 'Listing' },
    { key: 'guest_name', label: 'Guest' },
    { key: 'start_date', label: 'Check-in' },
    { key: 'end_date', label: 'Check-out' },
    { key: 'nights', label: 'Nights', num: true },
    { key: 'status', label: 'Status' },
    { key: 'earnings', label: 'Earnings', num: true },
    { key: 'cost_total', label: 'Costs', num: true },
    { key: 'net', label: 'Net', num: true },
    { key: null, label: 'Payment' }
  ];

  App.Views.reservations = function (root) {
    U.clear(root);
    var f = App.state.filter();
    f.sort = sort.by;
    f.dir = sort.dir;
    f.status = localFilter.status;
    f.paid = localFilter.paid;

    var rows = DB.reservations(f);

    /* local (view-specific) controls */
    var statusSel = U.el('select', {
      onchange: function () { localFilter.status = this.value; App.refresh(); }
    }, [U.el('option', { value: '', text: 'Any status' })].concat(
      DB.statuses().map(function (st) {
        return U.el('option', { value: st, text: st, selected: localFilter.status === st });
      })));

    var paidSel = U.el('select', {
      onchange: function () { localFilter.paid = this.value; App.refresh(); }
    }, [
      U.el('option', { value: '', text: 'Any payment state' }),
      U.el('option', { value: 'due', text: 'Has unpaid costs', selected: localFilter.paid === 'due' }),
      U.el('option', { value: 'paid', text: 'Fully paid', selected: localFilter.paid === 'paid' })
    ]);

    var totals = rows.reduce(function (a, r) {
      a.earnings += r.earnings; a.costs += r.cost_total; a.net += r.net; a.nights += r.nights;
      return a;
    }, { earnings: 0, costs: 0, net: 0, nights: 0 });

    var card = U.el('div', { class: 'card' });
    card.appendChild(U.el('div', { class: 'card-head' }, [
      U.el('div', null, [
        U.el('h2', { text: 'Reservations' }),
        U.el('p', { text: rows.length + ' shown · click any row to enter the watchman, tips, water and fruit costs.' })
      ]),
      U.el('div', { class: 'spacer' }),
      U.el('div', { class: 'field', style: 'flex:0 0 auto;min-width:150px' }, [statusSel]),
      U.el('div', { class: 'field', style: 'flex:0 0 auto;min-width:170px' }, [paidSel])
    ]));

    if (!rows.length) {
      card.appendChild(U.el('div', { class: 'empty', text: 'No reservations match these filters.' }));
      root.appendChild(card);
      return;
    }

    var table = U.el('table', { class: 'data' });
    var thead = U.el('thead');
    thead.appendChild(U.el('tr', null, COLS.map(function (c) {
      if (!c.key) return U.el('th', { text: c.label });
      var arrow = sort.by === c.key ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : '';
      return U.el('th', {
        class: 'sortable' + (c.num ? ' num' : ''),
        text: c.label + arrow,
        title: 'Sort by ' + c.label,
        onclick: function () {
          if (sort.by === c.key) sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
          else { sort.by = c.key; sort.dir = c.num || c.key.indexOf('date') !== -1 ? 'desc' : 'asc'; }
          App.refresh();
        }
      });
    })));
    table.appendChild(thead);

    var tbody = U.el('tbody');
    rows.forEach(function (r) {
      var isOpen = openRow === r.id;
      var tr = U.el('tr', {
        class: isOpen ? 'is-open' : '', tabindex: 0,
        style: 'cursor:pointer',
        onclick: function (e) {
          if (e.target.closest('input,select,button,label,a')) return;
          openRow = isOpen ? null : r.id;
          App.refresh();
        },
        onkeydown: function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openRow = isOpen ? null : r.id;
            App.refresh();
          }
        }
      }, [
        U.el('td', null, [U.el('span', { class: 'mono small', text: r.confirmation_code })]),
        U.el('td', { class: 'wrap', text: r.listing_name }),
        U.el('td', { class: 'wrap', dir: 'auto', text: r.guest_name || '—' }),
        U.el('td', { text: U.prettyDate(r.start_date) }),
        U.el('td', { text: U.prettyDate(r.end_date) }),
        U.el('td', { class: 'num', text: r.nights }),
        U.el('td', null, [statusBadge(r.status)]),
        U.el('td', { class: 'num', text: U.fmtNum(r.earnings, 2) }),
        U.el('td', { class: 'num', text: U.fmtNum(r.cost_total, 2) }),
        U.el('td', { class: 'num' + (r.net < 0 ? ' money-neg' : ''), text: U.fmtNum(r.net, 2) }),
        U.el('td', null, [paidBadge(r)])
      ]);
      tbody.appendChild(tr);

      if (isOpen) {
        var dtr = U.el('tr', { class: 'detail-row' });
        var td = U.el('td', { colspan: COLS.length });
        td.appendChild(detailBox(r, function () { App.refresh(); }));
        dtr.appendChild(td);
        tbody.appendChild(dtr);
      }
    });
    table.appendChild(tbody);

    table.appendChild(U.el('tfoot', null, [
      U.el('tr', null, [
        U.el('td', { colspan: 5, text: 'Total of ' + rows.length + ' shown' }),
        U.el('td', { class: 'num', text: totals.nights }),
        U.el('td'),
        U.el('td', { class: 'num', text: U.fmtNum(totals.earnings, 2) }),
        U.el('td', { class: 'num', text: U.fmtNum(totals.costs, 2) }),
        U.el('td', { class: 'num' + (totals.net < 0 ? ' money-neg' : ''), text: U.fmtNum(totals.net, 2) }),
        U.el('td')
      ])
    ]));

    card.appendChild(U.el('div', { class: 'table-scroll' }, [table]));
    root.appendChild(card);
  };
})(window.App);
