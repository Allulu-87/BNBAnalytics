/* BNB Analytics — reservations table, the per-booking cost editor, and the
   add/edit form. Each booking carries a charge slot per DB.CHARGE_KINDS
   (watchman profit, water bottles, fruits, and dry cleaning on request); every
   one has an amount, a date paid, and a processed/not-processed flag. */
window.App = window.App || {};
window.App.Views = window.App.Views || {};

(function (App) {
  'use strict';

  var U = App.U, DB = App.DB;

  var sort = { by: 'start_date', dir: 'desc' };
  var openRow = null;      // reservation id whose editor is expanded
  var editRes = null;      // 'new', or an id, while the add/edit form is open
  var localFilter = { status: '', paid: '', payout: '' };
  var paging = U.pageState('reservations');

  /** The filter the table is currently showing. Shared by the view and by the
      "did the booking I just added land in view?" check. */
  function currentFilter() {
    var f = App.state.filter();
    f.sort = sort.by;
    f.dir = sort.dir;
    f.status = localFilter.status;
    f.paid = localFilter.paid;
    f.payout = localFilter.payout;
    return f;
  }

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
    // every kind has a default now, so the "use N" shortcut applies to all
    var expect = DB.defaultChargeAmount(kind, res.nights) || null;
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

    var hint = kind.perNight
      ? U.fmtNum(U.parseNum(DB.getSetting(kind.settingKey)), 3) + ' × ' + res.nights + ' nights'
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

  /**
   * Opt-in switch for a charge that is off by default.
   * Ticking it creates the charge at its default amount; unticking removes it
   * (saveCharge deletes anything with a non-positive amount).
   */
  function optionalChargeToggle(res, kind, present, onChanged) {
    var amount = DB.defaultChargeAmount(kind, res.nights);

    var cb = U.el('input', {
      type: 'checkbox',
      'aria-label': kind.label + ' post checkout?'
    });
    cb.checked = !!present;

    cb.addEventListener('change', function () {
      DB.saveCharge(res.id, kind.key,
        cb.checked ? { amount: amount, is_paid: 0 } : { amount: 0 });
      App.persist();
      onChanged();
    });

    return U.el('div', { class: 'payout-box optional-charge' }, [
      U.el('label', { class: 'payout-check' }, [cb, kind.label + ' post checkout?']),
      U.el('p', { class: 'payout-note' }, [
        cb.checked
          ? 'Charged at ' + U.fmtMoney(amount, 3) + ' — edit the amount in the table below.'
          : 'Not charged. Tick to add ' + U.fmtMoney(amount, 3) + ' to this booking.'
      ])
    ]);
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

  /** Edit and delete, at the foot of the detail panel.
      Editing swaps this modal for the form one — two stacked modals would fight
      over the backdrop and the scroll lock. */
  function detailActions(res) {
    return U.el('div', { class: 'row', style: 'margin-top:.6rem' }, [
      U.el('button', {
        class: 'btn btn-sm', type: 'button',
        title: 'Correct anything Airbnb got wrong, or fill in a booking taken elsewhere',
        onclick: function () { editRes = res.id; App.refresh(); }
      }, ['Edit details']),
      U.el('span', { style: 'flex:1' }),
      U.el('button', {
        class: 'btn btn-sm btn-danger', type: 'button',
        onclick: function () {
          if (!confirm('Delete this reservation and its costs?\n\n' +
            res.confirmation_code + ' · ' + (res.guest_name || '') +
            '\n\nIf it came from Airbnb it will come back the next time you ' +
            'import a CSV that contains it.')) return;
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
        detailActions(res)
      ]);
    }

    var totals = U.el('div', { class: 'charge-total' });
    var optionalHost = U.el('div');

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
    table.appendChild(tb);
    var rows = U.el('div', { class: 'table-scroll' }, [table]);

    /* Which rows exist depends on the optional toggles, so the body and the
       toggles are rebuilt together — but only them. Rebuilding the whole view
       would replay the modal's entry animation. */
    function rebuildCharges() {
      var charges = DB.chargesFor(res.id);

      U.clear(tb);
      DB.CHARGE_KINDS.forEach(function (kind) {
        if (kind.optional && !charges[kind.key]) return;   // off until asked for
        tb.appendChild(chargeRow(res, kind, charges[kind.key], syncFigures));
      });

      U.clear(optionalHost);
      DB.CHARGE_KINDS.forEach(function (kind) {
        if (!kind.optional) return;
        optionalHost.appendChild(optionalChargeToggle(
          res, kind, charges[kind.key],
          function () { rebuildCharges(); syncFigures(); }
        ));
      });

      /* Rebuilt rows carry fresh date inputs that need pickers. Only mount here
         when we are already in the document — on the first build nothing is
         attached yet, and mount() drains the queue, which would throw away the
         pickers that render() is about to create. */
      if (tb.isConnected) App.DP.mount();
    }

    payout = payoutControl(res, syncFigures);
    rebuildCharges();
    syncFigures();

    return U.el('div', { class: 'detail-box' }, [
      factGrid(res), payout.el, rows, optionalHost, totals,
      notesField(res, syncFigures), detailActions(res)
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
    var f = currentFilter();
    var rows = DB.reservations(f);
    // the filters and sort identify the list; a change to either returns to page 1
    var view = U.page(rows, paging, JSON.stringify(f));

    /* local (view-specific) controls */
    /* The managed list plus anything an import actually brought in, so a status
       nobody chose is still filterable and a managed one is offered before its
       first booking exists. */
    var statusChoices = DB.statusOptions().concat(DB.statuses())
      .filter(function (s, i, a) { return s && a.indexOf(s) === i; });

    var statusSel = U.el('select', {
      onchange: function () { localFilter.status = this.value; App.refresh(); }
    }, [U.el('option', { value: '', text: 'Any status' })].concat(
      statusChoices.map(function (st) {
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
        U.el('p', {
          text: (view.total > view.rows.length
            ? 'Showing ' + view.first + '–' + view.last + ' of ' + view.total
            : view.total + ' shown') +
            ' · tap any row to record its costs and payout.'
        })
      ]),
      U.el('div', { class: 'spacer' }),
      U.el('button', {
        class: 'btn btn-primary', type: 'button',
        title: 'Enter a booking that is not in an Airbnb export',
        onclick: function () { openRow = null; editRes = 'new'; App.refresh(); }
      }, ['Add reservation']),
      U.el('div', { class: 'field', style: 'flex:0 0 auto;min-width:150px' }, [statusSel]),
      U.el('div', { class: 'field', style: 'flex:0 0 auto;min-width:165px' }, [payoutSel]),
      U.el('div', { class: 'field', style: 'flex:0 0 auto;min-width:170px' }, [paidSel])
    ]));

    if (!rows.length) {
      card.appendChild(U.el('div', { class: 'empty', text: 'No reservations match these filters.' }));
      root.appendChild(card);
      appendModal(root, null, null, null);   // "Add reservation" still has to work
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
    view.rows.forEach(function (r) {
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

    /* The footer totals every row the filters match, not just this page — a
       running total of whichever ten rows you happen to be looking at would be
       a number with no meaning. */
    table.appendChild(U.el('tfoot', null, [
      U.el('tr', null, [
        U.el('td', { colspan: 5, text: 'Total of all ' + rows.length + ' matching' }),
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
    var pager = U.pager(view, paging, App.refresh, 'reservations');
    if (pager) card.appendChild(pager);
    root.appendChild(card);

    appendModal(root, openRes, openTr, bumpFoot);
  };

  /** At most one modal is ever up. The form wins when both are asked for, so
      "Edit details" replaces the detail panel and returns to it when it closes. */
  function appendModal(root, openRes, openTr, bumpFoot) {
    if (editRes !== null) {
      var target = editRes === 'new'
        ? null
        : DB.one('SELECT * FROM v_reservations WHERE id = ?', [editRes]);
      if (editRes === 'new' || target) {
        root.appendChild(formModal(target));
        return;
      }
      editRes = null;          // it was deleted from under us
    }
    if (openRes) root.appendChild(reservationModal(openRes, openTr, bumpFoot));
  }

  /* ── modal ────────────────────────────────────────────────────────────────
     Opening a reservation in a modal keeps it entirely independent of the
     reservations table: the panel is sized by the viewport, so nothing it holds
     can widen the table or get dragged into the table's sideways scroll. */

  /**
   * Backdrop, panel, head and dismissal — shared by both modals so they cannot
   * drift apart in behaviour.
   * @param {{title, sub, label, body, onClose, dismissOnBackdrop}} opts
   */
  function modalShell(opts) {
    var closeBtn = U.el('button', {
      class: 'btn btn-icon', type: 'button', 'aria-label': 'Close',
      onclick: opts.onClose
    }, [U.el('span', {
      html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
        '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" ' +
        'stroke-linecap="round"/></svg>'
    })]);

    var modal = U.el('div', {
      class: 'modal', role: 'dialog', 'aria-modal': 'true', tabindex: '-1',
      'aria-label': opts.label,
      // stop a click inside from reaching the backdrop's dismiss handler
      onclick: function (e) { e.stopPropagation(); }
    }, [
      U.el('div', { class: 'modal-head' }, [
        U.el('div', { class: 'mh-text' }, [
          U.el('h2', { dir: 'auto', text: opts.title }),
          opts.sub ? U.el('div', { class: 'mh-sub' }, [opts.sub]) : null
        ]),
        closeBtn
      ]),
      U.el('div', { class: 'modal-body' }, [opts.body])
    ]);

    var backdrop = U.el('div', {
      class: 'modal-backdrop',
      onclick: opts.dismissOnBackdrop ? opts.onClose : null,
      onkeydown: function (e) {
        // bubbles up from anything focused inside, so no document listener to leak
        if (e.key === 'Escape') { e.preventDefault(); opts.onClose(); }
      }
    }, [modal]);

    // move focus in, so Escape works and the keyboard lands in the right place
    setTimeout(function () { if (modal.isConnected !== false) modal.focus(); }, 0);

    return backdrop;
  }

  function closeModal() {
    openRow = null;
    App.refresh();
  }

  function reservationModal(res, tr, bumpFoot) {
    return modalShell({
      title: res.guest_name || res.confirmation_code,
      sub: res.confirmation_code + ' · ' + res.listing_name + ' · ' +
        U.prettyDate(res.start_date) + ' → ' + U.prettyDate(res.end_date),
      label: 'Reservation ' + res.confirmation_code,
      body: detailBox(res, tr, bumpFoot),
      onClose: closeModal,
      dismissOnBackdrop: true        // nothing here is unsaved; every field commits
    });
  }

  /* ── adding and editing by hand ───────────────────────────────────────────
     An Airbnb export is the usual source, but a booking taken outside it — or
     one the export got wrong — has to be enterable too. The form writes exactly
     the columns the importer writes, so Airbnb stays authoritative: re-importing
     a CSV that carries the same confirmation code will update the record again.
     Charges, payout and notes are never touched by either path. */

  function formModal(res) {
    var isNew = !res;
    var dirty = false;

    function close() {
      if (dirty && !confirm(isNew
        ? 'Discard this new reservation?'
        : 'Discard the changes to this reservation?')) return;
      editRes = null;
      App.refresh();
    }

    /* ── listing and status: both picked from lists kept in Settings ─────── */

    var listings = DB.listings();
    var listingSel = U.el('select', { 'aria-label': 'Listing' },
      listings.map(function (l) { return U.el('option', { value: l.id, text: l.name }); }));
    if (res && res.listing_id) listingSel.value = String(res.listing_id);

    /* The managed list, plus this booking's own status when it is not on it. An
       import can bring back wording nobody chose, and merely opening such a
       booking must not quietly re-label it. */
    var statusOptions = DB.statusOptions();
    var ownStatus = res && res.status ? String(res.status).trim() : '';
    var unmanaged = ownStatus && statusOptions.indexOf(ownStatus) === -1;
    var statusSel = U.el('select', { 'aria-label': 'Status' },
      statusOptions.map(function (s) { return U.el('option', { value: s, text: s }); })
        .concat(unmanaged
          ? [U.el('option', { value: ownStatus, text: ownStatus + '  (from the import)' })]
          : []));
    statusSel.value = ownStatus ||
      (statusOptions.indexOf('Confirmed') !== -1 ? 'Confirmed' : statusOptions[0]);

    /* ── the rest of the fields ─────────────────────────────────────────── */

    function textIn(value, placeholder, label, type) {
      return U.el('input', {
        type: type || 'text', value: value == null ? '' : value,
        placeholder: placeholder, 'aria-label': label, dir: 'auto'
      });
    }

    function numIn(value, label, step) {
      return U.el('input', {
        type: 'number', step: step || '1', min: '0', inputmode: 'decimal',
        value: value == null ? '' : value, 'aria-label': label
      });
    }

    var code = textIn(res && res.confirmation_code, 'HM1AB2CD3E', 'Confirmation code');

    var guest = textIn(res && res.guest_name, 'Guest name', 'Guest name');
    var contact = textIn(res && res.contact, 'Phone number', 'Contact', 'tel');

    var adults = numIn(res ? res.adults : 1, 'Adults');
    var children = numIn(res ? res.children : 0, 'Children');
    var infants = numIn(res ? res.infants : 0, 'Infants');

    var earnings = numIn(res ? U.round(res.earnings_raw, 3) : '', 'Earnings', '0.001');
    var currency = textIn(res ? res.currency : U.currency, U.currency, 'Currency');

    /* Nights are the gap between the dates — shown, not typed. Two fields that
       can disagree about the same fact is one field too many, and the watchman
       charge is priced off this one. */
    var nightsOut = U.el('div', {
      class: 'static-value', role: 'status', 'aria-label': 'Nights'
    });

    function nightCount() {
      return U.nightsBetween(checkIn.value, checkOut.value);
    }

    function paintNights() {
      var n = nightCount();
      nightsOut.textContent = U.isISO(checkIn.value) && U.isISO(checkOut.value)
        ? n + (n === 1 ? ' night' : ' nights')
        : '—';
    }

    var checkIn = App.DP.attach(
      textIn(res && res.start_date, '', 'Check-in date'),
      { placeholder: 'Check-in', onPick: function () { dirty = true; paintNights(); } });
    var checkOut = App.DP.attach(
      textIn(res && res.end_date, '', 'Check-out date'),
      { placeholder: 'Check-out', onPick: function () { dirty = true; paintNights(); } });
    var booked = App.DP.attach(
      textIn(res && res.booked_date, '', 'Date booked'),
      { placeholder: 'Not recorded', onPick: function () { dirty = true; } });

    paintNights();

    /* ── save ───────────────────────────────────────────────────────────── */

    function whole(input) {
      var n = Math.round(U.parseNum(input.value));
      return n > 0 ? n : 0;
    }

    function save() {
      if (!listings.length) {
        U.toast('Add a listing under Data & export → Settings first', true); return;
      }
      var codeVal = code.value.trim();
      if (!codeVal) { U.toast('Enter the confirmation code', true); return; }

      var listingId = parseInt(listingSel.value, 10);
      if (!listingId) { U.toast('Pick the listing this booking is for', true); return; }

      if (!U.isISO(checkIn.value)) { U.toast('Pick the check-in date', true); return; }
      // required now that the night count is derived from it rather than typed
      if (!U.isISO(checkOut.value)) { U.toast('Pick the check-out date', true); return; }
      if (checkOut.value < checkIn.value) {
        U.toast('Check-out cannot be before check-in', true); return;
      }
      if (U.parseNum(earnings.value) < 0) {
        U.toast('Earnings cannot be negative', true); return;
      }
      if (DB.codeTaken(listingId, codeVal, res ? res.id : null)) {
        U.toast('That confirmation code is already used on this listing', true); return;
      }

      var statusVal = statusSel.value.trim() || null;
      var nights = nightCount();

      /* Cancelling clears everything recorded against the booking — a cancelled
         stay has no watchman, no water and no dues. Say so before doing it. */
      if (res && !res.is_cancelled && DB.isCancelledStatus(statusVal)) {
        var load = DB.cancelledChargeLoad(res.id);
        if (load.n && !confirm(
          'Marking this cancelled removes the ' + load.n + ' payment' +
          (load.n === 1 ? '' : 's') + ' recorded against it (' +
          U.fmtMoney(load.total, 3) + ').\n\nContinue?')) return;
      }

      var rec = {
        confirmation_code: codeVal,
        listing_id: listingId,
        status: statusVal,
        guest_name: guest.value.trim() || null,
        contact: contact.value.trim() || null,
        adults: whole(adults), children: whole(children), infants: whole(infants),
        start_date: checkIn.value,
        end_date: checkOut.value,
        nights: nights,
        booked_date: booked.value || null,
        earnings: U.round(U.parseNum(earnings.value), 3),
        currency: currency.value.trim().toUpperCase() || U.currency
      };

      if (res) {
        DB.saveReservationDetails(res.id, rec);
        DB.purgeCancelledCharges();
        /* Brought back from cancelled: its charges were purged when it was
           cancelled, so give it the standard ones again. seedCharges only fills
           gaps, so an ordinary edit cannot disturb what is already recorded. */
        if (res.is_cancelled) DB.seedCharges(res.id, rec.nights, rec.status);
        App.persist();
        editRes = null;
        App.refresh();
        U.toast('Reservation updated');
        return;
      }

      rec.imported_at = null;            // entered by hand, not from an export
      var id = DB.insertReservation(rec);
      DB.seedCharges(id, rec.nights, rec.status);
      App.persist();

      /* A booking outside the current date window would otherwise vanish the
         moment it is saved, which reads as "it didn't work". And the default
         sort is by check-in, so even a matching one is rarely on page 1 —
         go to whichever page it actually landed on. */
      var all = DB.reservations(currentFilter());
      var ix = -1;
      for (var i = 0; i < all.length; i++) { if (all[i].id === id) { ix = i; break; } }
      if (ix !== -1) paging.page = Math.floor(ix / paging.size) + 1;

      editRes = null;
      openRow = ix === -1 ? null : id;    // open it, ready for its costs
      App.refresh();
      U.toast(ix !== -1 ? 'Reservation added'
        : 'Reservation added — widen the filters above to see it');
    }

    /* ── layout ─────────────────────────────────────────────────────────── */

    function field(label, control, flex, hint) {
      return U.el('div', { class: 'field', style: 'flex:' + flex }, [
        U.el('label', { text: label }), control,
        hint ? U.el('span', { class: 'small muted', text: hint }) : null
      ]);
    }

    var form = U.el('div', null, [
      listings.length ? null : U.el('div', { class: 'notice bad', style: 'margin:0 0 .7rem' }, [
        'There are no listings yet. Add one under Data & export → Settings, ' +
        'then come back — a booking has to belong to a property.'
      ]),
      U.el('div', { class: 'row', style: 'align-items:flex-end' }, [
        field('Listing', listingSel, '2 1 220px'),
        field('Confirmation code', code, '1 1 170px'),
        field('Status', statusSel, '1 1 160px')
      ]),
      U.el('div', { class: 'row', style: 'align-items:flex-end;margin-top:.55rem' }, [
        field('Guest', guest, '2 1 200px'),
        field('Contact', contact, '1 1 160px')
      ]),
      U.el('div', { class: 'row', style: 'align-items:flex-end;margin-top:.55rem' }, [
        field('Check-in', checkIn, '1 1 150px'),
        field('Check-out', checkOut, '1 1 150px'),
        field('Nights', nightsOut, '0 1 100px', 'from the dates'),
        field('Booked', booked, '1 1 150px')
      ]),
      U.el('div', { class: 'row', style: 'align-items:flex-end;margin-top:.55rem' }, [
        field('Earnings', earnings, '1 1 150px'),
        field('Currency', currency, '0 1 90px'),
        field('Adults', adults, '0 1 85px'),
        field('Children', children, '0 1 85px'),
        field('Infants', infants, '0 1 85px')
      ]),
      U.el('p', { class: 'small muted', style: 'margin:.75rem 0 0' }, [
        isNew
          ? 'Saved as a normal booking: it gets the standard per-booking charges, ' +
            'and importing a CSV with this confirmation code will update it.'
          : 'Only Airbnb’s own fields are here. The charges, the payout flag and ' +
            'your notes are kept separately and are not affected by this.'
      ]),
      U.el('div', { class: 'row', style: 'margin-top:.8rem' }, [
        U.el('span', { style: 'flex:1' }),
        U.el('button', { class: 'btn', type: 'button', onclick: close }, ['Cancel']),
        U.el('button', { class: 'btn btn-primary', type: 'button', onclick: save },
          [isNew ? 'Add reservation' : 'Save changes'])
      ])
    ]);

    // one listener for the lot, so an accidental dismissal can warn about losses
    form.addEventListener('input', function () { dirty = true; });
    form.addEventListener('change', function () { dirty = true; });

    return modalShell({
      title: isNew ? 'Add a reservation' : 'Edit reservation',
      sub: isNew
        ? 'For a booking that is not in an Airbnb export'
        : res.confirmation_code + ' · ' + res.listing_name,
      label: isNew ? 'Add a reservation' : 'Edit reservation ' + res.confirmation_code,
      body: form,
      onClose: close
      // no dismissOnBackdrop: a stray tap outside must not throw away typing
    });
  }
})(window.App);
