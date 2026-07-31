/* BNB Analytics — reservations table + the per-booking cost editor.
   Each booking carries three charge slots (watchman profit, water
   bottles, fruits); every one has an amount, a date paid, and a
   processed/not-processed flag. */
window.App = window.App || {};
window.App.Views = window.App.Views || {};

(function (App) {
  'use strict';

  var U = App.U, DB = App.DB;

  var sort = { by: 'start_date', dir: 'desc' };
  var openRow = null;      // reservation id whose editor is expanded
  var localFilter = { status: '', paid: '', payout: '' };

  function statusBadge(r) {
    return U.el('span', {
      class: 'badge' + (r.is_cancelled ? ' due' : ''),
      text: r.status || '—'
    });
  }

  /** Guest name, flagged when the booking carries a note. */
  function guestContent(r) {
    var kids = [U.el('span', { dir: 'auto', text: r.guest_name || '—' })];
    if (r.notes && String(r.notes).trim()) {
      kids.push(U.el('span', {
        class: 'badge note-badge', text: 'note',
        title: String(r.notes).slice(0, 400)
      }));
    }
    return kids;
  }

  /** Struck through when cancelled, dimmed when the payout hasn't landed. */
  function earningsClass(r) {
    if (r.is_cancelled) return 'num money-void';
    if (!r.payout_received) return 'num money-awaiting';
    return 'num';
  }

  function earningsTitle(r) {
    if (r.is_cancelled) return 'Cancelled — ' + U.fmtMoney(r.earnings_raw, 3) + ' is not counted';
    if (!r.payout_received) return 'Not received in the bank yet, so it is not in net profit';
    return null;
  }

  function earningsCell(r) {
    return U.el('td', {
      class: earningsClass(r), title: earningsTitle(r)
    }, [U.fmtNum(r.earnings_raw, 2)]);
  }

  /** Has the Airbnb payout landed in the bank? */
  function payoutBadge(r) {
    if (r.is_cancelled) return U.el('span', { class: 'badge muted', text: 'n/a' });
    if (r.payout_received) {
      return U.el('span', {
        class: 'badge paid', text: 'in bank',
        title: r.payout_date ? 'Received ' + U.prettyDate(r.payout_date) : 'Received'
      });
    }
    return U.el('span', {
      class: 'badge due', text: 'awaiting',
      title: 'Not received in the bank yet — excluded from net profit'
    });
  }

  function paidBadge(r) {
    if (r.is_cancelled) {
      return U.el('span', {
        class: 'badge muted', text: 'n/a',
        title: 'Cancelled — no payments are tracked against it'
      });
    }
    if (!r.cost_total) return U.el('span', { class: 'badge muted', text: 'no costs' });
    if (r.cost_unpaid > 0.0005) {
      return U.el('span', { class: 'badge due', text: U.fmtNum(r.cost_unpaid, 2) + ' due' });
    }
    return U.el('span', { class: 'badge paid', text: 'paid' });
  }

  /* ── the four charge editors ──────────────────────────────────────────── */

  /**
   * One charge as a table row.
   *
   * `onSaved` deliberately does NOT re-render the view. Rebuilding the whole
   * table on every field edit destroyed the inputs mid-use: focus was lost, the
   * date picker closed, and any horizontal scroll snapped back to the left. So
   * a charge edit writes to the database and then patches just the figures that
   * changed, leaving every input exactly where it was.
   */
  function chargeRow(res, kind, existing, onSaved) {
    var row = existing || { amount: 0, date_paid: null, is_paid: 0, note: null };
    var rate = U.parseNum(DB.getSetting('watchman_rate'));
    var expect = (kind.key === 'watchman' && res.nights > 0)
      ? U.round(rate * res.nights, 3)
      : null;
    var tr = U.el('tr', { class: row.amount > 0 ? 'is-set' : '' });
    var useBtn = null;

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
      type: 'checkbox', id: 'paid-' + res.id + '-' + kind.key,
      // no visible text beside it, so the column header alone isn't enough
      'aria-label': kind.label + ' payment processed'
    });
    isPaid.checked = !!row.is_paid;

    var note = U.el('input', {
      type: 'text', value: row.note || '', placeholder: 'Notes',
      'aria-label': kind.label + ' notes'
    });

    function commit() {
      var amt = U.parseNum(amount.value);
      var lower = kind.label.toLowerCase();

      /* "Processed" asserts that money actually moved, and it is what gets
         deducted from the booking — so it needs both an amount and the date it
         was paid. Refuse the tick rather than inventing either. */
      if (isPaid.checked && !(amt > 0)) {
        U.toast('Enter an amount for ' + lower + ' before marking it processed', true);
        isPaid.checked = false;
      } else if (isPaid.checked && !U.isISO(datePaid.value)) {
        U.toast('Enter the date ' + lower + ' was paid before marking it processed', true);
        isPaid.checked = false;
      }
      // an amountless charge cannot exist at all, note or not
      if (!(amt > 0) && note.value.trim()) {
        U.toast('Enter an amount for ' + lower + ' first', true);
      }

      DB.saveCharge(res.id, kind.key, {
        amount: amt,
        date_paid: datePaid.value || null,
        is_paid: isPaid.checked ? 1 : 0,
        note: note.value.trim() || null
      });
      App.persist();

      // patch this row in place, then let the caller refresh the figures
      tr.className = amt > 0 ? 'is-set' : '';
      syncUseBtn();
      onSaved();
    }

    /** The "use N" shortcut only makes sense while the amount differs. */
    function syncUseBtn() {
      if (!useBtn) return;
      useBtn.style.display =
        Math.abs(U.parseNum(amount.value) - expect) > 0.0005 ? '' : 'none';
    }

    App.DP.attach(datePaid, { placeholder: 'Not paid yet', onPick: commit });

    amount.addEventListener('change', commit);
    note.addEventListener('change', commit);
    isPaid.addEventListener('change', commit);

    var hint = expect != null
      ? U.fmtNum(rate, 3) + ' × ' + res.nights + ' nights'
      : kind.hint;

    var nameCell = U.el('td', {
      class: 'c-name',
      title: kind.label + ' — ' + hint
    }, [
      U.el('strong', { text: kind.short || kind.label }),
      U.el('span', { class: 'hint', text: hint })
    ]);

    if (expect != null) {
      useBtn = U.el('button', {
        class: 'cr-usebtn', type: 'button',
        onclick: function () { amount.value = expect; commit(); }
      }, ['use ' + U.fmtNum(expect, 3)]);
      nameCell.appendChild(useBtn);
      syncUseBtn();
    }

    [
      nameCell,
      U.el('td', { class: 'c-amount' }, [amount]),
      U.el('td', { class: 'c-date' }, [datePaid]),
      U.el('td', { class: 'c-note' }, [note]),
      U.el('td', { class: 'c-paid' }, [isPaid])
    ].forEach(function (td) { tr.appendChild(td); });

    return tr;
  }

  /** Everything the table row itself has no column for. */
  function factGrid(res) {
    var facts = [
      ['Confirmation', res.confirmation_code],
      ['Status', res.status || '—'],
      ['Contact', res.contact || '—'],
      ['Guests', res.adults + ' adults · ' + res.children + ' children · ' +
        res.infants + ' infants'],
      ['Stay', res.nights_raw + ' night' + (res.nights_raw === 1 ? '' : 's') + ' · ' +
        U.prettyDate(res.start_date) + ' → ' + U.prettyDate(res.end_date)],
      ['Booked', U.prettyDate(res.booked_date)],
      ['Earnings', U.fmtMoney(res.earnings_raw, 3) +
        (res.is_cancelled ? '  (cancelled — not counted)' : '')]
    ];

    var dl = U.el('dl', { class: 'fact-grid' });
    facts.forEach(function (f) {
      dl.appendChild(U.el('dt', { text: f[0] }));
      dl.appendChild(U.el('dd', { dir: 'auto', text: f[1] }));
    });
    return dl;
  }

  /**
   * "Payout received in the bank" — the switch that lets a reservation's earnings
   * into net profit. Deliberately separate from the per-booking charges below it:
   * those deduct on their own schedule regardless of this.
   */
  function payoutControl(res, onChanged) {
    var box = U.el('div', { class: 'payout-box' });
    var noteEl = U.el('p', { class: 'payout-note' });

    var date = U.el('input', {
      type: 'text', value: res.payout_date || '',
      'aria-label': 'Date the payout reached the bank'
    });

    var got = U.el('input', {
      type: 'checkbox', 'aria-label': 'Payout received in the bank'
    });
    got.checked = !!res.payout_received;

    /** Says which step is still outstanding. Repainted in place — rebuilding the
        panel would restart the modal's entry animation. */
    function paintNote(cur) {
      if (cur.payout_received) {
        noteEl.textContent = 'Counted in earnings and net profit' +
          (cur.payout_date ? ', received ' + U.prettyDate(cur.payout_date) : '') + '.';
      } else if (cur.payout_date) {
        noteEl.textContent = 'Date saved — tick the box to bring ' +
          U.fmtMoney(cur.earnings_raw, 3) + ' into earnings and net profit.';
      } else {
        noteEl.textContent = U.fmtMoney(cur.earnings_raw, 3) + ' is not in net profit yet. ' +
          'Pick the date it reached the bank, then tick the box.';
      }
    }

    function commit() {
      if (got.checked && !U.isISO(date.value)) {
        U.toast('Enter the date the payout reached the bank', true);
        got.checked = false;
      }
      DB.setPayout(res.id, got.checked, date.value || null);
      App.persist();
      onChanged();                  // patches the figures; never re-renders
    }

    App.DP.attach(date, { placeholder: 'Not received yet', onPick: commit });
    got.addEventListener('change', commit);

    box.appendChild(U.el('label', { class: 'payout-check' }, [got, 'Payout received in the bank']));
    box.appendChild(U.el('div', { class: 'payout-date' }, [date]));
    box.appendChild(noteEl);

    paintNote(res);
    return { el: box, paintNote: paintNote };
  }

  /** Your own note on this booking. Saved on blur, patched in place. */
  function notesField(res, onChanged) {
    var ta = U.el('textarea', {
      rows: '3', spellcheck: 'true', dir: 'auto',
      placeholder: 'Anything worth remembering about this booking…',
      'aria-label': 'Notes for this reservation'
    });
    ta.value = res.notes || '';

    ta.addEventListener('change', function () {
      DB.setReservationNotes(res.id, ta.value);
      App.persist();
      onChanged();
    });

    return U.el('div', { class: 'field res-notes' }, [
      U.el('label', { text: 'Notes' }), ta
    ]);
  }

  function deleteButton(res) {
    return U.el('div', { class: 'row', style: 'margin-top:.6rem' }, [
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
  }

  /**
   * @param {object} res       the reservation row
   * @param {HTMLElement} tr   its row in the outer table, patched in place
   */
  function detailBox(res, tr, onFigures) {
    /* A cancelled booking still opens — the contact number and the rest of the
       details live nowhere else — but it is read-only: no charge editor, because
       nothing is ever recorded against it. */
    if (res.is_cancelled) {
      return U.el('div', { class: 'detail-box' }, [
        factGrid(res),
        U.el('p', { class: 'notice', style: 'margin:0 0 .7rem' }, [
          'Cancelled, so it counts for nothing: no earnings, no nights, and no ' +
          'payments are tracked against it.'
        ]),
        // notes still make sense — often *why* it was cancelled
        notesField(res, function () {
          paintRow(tr, DB.one('SELECT * FROM v_reservations WHERE id = ?', [res.id]) || res);
        }),
        deleteButton(res)
      ]);
    }

    var charges = DB.chargesFor(res.id);
    var totals = U.el('div', { class: 'charge-total' });

    function stat(label, value, cls) {
      return U.el('span', null, [
        U.el('span', { class: 'k', text: label + ' ' }),
        U.el('span', { class: 'v' + (cls ? ' ' + cls : ''), text: value })
      ]);
    }

    var payout = null;   // assigned below; syncFigures repaints its note

    /* Re-read this one reservation and patch every figure it affects: the totals
       line here, the payout note, the row behind the modal, and the table footer.
       Nothing is rebuilt, so the modal does not flicker and no input in it is
       destroyed while in use. */
    function syncFigures() {
      var cur = DB.one('SELECT * FROM v_reservations WHERE id = ?', [res.id]) || res;

      U.clear(totals);
      [
        stat('Earnings', U.fmtMoney(cur.earnings_raw, 3) +
          (cur.payout_received ? '' : ' — awaiting bank'),
          cur.payout_received ? null : 'money-neg'),
        stat('Deducted', U.fmtMoney(cur.cost_paid, 3)),
        cur.cost_pending > 0.0005
          ? stat('Pending', U.fmtMoney(cur.cost_pending, 3) + ' (not deducted)')
          : null,
        stat('Net', U.fmtMoney(cur.net, 3), cur.net < 0 ? 'money-neg' : null)
      ].forEach(function (n) { if (n) totals.appendChild(n); });

      if (payout) payout.paintNote(cur);
      paintRow(tr, cur);
      if (onFigures) onFigures();      // keep the table footer in step
    }

    var table = U.el('table', { class: 'data charge-table' });
    table.appendChild(U.el('thead', null, [
      U.el('tr', null, [
        U.el('th', { class: 'c-name', text: 'Charge' }),
        U.el('th', { class: 'c-amount num', text: U.currency }),
        U.el('th', { class: 'c-date', text: 'Date paid' }),
        U.el('th', { class: 'c-note', text: 'Notes' }),
        U.el('th', { class: 'c-paid', text: 'Done' })
      ])
    ]));
    var tb = U.el('tbody');
    DB.CHARGE_KINDS.forEach(function (kind) {
      tb.appendChild(chargeRow(res, kind, charges[kind.key], syncFigures));
    });
    table.appendChild(tb);
    var rows = U.el('div', { class: 'table-scroll' }, [table]);

    payout = payoutControl(res, syncFigures);
    syncFigures();

    return U.el('div', { class: 'detail-box' }, [
      factGrid(res), payout.el, rows, totals,
      notesField(res, syncFigures), deleteButton(res)
    ]);
  }

  /* ── table ────────────────────────────────────────────────────────────── */

  var COLS = [
    { key: 'confirmation_code', label: 'Code' },
    { key: 'listing_name', label: 'Listing' },
    { key: 'guest_name', label: 'Guest' },
    { key: 'start_date', label: 'Check-in' },
    { key: 'end_date', label: 'Check-out' },
    // these two columns show Airbnb's figures, so they sort by them too
    { key: 'nights_raw', label: 'Nights', num: true },
    { key: 'status', label: 'Status' },
    { key: 'earnings_raw', label: 'Earnings', num: true },
    { key: 'payout_received', label: 'Payout' },
    { key: 'cost_paid', label: 'Deducted', num: true },
    { key: 'net', label: 'Net', num: true },
    { key: null, label: 'Payment' }
  ];

  function colIndex(key) {
    for (var i = 0; i < COLS.length; i++) if (COLS[i].key === key) return i;
    return -1;
  }

  /**
   * Repaint every cell of a row that money can change, from a fresh record.
   * Used instead of re-rendering the view, which would rebuild the modal and
   * replay its open animation — that is the flicker.
   * Indices come from COLS, so adding a column can't misdirect it.
   */
  function paintRow(tr, cur) {
    if (!tr || !tr.cells || tr.cells.length !== COLS.length) return;

    var gCell = U.clear(tr.cells[colIndex('guest_name')]);
    guestContent(cur).forEach(function (n) { gCell.appendChild(n); });

    var eCell = tr.cells[colIndex('earnings_raw')];
    eCell.textContent = U.fmtNum(cur.earnings_raw, 2);
    eCell.className = earningsClass(cur);
    var t = earningsTitle(cur);
    if (t) eCell.setAttribute('title', t); else eCell.removeAttribute('title');

    U.clear(tr.cells[colIndex('payout_received')]).appendChild(payoutBadge(cur));

    tr.cells[colIndex('cost_paid')].textContent = U.fmtNum(cur.cost_paid, 2);

    var netCell = tr.cells[colIndex('net')];
    netCell.textContent = U.fmtNum(cur.net, 2);
    netCell.className = 'num' + (cur.net < 0 ? ' money-neg' : '');

    U.clear(tr.cells[COLS.length - 1]).appendChild(paidBadge(cur));
  }

  /** Open or close a row. The detail opens in a modal, so there is nothing to
      scroll to — the page keeps its position for when it closes. */
  function toggleRow(id, isOpen) {
    openRow = isOpen ? null : id;
    App.refresh();
  }

  App.Views.reservations = function (root) {
    U.clear(root);
    var f = App.state.filter();
    f.sort = sort.by;
    f.dir = sort.dir;
    f.status = localFilter.status;
    f.paid = localFilter.paid;
    f.payout = localFilter.payout;

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

    var payoutSel = U.el('select', {
      onchange: function () { localFilter.payout = this.value; App.refresh(); }
    }, [
      U.el('option', { value: '', text: 'Any payout state' }),
      U.el('option', { value: 'awaiting', text: 'Awaiting bank', selected: localFilter.payout === 'awaiting' }),
      U.el('option', { value: 'received', text: 'Received in bank', selected: localFilter.payout === 'received' })
    ]);

    function sumOf(list) {
      return list.reduce(function (a, r) {
        a.earnings += r.earnings; a.costs += r.cost_paid; a.net += r.net;
        a.nights += r.nights; a.pending += r.cost_pending;
        a.awaiting += r.earnings_awaiting;
        return a;
      }, { earnings: 0, costs: 0, net: 0, nights: 0, pending: 0, awaiting: 0 });
    }
    var totals = sumOf(rows);

    // assigned once the footer exists; charge edits call it to refresh the totals
    var syncFoot = null;
    var bumpFoot = function () { if (syncFoot) syncFoot(); };

    var card = U.el('div', { class: 'card' });
    card.appendChild(U.el('div', { class: 'card-head' }, [
      U.el('div', null, [
        U.el('h2', { text: 'Reservations' }),
        U.el('p', { text: rows.length + ' shown · tap any row to enter the watchman, water and fruit costs.' })
      ]),
      U.el('div', { class: 'spacer' }),
      U.el('div', { class: 'field', style: 'flex:0 0 auto;min-width:150px' }, [statusSel]),
      U.el('div', { class: 'field', style: 'flex:0 0 auto;min-width:165px' }, [payoutSel]),
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

    var openRes = null, openTr = null;   // filled in by the loop below

    var tbody = U.el('tbody');
    rows.forEach(function (r) {
      var isOpen = openRow === r.id;

      /* Every row opens, cancelled included — the contact number and the rest of
         the details are only reachable there. What differs is the contents:
         detailBox() gives a cancelled booking a read-only panel. */
      var tr = U.el('tr', {
        class: (r.is_cancelled ? 'is-void' : '') + (isOpen ? ' is-open' : ''),
        tabindex: 0,
        style: 'cursor:pointer',
        title: r.is_cancelled ? 'Cancelled — tap to view details' : null,
        onclick: function (e) {
          if (e.target.closest('input,select,button,label,a')) return;
          toggleRow(r.id, isOpen);
        },
        onkeydown: function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleRow(r.id, isOpen);
          }
        }
      }, [
        U.el('td', null, [U.el('span', { class: 'mono small', text: r.confirmation_code })]),
        U.el('td', { class: 'wrap', text: r.listing_name }),
        U.el('td', { class: 'wrap' }, guestContent(r)),
        U.el('td', { text: U.prettyDate(r.start_date) }),
        U.el('td', { text: U.prettyDate(r.end_date) }),
        U.el('td', { class: 'num', text: r.nights_raw }),
        U.el('td', null, [statusBadge(r)]),
        earningsCell(r),
        U.el('td', null, [payoutBadge(r)]),
        U.el('td', { class: 'num', text: U.fmtNum(r.cost_paid, 2) }),
        U.el('td', { class: 'num' + (r.net < 0 ? ' money-neg' : ''), text: U.fmtNum(r.net, 2) }),
        U.el('td', null, [paidBadge(r)])
      ]);
      tbody.appendChild(tr);
      if (isOpen) { openRes = r; openTr = tr; }
    });
    table.appendChild(tbody);

    var fEarnings = U.el('td', { class: 'num', text: U.fmtNum(totals.earnings, 2) });
    var fAwaiting = U.el('td', {
      class: 'small muted', text: U.fmtNum(totals.awaiting, 2) + ' awaiting'
    });
    var fCosts = U.el('td', { class: 'num', text: U.fmtNum(totals.costs, 2) });
    var fNet = U.el('td', {
      class: 'num' + (totals.net < 0 ? ' money-neg' : ''), text: U.fmtNum(totals.net, 2)
    });
    var fPending = U.el('td', {
      class: 'small muted', text: U.fmtNum(totals.pending, 2) + ' pending'
    });

    table.appendChild(U.el('tfoot', null, [
      U.el('tr', null, [
        U.el('td', { colspan: 5, text: 'Total of ' + rows.length + ' shown' }),
        U.el('td', { class: 'num', text: totals.nights }),
        U.el('td'),
        fEarnings, fAwaiting, fCosts, fNet, fPending
      ])
    ]));

    syncFoot = function () {
      var t = sumOf(DB.reservations(f));
      fEarnings.textContent = U.fmtNum(t.earnings, 2);
      fAwaiting.textContent = U.fmtNum(t.awaiting, 2) + ' awaiting';
      fCosts.textContent = U.fmtNum(t.costs, 2);
      fNet.textContent = U.fmtNum(t.net, 2);
      fNet.className = 'num' + (t.net < 0 ? ' money-neg' : '');
      fPending.textContent = U.fmtNum(t.pending, 2) + ' pending';
    };

    card.appendChild(U.el('div', { class: 'table-scroll' }, [table]));
    root.appendChild(card);

    if (openRes) root.appendChild(reservationModal(openRes, openTr, bumpFoot));
  };

  /* ── modal ────────────────────────────────────────────────────────────────
     Opening a reservation in a modal keeps it entirely independent of the
     reservations table: the panel is sized by the viewport, so nothing it holds
     can widen the table or get dragged into the table's sideways scroll. */

  function closeModal() {
    openRow = null;
    App.refresh();
  }

  function reservationModal(res, tr, bumpFoot) {
    var body = U.el('div', { class: 'modal-body' }, [detailBox(res, tr, bumpFoot)]);

    var closeBtn = U.el('button', {
      class: 'btn btn-icon', type: 'button', 'aria-label': 'Close',
      onclick: closeModal
    }, [U.el('span', {
      html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
        '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" ' +
        'stroke-linecap="round"/></svg>'
    })]);

    var modal = U.el('div', {
      class: 'modal', role: 'dialog', 'aria-modal': 'true', tabindex: '-1',
      'aria-label': 'Reservation ' + res.confirmation_code,
      // stop a click inside from reaching the backdrop's dismiss handler
      onclick: function (e) { e.stopPropagation(); }
    }, [
      U.el('div', { class: 'modal-head' }, [
        U.el('div', { class: 'mh-text' }, [
          U.el('h2', { dir: 'auto', text: res.guest_name || res.confirmation_code }),
          U.el('div', { class: 'mh-sub' }, [
            res.confirmation_code + ' · ' + res.listing_name + ' · ' +
            U.prettyDate(res.start_date) + ' → ' + U.prettyDate(res.end_date)
          ])
        ]),
        closeBtn
      ]),
      body
    ]);

    var backdrop = U.el('div', {
      class: 'modal-backdrop',
      onclick: closeModal,                       // tap outside to dismiss
      onkeydown: function (e) {
        // bubbles up from anything focused inside, so no document listener to leak
        if (e.key === 'Escape') { e.preventDefault(); closeModal(); }
      }
    }, [modal]);

    // move focus in, so Escape works and the keyboard lands in the right place
    setTimeout(function () { if (modal.isConnected !== false) modal.focus(); }, 0);

    return backdrop;
  }
})(window.App);
