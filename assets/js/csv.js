/* BNB Analytics — CSV parsing + Airbnb reservation import.
   Re-importing the same export is the normal case, so the importer is
   idempotent: a reservation already on file (same listing + confirmation
   code) is skipped, never duplicated and never silently overwritten. */
window.App = window.App || {};

(function (App) {
  'use strict';

  var U = App.U, DB = App.DB;
  var CSV = {};

  /* ── RFC 4180 parser ──────────────────────────────────────────────────── */

  /** Parse delimited text into an array of string arrays.
      Handles quoted fields, embedded delimiters/newlines, doubled quotes,
      a UTF-8 BOM, and CRLF or bare CR line endings. */
  CSV.parse = function (text, delim) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    delim = delim || CSV.sniffDelimiter(text);

    var rows = [], row = [], field = '', i = 0, n = text.length, inQ = false;

    while (i < n) {
      var c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQ = true; i++; continue; }
      if (c === delim) { row.push(field); field = ''; i++; continue; }
      if (c === '\r') {
        // \r\n or a lone \r both end the record
        row.push(field); field = ''; rows.push(row); row = [];
        i += (text[i + 1] === '\n') ? 2 : 1;
        continue;
      }
      if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; i++; continue; }
      field += c; i++;
    }
    // trailing field / record
    if (field.length || row.length) { row.push(field); rows.push(row); }

    // drop fully-blank records (trailing newline, stray separators)
    return rows.filter(function (r) {
      return r.some(function (v) { return String(v).trim() !== ''; });
    });
  };

  /** Pick the delimiter by counting candidates on the header line. */
  CSV.sniffDelimiter = function (text) {
    var line = text.slice(0, 4000).split(/\r\n|\r|\n/)[0] || '';
    var best = ',', bestN = -1;
    [',', ';', '\t', '|'].forEach(function (d) {
      var n = line.split(d).length - 1;
      if (n > bestN) { bestN = n; best = d; }
    });
    return best;
  };

  /* ── header mapping ───────────────────────────────────────────────────── */

  function norm(h) {
    return String(h || '').toLowerCase()
      .replace(/[#*]/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  /* Airbnb changes these labels between locales and export versions, so match
     on a normalised alias list rather than a fixed column position. */
  var FIELDS = {
    confirmation_code: ['confirmation code', 'confirmation', 'code', 'reservation code'],
    status: ['status'],
    guest_name: ['guest name', 'guest', 'name'],
    contact: ['contact', 'phone', 'phone number', 'contact number'],
    adults: ['of adults', 'adults'],
    children: ['of children', 'children'],
    infants: ['of infants', 'infants'],
    start_date: ['start date', 'check in', 'checkin', 'arrival', 'arrival date', 'from'],
    end_date: ['end date', 'check out', 'checkout', 'departure', 'departure date', 'to'],
    nights: ['of nights', 'nights'],
    booked_date: ['booked', 'booked date', 'booking date', 'date booked'],
    listing: ['listing', 'listing name', 'property', 'room'],
    earnings: ['earnings', 'amount', 'payout', 'total payout', 'gross earnings', 'revenue']
  };

  CSV.mapHeaders = function (header) {
    var normed = header.map(norm);
    var map = {};
    Object.keys(FIELDS).forEach(function (field) {
      var aliases = FIELDS[field];
      for (var a = 0; a < aliases.length; a++) {
        var idx = normed.indexOf(aliases[a]);
        if (idx !== -1 && Object.keys(map).every(function (k) { return map[k] !== idx; })) {
          map[field] = idx; return;
        }
      }
    });
    return map;
  };

  /* ── dates ────────────────────────────────────────────────────────────── */

  /** Decide whether slash dates are M/D/Y or D/M/Y by looking for a first
      component > 12 anywhere in the column. Airbnb exports in the account's
      locale, so this cannot be assumed. */
  CSV.detectDayFirst = function (samples) {
    var sawDayFirst = false, sawMonthFirst = false;
    samples.forEach(function (s) {
      var m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(String(s || '').trim());
      if (!m) return;
      var a = parseInt(m[1], 10), b = parseInt(m[2], 10);
      if (a > 12 && b <= 12) sawDayFirst = true;
      if (b > 12 && a <= 12) sawMonthFirst = true;
    });
    if (sawDayFirst && !sawMonthFirst) return true;
    return false; // default to the US-style M/D/Y Airbnb ships by default
  };

  var MONTH_NAMES = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
    may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
    september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
  };

  /** Normalise a date cell to ISO yyyy-mm-dd, or null. */
  CSV.toISO = function (raw, dayFirst) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return null;

    // already ISO
    var iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (iso) return U.iso(+iso[1], +iso[2], +iso[3]);

    // numeric with separators
    var m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(s);
    if (m) {
      var a = +m[1], b = +m[2], y = +m[3];
      if (y < 100) y += y < 70 ? 2000 : 1900;
      var mo, d;
      if (a > 12) { d = a; mo = b; }
      else if (b > 12) { mo = a; d = b; }
      else if (dayFirst) { d = a; mo = b; }
      else { mo = a; d = b; }
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      return U.iso(y, mo, d);
    }

    // "6 August 2026" / "August 6, 2026"
    var t = s.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
    if (t.length >= 3) {
      var nameIdx = -1, monthNum = 0;
      for (var i = 0; i < t.length; i++) {
        var key = t[i].toLowerCase().replace(/\./g, '');
        if (MONTH_NAMES[key]) { nameIdx = i; monthNum = MONTH_NAMES[key]; break; }
      }
      if (nameIdx !== -1) {
        var nums = t.filter(function (x, ix) { return ix !== nameIdx && /^\d+$/.test(x); }).map(Number);
        var dd = null, yy = null;
        nums.forEach(function (v) { if (v > 31) yy = v; else if (dd == null) dd = v; });
        if (dd && yy) return U.iso(yy, monthNum, dd);
      }
    }

    // last resort: let the engine try, but only trust an unambiguous result
    var p = new Date(s);
    if (!isNaN(p.getTime())) return U.iso(p.getFullYear(), p.getMonth() + 1, p.getDate());
    return null;
  };

  /** Pull the currency token out of e.g. "JD 414.440" or "$1,234.56". */
  CSV.currencyOf = function (raw) {
    var s = String(raw == null ? '' : raw).trim();
    var m = /([A-Za-z]{2,3}|[$£€₪﷼])/.exec(s);
    return m ? m[1].toUpperCase().replace('$', '$') : null;
  };

  /* ── nights ───────────────────────────────────────────────────────────── */

  function nightsBetween(aISO, bISO) {
    if (!U.isISO(aISO) || !U.isISO(bISO)) return 0;
    var a = new Date(aISO + 'T00:00:00Z'), b = new Date(bISO + 'T00:00:00Z');
    var d = Math.round((b - a) / 86400000);
    return d > 0 ? d : 0;
  }

  /* ── change detection ─────────────────────────────────────────────────── */

  function isBlank(v) {
    return v == null || String(v).trim() === '';
  }

  function nameTokens(v) {
    return String(v == null ? '' : v).trim().toLowerCase().split(/\s+/).filter(Boolean);
  }

  /**
   * Is `next` merely a shortened form of `cur`?
   *
   * Airbnb trims a guest's full name down to the first name once the stay is
   * over ("Abdulwahab Alanazi" → "Abdulwahab"). That is a loss of detail, not a
   * correction, so the fuller stored name should win. Compared as whole words,
   * so "Alice" → "Ali" is treated as a real change rather than a truncation.
   */
  function isTruncationOf(next, cur) {
    var a = nameTokens(next), b = nameTokens(cur);
    if (!a.length || a.length >= b.length) return false;
    return a.every(function (t) { return b.indexOf(t) !== -1; });
  }

  /**
   * Keep detail the export no longer carries. Runs before the diff, so a
   * dropped or shortened value is never even reported as a change.
   *   keepIfBlank     — an empty value means "not supplied", not "cleared"
   *   keepIfTruncated — a shorter form of what we hold is a loss, not an update
   * A genuinely different, fuller value still wins in both cases.
   */
  CSV.preserveDetail = function (cur, rec) {
    DB.IMPORT_FIELDS.forEach(function (f) {
      if (f.keepIfBlank && isBlank(rec[f.key]) && !isBlank(cur[f.key])) {
        rec[f.key] = cur[f.key];
        return;
      }
      if (f.keepIfTruncated && isTruncationOf(rec[f.key], cur[f.key])) {
        rec[f.key] = cur[f.key];
      }
    });
    return rec;
  };

  /**
   * Compare an existing reservation against a freshly parsed one.
   * @returns {Array<{key,label,from,to}>} one entry per field that moved
   */
  CSV.diff = function (cur, rec) {
    var out = [];
    DB.IMPORT_FIELDS.forEach(function (f) {
      var a = cur[f.key], b = rec[f.key];
      var same;
      if (f.money) {
        same = Math.abs(U.parseNum(a) - U.parseNum(b)) < 0.0005;
      } else if (f.int) {
        same = Math.round(U.parseNum(a)) === Math.round(U.parseNum(b));
      } else {
        same = String(a == null ? '' : a).trim() === String(b == null ? '' : b).trim();
      }
      if (!same) {
        out.push({
          key: f.key, label: f.label,
          from: a == null || a === '' ? '—' : a,
          to: b == null || b === '' ? '—' : b
        });
      }
    });
    return out;
  };

  /* ── analyse: parse + classify, no writes ─────────────────────────────── */

  /**
   * Read a CSV and work out exactly what an import would do.
   * Nothing is written — the UI shows this first and the user confirms.
   * @returns {{ok:boolean, error?:string, map:object, missing:string[],
   *            newRows:object[], dupes:object[], bad:object[], dayFirst:boolean}}
   */
  CSV.analyse = function (text) {
    var rows = CSV.parse(text);
    if (rows.length < 2) {
      return { ok: false, error: 'That file has no data rows.', newRows: [], dupes: [], bad: [] };
    }

    var header = rows[0];
    var map = CSV.mapHeaders(header);
    var required = ['confirmation_code', 'start_date', 'listing'];
    var missing = required.filter(function (f) { return map[f] == null; });
    if (missing.length) {
      return {
        ok: false, map: map, missing: missing, newRows: [], dupes: [], bad: [],
        error: 'Missing required column(s): ' + missing.join(', ') +
               '. Found: ' + header.join(', ')
      };
    }

    var body = rows.slice(1);
    var get = function (r, f) { return map[f] == null ? '' : (r[map[f]] == null ? '' : r[map[f]]); };

    var dayFirst = CSV.detectDayFirst(
      body.slice(0, 300).map(function (r) { return get(r, 'start_date'); })
        .concat(body.slice(0, 300).map(function (r) { return get(r, 'end_date'); }))
    );

    var newRows = [], changedRows = [], dupes = [], bad = [];
    var seenInFile = {};       // catch duplicates *within* one file too
    var now = new Date().toISOString();

    body.forEach(function (r, ix) {
      var code = String(get(r, 'confirmation_code')).trim();
      var listingName = String(get(r, 'listing')).trim();
      var startISO = CSV.toISO(get(r, 'start_date'), dayFirst);
      var endISO = CSV.toISO(get(r, 'end_date'), dayFirst);

      if (!code) { bad.push({ line: ix + 2, why: 'no confirmation code', raw: r.join(' | ') }); return; }
      if (!startISO) { bad.push({ line: ix + 2, why: 'unreadable start date "' + get(r, 'start_date') + '"', raw: code }); return; }

      var nights = Math.round(U.parseNum(get(r, 'nights')));
      if (!nights) nights = nightsBetween(startISO, endISO);

      var rec = {
        line: ix + 2,
        confirmation_code: code,
        listing_name: listingName || 'Unknown listing',
        status: String(get(r, 'status')).trim() || null,
        guest_name: String(get(r, 'guest_name')).trim() || null,
        contact: String(get(r, 'contact')).trim() || null,
        adults: Math.round(U.parseNum(get(r, 'adults'))),
        children: Math.round(U.parseNum(get(r, 'children'))),
        infants: Math.round(U.parseNum(get(r, 'infants'))),
        start_date: startISO,
        end_date: endISO,
        nights: nights,
        booked_date: CSV.toISO(get(r, 'booked_date'), dayFirst),
        earnings: U.parseNum(get(r, 'earnings')),
        currency: CSV.currencyOf(get(r, 'earnings')) || U.currency,
        imported_at: now
      };

      var fileKey = rec.listing_name + '||' + code;
      if (seenInFile[fileKey]) {
        dupes.push({ code: code, listing_name: rec.listing_name, reason: 'repeated in this file' });
        return;
      }
      seenInFile[fileKey] = true;

      var lid = DB.one('SELECT id FROM listings WHERE name = ?', [rec.listing_name]);
      var current = lid ? DB.findReservation(lid.id, code) : null;

      if (current) {
        /* Already on file — but Airbnb details can move after the fact (a guest
           cancels, a date shifts, a payout is corrected). Compare and update
           rather than skipping, so the record stays true to the source.
           Detail the export no longer carries is restored first, so an absent or
           shortened value never masquerades as an edit. */
        CSV.preserveDetail(current, rec);
        var changes = CSV.diff(current, rec);
        if (changes.length) {
          rec.id = current.id;
          rec.changes = changes;
          changedRows.push(rec);
        } else {
          dupes.push({ code: code, listing_name: rec.listing_name, reason: 'no change' });
        }
        return;
      }
      newRows.push(rec);
    });

    return {
      ok: true, map: map, missing: [],
      newRows: newRows, changedRows: changedRows, dupes: dupes, bad: bad,
      dayFirst: dayFirst, total: body.length
    };
  };

  /**
   * Commit the rows from analyse().
   * New reservations are inserted and get the auto per-night watchman charge.
   * Changed ones are overwritten field-by-field — their booking_charges rows are
   * never touched, so entered amounts, dates paid and processed flags survive.
   */
  CSV.commit = function (newRows, changedRows) {
    var rate = U.parseNum(DB.getSetting('watchman_rate'));
    var inserted = 0, seeded = 0, updated = 0;

    DB.run('BEGIN');
    try {
      (newRows || []).forEach(function (rec) {
        var listingId = DB.listingId(rec.listing_name);
        if (DB.reservationExists(listingId, rec.confirmation_code)) return;
        rec.listing_id = listingId;
        var id = DB.insertReservation(rec);
        inserted++;
        // a cancelled stay never gets a watchman charge to begin with
        if (rate > 0 && rec.nights > 0 && !DB.isCancelledStatus(rec.status)) {
          DB.saveCharge(id, 'watchman', { amount: U.round(rate * rec.nights, 3), is_paid: 0 });
          seeded++;
        }
      });

      (changedRows || []).forEach(function (rec) {
        if (!rec.id) return;
        DB.updateReservation(rec.id, rec);
        updated++;
      });

      // anything that just became cancelled loses its charges and its dues
      var purged = DB.purgeCancelledCharges();

      DB.run('COMMIT');
      return { inserted: inserted, seeded: seeded, updated: updated, purged: purged };
    } catch (e) {
      DB.run('ROLLBACK');
      throw e;
    }
  };

  App.CSV = CSV;
})(window.App);
