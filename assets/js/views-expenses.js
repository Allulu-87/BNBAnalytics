/* BNB Analytics — anytime expenses (bills and supplies).
   Not tied to a booking: each row has a category, amount, date, a
   paid/not-paid flag with its own date paid, and an optional listing. */
window.App = window.App || {};
window.App.Views = window.App.Views || {};

(function (App) {
  'use strict';

  var U = App.U, DB = App.DB;

  var editing = null;              // expense id being edited, or null for "new"
  var localFilter = { category: '', paid: '' };
  var draft = null;                // preserved across re-render

  function blankDraft() {
    return {
      category: 'Gas Bill', detail: '', listing_id: '', amount: '',
      expense_date: U.todayISO(), is_paid: false, date_paid: '', note: ''
    };
  }

  function form(root) {
    if (!draft) draft = blankDraft();

    var listings = DB.listings();

    var catSel = U.el('select', {
      'aria-label': 'Category',
      onchange: function () {
        draft.category = this.value;
        App.refresh();
      }
    }, DB.EXPENSE_CATEGORIES.map(function (c) {
      return U.el('option', { value: c, text: c, selected: draft.category === c });
    }));

    var detail = U.el('input', {
      type: 'text', value: draft.detail || '', placeholder: 'What was it?',
      'aria-label': 'Specify what this was',
      oninput: function () { draft.detail = this.value; }
    });

    var amount = U.el('input', {
      type: 'number', step: '0.001', min: '0', inputmode: 'decimal',
      value: draft.amount, placeholder: '0.000', 'aria-label': 'Amount',
      oninput: function () { draft.amount = this.value; }
    });

    var date = App.DP.attach(
      U.el('input', { type: 'text', value: draft.expense_date, 'aria-label': 'Date of expense' }),
      {
        placeholder: 'Date of expense',
        onPick: function (iso) { draft.expense_date = iso; }
      }
    );

    var listingSel = U.el('select', {
      'aria-label': 'Listing',
      onchange: function () { draft.listing_id = this.value; }
    }, [U.el('option', { value: '', text: 'All listings (shared)' })].concat(
      listings.map(function (l) {
        return U.el('option', { value: l.id, text: l.name, selected: String(draft.listing_id) === String(l.id) });
      })));

    var paid = U.el('input', { type: 'checkbox', id: 'exp-paid' });
    paid.checked = !!draft.is_paid;
    paid.addEventListener('change', function () {
      draft.is_paid = this.checked;
      if (this.checked && !draft.date_paid) { draft.date_paid = draft.expense_date || U.todayISO(); }
      App.refresh();
    });

    var datePaid = App.DP.attach(
      U.el('input', { type: 'text', value: draft.date_paid || '', 'aria-label': 'Date paid' }),
      {
        placeholder: 'Not paid yet',
        onPick: function (iso) { draft.date_paid = iso; }
      }
    );

    var note = U.el('input', {
      type: 'text', value: draft.note || '', placeholder: 'Note (optional)',
      'aria-label': 'Note',
      oninput: function () { draft.note = this.value; }
    });

    function save() {
      var amt = U.parseNum(draft.amount);
      if (!amt) { U.toast('Enter an amount first', true); return; }
      if (!U.isISO(draft.expense_date)) { U.toast('Pick a date for this expense', true); return; }
      if (draft.category === 'Other' && !String(draft.detail).trim()) {
        U.toast('Say what the "Other" expense was', true); return;
      }
      DB.saveExpense({
        id: editing || null,
        category: draft.category,
        detail: String(draft.detail || '').trim() || null,
        listing_id: draft.listing_id ? parseInt(draft.listing_id, 10) : null,
        amount: amt,
        expense_date: draft.expense_date,
        date_paid: draft.date_paid || null,
        is_paid: draft.is_paid ? 1 : 0,
        note: String(draft.note || '').trim() || null
      });
      App.persist();
      U.toast(editing ? 'Expense updated' : 'Expense added');
      editing = null;
      draft = blankDraft();
      App.refresh();
    }

    var fields = [
      U.el('div', { class: 'field', style: 'flex:1 1 175px' }, [U.el('label', { text: 'Category' }), catSel])
    ];
    if (draft.category === 'Other') {
      fields.push(U.el('div', { class: 'field', style: 'flex:1 1 175px' }, [
        U.el('label', { text: 'Specify' }), detail
      ]));
    }
    fields.push(
      U.el('div', { class: 'field', style: 'flex:1 1 120px' }, [U.el('label', { text: 'Amount (' + U.currency + ')' }), amount]),
      U.el('div', { class: 'field', style: 'flex:1 1 140px' }, [U.el('label', { text: 'Date' }), date]),
      U.el('div', { class: 'field', style: 'flex:1 1 165px' }, [U.el('label', { text: 'Listing' }), listingSel]),
      U.el('div', { class: 'field', style: 'flex:1 1 140px' }, [U.el('label', { text: 'Date paid' }), datePaid]),
      U.el('div', { class: 'field', style: 'flex:2 1 180px' }, [U.el('label', { text: 'Note' }), note])
    );

    var actions = U.el('div', { class: 'row', style: 'margin-top:.65rem' }, [
      paid,
      U.el('label', { for: 'exp-paid', text: 'Payment processed' }),
      U.el('span', { style: 'flex:1' }),
      editing ? U.el('button', {
        class: 'btn', type: 'button',
        onclick: function () { editing = null; draft = blankDraft(); App.refresh(); }
      }, ['Cancel']) : null,
      U.el('button', { class: 'btn btn-primary', type: 'button', onclick: save },
        [editing ? 'Save changes' : 'Add expense'])
    ]);

    var card = U.el('div', { class: 'card' });
    card.appendChild(U.el('div', { class: 'card-head' }, [
      U.el('div', null, [
        U.el('h2', { text: editing ? 'Edit expense' : 'Add an expense' }),
        U.el('p', { text: 'Bills and supplies that are not tied to one booking.' })
      ])
    ]));
    card.appendChild(U.el('div', { class: 'row', style: 'align-items:flex-end' }, fields));
    card.appendChild(actions);
    root.appendChild(card);
  }

  App.Views.expenses = function (root) {
    U.clear(root);
    form(root);

    var f = App.state.filter();
    f.category = localFilter.category;
    f.paid = localFilter.paid;
    var rows = DB.expenses(f);
    var total = rows.reduce(function (a, r) { return a + r.amount; }, 0);
    var unpaid = rows.reduce(function (a, r) { return a + (r.is_paid ? 0 : r.amount); }, 0);

    var catSel = U.el('select', {
      onchange: function () { localFilter.category = this.value; App.refresh(); }
    }, [U.el('option', { value: '', text: 'All categories' })].concat(
      DB.EXPENSE_CATEGORIES.map(function (c) {
        return U.el('option', { value: c, text: c, selected: localFilter.category === c });
      })));

    var paidSel = U.el('select', {
      onchange: function () { localFilter.paid = this.value; App.refresh(); }
    }, [
      U.el('option', { value: '', text: 'Any payment state' }),
      U.el('option', { value: 'due', text: 'Not paid yet', selected: localFilter.paid === 'due' }),
      U.el('option', { value: 'paid', text: 'Paid', selected: localFilter.paid === 'paid' })
    ]);

    var card = U.el('div', { class: 'card' });
    card.appendChild(U.el('div', { class: 'card-head' }, [
      U.el('div', null, [
        U.el('h2', { text: 'Expense log' }),
        U.el('p', { text: rows.length + ' entries · ' + U.fmtMoney(total, 2) + ' total, ' + U.fmtMoney(unpaid, 2) + ' unpaid.' })
      ]),
      U.el('div', { class: 'spacer' }),
      U.el('div', { class: 'field', style: 'flex:0 0 auto;min-width:160px' }, [catSel]),
      U.el('div', { class: 'field', style: 'flex:0 0 auto;min-width:170px' }, [paidSel])
    ]));

    if (!rows.length) {
      card.appendChild(U.el('div', { class: 'empty', text: 'No expenses match these filters.' }));
      root.appendChild(card);
      return;
    }

    var table = U.el('table', { class: 'data' });
    table.appendChild(U.el('thead', null, [
      U.el('tr', null, ['Date', 'Category', 'Detail', 'Listing', 'Amount', 'Payment', 'Date paid', 'Note', ''].map(function (h, i) {
        return U.el('th', { class: (i === 4 ? 'num' : ''), text: h });
      }))
    ]));

    var tbody = U.el('tbody');
    rows.forEach(function (r) {
      tbody.appendChild(U.el('tr', null, [
        U.el('td', { text: U.prettyDate(r.expense_date) }),
        U.el('td', { text: r.category }),
        U.el('td', { class: 'wrap', dir: 'auto', text: r.detail || '—' }),
        U.el('td', { class: 'wrap', text: r.listing_name || 'All listings' }),
        U.el('td', { class: 'num', text: U.fmtNum(r.amount, 2) }),
        U.el('td', null, [U.el('span', {
          class: 'badge ' + (r.is_paid ? 'paid' : 'due'),
          text: r.is_paid ? 'paid' : 'not paid'
        })]),
        U.el('td', { text: r.date_paid ? U.prettyDate(r.date_paid) : '—' }),
        U.el('td', { class: 'wrap', dir: 'auto', text: r.note || '—' }),
        U.el('td', null, [U.el('div', { class: 'row', style: 'gap:.25rem;flex-wrap:nowrap' }, [
          U.el('button', {
            class: 'btn btn-sm', type: 'button', title: 'Edit',
            onclick: function () {
              editing = r.id;
              draft = {
                category: r.category, detail: r.detail || '',
                listing_id: r.listing_id || '', amount: r.amount,
                expense_date: r.expense_date, is_paid: !!r.is_paid,
                date_paid: r.date_paid || '', note: r.note || ''
              };
              App.refresh();
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }
          }, ['Edit']),
          U.el('button', {
            class: 'btn btn-sm btn-danger', type: 'button', title: 'Delete',
            onclick: function () {
              if (!confirm('Delete this expense?\n\n' + r.category + ' · ' + U.fmtMoney(r.amount, 2))) return;
              DB.deleteExpense(r.id);
              App.persist();
              if (editing === r.id) { editing = null; draft = blankDraft(); }
              App.refresh();
              U.toast('Expense deleted');
            }
          }, ['Delete'])
        ])])
      ]));
    });
    table.appendChild(tbody);
    table.appendChild(U.el('tfoot', null, [
      U.el('tr', null, [
        U.el('td', { colspan: 4, text: 'Total' }),
        U.el('td', { class: 'num', text: U.fmtNum(total, 2) }),
        U.el('td', { colspan: 4, text: U.fmtMoney(unpaid, 2) + ' unpaid' })
      ])
    ]));

    card.appendChild(U.el('div', { class: 'table-scroll' }, [table]));
    root.appendChild(card);
  };
})(window.App);
