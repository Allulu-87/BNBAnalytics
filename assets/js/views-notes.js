/* BNB Analytics — side notes.
   A plain notebook that belongs to the app rather than to any reservation:
   reminders, supplier prices, things to buy, whatever. Stored in the same
   SQLite database, so it travels in every .sqlite backup and export. */
window.App = window.App || {};
window.App.Views = window.App.Views || {};

(function (App) {
  'use strict';

  var U = App.U, DB = App.DB;

  var draft = '';        // survives re-render while typing a new note
  var query = '';

  /** "12 Aug 2026, 14:30" from an ISO timestamp. */
  function stamp(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    return U.prettyDate(U.iso(d.getFullYear(), d.getMonth() + 1, d.getDate())) +
      ', ' + hh + ':' + mm;
  }

  function noteCard(note, rerender) {
    var ta = U.el('textarea', {
      rows: '4', spellcheck: 'true', dir: 'auto',
      'aria-label': 'Note'
    });
    ta.value = note.body || '';

    /* Saved on blur and patched in place — no re-render, so the caret and any
       other note you have part-written are left alone. */
    var saved = U.el('span', { class: 'note-saved' });
    function paintStamp(updatedAt) {
      saved.textContent = (note.created_at && updatedAt &&
        updatedAt.slice(0, 16) !== note.created_at.slice(0, 16))
        ? 'Edited ' + stamp(updatedAt)
        : 'Added ' + stamp(note.created_at);
    }
    paintStamp(note.updated_at);

    ta.addEventListener('change', function () {
      DB.updateNote(note.id, ta.value);
      App.persist();
      var fresh = DB.one('SELECT updated_at FROM notes WHERE id = ?', [note.id]);
      paintStamp(fresh && fresh.updated_at);
      U.toast('Note saved');
    });

    return U.el('div', { class: 'card note-card' }, [
      ta,
      U.el('div', { class: 'note-foot' }, [
        saved,
        U.el('span', { class: 'spacer', style: 'flex:1' }),
        U.el('button', {
          class: 'btn btn-sm btn-danger', type: 'button',
          onclick: function () {
            var preview = String(note.body || '').trim().slice(0, 60);
            if (!confirm('Delete this note?' + (preview ? '\n\n' + preview + '…' : ''))) return;
            DB.deleteNote(note.id);
            App.persist();
            rerender();
            U.toast('Note deleted');
          }
        }, ['Delete'])
      ])
    ]);
  }

  App.Views.notes = function (root) {
    U.clear(root);
    var rerender = App.refresh;

    /* ── new note ───────────────────────────────────────────────────────── */

    var input = U.el('textarea', {
      rows: '3', spellcheck: 'true', dir: 'auto',
      placeholder: 'Write a note…', 'aria-label': 'New note',
      oninput: function () { draft = this.value; }
    });
    input.value = draft;

    function add() {
      var body = String(input.value || '').trim();
      if (!body) { U.toast('Write something first', true); return; }
      DB.addNote(body);
      App.persist();
      draft = '';
      rerender();
      U.toast('Note added');
    }

    var addCard = U.el('div', { class: 'card' });
    addCard.appendChild(U.el('div', { class: 'card-head' }, [
      U.el('div', null, [
        U.el('h2', { text: 'Side notes' }),
        U.el('p', { text: 'Kept in the same database as everything else, so backups include them.' })
      ])
    ]));
    addCard.appendChild(input);
    addCard.appendChild(U.el('div', { class: 'row', style: 'margin-top:.55rem' }, [
      U.el('button', { class: 'btn btn-primary', type: 'button', onclick: add }, ['Add note'])
    ]));
    root.appendChild(addCard);

    /* ── the list ───────────────────────────────────────────────────────── */

    var all = DB.notes();
    var q = query.trim().toLowerCase();
    var shown = q
      ? all.filter(function (n) { return String(n.body || '').toLowerCase().indexOf(q) !== -1; })
      : all;

    if (all.length) {
      root.appendChild(U.el('div', { class: 'filterbar', style: 'margin-bottom:.8rem' }, [
        U.el('div', { class: 'field wide' }, [
          U.el('label', { text: 'Search notes' }),
          U.el('input', {
            type: 'search', value: query, placeholder: 'Find a note…',
            'aria-label': 'Search notes',
            oninput: U.debounce(function () { query = this.value; App.refresh(); }, 260)
          })
        ]),
        U.el('div', { class: 'field' }, [
          U.el('label', { text: 'Showing' }),
          U.el('div', { class: 'small muted', style: 'padding-top:.5rem' }, [
            shown.length + ' of ' + all.length
          ])
        ])
      ]));
    }

    if (!shown.length) {
      root.appendChild(U.el('div', { class: 'card' }, [
        U.el('div', { class: 'empty' }, [
          all.length
            ? 'No note matches that search.'
            : 'No notes yet. Anything you write above is saved here, newest first.'
        ])
      ]));
      return;
    }

    shown.forEach(function (n) { root.appendChild(noteCard(n, rerender)); });
  };
})(window.App);
