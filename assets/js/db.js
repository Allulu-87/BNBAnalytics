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
  /* Watchman tips moved out to the expenses list — they are not per-booking. */
  DB.CHARGE_KINDS = [
    { key: 'watchman', label: 'Watchman profit', short: 'Watchman', auto: true, hint: 'per night' },
    { key: 'water', label: 'Water bottles', short: 'Water', auto: false, hint: 'free amount' },
    { key: 'fruits', label: 'Fruits', short: 'Fruits', auto: false, hint: 'free amount' }
  ];

  /** The one definition of "cancelled", shared by SQL and JS. */
  DB.CANCELLED_SQL = "LOWER(IFNULL(status,'')) LIKE '%cancel%'";

  DB.isCancelledStatus = function (status) {
    return /cancel/i.test(String(status == null ? '' : status));
  };

  /** Anytime expense categories, in the order the user listed them. */
  DB.EXPENSE_CATEGORIES = [
    'Watchman Salary', 'Watchman Tips',
    'Gas Bill', 'Electricity Bill', 'Water Bill', 'Internet Bill',
    'Nescafe 3 in 1', 'Toilet Paper', 'Facial Tissue', 'Surface Cleaner',
    'Surface Cleaning Sheets', 'Sugar Bags', 'Tea Bags', 'Dishwashing Liquid',
    'Cleaning Sponge', 'Slippers',
    'AE to JD Currency Diff', 'Bank Transfer Fees', 'Other'
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
    /* Yours, not Airbnb's: has the payout actually landed in the bank?
       Never written by the importer (see DB.updateReservation). */
    "  payout_received INTEGER NOT NULL DEFAULT 0," +
    "  payout_date TEXT," +
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
    "CREATE INDEX IF NOT EXISTS ix_exp_cat ON expenses(category);"
  ];

  /* Columns added after the first release. `CREATE TABLE IF NOT EXISTS` does
     nothing on an existing database, so new columns need an explicit ALTER —
     and SQLite has no `ADD COLUMN IF NOT EXISTS`, hence the PRAGMA check. */
  var ADDED_COLUMNS = [
    ['reservations', 'payout_received', 'INTEGER NOT NULL DEFAULT 0'],
    ['reservations', 'payout_date', 'TEXT']
  ];

  /* Everything below is derived from the tables, so it is dropped and rebuilt on
     every boot rather than left at an older definition. Runs AFTER the ALTERs,
     because the view reads the columns they add. Drop the dependent view first. */
  var SCHEMA_VIEWS = (function () {
    var CANC = "LOWER(IFNULL(r.status,'')) LIKE '%cancel%'";
    var GOT = 'IFNULL(r.payout_received, 0) = 1';

    // what the booking is worth (0 once cancelled)
    var ELIGIBLE = 'CASE WHEN ' + CANC + ' THEN 0 ELSE r.earnings END';
    // what counts today: banked, and not cancelled
    var COUNTED = 'CASE WHEN ' + CANC + ' OR NOT (' + GOT + ') THEN 0 ELSE r.earnings END';
    // earned but still to arrive
    var AWAITING = 'CASE WHEN ' + CANC + ' OR ' + GOT + ' THEN 0 ELSE r.earnings END';
    // nights follow the stay, not the money, so only cancellation zeroes them
    var NIGHTS = 'CASE WHEN ' + CANC + ' THEN 0 ELSE r.nights END';

    return [
    "DROP VIEW IF EXISTS v_reservations;",
    "DROP VIEW IF EXISTS v_booking_costs;",

    /* Per-booking cost rollup */
    "CREATE VIEW v_booking_costs AS " +
    "SELECT reservation_id," +
    "  SUM(amount) AS cost_total," +
    "  SUM(CASE WHEN is_paid = 1 THEN amount ELSE 0 END) AS cost_paid," +
    "  SUM(CASE WHEN is_paid = 0 THEN amount ELSE 0 END) AS cost_unpaid " +
    "FROM booking_charges GROUP BY reservation_id;",

    /* One row per reservation, with money already resolved. Three rules are baked
       in here so every caller gets them for free:

       1. Costs deduct ONLY once their payment is processed. An amount entered but
          not paid leaves the earnings untouched; that is `cost_pending`.

       2. Earnings count ONLY once the payout has landed in the bank. Until then
          they sit in `earnings_awaiting` — real, but not yet yours. Per-booking
          charges are unaffected: they deduct on their own schedule, so a booking
          can legitimately show a negative net while its payout is in transit.

       3. A cancelled booking is worth nothing and sells no nights.

       So: earnings_raw/nights_raw = what Airbnb said · earnings_eligible = what it
       is worth · earnings = what counts today · net = earnings − cost_paid ·
       net_after_pending = the net once everything settles both ways. */
    "CREATE VIEW v_reservations AS " +
    "SELECT r.id, r.confirmation_code, r.listing_id, l.name AS listing_name," +
    "  r.status, r.guest_name, r.contact," +
    "  r.adults, r.children, r.infants," +
    "  r.adults + r.children + r.infants AS guests," +
    "  r.start_date, r.end_date, r.booked_date," +
    "  r.currency, r.imported_at," +
    "  IFNULL(r.payout_received, 0) AS payout_received," +
    "  r.payout_date," +
    "  CASE WHEN " + CANC + " THEN 1 ELSE 0 END AS is_cancelled," +
    "  r.earnings AS earnings_raw," +
    "  r.nights   AS nights_raw," +
    "  " + ELIGIBLE + " AS earnings_eligible," +
    "  " + COUNTED + " AS earnings," +
    "  " + AWAITING + " AS earnings_awaiting," +
    "  " + NIGHTS + " AS nights," +
    "  COALESCE(c.cost_total, 0)  AS cost_total," +
    "  COALESCE(c.cost_paid, 0)   AS cost_paid," +
    "  COALESCE(c.cost_unpaid, 0) AS cost_unpaid," +
    "  COALESCE(c.cost_unpaid, 0) AS cost_pending," +
    "  (" + COUNTED + ") - COALESCE(c.cost_paid, 0) AS net," +
    "  (" + ELIGIBLE + ") - COALESCE(c.cost_total, 0) AS net_after_pending," +
    "  CASE WHEN " + CANC + " OR r.nights <= 0 THEN 0" +
    "       ELSE r.earnings / r.nights END AS per_night " +
    "FROM reservations r " +
    "JOIN listings l ON l.id = r.listing_id " +
    "LEFT JOIN v_booking_costs c ON c.reservation_id = r.id;"
    ];
  })();

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

  var SCHEMA_VERSION = 2;

  /**
   * One-time data moves, keyed off meta.schema_version so they never re-run.
   * (Structural DDL above is `IF NOT EXISTS` / drop-and-recreate, so it is
   * safe every boot and does not belong here.)
   */
  function runMigrations() {
    var from = parseInt(DB.getSetting('schema_version') || '1', 10);
    if (!isFinite(from) || from < 1) from = 1;

    /* v2 — watchman tips stop being a per-booking charge and become an expense.
       Carry the amount, paid state and date across, and reference the booking in
       the note so the history is not lost. */
    if (from < 2) {
      DB.db.run(
        "INSERT INTO expenses (category, detail, listing_id, amount, expense_date, date_paid, is_paid, note) " +
        "SELECT 'Watchman Tips', NULL, r.listing_id, bc.amount," +
        "  COALESCE(bc.date_paid, r.end_date, r.start_date)," +
        "  bc.date_paid, bc.is_paid," +
        "  TRIM(COALESCE(bc.note, '') || ' (moved from booking ' || r.confirmation_code || ')') " +
        "FROM booking_charges bc JOIN reservations r ON r.id = bc.reservation_id " +
        "WHERE bc.kind = 'tips' AND bc.amount > 0");
      DB.db.run("DELETE FROM booking_charges WHERE kind = 'tips'");
    }

    if (from !== SCHEMA_VERSION) DB.setSetting('schema_version', String(SCHEMA_VERSION));
  }

  function tableColumns(table) {
    return DB.all('PRAGMA table_info(' + table + ')').map(function (c) { return c.name; });
  }

  DB.migrate = function () {
    SCHEMA.forEach(function (stmt) { DB.db.run(stmt); });

    // add any column a previous release didn't have, before the views read it
    ADDED_COLUMNS.forEach(function (c) {
      if (tableColumns(c[0]).indexOf(c[1]) === -1) {
        DB.db.run('ALTER TABLE ' + c[0] + ' ADD COLUMN ' + c[1] + ' ' + c[2]);
      }
    });

    SCHEMA_VIEWS.forEach(function (stmt) { DB.db.run(stmt); });

    /* Sweep out zero-value rows. Earlier builds could store a 0.00 charge when
       "payment processed" was ticked before an amount was typed; saveCharge no
       longer creates them, and this clears any already on file. Idempotent, so
       it is safe to run on every boot. */
    DB.db.run('DELETE FROM booking_charges WHERE amount IS NULL OR amount <= 0');
    DB.db.run('DELETE FROM expenses WHERE amount IS NULL OR amount <= 0');

    // a cancelled booking carries no charges and no dues
    DB.purgeCancelledCharges();

    runMigrations();
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

  DB.findReservation = function (listingId, code) {
    return DB.one('SELECT * FROM reservations WHERE listing_id = ? AND confirmation_code = ?',
      [listingId, code]);
  };

  /**
   * Fields that belong to Airbnb and may legitimately change between exports.
   *
   * Two flags protect detail that Airbnb stops supplying once a stay is over:
   *   `keepIfBlank`     — an empty value means "not supplied", not "cleared".
   *   `keepIfTruncated` — a shortened form of what we already hold is a loss of
   *                       detail, not an update (a full name trimmed to just the
   *                       first name). Compared word-by-word.
   * A genuinely different, fuller value still wins in both cases.
   */
  DB.IMPORT_FIELDS = [
    { key: 'status', label: 'Status' },
    { key: 'guest_name', label: 'Guest', keepIfBlank: true, keepIfTruncated: true },
    { key: 'contact', label: 'Contact', keepIfBlank: true },
    { key: 'adults', label: 'Adults', int: true },
    { key: 'children', label: 'Children', int: true },
    { key: 'infants', label: 'Infants', int: true },
    { key: 'start_date', label: 'Check-in' },
    { key: 'end_date', label: 'Check-out' },
    { key: 'nights', label: 'Nights', int: true },
    { key: 'booked_date', label: 'Booked' },
    { key: 'earnings', label: 'Earnings', money: true },
    { key: 'currency', label: 'Currency' }
  ];

  /**
   * Overwrite the Airbnb-sourced columns of an existing reservation.
   * booking_charges live in their own table keyed by reservation_id, so the
   * amounts, dates paid and processed flags you entered are untouched by this.
   */
  DB.updateReservation = function (id, r) {
    DB.run(
      'UPDATE reservations SET status = ?, guest_name = ?, contact = ?,' +
      ' adults = ?, children = ?, infants = ?, start_date = ?, end_date = ?,' +
      ' nights = ?, booked_date = ?, earnings = ?, currency = ?, imported_at = ?' +
      ' WHERE id = ?',
      [r.status, r.guest_name, r.contact, r.adults, r.children, r.infants,
        r.start_date, r.end_date, r.nights, r.booked_date, r.earnings,
        r.currency, r.imported_at, id]);
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

  /** Mark whether the Airbnb payout has actually reached the bank. Yours, so
      the importer never touches it. */
  DB.setPayout = function (id, received, dateISO) {
    DB.run('UPDATE reservations SET payout_received = ?, payout_date = ? WHERE id = ?',
      [received ? 1 : 0, received ? (dateISO || null) : null, id]);
  };

  /* ── booking charges ─────────────────────────────────────────────────── */

  /** How many charges, and how much, a cancelled booking still holds. Used to
      warn before they are cleared. */
  DB.cancelledChargeLoad = function (reservationId) {
    return DB.one(
      'SELECT COUNT(*) AS n, IFNULL(SUM(amount),0) AS total,' +
      ' IFNULL(SUM(CASE WHEN is_paid = 1 THEN amount ELSE 0 END),0) AS paid' +
      ' FROM booking_charges WHERE reservation_id = ?', [reservationId]) ||
      { n: 0, total: 0, paid: 0 };
  };

  /**
   * Drop every charge belonging to a cancelled booking.
   * A cancelled stay has no watchman, no tips, no water, no fruit — so it has
   * nothing outstanding either. Idempotent, so it is safe on every boot.
   * @returns {number} rows removed
   */
  DB.purgeCancelledCharges = function () {
    var before = DB.scalar('SELECT COUNT(*) AS n FROM booking_charges') || 0;
    DB.db.run(
      'DELETE FROM booking_charges WHERE reservation_id IN' +
      ' (SELECT id FROM reservations WHERE ' + DB.CANCELLED_SQL + ')');
    var after = DB.scalar('SELECT COUNT(*) AS n FROM booking_charges') || 0;
    return before - after;
  };

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
    if (f.payout === 'received') w.push('payout_received = 1');
    if (f.payout === 'awaiting') w.push('payout_received = 0 AND is_cancelled = 0');
    if (f.q) {
      w.push('(guest_name LIKE ? OR confirmation_code LIKE ? OR IFNULL(contact, \'\') LIKE ?' +
        ' OR listing_name LIKE ?)');
      var like = '%' + f.q + '%'; p.push(like, like, like, like);
    }
    // whitelist, because f.sort is interpolated into the SQL rather than bound
    var order = ({
      start_date: 'start_date', end_date: 'end_date', booked_date: 'booked_date',
      earnings: 'earnings', earnings_raw: 'earnings_raw',
      earnings_awaiting: 'earnings_awaiting',
      nights: 'nights', nights_raw: 'nights_raw',
      net: 'net', guest_name: 'guest_name', is_cancelled: 'is_cancelled',
      payout_received: 'payout_received', payout_date: 'payout_date',
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
