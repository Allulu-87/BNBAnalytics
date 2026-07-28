# BNB Analytics

A portable Airbnb profit tracker. Import your `reservations.csv`, record what each
booking costs you and what the bills cost you, and see earnings vs. net profit by
month and year — with filtering, search, and Excel/CSV export.

No server, no install, no accounts. It is a static web page with a real SQLite
database inside it.

---

## Why this stack

You asked what language suits the requirements. The requirements were: run
anywhere including an Android phone, host free, keep data in "light SQL".

**HTML5 + CSS + vanilla JavaScript, with SQLite compiled to WebAssembly.**

| Requirement | How it's met |
|---|---|
| Portable / runs anywhere | A static page. Any browser on any OS, phone included — served over http, not opened from storage (see Option C). |
| Installable on Android | It's a PWA — Chrome → ⋮ → *Add to Home screen*. Runs full-screen, offline. |
| Free hosting | GitHub Pages, Cloudflare Pages, Netlify — all free for static files. |
| Light SQL | Real SQLite (`sql.js` 1.10.3, MIT) running in the browser. Real tables, views, joins. |
| Your data stays yours | The database lives in your browser and downloads as a genuine `.sqlite` file. |

**Why not Python/Flask, Node, or PHP?** Each needs a server process running
somewhere. That kills "open it on my phone", and free tiers sleep or expire.
Every one of your requirements is satisfiable client-side, so adding a backend
would only add cost and fragility. If you later want the same data on several
devices *simultaneously*, that's the point where a backend earns its keep — and
because storage is already SQLite, the schema ports over unchanged.

---

## Running it

### Option A — host it free (recommended)

Upload the whole folder to any static host:

- **GitHub Pages** — push the folder to a repo, Settings → Pages → deploy from branch.
- **Cloudflare Pages / Netlify** — drag the folder onto their dashboard.

Then open the URL on your phone and *Add to Home screen*. This is the best
option: offline support and browser storage both work properly.

### Option B — run it locally

Any static file server works. From this folder:

```bash
npx serve .
```

or, if you have Python:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

### Option C — opening `index.html` directly

On a **desktop** browser this generally works: the app uses classic scripts (no
ES modules) and the SQLite WASM binary is base64-inlined, so nothing needs
fetching. Some browsers block IndexedDB on `file://`, in which case it falls back
to `localStorage` (~5 MB, plenty here) — the header always says which store is
active. Keep `.sqlite` backups if you rely on this.

**On Android this does not work, and it is not something the app can fix.**
Copying the folder to the phone and tapping `index.html` leaves it stuck on
"Starting the database…". Chrome on Android will not load a page's neighbouring
`.js`/`.css` files from device storage — scoped storage plus `file://`
restrictions mean the scripts are simply never fetched, so the database engine
never arrives. Use Option A or B on a phone.

If it does get stuck, the app now reports why instead of spinning: after a few
seconds it replaces the spinner with a startup report listing exactly which files
failed to load, plus a **Select all** button so you can copy it.

### Getting it onto an Android phone

1. **Host it** (Option A) and open the URL. Then Chrome → ⋮ → *Add to Home
   screen*. The service worker caches everything, so after the first load it runs
   offline — no connection needed, and the data lives on the phone. This is the
   intended way.
2. **Or serve it locally on the phone.** Install [Termux](https://termux.dev),
   then:

   ```bash
   pkg install python
   cd /sdcard/Download/BNB\ Analytics
   python -m http.server 8000
   ```

   and open `http://localhost:8000` in Chrome. Works fully offline, no hosting
   account — but you have to start the server each time.

Either way the storage is on the phone; hosting only serves the app's files, it
never sees your data.

---

## Using it

### 1. Import

**Import** tab → drop `reservations.csv`. You get a preview showing what is new,
what was already imported, and anything unreadable — nothing is written until
you confirm.

Re-importing is safe and expected. A reservation is identified by
**listing + confirmation code**, so the same export can be dropped in every
week and only genuinely new bookings are added. Existing rows are never
overwritten, so costs you have already typed in are never lost.

The importer copes with Airbnb's variations: `,` `;` `|` or tab delimiters,
`M/D/YYYY` vs `D/M/YYYY` (auto-detected from the file), `JD 414.440` /
`$1,234.56` / `(50.00)` amounts, quoted fields, Arabic guest names, and a
missing `# of nights` column (derived from the dates).

### 2. Per-booking costs

**Reservations** tab → click any row. Four slots, each with an amount, a date
paid, and a *payment processed* tick:

- **Watchman profit** — auto-filled on import at your per-night rate × nights
- **Watchman tips** — free amount
- **Water bottles** — free amount
- **Fruits** — free amount

Ticking *payment processed* fills in today's date if you left it blank. The
watchman rate lives in **Data & export → Settings** (default `2` per night); its
"Set" button re-applies a changed rate to an individual booking.

**A charge only exists if it has an amount.** Leaving a slot at zero stores
nothing at all, so zero-value lines never reach the analysis. If you tick
*payment processed* before typing an amount, the app says so and leaves the slot
empty rather than recording a 0.00 charge.

### Booking costs tab

The per-booking payments analysed on their own, since they behave differently
from bills — they scale with occupancy.

- **Group by day / month / year.**
- **Count each payment on** — *when the booking happened* (default: every charge
  counts, paid or not, and it reconciles with the Dashboard) or *when it was
  actually paid* (only settled charges, i.e. real cash out).
- Totals per charge type, cost per night, and what is still owed.
- A stacked column chart of the four charge types over time, its table twin, a
  full period-by-period breakdown, and a by-charge-type share table.

Only periods that actually have a payment appear — a day axis is not gap-filled,
which would otherwise mean hundreds of empty columns.

### 3. Anytime costs

**Expenses** tab, for things not tied to one booking: Gas, Electricity, Water,
Internet, Nescafe 3 in 1, Toilet Paper, Facial Tissue, Surface Cleaner, Surface
Cleaning Sheets, Sugar Bags, Tea Bags, Dishwashing Liquid, Cleaning Sponge,
Slippers, and **Other** with a free-text field.

Each entry can be attached to one listing, or left as **All listings (shared)**
for overhead. Shared entries are counted in every per-listing view — noted on
screen, since it means per-listing cost columns overlap by design while earnings
partition exactly.

### 4. Analysis

**Dashboard.** Net profit as the headline (with a change vs. the previous
equal-length period), plus earnings, per-booking costs, anytime expenses, what
you still owe, and average per night. Then monthly earnings/costs/net, a ranked
breakdown of every cost line, a yearly summary, a per-listing comparison, and an
itemised *not paid yet* list.

Filters sit in one row at the top — listing, date range, quick presets, search —
and scope everything below them, exports included. **Attribute by** decides which
date a booking's revenue counts on: check-in (default), check-out, or date
booked. The **From**/**To** pickers bound each other, so an inverted range can't
be selected.

### Date fields

Every date field uses [flatpickr](https://flatpickr.js.org) rather than the
browser's own `type="date"` control, so the picker looks and behaves identically
on desktop and on your phone, and follows light/dark mode. Dates display as
`6 Aug 2026`; the value stored in SQLite is always ISO `2026-08-06`.

Each calendar has **Today** and **Clear** in its footer — Clear is how you
un-set an optional *date paid*. You can also type a date directly into the field.

Every chart has a **Table** toggle showing the same numbers exactly.

### 5. Export

**Data & export** honours the current filters.

- **Excel workbook (.xlsx)** — ten sheets: Summary, Monthly, Yearly,
  Reservations, Booking charges, Charges by day / month / year, Expenses, Cost
  breakdown. Numbers arrive as numbers, so you can sum and pivot immediately.
- **CSV** — per table, UTF-8 with a BOM so Excel shows Arabic names correctly.

### Backup

**Download .sqlite backup** gives you the entire database as one file — the only
backup that survives clearing your browser data. **Restore from backup** replaces
everything from such a file (an invalid file is rejected without touching your
current data).

---

## Data model

Plain SQLite. Query it yourself in **Data & export → SQL console** (read-only),
or open a downloaded `.sqlite` in any SQLite tool.

```
listings(id, name UNIQUE)

reservations(id, confirmation_code, listing_id → listings,
             status, guest_name, contact, adults, children, infants,
             start_date, end_date, nights, booked_date,
             earnings, currency, imported_at,
             UNIQUE(listing_id, confirmation_code))   ← the de-dup key

booking_charges(id, reservation_id → reservations,
                kind ∈ {watchman, tips, water, fruits},
                amount, date_paid, is_paid, note,
                UNIQUE(reservation_id, kind))

expenses(id, category, detail, listing_id → listings (nullable = shared),
         amount, expense_date, date_paid, is_paid, note)

meta(k, v)        -- watchman_rate, currency, decimals, revenue_basis
```

Two views do the arithmetic: `v_booking_costs` rolls charges up per reservation,
and `v_reservations` adds `cost_total` / `cost_paid` / `cost_unpaid` / `net`.

**Net profit = earnings − per-booking charges − anytime expenses.** Costs count
whether or not they are marked paid; the paid flag drives the *still to pay*
figures, not profit.

Dates are stored as ISO `YYYY-MM-DD` text, which sorts and compares correctly in
SQLite. Amounts are `REAL` and displayed at the currency's precision (3 decimals
for JOD; change it in Settings).

---

## Files

```
index.html                  app shell
manifest.webmanifest        PWA manifest
sw.js                       offline cache (stale-while-revalidate)
assets/css/app.css          styling, light + dark
assets/js/
  util.js                   formatting, dates, DOM helpers
  datepicker.js             flatpickr wiring (all date fields)
  store.js                  IndexedDB with localStorage fallback
  db.js                     schema, views, query API
  csv.js                    CSV parsing + de-duplicating import
  exporter.js               .xlsx (ZIP + OOXML) and CSV writers
  charts.js                 SVG charts
  analytics.js              the aggregates
  views-*.js                one file per tab (dashboard, reservations,
                            charges, expenses, import, data)
  app.js                    boot, tabs, shared filter row
assets/vendor/
  sql-wasm.js               sql.js 1.10.3 (MIT)
  sql-wasm-binary.js        its .wasm, base64-inlined for file:// support
  sql.js-LICENSE.txt
  flatpickr.min.js/.css     flatpickr 4.6.13 (MIT)
  flatpickr-LICENSE.md
```

Both libraries are vendored locally, never loaded from a CDN — the app has to
work offline and from `file://`.

Editing the app? Bump `CACHE` in `sw.js`, or the service worker will keep
serving the previous version for one extra load.

## Colour choices

The chart palette is not decorative. The series colours and both light/dark
variants were run through a colour-vision validator — lightness band, chroma
floor, colour-blind separation (protanopia/deuteranopia/tritanopia), and contrast
against the chart surface. All six runs on slots 1–3 pass.

Slot order is a safety mechanism, not taste: it keeps yellow away from orange,
the one adjacent pair that fails on its own. That is why the four charge types
are assigned blue → orange → aqua → yellow in that fixed order, and why colour
follows the charge *type* rather than its current rank — filtering never
repaints the survivors.

Two light-mode slots sit below 3:1 against the surface, which obliges the
documented relief: every chart also has a Table view and a legend, so nothing
ever depends on colour alone.
