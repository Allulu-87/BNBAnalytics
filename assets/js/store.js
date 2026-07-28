/* BNB Analytics — where the SQLite file lives between visits.
   Order of preference:
     1. IndexedDB  — the real home; holds a raw Uint8Array, no size ceiling.
     2. localStorage — fallback for file:// on Chrome, where IndexedDB is
        blocked for opaque origins. Base64, so ~5 MB and lossy on quota.
   Either way the DB is also downloadable as a real .sqlite file (Data tab),
   which is the only backup that survives a cleared browser profile. */
window.App = window.App || {};

(function (App) {
  'use strict';

  var DB_NAME = 'bnb-analytics';
  var STORE = 'files';
  var KEY = 'main.sqlite';
  var PROBE_KEY = '__writable_probe__';   // never the live DB key
  var LS_KEY = 'bnb-analytics:sqlite-b64';

  var Store = { mode: 'unknown' };

  function openIDB() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) return reject(new Error('no indexedDB'));
      var req;
      try { req = indexedDB.open(DB_NAME, 1); }
      catch (e) { return reject(e); }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('idb open failed')); };
      req.onblocked = function () { reject(new Error('idb blocked')); };
      // Some browsers just never fire on file:// — don't hang the boot.
      setTimeout(function () { reject(new Error('idb timeout')); }, 3000);
    });
  }

  function idbGet(key) {
    return openIDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readonly');
        var r = tx.objectStore(STORE).get(key);
        r.onsuccess = function () { resolve(r.result || null); };
        r.onerror = function () { reject(r.error); };
      });
    });
  }

  function idbPut(bytes, key) {
    return openIDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(bytes, key);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error || new Error('idb abort')); };
      });
    });
  }

  function idbDel(key) {
    return openIDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  /* ── base64 <-> bytes (chunked; a 1-arg apply on a big array throws) ──── */

  function bytesToB64(bytes) {
    var CH = 0x8000, out = [];
    for (var i = 0; i < bytes.length; i += CH) {
      out.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CH)));
    }
    return btoa(out.join(''));
  }

  function b64ToBytes(b64) {
    var bin = atob(b64), n = bin.length, out = new Uint8Array(n);
    for (var i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* ── public API ───────────────────────────────────────────────────────── */

  /** Probe which backend works, once, at boot. The probe uses its own key —
      it must never read, write or delete the live database. */
  Store.init = function () {
    return idbPut(new Uint8Array([1]), PROBE_KEY)
      .then(function () { return idbDel(PROBE_KEY); })
      .then(function () {
        Store.mode = 'indexeddb';
        return 'indexeddb';
      })
      .catch(function () {
        try {
          localStorage.setItem('bnb:probe', '1');
          localStorage.removeItem('bnb:probe');
          Store.mode = 'localstorage';
        } catch (e) {
          Store.mode = 'memory';
        }
        return Store.mode;
      });
  };

  /** @returns {Promise<Uint8Array|null>} */
  Store.load = function () {
    if (Store.mode === 'indexeddb') {
      return idbGet(KEY).then(function (v) {
        if (!v) return null;
        return v instanceof Uint8Array ? v : new Uint8Array(v);
      }).catch(function () { return null; });
    }
    if (Store.mode === 'localstorage') {
      try {
        var b64 = localStorage.getItem(LS_KEY);
        return Promise.resolve(b64 ? b64ToBytes(b64) : null);
      } catch (e) { return Promise.resolve(null); }
    }
    return Promise.resolve(null);
  };

  Store.save = function (bytes) {
    if (Store.mode === 'indexeddb') {
      return idbPut(bytes, KEY).catch(function (e) {
        App.U.toast('Could not save to browser storage', true);
        throw e;
      });
    }
    if (Store.mode === 'localstorage') {
      return new Promise(function (resolve, reject) {
        try {
          localStorage.setItem(LS_KEY, bytesToB64(bytes));
          resolve(true);
        } catch (e) {
          App.U.toast('Storage full — export a backup from the Data tab', true);
          reject(e);
        }
      });
    }
    return Promise.resolve(false); // memory-only: nothing to do
  };

  Store.clear = function () {
    if (Store.mode === 'indexeddb') return idbDel(KEY).catch(function () { return true; });
    if (Store.mode === 'localstorage') {
      try { localStorage.removeItem(LS_KEY); } catch (e) { /* ignore */ }
    }
    return Promise.resolve(true);
  };

  Store.describe = function () {
    return {
      indexeddb: 'Saved in this browser (IndexedDB)',
      localstorage: 'Saved in this browser (localStorage — keep backups)',
      memory: 'Not saved — this session only. Export a backup!'
    }[Store.mode] || 'Unknown storage';
  };

  App.Store = Store;
})(window.App);
