/* BNB Analytics — SQLite (sql.js / WASM) schema + query API.
   Real SQL, real .sqlite file, no server. */
window.App = window.App || {};

(function (App) {
  'use strict';

  var U = App.U;
  var DB = {
    sql: null,     // the sql.js module
    db: null,      // the open database
    ready: false
  };

  /** Per-booking charge kinds. `auto` rows get seeded on import. */
  DB.CHARGE_KINDS = [
    { key: 'watchman', label: 'Watchman profit', short: 'Watchman', auto: true, hint: 'per night' },
    { key: 'tips', label: 'Watchman tips', short: 'Tips', auto: false, hint: 'free amount' },
    { key: 'water', label: 'Water bottles', short: 'Water', auto: false, hint: 'free amount' },
    { key: 'fruits', label: 'Fruits', short: 'Fruits', auto: false, hint: 'free amount' }
  ];

  /** Anytime expense categories, in the order the user listed them. */
  DB.EXPENSE_CATEGORIES = [
    'Gas Bill', 'Electricity Bill', 'Water Bill', 'Internet Bill',
    'Nescafe 3 in 1', 'Toilet Paper', 'Facial Tissue', 'Surface Cleaner',
    'Surface Cleaning Sheets', 'Sugar Bags', 'Tea Bags', 'Dishwashing Liquid',
    'Cleaning Sponge', 'Slippers', 'Other'
  ];

  var SCHEMA = [
    "PRAGMA foreign_keys = ON;",

    "CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);",

    "CREATE TABLE IF NOT EXISTS listings (" +
    "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
    "  name TEXT NOT NULL UNIQUE" +
    ");",

    "CREATE TABLE IF NOT EXISTS reservations (" +
    "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
    "  confirmation_code TEXT NOT NULL," +
    "  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE," +
    "  status TEXT," +
    "  guest_name TEXT," +
    "  contact TEXT," +
    "  adults INTEGER DEFAULT 0," +
    "  children INTEGER DEFAULT 0," +
    "  infants INTEGER DEFAULT 0," +
    "  start_date TEXT," +
    "  end_date TEXT," +
    "  nights INTEGER DEFAULT 0," +
    "  booked_date TEXT," +
    "  earnings REAL NOT NULL DEFAULT 0," +
    "  currency TEXT DEFAULT 'JD'," +
    "  imported_at TEXT," +
    "  UNIQUE (listing_id, confirmation_code)" +
    ");",

    "CREATE TABLE IF NOT EXISTS booking_charges (" +
    "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
    "  reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE," +
    "  kind TEXT NOT NULL," +
    "  amount REAL NOT NULL DEFAULT 0," +
    "  date_paid TEXT," +
    "  is_paid INTEGER NOT NULL DEFAULT 0," +
    "  note TEXT," +
    "  UNIQUE (reservation_id, kind)" +
    ");",

    "CREATE TABLE IF NOT EXISTS expenses (" +
    "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
    "  category TEXT NOT NULL," +
    "  detail TEXT," +
    "  listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL," +
    "  amount REAL NOT NULL DEFAULT 0," +
    "  expense_date TEXT NOT NULL," +
    "  date_paid TEXT," +
    "  is_paid INTEGER NOT NULL DEFAULT 0," +
    "  note TEXT" +
    ");",

    "CREATE INDEX IF NOT EXISTS ix_res_listing ON reservations(listing_id);",
    "CREATE INDEX IF NOT EXISTS ix_res_start ON reservations(start_date);",
    "CREATE INDEX IF NOT EXISTS ix_res_code ON reservations(confirmation_code);",
    "CREATE INDEX IF NOT EXISTS ix_chg_res ON booking_charges(reservation_id);",
    "CREATE INDEX IF NOT EXISTS ix_exp_date ON expenses(expense_date);",
    "CREATE INDEX IF NOT EXISTS ix_exp_cat ON expenses(category);",

    /* Views are derived, so they are always rebuilt rather than left at an
       older definition on a database created by a previous version. Drop the
       dependent view first. */
    "DROP VIEW IF EXISTS v_reservations;",
    "DROP VIEW IF EXISTS v_booking_costs;",

    /* Per-booking cost rollup */
    "CREATE VIEW v_booking_costs AS " +
    "SELECT reservation_id," +
    "  SUM(amount) AS cost_total," +
    "  SUM(CASE WHEN is_paid = 1 THEN amount ELSE 0 END) AS cost_paid," +
    "  SUM(CASE WHEN is_paid = 0 THEN amount ELSE 0 END) AS cost_unpaid " +
    "FROM booking_charges GROUP BY reservation_id;",

    /* One row per reservation with costs and net already resolved.
       `net` deducts ONLY charges whose payment has actually been processed —
       an amount that has been entered but not yet paid leaves the earnings
       untouched. `cost_pending` is that committed-but-not-yet-deducted money,
       and `net_after_pending` is what the net becomes once it is all settled. */
    "CREATE VIEW v_reservations AS " +
    "SELECT r.id, r.confirmation_code, r.listing_id, l.name AS listing_name," +
    "  r.status, r.guest_name, r.contact," +
    "  r.adults, r.children, r.infants," +
    "  r.adults + r.children + r.infants AS guests," +
    "  r.start_date, r.end_date, r.nights, r.booked_date," +
    "  r.earnings, r.currency, r.imported_at," +
    "  COALESCE(c.cost_total, 0)  AS cost_total," +
    "  COALESCE(c.cost_paid, 0)   AS cost_paid," +
    "  COALESCE(c.cost_unpaid, 0) AS cost_unpaid," +
    "  COALESCE(c.cost_unpaid, 0) AS cost_pending," +
    "  r.earnings - COALESCE(c.cost_paid, 0) AS net," +
    "  r.earnings - COALESCE(c.cost_total, 0) AS net_after_pending," +
    "  CASE WHEN r.nights > 0 THEN r.earnings / r.nights ELSE 0 END AS per_night " +
    "FROM reservations r " +
    "JOIN listings l ON l.id = r.listing_id " +
    "LEFT JOIN v_booking_costs c ON c.reservation_id = r.id;"
  ];

  /* ── boot ─────────────────────────────────────────────────────────────── */

  function wasmBinary() {
    var b64 = window.__SQLJS_WASM_B64__;
    if (!b64) return null;
    var bin = atob(b64), n = bin.length, out = new Uint8Array(n);
    for (var i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /** Reject rather than hang. Emscripten can abort inside a callback without
      ever settling its promise, which would leave the splash spinning forever. */
  function withTimeout(promise, ms, message) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (!done) { done = true; reject(new Error(message)); }
      }, ms);
      promise.then(
        function (v) { if (!done) { done = true; clearTimeout(timer); resolve(v); } },
        function (e) { if (!done) { done = true; clearTimeout(timer); reject(e); } }
      );
    });
  }

  DB.open = function (bytes) {
    if (typeof initSqlJs !== 'function') {
      return Promise.reject(new Error(
        'assets/vendor/sql-wasm.js did not load, so there is no database engine.'));
    }
    var bin = wasmBinary();
    if (!bin) {
      // Without the inlined binary sql.js would try to fetch a .wasm file that
      // this build does not ship — which hangs instead of failing.
      return Promise.reject(new Error(
        'assets/vendor/sql-wasm-binary.js did not load, so the SQLite engine is ' +
        'missing. This is what happens when the browser cannot read the app’s ' +
        'files alongside index.html — serve the folder over http:// instead.'));
    }

    // wasm compilation on a slow phone is legitimately slow; 25s, then give up
    return withTimeout(
      initSqlJs({ wasmBinary: bin }),
      25000,
      'The SQLite engine did not finish starting (WebAssembly may be blocked or too slow here).'
    ).then(function (SQL) {
      DB.sql = SQL;
      DB.db = bytes && bytes.length ? new SQL.Database(bytes) : new SQL.Database();
      DB.migrate();
      DB.ready = true;
      return DB;
    });
  };

  DB.migrate = function () {
    SCHEMA.forEach(function (stmt) { DB.db.run(stmt); });

    /* Sweep out zero-value rows. Earlier builds could store a 0.00 charge when
       "payment processed" was ticked before an amount was typed; saveCharge no
       longer creates them, and this clears any already on file. Idempotent, so
       it is safe to run on every boot. */
    DB.db.run('DELETE FROM booking_charges WHERE amount IS NULL OR amount <= 0');
    DB.db.run('DELETE FROM expenses WHERE amount IS NULL OR amount <= 0');

    if (DB.getSetting('schema_version') == null) DB.setSetting('schema_version', '1');
    if (DB.getSetting('watchman_rate') == null) DB.setSetting('watchman_rate', '2');
    if (DB.getSetting('currency') == null) DB.setSetting('currency', 'JD');
    if (DB.getSetting('decimals') == null) DB.setSetting('decimals', '3');
    if (DB.getSetting('revenue_basis') == null) DB.setSetting('revenue_basis', 'start_date');
    U.currency = DB.getSetting('currency') || 'JD';
    U.decimals = parseInt(DB.getSetting('decimals') || '3', 10);
  };

  /** Replace the live DB with a restored file. Throws if it isn't valid. */
  DB.replace = function (bytes) {
    var fresh = new DB.sql.Database(bytes);
    fresh.exec('SELECT count(*) FROM sqlite_master');   // sanity probe
    if (DB.db) DB.db.close();
    DB.db = fresh;
    DB.migrate();
  };

  DB.export = function () { return DB.db.export(); };

  /* ── query helpers ────────────────────────────────────────────────────── */

  /** sql.js refuses to bind `undefined`, and a missing optional field is the
      normal case for callers. Normalise it to NULL rather than throwing. */
  function bindable(params) {
    if (!params) return params;
    return params.map(function (v) { return v === undefined ? null : v; });
  }

  /** Run a SELECT, get an array of plain row objects. */
  DB.all = function (sql, params) {
    var st = DB.db.prepare(sql);
    try {
      if (params) st.bind(bindable(params));
      var out = [];
      while (st.step()) out.push(st.getAsObject());
      return out;
    } finally { st.free(); }
  };

  DB.one = function (sql, params) {
    var rows = DB.all(sql, params);
    return rows.length ? rows[0] : null;
  };

  DB.run = function (sql, params) { DB.db.run(sql, bindable(params) || []); };

  DB.lastId = function () {
    return DB.one('SELECT last_insert_rowid() AS id').id;
  };

  DB.scalar = function (sql, params) {
    var r = DB.one(sql, params);
    if (!r) return null;
    var k = Object.keys(r)[0];
    return r[k];
  };

  /* ── settings ─────────────────────────────────────────────────────────── */

  DB.getSetting = function (k) {
    var r = DB.one('SELECT v FROM meta WHERE k = ?', [k]);
    return r ? r.v : null;
  };

  DB.setSetting = function (k, v) {
    DB.run('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', [k, String(v)]);
  };

  /* ── listings ─────────────────────────────────────────────────────────── */

  DB.listings = function () {
    return DB.all('SELECT l.id, l.name, COUNT(r.id) AS n FROM listings l ' +
      'LEFT JOIN reservations r ON r.listing_id = l.id GROUP BY l.id ORDER BY l.name');
  };

  DB.listingId = function (name) {
    name = String(name || '').trim();
    if (!name) name = 'Unknown listing';
    var r = DB.one('SELECT id FROM listings WHERE name = ?', [name]);
    if (r) return r.id;
    DB.run('INSERT INTO listings (name) VALUES (?)', [name]);
    return DB.lastId();
  };

  /* ── reservations ─────────────────────────────────────────────────────── */

  DB.reservationExists = function (listingId, code) {
    return !!DB.one('SELECT id FROM reservations WHERE listing_id = ? AND confirmation_code = ?',
      [listingId, code]);
  };

  DB.insertReservation = function (r) {
    DB.run(
      'INSERT INTO reservations (confirmation_code, listing_id, status, guest_name, contact,' +
      ' adults, children, infants, start_date, end_date, nights, booked_date, earnings, currency, imported_at)' +
      ' VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [r.confirmation_code, r.listing_id, r.status, r.guest_name, r.contact,
        r.adults, r.children, r.infants, r.start_date, r.end_date, r.nights,
        r.booked_date, r.earnings, r.currency, r.imported_at]);
    return DB.lastId();
  };

  DB.deleteReservation = function (id) {
    DB.run('DELETE FROM reservations WHERE id = ?', [id]);
  };

  /* ── booking charges ─────────────────────────────────────────────────── */

  DB.chargesFor = function (reservationId) {
    var rows = DB.all('SELECT * FROM booking_charges WHERE reservation_id = ?', [reservationId]);
    var byKind = {};
    rows.forEach(function (r) { byKind[r.kind] = r; });
    return byKind;
  };

  /** Upsert one charge.
      A charge with no money in it is not a charge, so anything that resolves to
      a non-positive amount is deleted rather than stored — ticking "processed"
      or leaving a note before typing an amount must not create a 0.00 row. */
  DB.saveCharge = function (reservationId, kind, patch) {
    var cur = DB.one('SELECT * FROM booking_charges WHERE reservation_id = ? AND kind = ?',
      [reservationId, kind]);
    var next = {
      amount: patch.amount != null ? patch.amount : (cur ? cur.amount : 0),
      date_paid: patch.date_paid !== undefined ? patch.date_paid : (cur ? cur.date_paid : null),
      is_paid: patch.is_paid != null ? (patch.is_paid ? 1 : 0) : (cur ? cur.is_paid : 0),
      note: patch.note !== undefined ? patch.note : (cur ? cur.note : null)
    };
    if (!(next.amount > 0)) {
      if (cur) DB.run('DELETE FROM booking_charges WHERE id = ?', [cur.id]);
      return;
    }
    if (cur) {
      DB.run('UPDATE booking_charges SET amount = ?, date_paid = ?, is_paid = ?, note = ? WHERE id = ?',
        [next.amount, next.date_paid, next.is_paid, next.note, cur.id]);
    } else {
      DB.run('INSERT INTO booking_charges (reservation_id, kind, amount, date_paid, is_paid, note)' +
        ' VALUES (?,?,?,?,?,?)',
        [reservationId, kind, next.amount, next.date_paid, next.is_paid, next.note]);
    }
  };

  /* ── expenses ─────────────────────────────────────────────────────────── */

  DB.saveExpense = function (e) {
    if (e.id) {
      DB.run('UPDATE expenses SET category=?, detail=?, listing_id=?, amount=?, expense_date=?,' +
        ' date_paid=?, is_paid=?, note=? WHERE id=?',
        [e.category, e.detail, e.listing_id, e.amount, e.expense_date,
          e.date_paid, e.is_paid ? 1 : 0, e.note, e.id]);
      return e.id;
    }
    DB.run('INSERT INTO expenses (category, detail, listing_id, amount, expense_date, date_paid, is_paid, note)' +
      ' VALUES (?,?,?,?,?,?,?,?)',
      [e.category, e.detail, e.listing_id, e.amount, e.expense_date,
        e.date_paid, e.is_paid ? 1 : 0, e.note]);
    return DB.lastId();
  };

  DB.deleteExpense = function (id) { DB.run('DELETE FROM expenses WHERE id = ?', [id]); };

  DB.expenses = function (filter) {
    var f = filter || {};
    var w = [], p = [];
    if (f.from) { w.push('expense_date >= ?'); p.push(f.from); }
    if (f.to) { w.push('expense_date <= ?'); p.push(f.to); }
    if (f.listingId) { w.push('(listing_id = ? OR listing_id IS NULL)'); p.push(f.listingId); }
    if (f.category) { w.push('category = ?'); p.push(f.category); }
    if (f.paid === 'paid') w.push('is_paid = 1');
    if (f.paid === 'due') w.push('is_paid = 0');
    if (f.q) {
      w.push('(category LIKE ? OR IFNULL(detail, \'\') LIKE ? OR IFNULL(note, \'\') LIKE ?)');
      var like = '%' + f.q + '%'; p.push(like, like, like);
    }
    var sql = 'SELECT e.*, l.name AS listing_name FROM expenses e ' +
      'LEFT JOIN listings l ON l.id = e.listing_id' +
      (w.length ? ' WHERE ' + w.join(' AND ') : '') +
      ' ORDER BY e.expense_date DESC, e.id DESC';
    return DB.all(sql, p);
  };

  /* ── reservation search ──────────────────────────────────────────────── */

  DB.reservations = function (filter) {
    var f = filter || {};
    var w = [], p = [];
    var dateCol = f.basis || 'start_date';
    if (f.from) { w.push(dateCol + ' >= ?'); p.push(f.from); }
    if (f.to) { w.push(dateCol + ' <= ?'); p.push(f.to); }
    if (f.listingId) { w.push('listing_id = ?'); p.push(f.listingId); }
    if (f.status) { w.push('status = ?'); p.push(f.status); }
    if (f.paid === 'due') w.push('cost_unpaid > 0');
    if (f.paid === 'paid') w.push('cost_unpaid = 0 AND cost_total > 0');
    if (f.q) {
      w.push('(guest_name LIKE ? OR confirmation_code LIKE ? OR IFNULL(contact, \'\') LIKE ?' +
        ' OR listing_name LIKE ?)');
      var like = '%' + f.q + '%'; p.push(like, like, like, like);
    }
    // whitelist, because f.sort is interpolated into the SQL rather than bound
    var order = ({
      start_date: 'start_date', end_date: 'end_date', booked_date: 'booked_date',
      earnings: 'earnings', net: 'net', nights: 'nights', guest_name: 'guest_name',
      listing_name: 'listing_name', cost_total: 'cost_total', cost_paid: 'cost_paid',
      cost_pending: 'cost_pending', cost_unpaid: 'cost_unpaid', status: 'status',
      confirmation_code: 'confirmation_code'
    })[f.sort] || 'start_date';
    var dir = f.dir === 'asc' ? 'ASC' : 'DESC';
    return DB.all('SELECT * FROM v_reservations' +
      (w.length ? ' WHERE ' + w.join(' AND ') : '') +
      ' ORDER BY ' + order + ' ' + dir + ', id DESC', p);
  };

  DB.statuses = function () {
    return DB.all("SELECT DISTINCT status FROM reservations WHERE IFNULL(status,'') <> '' ORDER BY status")
      .map(function (r) { return r.status; });
  };

  /** Earliest/latest dates on record, for sensible default filter bounds. */
  DB.dateBounds = function (basis) {
    var col = basis || 'start_date';
    var r = DB.one('SELECT MIN(d) AS lo, MAX(d) AS hi FROM (' +
      ' SELECT ' + col + ' AS d FROM reservations WHERE ' + col + ' IS NOT NULL' +
      ' UNION ALL SELECT expense_date AS d FROM expenses' +
      ')');
    return { lo: r && r.lo, hi: r && r.hi };
  };

  DB.counts = function () {
    return {
      listings: DB.scalar('SELECT COUNT(*) AS n FROM listings') || 0,
      reservations: DB.scalar('SELECT COUNT(*) AS n FROM reservations') || 0,
      charges: DB.scalar('SELECT COUNT(*) AS n FROM booking_charges') || 0,
      expenses: DB.scalar('SELECT COUNT(*) AS n FROM expenses') || 0
    };
  };

  App.DB = DB;
})(window.App);
