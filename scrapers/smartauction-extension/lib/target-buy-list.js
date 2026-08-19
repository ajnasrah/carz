// Target Buy List — turn an auction run list into a shortlist worth bidding on.
//
// Upload an auction pre-sale run list; every car is cross-checked against the
// cars we've actually sold, matched on YEAR / MAKE / MODEL / ODOMETER. A car is
// a TARGET when the cars we've sold like it averaged more than $800 net profit
// and moved in under 30 days. Output is a downloadable .xlsx to work off at the
// sale.
//
// The sold book is re-pulled from Supabase on EVERY upload — no caching — so the
// list always reflects what we've sold as of right now.
//
// Sold book source:
//   sold — the full wholesale book, ~6,200 sales over 19 months, fed by the
//          frazer-ingest edge function. Read via the list_all_sold() RPC because
//          the table itself is RLS-protected against the anon key.
//
// Currently wired for the Edge Pipeline pre-sale format. ADESA / Manheim plug in
// by adding an entry to FORMATS below.
//
// Usage from popup.js init():  window.TargetBuyList.bindUI({ supabaseUrl, supabaseKey })

(function () {
  'use strict';

  let cfg = { supabaseUrl: '', supabaseKey: '' };
  let lastResult = null;
  let savedIndex = [];   // recent saved lists, newest first

  // ── Buy criteria ───────────────────────────────────────────────────────────
  const TARGET_PROFIT = 800;   // cohort mean net profit must clear this
  const TARGET_DAYS = 30;      // ...and move in under this many days
  const TARGET_MEDIAN_FLOOR = 500; // guard: mean can be dragged up by one winner
  const WATCH_PROFIT = 400;
  const WATCH_DAYS = 40;

  // THE definition of "the same car": same make, same model, within a model year,
  // and an odometer within this band. Only this cohort can make something a TARGET.
  //
  // Widened from ±0yr/±15k after testing against the full 6,216-sale book. On the
  // 57-day book the tight window appeared to carry signal — it read 2.5-3x higher
  // than looser cohorts — but that was small-sample noise. Across the real book,
  // the 189 cars that qualify under both windows average $663 on the wider cohort
  // versus $598 on the tighter one, with an identical loss rate (27% vs 28%). The
  // wider window doubles coverage (272 -> 374 matched, 32 -> 66 HIGH confidence)
  // and roughly doubles cohort size (11 -> 26) at no cost in accuracy.
  const EXACT = { years: 1, miles: 20000, min: 2 };

  // Looser cohorts exist only for context when there's no exact match. They are
  // always capped at WATCH and always labelled, because a loose match is not
  // evidence about this car.
  //
  // An earlier model-name-only tier matched on nameplate alone, with no mileage
  // limit at all: a 200k-mile 2011 Acadia inherited the numbers of 80k-mile 2022
  // Acadias, and three completely different cars all reported the same n=8,
  // $2,260 avg. Every tier now constrains both year and mileage.
  const TIERS = [
    { id: 'exact', label: 'exact', years: EXACT.years, miles: EXACT.miles, min: EXACT.min },
    { id: 'close', label: 'close', years: 1, miles: 20000, min: 3, cap: 'WATCH' },
    { id: 'broad', label: 'broad', years: 3, miles: 40000, min: 5, cap: 'WATCH' },
  ];

  const SAME_YEAR_VETO_N = 5; // model-years with this many sales can veto a target
  const MIN_VALID_ODO = 100; // below this the run list's mileage is a data error

  // Outlier trim: sort the book by profit and walk in from each tail while
  // consecutive cars differ by more than this. Median consecutive gap is ~$5,
  // so a $500 gap is a genuine break, not the distribution.
  const OUTLIER_GAP = 500;

  // ── CSV parsing (quoted fields, embedded commas, CRLF) ─────────────────────
  function parseCSV(text) {
    const rows = [];
    let i = 0, f = '', row = [], q = false;
    const pushF = () => { row.push(f); f = ''; };
    const pushR = () => { rows.push(row); row = []; };
    while (i < text.length) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += c;
      } else {
        if (c === '"') q = true;
        else if (c === ',') pushF();
        else if (c === '\n') { pushF(); pushR(); }
        // Manheim exports terminate rows with a bare CR. Treat a lone CR as a
        // row break; in CRLF the following LF closes the row instead.
        else if (c === '\r') { if (text[i + 1] !== '\n') { pushF(); pushR(); } }
        else f += c;
      }
      i++;
    }
    if (f.length || row.length) { pushF(); pushR(); }
    // ADESA exports lead with a UTF-8 BOM, which would otherwise corrupt the
    // first header name.
    const header = (rows.shift() || []).map((h) => h.replace(/^﻿/, '').trim());
    return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, j) => [h, r[j]])));
  }

  const int = (x) => { const n = parseInt(String(x ?? '').replace(/[^0-9-]/g, ''), 10); return Number.isFinite(n) ? n : null; };
  const dec = (x) => { const n = parseFloat(String(x ?? '').replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? n : null; };

  // A field is a list of spellings, not one. The same auction platform renames
  // its columns between sites — see the Edge Pipeline note below — so reading
  // r['Vin'] directly is how a run list from a new yard silently scores zero
  // cars. `has` is the same idea for detection.
  const pick = (r, ...names) => { for (const n of names) if (n in r) return r[n]; return ''; };
  const has = (r, ...names) => names.some((n) => n in r);
  const str = (x) => String(x ?? '').trim();

  // Normalise the several date shapes the auction feeds use into YYYY-MM-DD.
  function toISODate(v) {
    if (!v) return null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); // M/D/YY(YY)
    if (m) {
      const yy = m[3].length === 2 ? `20${m[3]}` : m[3];
      return `${yy}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
    }
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }

  // ── Run-list formats ───────────────────────────────────────────────────────
  const FORMATS = [
    {
      id: 'edge_pipeline',
      label: 'Edge Pipeline',
      // Edge Pipeline ships two exports and both belong here: the pre-sale run
      // list (Run Number / Lane / Lot) and the vehicle search, which has no run
      // columns whatsoever because a timed sale has no lane to run in. Keying
      // on Run Number alone rejected every search export. The run fields just
      // come back empty in that case, which is exactly why the table grew a VIN
      // column.
      //
      // Two header dialects, and they are the same report from the same
      // platform. One yard writes `Stock Number` / `Exterior Color` / `Mileage`
      // / `Has Condition Report` / `Vin`; Des Moines and DAAS Memphis write
      // `Stock #` / `Color` / `Odometer` / `CR` / `VIN` and add Lights +
      // Announcements. Reading only the first spelling meant a Des Moines run
      // list failed detection outright and reported nothing at all.
      //
      // `!('MMR' in r)` keeps Manheim out — the other feed with a 'Vin' header —
      // and `!('Lane / Run' in r)` keeps ADESA out, which is important now that
      // the all-caps 'VIN' this accepts is also ADESA's spelling. Both are
      // matched further down.
      detect: (r) => has(r, 'Vin', 'VIN') && !('MMR' in r) && !('Lane / Run' in r)
        && ('Run Number' in r
          || ('Picture Count' in r && has(r, 'Has Condition Report', 'CR'))),
      map: (r) => ({
        vin: str(pick(r, 'Vin', 'VIN')).toUpperCase(),
        stock: str(pick(r, 'Stock Number', 'Stock #')),
        run: str(r['Run Number']),
        lane: str(r['Lane']),
        lot: str(r['Lot']),
        saleDate: str(r['Sale Date']),
        year: int(r['Year']),
        make: str(r['Make']),
        model: str(r['Model']),
        style: str(r['Style']),
        color: str(pick(r, 'Exterior Color', 'Color')),
        odo: int(pick(r, 'Mileage', 'Odometer')),
        grade: str(r['Grade']),
        // 'true'/'false' in one dialect, 'Yes'/'No' in the other.
        hasCR: /^(true|yes)$/i.test(str(pick(r, 'Has Condition Report', 'CR'))),
        pics: int(r['Picture Count']),
        // The search export carries these and the pre-sale one doesn't; they
        // were being dropped on the floor into an Announcements column that
        // then exported blank. "RIDE AND DRIVE" vs a lights disclosure is the
        // difference between a bid and a pass.
        announcements: [r['Announcements'], r['Lights']]
          .map((x) => (x || '').trim()).filter(Boolean).join(' | '),
      }),
    },
    {
      id: 'adesa',
      label: 'ADESA',
      detect: (r) => 'VIN' in r && 'Lane / Run' in r,
      map: (r) => {
        // "C74" -> lane C, run 74. Occasionally just a number.
        const lr = String(r['Lane / Run'] || '').trim();
        const m = lr.match(/^([A-Za-z]*)\s*[-/]?\s*(\d+)$/);
        return {
          vin: (r['VIN'] || '').trim().toUpperCase(),
          stock: '',
          run: lr,
          lane: m ? m[1] : '',
          lot: m ? m[2] : '',
          // "Starts 08/04/2026 12:00 PM EDT" -> 2026-08-04
          saleDate: toISODate((String(r['Date'] || '').match(/(\d{1,2}\/\d{1,2}\/\d{4})/) || [])[1]) || '',
          year: int(r['Year']),
          make: (r['Make'] || '').trim(),
          model: (r['Model'] || '').trim(),
          style: (r['Trim'] || '').trim(),
          color: (r['Exterior Color'] || '').trim(),
          odo: int(r['Odometer']),
          grade: (r['Grade'] || '').trim(),
          hasCR: !!String(r['Grade'] || '').trim(),
          pics: null,
          // ADESA-only extras, surfaced in the export when present.
          drivetrain: (r['Drivetrain'] || '').trim(),
          engine: (r['Engine'] || '').trim(),
          transmission: (r['Transmission'] || '').trim(),
          fuel: (r['Fuel'] || '').trim(),
          seller: (r['Seller'] || '').trim(),
          announcements: [r['Announcements'], r['Notes'], r['Driveability'], r['Condition Guarantee']]
            .map((x) => (x || '').trim()).filter(Boolean).join(' | '),
          titleStatus: (r['Title Status'] || '').trim(),
          auctionValue: dec(r['CarValue']),
          location: (r['Location'] || '').trim(),
          channel: (r['Sale Channel'] || '').trim(),
        };
      },
    },
    {
      id: 'manheim',
      label: 'Manheim',
      detect: (r) => 'Vin' in r && 'MMR' in r && 'Auction House' in r,
      map: (r) => ({
        vin: (r['Vin'] || '').trim().toUpperCase(),
        stock: '',
        run: (r['Run'] || '').trim(),
        lane: (r['Lane'] || '').trim(),
        lot: '',
        saleDate: toISODate((String(r['Starts At'] || '').match(/^(\d{4}-\d{2}-\d{2})/) || [])[1]) || '',
        year: int(r['Year']),
        make: (r['Make'] || '').trim(),
        model: (r['Model'] || '').trim(),
        style: (r['Trim'] || '').trim(),
        color: (r['Exterior Color'] || '').trim(),
        odo: int(r['Odometer Value']),
        grade: (r['Condition Report Grade'] || '').trim(),
        hasCR: !!String(r['Condition Report Grade'] || '').trim(),
        pics: null,
        drivetrain: (r['Drivetrain'] || '').trim(),
        engine: (r['Engine Type'] || '').trim(),
        transmission: (r['Transmission Type'] || '').trim(),
        fuel: '',
        seller: (r['Seller Name'] || '').trim(),
        // Manheim's "Status" is the listing state (Live/Sold), not a title
        // status — it belongs with the notes, not in the Title Status column.
        announcements: [r['Status'], r['Seller Comments'], r['Notes']]
          .map((x) => (x || '').trim()).filter(Boolean).join(' | '),
        titleStatus: '',
        // Manheim is the one feed that carries a market benchmark.
        auctionValue: dec(r['MMR']),
        location: (r['Pickup Location'] || '').trim(),
        // The SALE, as distinct from where the car sits. Usually the same place
        // with the state prefix stripped ("MO - Manheim Kansas City" vs "Manheim
        // Kansas City"), and not the same at all for an offsite unit, which
        // lists the lot holding it. Studies group on this.
        auction: (r['Auction House'] || '').trim(),
        saleName: (r['Event Sale Name'] || '').trim(),
        channel: (r['Inventory'] || '').trim(),
      }),
    },
  ];

  const detectFormat = (rows) => (rows.length ? FORMATS.find((f) => f.detect(rows[0])) || null : null);

  // ── Normalisation ──────────────────────────────────────────────────────────
  const normMake = (m) => String(m || '').toUpperCase().replace(/[^A-Z]/g, '');

  // "F-150" vs "F150", "SILVERADO 1500" vs "Silverado" — strip to alphanumerics
  // and drop a leading make token so both sides line up.
  function normModel(model, make) {
    let s = String(model || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const mk = normMake(make);
    if (mk && s.startsWith(mk) && s.length > mk.length) s = s.slice(mk.length);
    for (const p of ['CHEVROLET', 'FORD', 'RAM', 'GMC', 'JEEP', 'NISSAN', 'TOYOTA']) {
      if (s.startsWith(p) && s.length > p.length) { s = s.slice(p.length); break; }
    }
    return s;
  }

  // Tonnage is part of a vehicle's identity; trim and body style are not. A bare
  // prefix match let a Sierra 3500HD draw the same 20 half-tons as a Sierra 1500 —
  // a one-ton dually priced off half-tons is a different truck, different buyer,
  // different market. Trim variants (Unlimited, Sport) DO comp against each other:
  // all Wranglers are Wranglers.
  const SERIES_RE = /(1500|2500|3500)/;
  const TRIM_RE = /UNLIMITED|UNLIMI|SPORT/;

  function modelParts(norm) {
    // The sold export truncates at 15 chars, so "WRANGLER UNLIMI" has to reduce
    // to the same nameplate as "WRANGLER".
    let base = norm.replace(TRIM_RE, '');
    let series = '';
    const stem = (base.match(/^[A-Z]+/) || [''])[0];
    // Only read digits as a series when the alphabetic stem is itself the
    // nameplate (SILVERADO 1500). For F150 / F250 the digits ARE the nameplate.
    if (stem.length >= 4) {
      const m = base.match(SERIES_RE);
      if (m) { series = m[1]; base = base.replace(SERIES_RE, ''); }
    }
    return { base: base.replace(/HD$/, ''), series };
  }

  function modelMatch(a, b) {
    if (!a || !b) return false;
    const A = modelParts(a), B = modelParts(b);
    // A heavy-duty truck must never borrow half-ton history. Where a side is
    // silent on series — the sold export usually is — treat it as a half-ton,
    // which is the dominant case: 1500 still matches, 2500 and 3500 cannot.
    if ((A.series || '1500') !== (B.series || '1500')) return false;
    if (A.base === B.base) return true;
    const [s, l] = A.base.length < B.base.length ? [A.base, B.base] : [B.base, A.base];
    return s.length >= 4 && l.startsWith(s);
  }

  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  function median(a) {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  // The sold book: every wholesale sale we've made, with its economics.
  //
  // Read through the list_all_sold() RPC rather than the table directly — `sold`
  // is RLS-protected, so an anon SELECT silently returns zero rows. The RPC is
  // SECURITY DEFINER and granted to anon for exactly this reason. Reading the
  // table straight was why this engine previously scored against a 57-day
  // spreadsheet import instead of the full 19-month book.
  //
  // Frazer stores these columns as text, so dates and money need coercing.
  const rpcNum = (x) => {
    if (x === null || x === undefined || x === '') return null;
    const n = parseFloat(String(x).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : null;
  };

  // Frazer writes sale_date as MM/DD/YY.
  function frazerDate(v) {
    if (!v) return null;
    const m = String(v).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (!m) return toISODate(v);
    const yy = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yy}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }

  // ── Saved lists ────────────────────────────────────────────────────────────
  // Scoring a run list is a minute of work — read the CSV, pull six thousand
  // sold cars, match every one of them — and until now it lived in `lastResult`
  // above, which the popup destroys the moment it closes. Click off the popup
  // at the sale and the list was gone, with the cars already crossing the block.
  //
  // So every scored list is written to target_run_lists, and the popup reads the
  // newest one back on open. The web app's List Builder reads and writes the
  // same rows (inspection-app/src/services/targetRunLists.js) — score a list
  // here and it's on the phone, score it there and it's here.
  const TABLE = 'target_run_lists';
  // Enough to name a list in the picker, without dragging a dozen scored run
  // lists across the wire to fill a dropdown.
  const SUMMARY = 'id,source_id,source_label,file_name,sale_date,car_count,'
    + 'target_count,watch_count,book_size,built_by,created_at';

  const sbHeaders = (extra) => Object.assign({
    apikey: cfg.supabaseKey,
    Authorization: `Bearer ${cfg.supabaseKey}`,
    'Content-Type': 'application/json',
  }, extra || {});

  // The sale date the list is for, taken from the cars rather than the file
  // name, which is whatever the auction site called the download. Most common
  // wins, because one export can straddle two sale days.
  function saleDateOf(cars) {
    const tally = new Map();
    for (const c of cars) {
      const d = String(c.saleDate || '').trim();
      if (d) tally.set(d, (tally.get(d) || 0) + 1);
    }
    let best = null, bestN = 0;
    for (const [d, n] of tally) if (n > bestN) { best = d; bestN = n; }
    return best;
  }

  async function saveRunList(result) {
    const { scored } = result;
    const row = {
      source_id: result.sourceId,
      source_label: result.source,
      file_name: result.fileName || null,
      sale_date: saleDateOf(scored),
      car_count: scored.length,
      target_count: scored.filter((c) => c.verdict === 'TARGET').length,
      watch_count: scored.filter((c) => c.verdict === 'WATCH').length,
      book_size: result.bookSize == null ? null : result.bookSize,
      cars: scored,
      opened: [],
      built_by: 'extension',
    };
    const res = await fetch(`${cfg.supabaseUrl}/rest/v1/${TABLE}`, {
      method: 'POST',
      headers: sbHeaders({ Prefer: 'return=representation' }),
      body: JSON.stringify(row),
    });
    if (!res.ok) throw new Error(`save failed (${res.status})`);
    const [saved] = await res.json();
    // Old lists are a few hundred KB each and nobody re-works last month's
    // sale. Trimming on write keeps this off a scheduler.
    fetch(`${cfg.supabaseUrl}/rest/v1/rpc/prune_target_run_lists`, {
      method: 'POST', headers: sbHeaders(), body: '{}',
    }).catch(() => {});
    recordObservations(result).catch((e) =>
      console.error('could not record run-list observations', e));
    return saved && saved.id;
  }

  // Keep the condition of every car we look at, forever.
  //
  // Mirror of recordObservations() in inspection-app/src/services/targetRunLists.js
  // — change one, change the other. It has to exist on both sides because most
  // lists are scored here, in the popup, and the row above is deleted after 30
  // days by the prune. CR grade and announcements are the only condition facts
  // we ever see while the car is still on the block; `sold` records what the
  // shop spent but never what shape the car was in when we bid.
  //
  // Every car goes in, not just the flagged ones: a PASS we bought anyway is the
  // only evidence that a PASS was ever wrong.
  async function recordObservations(result) {
    const scored = result && result.scored;
    if (!scored || !scored.length || !result.sourceId) return 0;
    const gradeNum = (g) => {
      const m = String(g == null ? '' : g).match(/\d+(\.\d+)?/);
      if (!m) return null;
      const n = Number(m[0]);
      return isFinite(n) && n >= 0 && n <= 5.1 ? n : null;
    };
    const txt = (v) => {
      const s = String(v == null ? '' : v).trim();
      return s ? s.slice(0, 2000) : null;
    };
    const int = (v) => (v != null && v !== '' && isFinite(Number(v)) ? Math.round(Number(v)) : null);
    const dec = (v) => (isFinite(Number(v)) && v != null && v !== '' ? Number(v) : null);
    const rows = scored
      .filter((c) => String(c.vin || '').length === 17)
      .map((c) => ({
        vin: String(c.vin).toUpperCase(),
        // '' not null: the unique index spans this column and NULLs never
        // collide, so an undated list would re-insert in full every upload.
        sale_date: txt(c.saleDate) || '',
        source_id: result.sourceId,
        source_label: result.source,
        year: int(c.year), make: txt(c.make), model: txt(c.model),
        trim: txt(c.style), odometer: int(c.odo),
        cr_grade: gradeNum(c.grade), cr_grade_raw: txt(c.grade),
        has_cr: c.hasCR == null ? null : !!c.hasCR,
        announcements: txt(c.announcements), title_status: txt(c.titleStatus),
        auction_value: dec(c.auctionValue),
        seller: txt(c.seller), location: txt(c.location), lane: txt(c.lane),
        // Falls back to the pickup location with its state prefix stripped, so a
        // feed that has no explicit auction column still groups with the rest.
        auction: txt(c.auction) || txt(String(c.location || '').replace(/^[A-Z]{2}\s*-\s*/, '')),
        sale_name: txt(c.saleName),
        lot: txt(c.lot), run: txt(c.run), channel: txt(c.channel),
        drivetrain: txt(c.drivetrain), engine: txt(c.engine),
        transmission: txt(c.transmission), fuel: txt(c.fuel), color: txt(c.color),
        verdict: txt(c.verdict), confidence: txt(c.confidence),
        exact_n: int(c.exactN), exact_profit: dec(c.exactProfit), exact_days: dec(c.exactDays),
      }));
    if (!rows.length) return 0;
    // Chunked — a 1,200-car ADESA list in one request is a large body.
    for (let i = 0; i < rows.length; i += 500) {
      const r = await fetch(
        `${cfg.supabaseUrl}/rest/v1/run_list_observations?on_conflict=vin,sale_date,source_id`,
        {
          method: 'POST',
          headers: sbHeaders({ Prefer: 'resolution=ignore-duplicates,return=minimal' }),
          body: JSON.stringify(rows.slice(i, i + 500)),
        });
      if (!r.ok) throw new Error(`observations failed (${r.status})`);
    }
    return rows.length;
  }

  async function listSaved(limit) {
    const res = await fetch(
      `${cfg.supabaseUrl}/rest/v1/${TABLE}?select=${SUMMARY}&order=created_at.desc&limit=${limit || 12}`,
      { headers: sbHeaders(), signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`reading saved lists failed (${res.status})`);
    return res.json();
  }

  // Comes back in the shape handleRunList builds, so a restored list and a
  // freshly scored one are the same thing to renderPanel and everything under
  // it. The format's parser did its job at upload and doesn't survive JSON —
  // only its id matters now, since that's what says how a car gets opened.
  async function loadSaved(id) {
    const res = await fetch(`${cfg.supabaseUrl}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(id)}&select=*`,
      { headers: sbHeaders(), signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`loading that list failed (${res.status})`);
    const [row] = await res.json();
    if (!row) return null;
    return {
      id: row.id,
      scored: row.cars || [],
      source: row.source_label || row.source_id,
      sourceId: row.source_id,
      fileName: row.file_name,
      bookSize: row.book_size,
      savedAt: row.created_at,
      builtBy: row.built_by,
      openedVins: row.opened || [],
    };
  }

  // Which cars have already been sent to a window. Written after every batch so
  // the count is right on the next surface that opens this list; failure is
  // silent, because losing the progress marker must never cost you the list.
  function saveOpened(id, vins) {
    if (!id) return;
    fetch(`${cfg.supabaseUrl}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: sbHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify({ opened: Array.from(vins), updated_at: new Date().toISOString() }),
    }).catch((e) => console.error('saving open progress failed', e));
  }

  async function fetchSoldBook(log) {
    const rows = [];
    const PAGE = 1000;
    for (let offset = 0; ; offset += PAGE) {
      const res = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/list_all_sold?limit=${PAGE}&offset=${offset}`, {
        method: 'POST',
        headers: {
          apikey: cfg.supabaseKey,
          Authorization: `Bearer ${cfg.supabaseKey}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
      if (!res.ok) throw new Error(`list_all_sold failed (${res.status})`);
      const batch = await res.json();
      if (!Array.isArray(batch) || !batch.length) break;
      rows.push(...batch);
      if (batch.length < PAGE) break;
      if (offset > 100000) break; // safety stop
    }

    const mapped = rows.map((r) => ({
      vin: String(r.vehicle_vin || '').trim().toUpperCase(),
      year: rpcNum(r.vehicle_year),
      make: r.vehicle_make,
      model: r.vehicle_model,
      odometer: rpcNum(r.mileage),
      sale_date: frazerDate(r.sale_date),
      sale_price: rpcNum(r.sales_price),
      total_cost: rpcNum(r.total_cost),
      added_costs: rpcNum(r.added_costs),
      net_profit: rpcNum(r.profit_on_sale),
      days_on_lot: rpcNum(r.days_on_lot),
      vendor: r.vendor,
      buyer: r.buyer,
    }));

    if (log) {
      const ds = mapped.map((r) => r.sale_date).filter(Boolean).sort();
      log(`Sold book: ${mapped.length} sales${ds.length ? ` (${ds[0]} → ${ds[ds.length - 1]})` : ''}`, 'ok');
    }
    return mapped;
  }

  // ── Clean the sold book ────────────────────────────────────────────────────
  // Duplicates are KEPT. The same car sold twice is two real outcomes, and a
  // buy-back loss is part of what that year/make/model/odometer actually costs
  // us. No VIN de-duplication, no arbitration-vendor filter.
  //
  // Only two kinds of row are dropped:
  //   1. Pass-through title transfers ($0 profit, $0 recon) — not real deals.
  //   2. Extreme outliers at either tail — the car that lost $8k because it was
  //      a disaster, or made $7k because we got lucky. Neither repeats. A
  //      routine $2-3k buy-back loss sits inside the distribution and stays.
  function cleanBook(rows) {
    const usable = rows.filter((r) => r.net_profit !== null && r.net_profit !== undefined);

    const removedPassthrough = usable.filter(
      (r) => Number(r.net_profit) === 0 && Number(r.added_costs || 0) === 0);
    const ptSet = new Set(removedPassthrough);
    let book = usable.filter((r) => !ptSet.has(r));

    book.sort((a, b) => Number(a.net_profit) - Number(b.net_profit));
    const p = book.map((r) => Number(r.net_profit));

    // Never let the walk eat the book: on a small or very spread-out set every
    // gap can exceed the threshold, which would trim everything to nothing.
    const maxTrim = Math.floor(p.length * 0.05);
    let lo = 0;
    while (lo < maxTrim && p[lo + 1] - p[lo] > OUTLIER_GAP) lo++;
    let hi = p.length - 1;
    while (hi > p.length - 1 - maxTrim && p[hi] - p[hi - 1] > OUTLIER_GAP) hi--;
    if (lo > hi) { lo = 0; hi = p.length - 1; }

    // Reported for visibility only — these rows stay in the book.
    const vinCounts = new Map();
    for (const r of book) if (r.vin) vinCounts.set(r.vin, (vinCounts.get(r.vin) || 0) + 1);
    const buyBacks = book.filter((r) => r.vin && vinCounts.get(r.vin) > 1);

    const removedOutliers = [...book.slice(0, lo), ...book.slice(hi + 1)];
    book = book.slice(lo, hi + 1);

    return { book, removedOutliers, removedPassthrough, buyBacks };
  }

  function indexBook(book) {
    const byMake = new Map();
    for (const r of book) {
      const nmk = normMake(r.make);
      if (!nmk) continue;
      if (!byMake.has(nmk)) byMake.set(nmk, []);
      byMake.get(nmk).push({
        year: r.year,
        odo: r.odometer,
        profit: Number(r.net_profit),
        days: r.days_on_lot == null ? null : Number(r.days_on_lot),
        price: r.sale_price == null ? null : Number(r.sale_price),
        nmodel: normModel(r.model, r.make),
        vin: r.vin,
        saleDate: r.sale_date,
      });
    }
    return byMake;
  }

  // ── Scoring ────────────────────────────────────────────────────────────────
  function cohortStats(cohort) {
    if (!cohort.length) return { n: 0, meanProfit: null, medProfit: null, meanDays: null, hitRate: null, lossRate: null, medResale: null };
    const profits = cohort.map((s) => s.profit);
    const days = cohort.map((s) => s.days).filter((d) => d != null);
    const prices = cohort.map((s) => s.price).filter((v) => v != null);
    return {
      n: cohort.length,
      meanProfit: mean(profits),
      medProfit: median(profits),
      meanDays: days.length ? mean(days) : null,
      hitRate: (profits.filter((v) => v > 1000).length / profits.length) * 100,
      lossRate: (profits.filter((v) => v <= 0).length / profits.length) * 100,
      medResale: median(prices),
    };
  }

  // Cars of the same model inside a tier's year and mileage band.
  const inTier = (pool, car, tier) => pool.filter((s) =>
    s.year != null && Math.abs(s.year - car.year) <= tier.years &&
    s.odo != null && Math.abs(s.odo - car.odo) <= tier.miles);

  const fmtMoney = (v) => (v == null ? '—' : `$${Math.round(v).toLocaleString()}`);

  function evaluateCar(car, byMake) {
    const nmk = normMake(car.make);
    const nmd = normModel(car.model, car.make);
    const pool = (byMake.get(nmk) || []).filter((s) => modelMatch(s.nmodel, nmd));

    const badOdo = car.odo == null || car.odo < MIN_VALID_ODO;
    const base = {
      ...car, badOdo, tier: null, n: 0, meanProfit: null, medProfit: null,
      meanDays: null, hitRate: null, confidence: 'NONE', medResale: null,
      exactN: 0, exactProfit: null, exactMedProfit: null, exactDays: null,
      exactHit: null, exactLoss: null, sameYearN: 0, sameYearProfit: null,
      compPool: '', compShared: 1,
    };

    if (!pool.length) return { ...base, verdict: 'NO DATA', why: 'No record of us selling this model' };
    if (car.year == null) {
      return { ...base, n: pool.length, verdict: 'NO DATA', why: 'Run list has no year — cannot match on age' };
    }
    if (badOdo) {
      return {
        ...base, n: pool.length, verdict: 'NO DATA',
        why: `Run-list mileage looks wrong (${car.odo == null ? 'blank' : car.odo}) — can't match on miles`,
      };
    }

    // The exact car: same year, same model, odometer in range. This is the only
    // cohort allowed to produce a verdict.
    const exactCohort = inTier(pool, car, EXACT);
    const exact = cohortStats(exactCohort);
    // Two run-list cars close enough to draw the same sold cars are one bet, not
    // two. Stamp the cohort so shared evidence is visible instead of implied.
    const compPool = exactCohort.length
      ? exactCohort.map((s) => `${s.vin}|${s.saleDate}`).sort().join(',')
      : '';

    // Same year, any mileage. Used ONLY to veto — never to promote. It catches
    // model-years that are broadly bad (2022 F150: 7 sold, -$1,776 avg) which a
    // narrow mileage band can miss.
    const sameYear = cohortStats(pool.filter((s) => s.year === car.year));

    // Looser cohorts are computed for context and shown in their own columns.
    // They never set the verdict and never drive the ranking.
    let context = null;
    for (const tier of TIERS) {
      if (tier.id === 'exact') continue;
      const cohort = inTier(pool, car, tier);
      if (cohort.length < tier.min) continue;
      context = { tier, st: cohortStats(cohort) };
      break;
    }

    const withStats = {
      ...base,
      compPool,
      exactN: exact.n, exactProfit: exact.meanProfit, exactMedProfit: exact.medProfit,
      exactDays: exact.meanDays, exactHit: exact.hitRate, exactLoss: exact.lossRate,
      sameYearN: sameYear.n, sameYearProfit: sameYear.meanProfit,
      tier: context ? context.tier.label : null,
      n: context ? context.st.n : 0,
      meanProfit: context ? context.st.meanProfit : null,
      medProfit: context ? context.st.medProfit : null,
      meanDays: context ? context.st.meanDays : null,
      hitRate: context ? context.st.hitRate : null,
      medResale: context ? context.st.medResale : exact.medResale,
    };

    const contextNote = context
      ? ` Context only: ${context.st.n} within ±${context.tier.years}yr/±${context.tier.miles / 1000}k, avg ${fmtMoney(context.st.meanProfit)}.`
      : '';

    if (exact.n < EXACT.min) {
      return {
        ...withStats, verdict: 'NO DATA', confidence: 'NONE',
        why: `Only ${exact.n} exact match${exact.n === 1 ? '' : 'es'} (same year, ±${EXACT.miles / 1000}k mi) — not enough to judge.${contextNote}`,
      };
    }

    let verdict = 'PASS';
    if (exact.meanDays != null && exact.meanProfit > TARGET_PROFIT &&
        exact.meanDays < TARGET_DAYS && exact.medProfit > TARGET_MEDIAN_FLOOR) {
      verdict = 'TARGET';
    } else if (exact.meanDays != null && exact.meanProfit > WATCH_PROFIT && exact.meanDays < WATCH_DAYS) {
      verdict = 'WATCH';
    }

    // Veto: this model-year loses money across the board, whatever the mileage.
    let veto = '';
    if (verdict !== 'PASS' && sameYear.n >= SAME_YEAR_VETO_N && sameYear.meanProfit < 0) {
      veto = ` VETO: all ${sameYear.n} ${car.year} ${car.model}s we sold average ${fmtMoney(sameYear.meanProfit)}.`;
      verdict = 'PASS';
    }

    return {
      ...withStats, verdict,
      confidence: exact.n >= 5 ? 'HIGH' : exact.n >= 3 ? 'MEDIUM' : 'LOW',
      why: `${exact.n} sold same year, ±${EXACT.miles / 1000}k mi · avg ${fmtMoney(exact.meanProfit)}, ` +
           `median ${fmtMoney(exact.medProfit)} · ${exact.meanDays == null ? '—' : Math.round(exact.meanDays)}d on lot · ` +
           `${Math.round(exact.hitRate)}% cleared $1k, ${Math.round(exact.lossRate)}% lost money.${veto}${contextNote}`,
    };
  }


  // Run-order comparator. Lanes sort numerically where they're numbers ("4"
  // before "15", not "15" before "4"), with the letter suffix breaking ties
  // ("5" before "5E" before "5R"), then lot number.
  function runOrder(c) {
    const lane = String(c.lane ?? '').trim()
    const lm = lane.match(/^(\d*)([A-Za-z]*)$/) || []
    const lotRaw = String(c.lot ?? '').trim() || (String(c.run ?? '').match(/(\d+)\s*$/) || [])[1] || ''
    return {
      laneNum: lm[1] ? parseInt(lm[1], 10) : Number.MAX_SAFE_INTEGER,
      laneAlpha: (lm[2] || '').toUpperCase(),
      lot: lotRaw ? parseInt(lotRaw, 10) : Number.MAX_SAFE_INTEGER,
    }
  }

  function byRunNumber(a, b) {
    const x = runOrder(a), y = runOrder(b)
    return x.laneNum - y.laneNum ||
      x.laneAlpha.localeCompare(y.laneAlpha) ||
      x.lot - y.lot ||
      String(a.run || '').localeCompare(String(b.run || ''))
  }

  // Does this list have run order at all? Manheim/OVE timed sales carry no run
  // number, lane or lot — every car sorts to MAX_SAFE_INTEGER and the
  // comparator says nothing. There, and only there, fall back to putting the
  // cars worth bidding on at the top, since nothing else orders them.
  function hasRunOrder(cars) {
    return cars.some((c) => {
      const o = runOrder(c);
      return o.laneNum !== Number.MAX_SAFE_INTEGER || o.lot !== Number.MAX_SAFE_INTEGER;
    });
  }

  const BAND_ORDER = { TARGET: 0, WATCH: 1, 'NO DATA': 2, PASS: 3 };

  // One list in the order the cars cross the block — targets and watches
  // interleaved, not stacked in two blocks.
  //
  // They used to be sorted by verdict band first, so the panel gave you every
  // target in run order and then every watch in run order: run 42 above run 7,
  // and you worked the lane by jumping between two halves of the table. The
  // band is on the row already, as the row colour, and the Excel export carries
  // it as a column. Sorting by it as well only broke the one order the sale
  // itself runs in.
  function sortScored(scored) {
    scored.sort(hasRunOrder(scored)
      ? byRunNumber
      : (a, b) => BAND_ORDER[a.verdict] - BAND_ORDER[b.verdict] ||
        (b.exactProfit == null ? -Infinity : b.exactProfit) - (a.exactProfit == null ? -Infinity : a.exactProfit));
    scored.forEach((c, i) => { c.rank = i + 1; });
    return scored;
  }

  // ── Run-list handling ──────────────────────────────────────────────────────
  async function handleRunList(file, log, setStatus) {
    setStatus('reading…', '');
    const raw = parseCSV(await file.text());
    if (!raw.length) throw new Error('empty file');

    const fmt = detectFormat(raw);
    if (!fmt) throw new Error('unrecognised format (expected Edge Pipeline pre-sale export)');
    log(`${fmt.label} run list — ${raw.length} rows`, 'ok');

    // ADESA exports repeat rows (~20 dupes in a 134-row list), so collapse on VIN.
    const mapped = raw.map(fmt.map).filter((c) => c.vin || (c.year && c.make));
    const seen = new Set();
    const cars = mapped.filter((c) => {
      if (!c.vin) return true;
      if (seen.has(c.vin)) return false;
      seen.add(c.vin);
      return true;
    });
    if (cars.length < mapped.length) log(`  collapsed ${mapped.length - cars.length} duplicate rows`, '');

    setStatus('pulling sold book…', '');
    const rows = await fetchSoldBook(log);
    if (!rows.length) throw new Error('sold book is empty — list_all_sold() returned nothing');

    const { book, removedOutliers, removedPassthrough } = cleanBook(rows);
    log(`  ${rows.length} rows → ${book.length} after cleaning`, 'ok');
    log(`  dropped ${removedPassthrough.length} pass-through, ${removedOutliers.length} outliers`, '');
    for (const r of removedOutliers) {
      log(`  outlier: $${Number(r.net_profit).toLocaleString()} ${r.year} ${r.make} ${r.model}`, '');
    }

    const byMake = indexBook(book);
    const scored = sortScored(cars.map((c) => evaluateCar(c, byMake)));

    // Flag rows whose verdict rests on the exact same sold cars.
    const poolCounts = new Map();
    for (const c of scored) if (c.compPool) poolCounts.set(c.compPool, (poolCounts.get(c.compPool) || 0) + 1);
    for (const c of scored) c.compShared = c.compPool ? poolCounts.get(c.compPool) : 1;

    const t = scored.filter((c) => c.verdict === 'TARGET').length;
    const w = scored.filter((c) => c.verdict === 'WATCH').length;

    lastResult = { scored, bookSize: book.length, rawBook: rows.length, source: fmt.label,
                   sourceId: fmt.id, fileName: file.name, removedOutliers, removedPassthrough };

    log(`${t} TARGET · ${w} WATCH · ${scored.length - t - w} PASS`, 'ok');
    setStatus(`✓ ${t} targets of ${scored.length}`, 'loaded');
    renderPanel(lastResult);

    // Saved before anything is done with it, so the minute of scoring can't go
    // with the popup. A save that fails leaves the panel up and working — it
    // just won't be there when you open the popup again.
    try {
      lastResult.id = await saveRunList(lastResult);
      log('saved — this list will still be here next time you open the popup', 'ok');
      await refreshSaved();
    } catch (err) {
      log(`couldn't save this list (${err.message}) — it'll be gone when the popup closes`, 'err');
    }
  }

  // ── Restore ────────────────────────────────────────────────────────────────
  // Called once when the popup opens. The newest saved list goes straight back
  // on screen — no upload, no re-scoring — which is the entire reason the rows
  // exist. Quiet on failure: an empty panel is what the popup did before.
  async function restoreLast() {
    try {
      savedIndex = (await listSaved()) || [];
      if (!savedIndex.length) return;
      const list = await loadSaved(savedIndex[0].id);
      if (!list) return;
      lastResult = list;
      renderPanel(lastResult);
      const st = document.getElementById('tblRunListStatus');
      if (st) {
        st.textContent = `✓ ${list.scored.filter((c) => c.verdict === 'TARGET').length} targets of ${list.scored.length}`;
        st.className = 'upload-file-status loaded';
      }
    } catch (err) {
      console.error('restoring the last run list failed', err);
    }
  }

  async function refreshSaved() {
    try {
      savedIndex = await listSaved();
      renderSavedStrip();
    } catch (err) { console.error('reading saved lists failed', err); }
  }

  async function openSaved(id) {
    if (!id || (lastResult && lastResult.id === id)) return;
    try {
      const list = await loadSaved(id);
      if (!list) { logLine('that list is no longer saved', 'err'); await refreshSaved(); return; }
      lastResult = list;
      renderPanel(lastResult);
    } catch (err) {
      logLine(`couldn't open that list: ${err.message}`, 'err');
    }
  }

  // ── Excel export ───────────────────────────────────────────────────────────
  // Keep in lockstep with COLUMNS in inspection-app/src/pages/ListBuilder.jsx —
  // both exports are meant to be the same workbook.
  const COLUMNS = [
    // VIN sits up front, not out past the stats. Manheim/OVE timed sales carry
    // no run number, lane or lot, so on those lists the VIN is the only thing
    // that identifies the car at all.
    ['Rank', 'rank', 6], ['Verdict', 'verdict', 10], ['VIN', 'vin', 20], ['Confidence', 'confidence', 11],
    ['Exact Matches', 'exactN', 13], ['Exact Avg Profit', 'exactProfit', 15],
    ['Exact Med Profit', 'exactMedProfit', 15], ['Exact Avg Days', 'exactDays', 13],
    ['Exact % Cleared $1k', 'exactHit', 18], ['Exact % Lost Money', 'exactLoss', 18],
    ['Shared Comps', 'compShared', 12],
    ['Same-Yr Sold', 'sameYearN', 12], ['Same-Yr Avg Profit', 'sameYearProfit', 17],
    ['Run #', 'run', 9], ['Lane', 'lane', 6], ['Lot', 'lot', 7], ['Sale Date', 'saleDate', 11],
    ['Year', 'year', 6], ['Make', 'make', 14], ['Model', 'model', 18], ['Trim / Style', 'style', 18],
    ['Miles', 'odo', 10], ['Color', 'color', 11], ['CR Grade', 'grade', 9], ['Has CR', 'hasCR', 7],
    ['Photos', 'pics', 7], ['Drivetrain', 'drivetrain', 11], ['Engine', 'engine', 16],
    ['Transmission', 'transmission', 13], ['Fuel', 'fuel', 9],
    ['Context Avg Profit', 'meanProfit', 17], ['Context Avg Days', 'meanDays', 16],
    ['Context Cars', 'n', 12], ['Context Tier', 'tier', 12],
    ['Our Median Resale', 'medResale', 16], ['MMR / Auction Value', 'auctionValue', 18],
    ['Why', 'why', 70], ['Stock', 'stock', 11],
    ['Seller', 'seller', 22], ['Location', 'location', 22], ['Channel', 'channel', 12],
    ['Title Status', 'titleStatus', 13], ['Announcements', 'announcements', 30],
  ];
  // Identifier columns must stay text. "4-0131" imports as a number and
  // "5E-0027" as scientific notation (5.00E-27) if the cell has no explicit text
  // format — which also splits sorting into a number block and a text block.
  const TEXT_KEYS = new Set(['run', 'lane', 'lot', 'stock', 'vin', 'saleDate', 'grade']);
  const MONEY_KEYS = new Set(['meanProfit', 'medProfit', 'medResale', 'auctionValue', 'exactProfit', 'exactMedProfit', 'sameYearProfit']);
  const INT_KEYS = new Set(['odo', 'meanDays', 'hitRate', 'n', 'pics', 'rank', 'year', 'exactN', 'exactDays', 'exactHit', 'exactLoss', 'compShared', 'sameYearN']);

  function exportXlsx() {
    if (!lastResult || typeof window.XLSXWriter === 'undefined') return;
    const S = window.XLSXWriter.S;
    const vStyle = { TARGET: S.GREEN, WATCH: S.YELLOW, PASS: S.DEFAULT };

    const rows = [COLUMNS.map(([h]) => ({ v: h, s: S.HEADER }))];
    for (const c of lastResult.scored) {
      rows.push(COLUMNS.map(([, key]) => {
        const v = c[key];
        if (key === 'verdict') return { v, s: vStyle[v] };
        if (v == null || v === '') return '';
        if (TEXT_KEYS.has(key)) return { v: String(v), s: S.TEXT };
        if (key === 'hasCR') return v ? 'Y' : '';
        if (MONEY_KEYS.has(key)) {
          const n = Number(v);
          return Number.isFinite(n) ? { v: Math.round(n), s: S.MONEY } : '';
        }
        if (INT_KEYS.has(key)) {
          const n = Number(v);
          if (!Number.isFinite(n)) return '';
          return key === 'year' ? n : { v: Math.round(n), s: S.NUMBER };
        }
        return v;
      }));
    }

    const blob = window.XLSXWriter.build({
      sheetName: 'Target Buy List',
      rows,
      widths: COLUMNS.map(([, , w]) => w),
    });
    window.XLSXWriter.download(blob, `target-buy-list-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  // ── Open the listings straight off the auction page ────────────────────────
  // A run list carries no listing URLs, and on a Manheim/OVE timed sale there
  // is no run number to call out either — so the only handle on a car is its
  // VIN, and the only place that VIN maps to a link is the search-results page
  // already sitting in the active tab. This pulls VIN -> listing link out of
  // that page's DOM, which is the ⌘F-then-click loop done in one shot.
  // Every source paginates, and none of them agree on how: OVE renders ~100 at
  // a time, Edge Pipeline paginates at 50, ADESA virtualises and keeps roughly
  // a screenful of 19 alive. So the batch is not "the next ten in the report" —
  // it's "every car in the report that this page is currently showing". You
  // work a page, move to the next, press again. Nothing is ever written off for
  // being absent; it just wasn't on that page.
  //
  // Still capped, because "all" on a 100-car OVE page means 100 windows.
  //
  // Five, not fifty. Fifty is how many windows a browser will *accept* before
  // it refuses; it is not how many a person can work, and on a 50-car list it
  // took a laptop down. Five is a screenful you can actually review, proxy and
  // close before pressing again. The overflow stays queued — `opened` below is
  // what makes the next press pick up where this one stopped, and a car is
  // only added to it once its window really opened.
  const MAX_OPEN_AT_ONCE = 5;
  const opened = new Set();

  // Both of these sites will take a VIN where they normally want their own
  // internal listing id and redirect to the right car themselves — verified
  // against live pages on both. That makes scraping unnecessary for them: the
  // URL is built straight from the run list, so every car in the report is
  // reachable whether or not it happens to be rendered, which is the whole
  // problem on ADESA (append-only infinite scroll, ~20 of 2,340 loaded at a
  // time — you would have to scroll for minutes to see the rest).
  //
  // Keyed by the format the run list was recognised as, because that is what
  // says which site the cars live on: a Manheim export is browsed on OVE, an
  // ADESA export on the ADESA marketplace.
  // Where a car actually lives — which is not one site per format. A Manheim
  // export carries both of Manheim's marketplaces and its `Inventory` column
  // says which: `OVE` is the online exchange, `Simulcast` is a car rolling
  // through a physical lane. Every export we get is Simulcast (Kansas City,
  // Denver — lanes 1 through 36), and a Simulcast car is not an OVE listing, so
  // sending it to an OVE detail route searched a marketplace the car was never
  // in and found nothing. Every time, for every car.
  //
  // The lane route is Manheim's own answer, not a guess: their legacy
  // /members/powersearch/searchResults.do?vin= 301s to
  // search.manheim.com/results?vin=<VIN>. That route also carries the VIN
  // through the login redirect in its `state` parameter, so it lands on the car
  // even from a browser that has to sign in first.
  const DIRECT_URL = {
    manheim: (c) => (/OVE/i.test(c.channel || '')
      ? `https://www.ove.com/search/results#/details/${c.vin}/OVE`
      : `https://search.manheim.com/results?vin=${c.vin}`),
    adesa: (c) => `https://marketplace.adesa.com/details/${c.vin}`,
  };
  // Edge Pipeline is deliberately absent: its detail route takes the auction's
  // own vehicle id, not a VIN, so those still have to be read off the page.

  // A source with no VIN-addressable URL can still have its listings recognised
  // by route, and Edge Pipeline needs that badly: its pre-sale page hangs a
  // little "(?)" lights-legend link off every card — 144 of them against 100
  // real car links, counted on a live Des Moines run list. Neither carries the
  // VIN in its href and the detail anchor wraps an image, so its text is empty
  // too; both therefore ranked `weak` below, and because the legend URL is much
  // shorter than a detail URL with its ?btr= return path, the shortest-wins
  // tiebreak chose the legend every single time. Pressing "open 5" opened five
  // copies of the colour key. Matching the route settles it outright.
  const LISTING_PATH = {
    edge_pipeline: '/components/vehicle/detail/',
  };

  // ADESA virtualises: ~20 cards exist at a time out of 2,300 results, and a
  // card is destroyed once it scrolls out. One snapshot can therefore only ever
  // see a screenful, which is why most of the list looked "not on this page".
  // So we sweep — scroll a step, harvest what rendered, repeat — and collect on
  // the way down rather than reading once at the end. Their loader is async and
  // extends the list as it goes (the scroll container grew 2,208px -> 13,077px
  // in testing), so "reached the bottom" is only believed after it stops
  // yielding anything new several times running.
  const SWEEP_MAX_MS = 90000;
  const SWEEP_SETTLE_MS = 600;
  const SWEEP_MAX_STEPS = 400;
  const SWEEP_STALLS = 4;

  // Runs in the page, not here — everything it needs must be inside it.
  function scrapeVinLinks(allItems, listingPath) {
    // The whole report gets handed over now, not a batch of ten, so narrow to
    // the cars this page actually shows before touching the DOM element by
    // element. One scan of the body text against 800 VINs is cheap; 800 VINs
    // against every element on the page is not.
    const bodyText = (document.body.textContent || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    const items = allItems.filter((it) => bodyText.indexOf(it.vin) !== -1);
    if (!items.length) return {};

    // Smallest element whose text carries the VIN: the card's VIN line, not the
    // card, not the whole results list. OVE splits the VIN across a plain and a
    // bold span, so match on textContent with the punctuation stripped rather
    // than on individual text nodes.
    const best = new Map();
    const els = document.body.getElementsByTagName('*');
    for (let i = 0; i < els.length; i++) {
      const raw = els[i].textContent;
      if (!raw || raw.length < 17 || raw.length > 5000) continue;
      const t = raw.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
      if (t.length < 17) continue;
      for (const it of items) {
        if (t.indexOf(it.vin) === -1) continue;
        const prev = best.get(it.vin);
        if (!prev || t.length < prev.len) best.set(it.vin, { el: els[i], len: t.length });
      }
    }

    const hrefOf = (a) => {
      const raw = a.getAttribute('href') || '';
      if (!raw || /^(javascript|mailto|tel):/i.test(raw)) return '';
      // OVE is a hash-routed SPA and the listing link *is* the hash:
      // "#/details/<VIN>/OVE". So a leading # is a real destination — only a
      // bare "#" or an in-page jump ("#top") isn't. a.href resolves these to a
      // full URL with the hash intact, which cold-loads to the right car.
      if (raw.charAt(0) === '#' && raw.charAt(1) !== '/') return '';
      return a.href;
    };
    // Links that live in a result card but never open the car.
    const NOT_A_LISTING = /carfax|autocheck|experian|\/seller|\/dealer|\/lights\/|feedback|rating|logout|help|report/i;

    // A badge can sit flush against the model year — OVE renders the title as
    // "NEW2023 Volkswagen Taos SE" — so drop leading letters that run straight
    // into a year before asking whether the text leads with that year.
    const deBadge = (txt) => txt.replace(/^[A-Z]+(?=(?:19|20)\d{2})/, '');

    // The VIN itself is never a link — the vehicle title sitting directly above
    // it is. So a card is scored by which of its anchors is that title, best
    // signal first:
    //   vin   the href carries the VIN outright — unambiguous, nothing to infer
    //   card  the anchor wraps text containing the VIN, so it *is* that car's
    //         card — ADESA links the whole card rather than the title
    //   title anchor text reads "2019 VOLKSWAGEN JETTA S" — year first, then make
    //   year  anchor text leads with the model year but the make didn't match
    //   weak  no title-shaped anchor at all; last resort, and reported as such
    // Requiring year AND make also keeps us honest when the climb overshoots
    // into a container holding more than one card.
    const RANK = { listing: 0, vin: 1, card: 2, title: 3, year: 4, weak: 5 };
    const flat = new Map();
    const flatText = (a) => {
      let v = flat.get(a);
      if (v === undefined) { v = (a.textContent || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase(); flat.set(a, v); }
      return v;
    };
    // An anchor's own text nodes, ignoring nested elements. A card that wraps
    // its whole tile in one <a> inherits the text of every link inside it, so
    // matching NOT_A_LISTING against the full textContent threw the ADESA card
    // away for containing a CARFAX link somewhere beneath it. For an ordinary
    // leaf link this is just its label, which is what the check always meant.
    const ownText = (a) => {
      const kids = a.childNodes || [];
      let s = '';
      for (let i = 0; i < kids.length; i++) if (kids[i].nodeType === 3) s += kids[i].nodeValue || '';
      return s.trim().toUpperCase();
    };
    const pickHref = (root, it) => {
      // querySelectorAll only ever returns descendants, so a card that is
      // itself an <a> — ADESA wraps the entire card in one — was invisible
      // here and the climb walked straight past the only link that mattered.
      const anchors = [...root.querySelectorAll('a[href]')];
      if (root.tagName === 'A' && root.getAttribute('href')) anchors.unshift(root);
      let bestHit = null;
      for (let i = 0; i < anchors.length; i++) {
        const h = hrefOf(anchors[i]);
        if (!h) continue;
        const txt = (anchors[i].textContent || '').trim().toUpperCase();
        // Carrying the VIN doesn't make a link the listing: OVE's AutoCheck URL
        // embeds the VIN in its query string, so it used to win at rank "vin"
        // and open a history report instead of the car. The exclusion has to
        // gate every branch, not just "weak".
        // A known listing route overrides the blocklist, and on Edge Pipeline
        // that is the whole ballgame: every car link carries a return path,
        // "?btr=%2Fcomponents%2Freport%2Fpresale%2Fview%2F…", and NOT_A_LISTING
        // matches on `report`. So every real car was thrown away here and the
        // only survivor in the card was the "(?)" lights legend — which is what
        // the batch actually opened, five times over. Testing the route first
        // fixes that without weakening any exclusion for the other sources.
        const isListing = !!listingPath && h.indexOf(listingPath) !== -1;
        if (!isListing && (NOT_A_LISTING.test(h) || NOT_A_LISTING.test(ownText(anchors[i])))) continue;
        let how = '';
        if (isListing) how = 'listing';
        else if (h.toUpperCase().indexOf(it.vin) !== -1) how = 'vin';
        else if (flatText(anchors[i]).indexOf(it.vin) !== -1) how = 'card';
        else if (it.year && deBadge(txt).indexOf(String(it.year)) === 0) {
          how = it.make && txt.indexOf(it.make.toUpperCase()) !== -1 ? 'title' : 'year';
        } else how = 'weak';
        // On a tie, the shorter URL wins: the car is "#/details/<VIN>/OVE" and
        // its condition-report tab is that same route plus a segment, so both
        // carry the VIN and rank equally. Shortest-wins picks the car without
        // depending on which one the page happens to render first.
        const better = !bestHit || RANK[how] < RANK[bestHit.how]
          || (RANK[how] === RANK[bestHit.how] && h.length < bestHit.href.length);
        if (better) bestHit = { href: h, how, text: txt.slice(0, 60) };
      }
      return bestHit;
    };

    const out = {};
    for (const it of items) {
      const hit = best.get(it.vin);
      if (!hit) continue;
      // Climb until a card-shaped ancestor yields a link. Keep climbing past a
      // weak hit — one more level up usually reaches the title anchor — but
      // hold onto it in case nothing better turns up.
      let p = hit.el, fallback = null;
      for (let d = 0; d < 12 && p && p !== document.body; d++) {
        const got = pickHref(p, it);
        if (got && got.how !== 'weak') { out[it.vin] = got; break; }
        if (got && !fallback) fallback = got;
        p = p.parentElement;
      }
      if (!out[it.vin] && fallback) out[it.vin] = fallback;
    }
    return out;
  }

  // Runs in the page. Scrolls the results one viewport and says where it got
  // to. The results rarely scroll the window itself — ADESA's document is
  // exactly one screen tall and the list lives in an inner div — so the
  // scroller is found by looking for the scrollable element holding the most
  // links, which is the results list on every site tried.
  function pageScrollStep(toTop) {
    let sc = null, most = -1;
    const els = document.body.getElementsByTagName('*');
    for (let i = 0; i < els.length; i++) {
      const e = els[i];
      if (e.scrollHeight <= e.clientHeight + 50) continue;
      const ov = getComputedStyle(e).overflowY;
      if (ov !== 'auto' && ov !== 'scroll') continue;
      const n = e.querySelectorAll('a[href]').length;
      if (n > most) { most = n; sc = e; }
    }
    const winMax = () => (document.documentElement.scrollHeight - window.innerHeight);
    if (toTop) {
      if (sc) sc.scrollTop = 0; else window.scrollTo(0, 0);
      return { y: 0, max: sc ? sc.scrollHeight - sc.clientHeight : winMax(), moved: true };
    }
    if (sc) {
      const was = sc.scrollTop;
      sc.scrollTop = was + Math.max(200, Math.round(sc.clientHeight * 0.85));
      return { y: sc.scrollTop, max: sc.scrollHeight - sc.clientHeight, moved: sc.scrollTop > was };
    }
    const was = window.scrollY;
    window.scrollBy(0, Math.max(200, Math.round(window.innerHeight * 0.85)));
    return { y: window.scrollY, max: winMax(), moved: window.scrollY > was };
  }

  async function resolveOnPage(cars, setNote, listingPath) {
    const items = cars.map((c) => ({ vin: c.vin, year: c.year, make: c.make, model: c.model }));
    setNote(`scanning the list for ${items.length}…`, '#666');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) { setNote('no active tab', '#c62828'); return null; }

    const links = {};
    let pending = items;
    const run = (func, args) => chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args })
      .then(([r]) => (r && r.result));
    // Each pass only asks about cars still missing, so the work shrinks as the
    // sweep goes on even though the list it's walking gets longer.
    const harvest = async () => {
      const got = (await run(scrapeVinLinks, [pending, listingPath || ''])) || {};
      const names = Object.keys(got);
      if (names.length) {
        Object.assign(links, got);
        const have = new Set(names);
        pending = pending.filter((p) => !have.has(p.vin));
      }
      return names.length;
    };

    try {
      // Start from the top so a sweep covers the whole list rather than
      // whatever happens to be below the current scroll position.
      await run(pageScrollStep, [true]);
      await harvest();

      let stalls = 0, steps = 0;
      const started = Date.now();
      while (pending.length && steps < SWEEP_MAX_STEPS && Date.now() - started < SWEEP_MAX_MS) {
        const pos = (await run(pageScrollStep, [false])) || {};
        steps++;
        await new Promise((r) => setTimeout(r, SWEEP_SETTLE_MS));
        const found = await harvest();
        // Their loader appends asynchronously, so a motionless step at the
        // bottom isn't the end until several in a row come back empty.
        const atEnd = !pos.moved && pos.y >= (pos.max || 0) - 2;
        if (!found && atEnd) { if (++stalls >= SWEEP_STALLS) break; } else stalls = 0;
        setNote(`scanning… ${Object.keys(links).length} found`, '#666');
      }
      return { items, links, tabUrl: tab.url || '' };
    } catch (err) {
      // Chrome refuses to inject into its own pages and into the Web Store.
      setNote(`can't read that tab — ${err.message}`, '#c62828');
      return null;
    }
  }

  // Dry run: show what each VIN resolved to without opening anything, so a bad
  // pick is caught before it becomes a screenful of wrong windows.
  async function checkOnPage(cars, setNote, log) {
    const direct = DIRECT_URL[lastResult && lastResult.sourceId];
    if (direct) {
      const shown = cars.slice(0, 10);
      for (const c of shown) log(`  ✓ ${c.vin} → ${direct(c)}  [direct link — no page needed]`, 'ok');
      if (cars.length > shown.length) log(`  …and ${cars.length - shown.length} more, same form`, '');
      setNote(`${cars.length} ready · built straight from the VIN`, '#1b5e20');
      return;
    }
    const got = await resolveOnPage(cars, setNote, LISTING_PATH[lastResult && lastResult.sourceId]);
    if (!got) return;
    const { items, links } = got;
    let good = 0, weak = 0;
    // Only what the page has gets a line each. The remainder is a single count:
    // the whole unopened report is handed over now, so listing every absent car
    // would bury the handful that matter under hundreds of lines.
    for (const it of items) {
      const hit = links[it.vin];
      if (!hit) continue;
      if (hit.how === 'weak') { weak++; log(`  ? ${it.vin} → ${hit.href}  [no title link found]`, 'err'); }
      else { good++; log(`  ✓ ${it.vin} → ${hit.href}  [${hit.how}: ${hit.text}]`, 'ok'); }
    }
    const elsewhere = items.length - good - weak;
    if (elsewhere) log(`  ${elsewhere} of ${items.length} weren't in that list`, '');
    setNote(`${good} matched · ${weak} unsure · ${elsewhere} not found`,
      weak || !good ? '#e65100' : '#1b5e20');
  }

  // Resolve VINs to links on the active tab and open each car in its own
  // window. A window rather than a tab because these are hash routes on the
  // same page the results live on — a tab would leave you scrubbing one
  // address bar, and OVE's SPA can swallow a same-document hash change without
  // re-rendering. Unfocused so the side panel keeps focus and the batch order
  // is preserved; awaited in sequence so the windows land in table order.
  async function openOnPage(cars, setNote, log) {
    const direct = DIRECT_URL[lastResult && lastResult.sourceId];
    let items, links;
    if (direct) {
      // No page needed, so nothing can be "not on this page".
      items = cars.map((c) => ({ vin: c.vin }));
      links = {};
      // Built from the car, not the VIN: which marketplace it opens on is a
      // property of the listing (see DIRECT_URL), not of the number.
      for (const c of cars) links[c.vin] = { href: direct(c), how: 'direct', text: '' };
    } else {
      const got = await resolveOnPage(cars, setNote, LISTING_PATH[lastResult && lastResult.sourceId]);
      if (!got) return;
      items = got.items; links = got.links;
    }

    // Everything we have a link for, in report order.
    const hits = items.map((it) => ({ it, hit: links[it.vin] })).filter((x) => x.hit);
    const overflow = Math.max(0, hits.length - MAX_OPEN_AT_ONCE);
    const batch = hits.slice(0, MAX_OPEN_AT_ONCE);

    if (!hits.length) {
      setNote(`none of your ${items.length} remaining cars are in that list`, '#c62828');
      log(`  nothing from the report turned up — check it's the right saved search`, 'err');
      return;
    }
    if (overflow) log(`  ${hits.length} found — opening ${MAX_OPEN_AT_ONCE}, press again for the other ${overflow}`, '');

    // Size and place them explicitly. Left to itself, chrome.windows.create
    // inherits the geometry of the last window you sized, which is how these
    // ended up full-width; and every window lands at the same coordinates, so
    // five cars stack exactly on top of each other and the only way to read
    // them is to drag each one aside.
    //
    // A car page wants roughly two thirds of the screen, and the cascade steps
    // down-right so the batch reads as a pile in run order. Anchored to the
    // right edge so the panel you're working from stays uncovered.
    const SW = (typeof screen !== 'undefined' && screen.availWidth) || 1680;
    const SH = (typeof screen !== 'undefined' && screen.availHeight) || 1050;
    const WIN_W = Math.round(Math.min(1200, SW * 0.62));
    const WIN_H = Math.round(Math.min(900, SH * 0.86));
    const STEP = 30;
    const spread = (MAX_OPEN_AT_ONCE - 1) * STEP;
    const BASE_LEFT = Math.max(0, SW - WIN_W - spread - 20);
    const BASE_TOP = Math.max(0, Math.round((SH - WIN_H - spread) / 2));

    let n = 0, weak = 0, firstWindowId = null;
    for (const { it, hit } of batch) {
      if (hit.how === 'weak') { weak++; log(`  ? ${it.vin} → ${hit.href}  [guessed — no title link]`, 'err'); }
      try {
        const win = await chrome.windows.create({
          url: hit.href,
          focused: false,
          width: WIN_W,
          height: WIN_H,
          left: BASE_LEFT + n * STEP,
          top: BASE_TOP + n * STEP,
        });
        if (firstWindowId === null && win) firstWindowId = win.id;
      } catch (err) {
        // Don't let one refused window kill the rest of the batch.
        log(`  ✗ ${it.vin} — couldn't open a window: ${err.message}`, 'err');
        continue;
      }
      opened.add(it.vin);
      n++;
    }
    // Still created unfocused, so the batch keeps its order and the panel isn't
    // yanked away mid-run. Raising the FIRST car once at the end brings the
    // whole cascade forward in one go — otherwise the pile sits behind whatever
    // window you were already working in, which is the other half of why these
    // needed shoving around by hand.
    if (firstWindowId !== null) {
      try {
        await chrome.windows.update(firstWindowId, { focused: true });
      } catch { /* closed already, or the profile refused focus — harmless */ }
    }
    // Cars this page didn't have are left completely alone — they're not gone,
    // they're on another page, and the next press picks them up there.
    const elsewhere = items.length - hits.length;
    setNote(`opened ${n}${weak ? ` · ${weak} guessed` : ''}`
      + `${overflow ? ` · ${overflow} more found` : ''}`
      + `${elsewhere ? ` · ${elsewhere} not in that list` : ''}`,
      weak ? '#e65100' : '#1b5e20');
  }

  // ── UI ─────────────────────────────────────────────────────────────────────
  // Same log pane handleRunList writes to, reachable from the rendered panel.
  function logLine(msg, kind) {
    const el = document.getElementById('tblLog');
    if (!el) return;
    const line = document.createElement('div');
    line.style.color = kind === 'err' ? '#c62828' : kind === 'ok' ? '#1b5e20' : '#777';
    line.textContent = msg;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
  }

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // The saved lists, newest first, as one line of chips above the report. Its
  // own function rather than part of renderPanel because saving a list changes
  // the strip and nothing else — redrawing the whole report to add a chip would
  // throw away the scroll position in a 300-car table.
  function renderSavedStrip() {
    const el = document.getElementById('tblSaved');
    if (!el) return;
    if (!savedIndex.length) { el.innerHTML = ''; return; }
    const current = lastResult && lastResult.id;
    el.innerHTML = `<div style="font-size:10px;color:#888;">Saved lists</div>`
      + `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:2px;">`
      + savedIndex.map((s) => {
        const on = s.id === current;
        const when = new Date(s.created_at).toLocaleString();
        const where = s.built_by === 'extension' ? 'this extension' : 'the web app';
        return `<span class="tbl-saved" data-id="${esc(s.id)}"
          title="${esc(`${s.car_count} cars · scored ${when} in ${where}`)}"
          style="cursor:pointer;font-size:10px;padding:2px 7px;border-radius:9px;
            border:1px solid ${on ? '#1b5e20' : '#ccc'};background:${on ? '#1b5e20' : '#fff'};
            color:${on ? '#fff' : '#555'};">${esc(s.source_label || s.source_id)}${
              s.sale_date ? ` · ${esc(s.sale_date)}` : ''} · ${s.target_count}T/${s.watch_count}W</span>`;
      }).join('')
      + `</div>`;
    el.querySelectorAll('.tbl-saved').forEach((n) =>
      n.addEventListener('click', () => openSaved(n.dataset.id)));
  }

  // The scored list, rolled up. Two tables: lanes, then the consignors inside
  // them — a lane tells you where to stand today, a consignor tells you whose
  // cars to look for next month, when the lane numbers have moved.
  //
  // Expected profit only counts cars that HAVE a comp (exactN > 0). Averaging in
  // the zeros from no-data cars drags a genuinely good lane down toward whatever
  // share of it we happen to have no history on.
  function laneStudyHtml(scored) {
    const roll = (keyOf) => {
      const m = new Map();
      for (const c of scored) {
        const k = String(keyOf(c) || '').trim() || '—';
        if (!m.has(k)) m.set(k, { k, n: 0, t: 0, w: 0, p: [], d: [], cr: [], sub: new Map() });
        const a = m.get(k);
        a.n++;
        if (c.verdict === 'TARGET') a.t++;
        if (c.verdict === 'WATCH') a.w++;
        if (Number(c.exactN) > 0 && isFinite(Number(c.exactProfit))) a.p.push(Number(c.exactProfit));
        if (Number(c.exactN) > 0 && isFinite(Number(c.exactDays))) a.d.push(Number(c.exactDays));
        const g = Number(String(c.grade == null ? '' : c.grade).match(/\d+(\.\d+)?/) || [NaN]);
        if (isFinite(g)) a.cr.push(g);
        const sk = String(c.seller || '').trim();
        if (sk) a.sub.set(sk, (a.sub.get(sk) || 0) + 1);
      }
      const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
      return [...m.values()]
        .map((a) => ({ ...a, ep: avg(a.p), ed: avg(a.d), acr: avg(a.cr) }))
        .sort((x, y) => (y.ep == null ? -1e9 : y.ep) - (x.ep == null ? -1e9 : x.ep));
    };
    const money = (v) => (v == null ? '—' : `$${Math.round(v).toLocaleString()}`);
    const tint = (v) => (v == null ? '#fafafa' : v >= 600 ? '#e8f5e9' : v >= 200 ? '#fffde7' : '#ffebee');
    const table = (rows, head, showTop) => {
      let h = `<div style="max-height:190px;overflow:auto;font-size:10px;margin-bottom:8px;">
        <table style="width:100%;border-collapse:collapse;">
        <tr style="background:#f0f0f0;font-weight:700;position:sticky;top:0;">
        <td>${head}</td><td>Cars</td><td title="cars flagged TARGET">Tgt</td>
        <td title="average net profit on exact comps">Avg $</td>
        <td title="average days on lot for exact comps">Days</td><td>CR</td>${showTop ? '<td>Top seller</td>' : ''}</tr>`;
      for (const a of rows) {
        const top = showTop ? [...a.sub.entries()].sort((x, y) => y[1] - x[1])[0] : null;
        h += `<tr style="border-top:1px solid #e0e0e0;background:${tint(a.ep)};">
          <td style="font-family:monospace;font-weight:700;">${esc(a.k)}</td>
          <td>${a.n}</td><td style="font-weight:700;">${a.t || ''}</td>
          <td style="font-weight:700;">${money(a.ep)}</td>
          <td>${a.ed == null ? '—' : Math.round(a.ed) + 'd'}</td>
          <td>${a.acr == null ? '—' : a.acr.toFixed(1)}</td>
          ${showTop ? `<td style="color:#555;">${esc(top ? top[0].slice(0, 28) : '')}</td>` : ''}</tr>`;
      }
      return h + '</table></div>';
    };
    const lanes = roll((c) => c.lane);
    const sellers = roll((c) => c.seller).filter((a) => a.n >= 2);
    const anyLane = scored.some((c) => String(c.lane ?? '').trim());
    let h = '';
    if (anyLane) h += `<div style="font-size:10px;font-weight:700;color:#1b5e20;margin:2px 0 3px;">Where to stand — by lane</div>`
      + table(lanes, 'Lane', true);
    h += `<div style="font-size:10px;font-weight:700;color:#1b5e20;margin:2px 0 3px;">Whose cars to watch — by consignor (2+ on this list)</div>`
      + table(sellers, 'Seller', false);
    h += `<div style="font-size:9px;color:#777;">Avg $ and Days count only cars with a real comp behind them. Green ≥ $600, amber ≥ $200.</div>`;
    return h;
  }

  function renderPanel(result) {
    const el = document.getElementById('tblPanel');
    if (!el) return;
    const { scored, bookSize } = result;
    const targets = scored.filter((c) => c.verdict === 'TARGET');
    const watch = scored.filter((c) => c.verdict === 'WATCH');

    let html = `<div style="font-size:11px;font-weight:700;color:#1b5e20;margin-bottom:2px;">
      ${targets.length} TARGET · ${watch.length} WATCH · ${scored.length} cars on the list</div>`;
    html += `<div style="font-size:10px;color:#666;margin-bottom:5px;">
      vs ${bookSize || '—'} sold cars · avg profit &gt; $${TARGET_PROFIT} and under ${TARGET_DAYS} days${
        result.savedAt ? ` · scored ${new Date(result.savedAt).toLocaleString()}${
          result.builtBy === 'web' ? ' in the web app' : ''}` : ''}</div>`;
    // Filled by renderSavedStrip, which also runs on its own when a save or a
    // delete changes the list without redrawing the whole panel.
    html += `<div id="tblSaved" style="margin-bottom:5px;"></div>`;
    html += `<div style="display:flex;gap:4px;margin-bottom:4px;">
      <button id="tblExport" class="btn btn-small" style="background:#1b5e20;font-size:10px;padding:3px 8px;">⬇ Excel</button>
      <button id="tblCopyRuns" class="btn btn-small" style="background:#1565c0;font-size:10px;padding:3px 8px;">Copy Run #s</button>
      <button id="tblCopyVins" class="btn btn-small" style="background:#6a1b9a;font-size:10px;padding:3px 8px;">Copy VINs</button>
      <button id="tblNewList" class="btn btn-small" title="score a different run list — this one stays up until the new file loads"
        style="background:#00695c;font-size:10px;padding:3px 8px;margin-left:auto;">＋ New list</button>
    </div>`;
    // "Reset opens", not "Reset" — it only rewinds the ↗ batching. Clearing the
    // report itself is ＋ New list, and the two sat next to each other reading
    // as if either might throw the run list away.
    // TARGET and WATCH open separately. They mean different things — one is
    // "bid on this", the other is "keep an eye on it" — and a single button
    // that opened both buried a handful of targets in a pile of watches.
    html += `<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;flex-wrap:wrap;">
      <button id="tblOpenTarget" class="btn btn-small" title="open TARGET cars only, ${MAX_OPEN_AT_ONCE} at a time — press again for the next ${MAX_OPEN_AT_ONCE}"
        style="background:#1b5e20;font-size:10px;padding:3px 8px;">↗ TARGET (<span id="tblLeftTarget">${targets.filter((c) => c.vin).length}</span> left)</button>
      <button id="tblOpenWatch" class="btn btn-small" title="open WATCH cars only, ${MAX_OPEN_AT_ONCE} at a time — press again for the next ${MAX_OPEN_AT_ONCE}"
        style="background:#e65100;font-size:10px;padding:3px 8px;">↗ WATCH (<span id="tblLeftWatch">${watch.filter((c) => c.vin).length}</span> left)</button>
      <button id="tblOpenCheck" class="btn btn-small" style="background:#455a64;font-size:10px;padding:3px 8px;">🔍 Check</button>
      <button id="tblOpenReset" class="btn btn-small" title="offer every car again from the top"
        style="background:#9e9e9e;font-size:10px;padding:3px 8px;">Reset opens</button>
      <span id="tblOpenNote" style="font-size:10px;color:#666;"></span>
    </div>`;

    // Each band in the order the table shows it, cars without a VIN dropped
    // since there'd be nothing to open them by.
    const bandOf = (v) => scored.filter((x) => x.verdict === v && x.vin);
    const listable = bandOf('TARGET').concat(bandOf('WATCH'));

    // Lane leads, because that is how the table is already sorted (byRunNumber
    // is lane-major) and how a sale is actually worked: you stand in a lane and
    // wait for a run to cross. Without it the run numbers read as shuffled —
    // 15, 19, 122, 39 — when they are in perfect order within lanes you cannot
    // see, and a bare run number is ambiguous anyway on a Manheim sale with
    // twenty lanes running at once.
    //
    // Only shown when the list HAS lanes: an OVE or Manheim timed sale has no
    // lane to run in, and an always-on column would spend width on a column of
    // blanks in a panel this narrow.
    const showLane = scored.some((c) => String(c.lane ?? '').trim());

    // SECOND VIEW — the same list, read by where it runs rather than car by car.
    //
    // The car list answers "what do I bid on". It cannot answer "where should I
    // stand", which is the question you actually have before a sale opens: a
    // Manheim sale runs twenty lanes at once and you cannot work all of them.
    // Rolling the scored list up by lane, and by the consignor inside it, turns
    // the same numbers into that answer — and the consignor is the half that
    // stays put, because lane assignments rotate between sale days.
    html += `<div style="display:flex;gap:4px;margin:8px 0 4px;align-items:center;">
      <button id="tblViewCars" class="btn btn-small" style="background:#1b5e20;font-size:10px;padding:3px 8px;">Cars</button>
      <button id="tblViewLanes" class="btn btn-small" style="background:#eee;color:#333;font-size:10px;padding:3px 8px;">By lane &amp; seller</button>
      <span style="font-size:10px;color:#666;">${esc(result.auction || result.source || '')}</span>
    </div>`;
    html += `<div id="tblLaneView" style="display:none;">${laneStudyHtml(scored)}</div>`;
    html += `<div id="tblCarView">`;
    html += `<div style="max-height:260px;overflow-y:auto;font-size:10px;"><table style="width:100%;border-collapse:collapse;">
      <tr style="background:#f0f0f0;font-weight:700;position:sticky;top:0;">
      ${showLane ? '<td>Lane</td>' : ''}<td>Run</td><td>VIN</td><td>Vehicle</td><td>Miles</td><td title="average net profit on exact comps">Avg $</td>
      <td title="average days on lot for exact comps">Days</td>
      <td title="exact comps: same year, ±20k mi">n</td><td></td></tr>`;
    // TARGET and WATCH only, which is what the footer has always claimed.
    // `verdict !== 'PASS'` also let NO DATA cars in, and those rendered their
    // loose context cohort — or "$0 / 0 / 0" from Math.round(null) when they had
    // no cohort at all — as if it were evidence.
    for (const c of scored.filter((x) => x.verdict === 'TARGET' || x.verdict === 'WATCH')) {
      const bg = c.verdict === 'TARGET' ? '#e8f5e9' : '#fffde7';
      const vin = esc(c.vin || '');
      html += `<tr style="border-top:1px solid #e0e0e0;background:${bg};" title="${esc(c.why)}">
        ${showLane ? `<td style="font-family:monospace;font-weight:700;">${esc(c.lane || '')}</td>` : ''}
        <td style="font-family:monospace;">${esc(c.run || '')}</td>
        <td>${vin ? `<span class="tbl-vin" data-vin="${vin}" title="${vin} — click to copy"
          style="font-family:monospace;cursor:pointer;border-bottom:1px dotted #999;">${vin.slice(-8)}</span>` : ''}</td>
        <td>${esc([c.year, c.make, c.model].filter(Boolean).join(' '))}</td>
        <td>${c.odo != null ? c.odo.toLocaleString() : ''}</td>
        <td style="font-weight:700;">${c.exactProfit == null ? '—' : `$${Math.round(c.exactProfit).toLocaleString()}`}</td>
        <td>${c.exactDays == null ? '—' : Math.round(c.exactDays)}</td>
        <td>${c.exactN || '—'}</td>
        <td>${vin ? `<span class="tbl-open" data-vin="${vin}" title="open this listing from the page"
          style="cursor:pointer;color:#e65100;font-weight:700;">↗</span>` : ''}</td></tr>`;
    }
    html += `</table></div>`;
    html += `</div>`;   // /tblCarView
    html += `<div style="font-size:10px;color:#888;padding-top:4px;">
      VIN shows the last 8 — click it to copy the full 17. ↗ opens that one car in its
      own window. <b>↗ TARGET</b> and <b>↗ WATCH</b> open only their own band, up to
      ${MAX_OPEN_AT_ONCE} at a time — press again for the next batch. ${DIRECT_URL[result.sourceId]
        ? 'Links are built straight from the VIN, so no auction tab needs to be open and nothing gets skipped.'
        : 'Links are read from the auction page in the active tab, so keep it on the results list.'}
      Showing TARGET + WATCH; all ${scored.length} cars are in the Excel export.</div>`;
    el.innerHTML = html;

    const noteEl = document.getElementById('tblOpenNote');
    const setNote = (text, color) => { if (noteEl) { noteEl.textContent = text; noteEl.style.color = color || '#666'; } };
    // Per band, so TARGET progress can't be hidden behind WATCH progress.
    const remainingIn = (v) => bandOf(v).filter((c) => !opened.has(c.vin));
    // The number ON each button is how many are still unopened, so after a
    // batch the button itself tells you what the next press will do. Separate
    // from the note, because openOnPage writes its own result into that and
    // would wipe a count written there.
    const setLeftCounts = () => {
      const t = document.getElementById('tblLeftTarget');
      const w = document.getElementById('tblLeftWatch');
      if (t) t.textContent = remainingIn('TARGET').length;
      if (w) w.textContent = remainingIn('WATCH').length;
    };
    const setProgress = () => {
      const t = bandOf('TARGET').length - remainingIn('TARGET').length;
      const w = bandOf('WATCH').length - remainingIn('WATCH').length;
      setNote(`${t}/${bandOf('TARGET').length} target · ${w}/${bandOf('WATCH').length} watch opened`);
      setLeftCounts();
    };
    // Not a blanket clear any more. A restored list brings back which cars were
    // already sent to a window, so picking the sale back up — in this popup, or
    // in the web app on the phone — carries on from there instead of offering
    // all forty targets again from the top.
    opened.clear();
    for (const vin of result.openedVins || []) opened.add(vin);
    setProgress();
    renderSavedStrip();

    document.getElementById('tblExport')?.addEventListener('click', exportXlsx);
    // Reopens the same file picker the "Run List" button uses. Deliberately
    // tears nothing down first: cancelling the dialog has to leave the current
    // report standing, and the change handler already clears the log and
    // re-renders over this panel once a file actually arrives.
    document.getElementById('tblNewList')?.addEventListener('click', () =>
      document.getElementById('tblRunListInput')?.click());
    // "7/5", not "5" — same reason the column is there. A run number copied off
    // a twenty-lane sale names one car per lane, so a bare list of them is a
    // list of guesses. Lists with no lanes copy exactly as before.
    document.getElementById('tblCopyRuns')?.addEventListener('click', () =>
      navigator.clipboard.writeText(targets
        .map((c) => {
          const lane = String(c.lane ?? '').trim()
          const run = String(c.run ?? '').trim()
          return lane && run ? `${lane}/${run}` : run
        })
        .filter(Boolean).join('\n')));
    document.getElementById('tblCopyVins')?.addEventListener('click', () =>
      navigator.clipboard.writeText(targets.map((c) => c.vin).filter(Boolean).join('\n')));

    const nextBatch = (v) => {
      const batch = remainingIn(v);
      if (batch.length) return batch;
      setNote(bandOf(v).length
        ? `every ${v.toLowerCase()} is open — hit Reset opens to go again`
        : `no ${v.toLowerCase()} cars on this list`, '#666');
      return null;
    };

    document.getElementById('tblOpenTarget')?.addEventListener('click', async () => {
      const batch = nextBatch('TARGET');
      if (batch) { await openOnPage(batch, setNote, logLine); setLeftCounts(); saveOpened(result.id, opened); }
    });
    document.getElementById('tblOpenWatch')?.addEventListener('click', async () => {
      const batch = nextBatch('WATCH');
      if (batch) { await openOnPage(batch, setNote, logLine); setLeftCounts(); saveOpened(result.id, opened); }
    });
    // Check reports without opening or consuming anything. It follows TARGET
    // while any are left, since that's the band you'd act on first.
    document.getElementById('tblOpenCheck')?.addEventListener('click', async () => {
      const band = remainingIn('TARGET').length ? 'TARGET' : 'WATCH';
      const batch = nextBatch(band);
      if (!batch) return;
      logLine(`Checking ${batch.length} ${band} cars…`, '');
      await checkOnPage(batch, setNote, logLine);
    });
    document.getElementById('tblViewCars')?.addEventListener('click', () => {
      document.getElementById('tblCarView').style.display = '';
      document.getElementById('tblLaneView').style.display = 'none';
      document.getElementById('tblViewCars').style.background = '#1b5e20';
      document.getElementById('tblViewCars').style.color = '#fff';
      document.getElementById('tblViewLanes').style.background = '#eee';
      document.getElementById('tblViewLanes').style.color = '#333';
    });
    document.getElementById('tblViewLanes')?.addEventListener('click', () => {
      document.getElementById('tblCarView').style.display = 'none';
      document.getElementById('tblLaneView').style.display = '';
      document.getElementById('tblViewLanes').style.background = '#1b5e20';
      document.getElementById('tblViewLanes').style.color = '#fff';
      document.getElementById('tblViewCars').style.background = '#eee';
      document.getElementById('tblViewCars').style.color = '#333';
    });

    document.getElementById('tblOpenReset')?.addEventListener('click', () => {
      opened.clear(); setProgress(); saveOpened(result.id, opened);
    });

    el.querySelectorAll('.tbl-vin').forEach((n) => n.addEventListener('click', async () => {
      await navigator.clipboard.writeText(n.dataset.vin);
      const was = n.textContent;
      n.textContent = 'copied';
      setTimeout(() => { n.textContent = was; }, 700);
    }));
    el.querySelectorAll('.tbl-open').forEach((n) => n.addEventListener('click', async () => {
      const car = listable.find((c) => c.vin === n.dataset.vin);
      if (!car) return;
      await openOnPage([car], setNote, logLine);
      setLeftCounts();
      saveOpened(result.id, opened);
    }));
  }

  function bindUI(config) {
    cfg = { ...cfg, ...config };

    const log = (msg, kind) => {
      const el = document.getElementById('tblLog');
      if (!el) return;
      const line = document.createElement('div');
      line.style.color = kind === 'err' ? '#c62828' : kind === 'ok' ? '#1b5e20' : '#777';
      line.textContent = msg;
      el.appendChild(line);
      el.scrollTop = el.scrollHeight;
    };
    const statusSetter = (id) => (text, cls) => {
      const el = document.getElementById(id);
      if (el) { el.textContent = text; el.className = `upload-file-status ${cls || ''}`; }
    };

    const wire = (inputId, statusId, handler) => {
      const input = document.getElementById(inputId);
      if (!input) return;
      input.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file) return;
        const logEl = document.getElementById('tblLog');
        if (logEl) logEl.innerHTML = '';
        const setStatus = statusSetter(statusId);
        try {
          await handler(file, log, setStatus);
        } catch (err) {
          setStatus('✗ failed', 'error');
          log(`Failed: ${err.message}`, 'err');
        }
      });
    };

    wire('tblRunListInput', 'tblRunListStatus', handleRunList);

    // Put the last list back on screen without being asked. Everything above is
    // wired first so the file picker works while this is still in flight.
    restoreLast();
  }

  window.TargetBuyList = {
    bindUI, parseCSV, normModel, normMake, modelMatch,
    cleanBook, indexBook, evaluateCar, fetchSoldBook, FORMATS,
    restoreLast, listSaved, loadSaved,
  };
})();
