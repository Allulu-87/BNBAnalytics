/* BNB Analytics — exports.
   CSV, and a genuine multi-sheet .xlsx written from scratch: a minimal
   STORE-only ZIP writer plus inline-string OOXML. No libraries, so numbers
   arrive in Excel as numbers (sortable, summable), not as text. */
window.App = window.App || {};

(function (App) {
  'use strict';

  var U = App.U;
  var Ex = {};

  /* ── ZIP (store, no deflate) ──────────────────────────────────────────── */

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function utf8(str) {
    if (window.TextEncoder) return new TextEncoder().encode(str);
    var esc = unescape(encodeURIComponent(str)), out = new Uint8Array(esc.length);
    for (var i = 0; i < esc.length; i++) out[i] = esc.charCodeAt(i);
    return out;
  }

  function Buf() { this.parts = []; this.len = 0; }
  Buf.prototype.u8 = function (b) { this.parts.push(b); this.len += b.length; return this; };
  Buf.prototype.u16 = function (v) {
    return this.u8(new Uint8Array([v & 0xFF, (v >>> 8) & 0xFF]));
  };
  Buf.prototype.u32 = function (v) {
    return this.u8(new Uint8Array([v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF]));
  };
  Buf.prototype.bytes = function () {
    var out = new Uint8Array(this.len), o = 0;
    this.parts.forEach(function (p) { out.set(p, o); o += p.length; });
    return out;
  };

  /** files: [{name, text}] → Blob (application/zip) */
  function zip(files) {
    var body = new Buf(), central = new Buf(), entries = 0;

    files.forEach(function (f) {
      var name = utf8(f.name);
      var data = utf8(f.text);
      var crc = crc32(data);
      var offset = body.len;

      body.u32(0x04034b50).u16(20).u16(0x0800).u16(0)   // sig, ver, UTF-8 flag, store
          .u16(0).u16(0)                               // time, date (fixed)
          .u32(crc).u32(data.length).u32(data.length)
          .u16(name.length).u16(0)
          .u8(name).u8(data);

      central.u32(0x02014b50).u16(20).u16(20).u16(0x0800).u16(0)
             .u16(0).u16(0)
             .u32(crc).u32(data.length).u32(data.length)
             .u16(name.length).u16(0).u16(0)
             .u16(0).u16(0).u32(0)
             .u32(offset)
             .u8(name);
      entries++;
    });

    var cdOffset = body.len;
    var cd = central.bytes();
    var end = new Buf();
    end.u32(0x06054b50).u16(0).u16(0).u16(entries).u16(entries)
       .u32(cd.length).u32(cdOffset).u16(0);

    var blobParts = [body.bytes(), cd, end.bytes()];
    return new Blob(blobParts, { type: 'application/zip' });
  }

  /* ── XLSX ─────────────────────────────────────────────────────────────── */

  function xmlEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
      // strip control chars Excel rejects outright
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  }

  function colRef(i) {
    var s = '';
    i += 1;
    while (i > 0) {
      var r = (i - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      i = Math.floor((i - 1) / 26);
    }
    return s;
  }

  function sheetXml(rows) {
    var out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'];
    rows.forEach(function (row, r) {
      out.push('<row r="' + (r + 1) + '">');
      row.forEach(function (v, c) {
        if (v == null || v === '') return;
        var ref = colRef(c) + (r + 1);
        if (typeof v === 'number' && isFinite(v)) {
          out.push('<c r="' + ref + '"><v>' + v + '</v></c>');
        } else if (typeof v === 'boolean') {
          out.push('<c r="' + ref + '" t="b"><v>' + (v ? 1 : 0) + '</v></c>');
        } else {
          out.push('<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' +
            xmlEsc(v) + '</t></is></c>');
        }
      });
      out.push('</row>');
    });
    out.push('</sheetData></worksheet>');
    return out.join('');
  }

  /** Excel sheet names: <=31 chars, no : \ / ? * [ ] */
  function safeSheetName(name, taken) {
    var s = String(name || 'Sheet').replace(/[:\\\/\?\*\[\]]/g, ' ').slice(0, 31).trim() || 'Sheet';
    var base = s, i = 2;
    while (taken.indexOf(s) !== -1) {
      var suffix = ' (' + i + ')';
      s = base.slice(0, 31 - suffix.length) + suffix;
      i++;
    }
    taken.push(s);
    return s;
  }

  /**
   * @param {Array<{name:string, rows:Array<Array<string|number>>}>} sheets
   * @returns {Blob} .xlsx
   */
  Ex.xlsx = function (sheets) {
    var taken = [];
    var named = sheets.map(function (s) { return { name: safeSheetName(s.name, taken), rows: s.rows }; });

    var files = [];

    files.push({
      name: '[Content_Types].xml',
      text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        named.map(function (s, i) {
          return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ' +
            'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
        }).join('') +
        '</Types>'
    });

    files.push({
      name: '_rels/.rels',
      text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>'
    });

    files.push({
      name: 'xl/workbook.xml',
      text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        named.map(function (s, i) {
          return '<sheet name="' + xmlEsc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
        }).join('') +
        '</sheets></workbook>'
    });

    files.push({
      name: 'xl/_rels/workbook.xml.rels',
      text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        named.map(function (s, i) {
          return '<Relationship Id="rId' + (i + 1) + '" ' +
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ' +
            'Target="worksheets/sheet' + (i + 1) + '.xml"/>';
        }).join('') +
        '</Relationships>'
    });

    named.forEach(function (s, i) {
      files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', text: sheetXml(s.rows) });
    });

    return zip(files);
  };

  /* ── CSV ──────────────────────────────────────────────────────────────── */

  function csvCell(v) {
    if (v == null) return '';
    var s = String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /** UTF-8 BOM so Excel opens Arabic guest names correctly on a double-click.
      Written as an escape, not a literal, so no editor can silently strip it. */
  Ex.csv = function (rows) {
    var text = rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
    return new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8' });
  };

  Ex.stamp = function () {
    var d = new Date();
    return U.iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
  };

  App.Ex = Ex;
})(window.App);
