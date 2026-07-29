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
// The sold book is read from two Supabase tables and merged by VIN:
//   sold            — auto-ingest target of the frazer-ingest edge function
//                     (Power Automate -> ?target=sold). Carries no net_profit
//                     column, so profit is derived as sales_price - total_cost.
//                     Preferred when present, since it refreshes on its own.
//   wholesale_sold  — the same economics loaded from a Frazer sold export.
//                     Backstop for whatever `sold` hasn't picked up.
// Nothing here needs changing when the Power Automate "sold" flow is switched
// on; `sold` simply starts winning.
//
// Currently wired for the Edge Pipeline pre-sale format. ADESA / Manheim plug in
// by adding an entry to FORMATS below.
//
// Usage from popup.js init():  window.TargetBuyList.bindUI({ supabaseUrl, supabaseKey })

(function () {
  'use strict';

  let cfg = { supabaseUrl: '', supabaseKey: '' };
  let lastResult = null;

  // ── Buy criteria ───────────────────────────────────────────────────────────
  const TARGET_PROFIT = 800;   // cohort mean net profit must clear this
  const TARGET_DAYS = 30;      // ...and move in under this many days
  const TARGET_MEDIAN_FLOOR = 500; // guard: mean can be dragged up by one winner
  const WATCH_PROFIT = 400;
  const WATCH_DAYS = 40;

  // THE definition of "the same car": same make, same model, same model year,
  // and an odometer within this band. Only this cohort can make something a
  // TARGET — how that exact car has performed for us is the whole point.
  const EXACT = { years: 0, miles: 15000, min: 2 };

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
      detect: (r) => 'Vin' in r && 'Run Number' in r && 'Lane' in r,
      map: (r) => ({
        vin: (r['Vin'] || '').trim().toUpperCase(),
        stock: (r['Stock Number'] || '').trim(),
        run: (r['Run Number'] || '').trim(),
        lane: (r['Lane'] || '').trim(),
        lot: (r['Lot'] || '').trim(),
        saleDate: (r['Sale Date'] || '').trim(),
        year: int(r['Year']),
        make: (r['Make'] || '').trim(),
        model: (r['Model'] || '').trim(),
        style: (r['Style'] || '').trim(),
        color: (r['Exterior Color'] || '').trim(),
        odo: int(r['Mileage']),
        grade: (r['Grade'] || '').trim(),
        hasCR: String(r['Has Condition Report'] || '').toLowerCase() === 'true',
        pics: int(r['Picture Count']),
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

  // Prefix match absorbs trim tails: SILVERADO vs SILVERADO1500.
  function modelMatch(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    const [s, l] = a.length < b.length ? [a, b] : [b, a];
    return s.length >= 4 && l.startsWith(s);
  }

  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  function median(a) {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  // ── Supabase reads (fresh on every upload) ─────────────────────────────────
  // PostgREST caps an unbounded select at 1000 rows, so page explicitly.
  async function fetchAll(table, select, order) {
    const out = [];
    const PAGE = 1000;
    for (let offset = 0; ; offset += PAGE) {
      const url = `${cfg.supabaseUrl}/rest/v1/${table}?select=${select}` +
        (order ? `&order=${order}` : '') + `&limit=${PAGE}&offset=${offset}`;
      const res = await fetch(url, {
        headers: { apikey: cfg.supabaseKey, Authorization: `Bearer ${cfg.supabaseKey}` },
      });
      if (!res.ok) throw new Error(`${table} fetch failed (${res.status})`);
      const batch = await res.json();
      out.push(...batch);
      if (batch.length < PAGE) break;
      if (offset > 100000) break; // safety stop
    }
    return out;
  }

  // Pull both sold sources and merge by VIN. `sold` wins where it has a row,
  // because it is the one that refreshes without anybody touching it.
  async function fetchSoldBook(log) {
    const merged = new Map();

    let auto = [];
    try {
      auto = await fetchAll('sold',
        'vehicle_vin,vehicle_year,vehicle_make,vehicle_model,mileage,sale_date,sales_price,total_cost,added_costs,days_on_lot');
    } catch (e) {
      if (log) log(`  auto-ingest 'sold' unavailable (${e.message})`, '');
    }
    for (const r of auto) {
      const vin = String(r.vehicle_vin || '').trim().toUpperCase();
      if (vin.length !== 17) continue;
      const price = r.sales_price == null ? null : Number(r.sales_price);
      const cost = r.total_cost == null ? null : Number(r.total_cost);
      // `sold` has no net_profit column. The identity holds on 697/701 rows of
      // the Frazer book; the handful that differ carry a flat $499 adjustment.
      if (price == null || cost == null) continue;
      merged.set(vin, {
        vin, year: r.vehicle_year, make: r.vehicle_make, model: r.vehicle_model,
        odometer: r.mileage == null ? null : Number(r.mileage),
        sale_date: r.sale_date, sale_price: price,
        added_costs: r.added_costs == null ? null : Number(r.added_costs),
        net_profit: price - cost,
        days_on_lot: r.days_on_lot == null ? null : Number(r.days_on_lot),
      });
    }

    const manual = await fetchAll('wholesale_sold',
      'vin,year,make,model,odometer,sale_date,sale_price,added_costs,net_profit,days_on_lot');
    let added = 0;
    for (const r of manual) {
      const vin = String(r.vin || '').trim().toUpperCase();
      if (!vin || merged.has(vin)) continue;
      merged.set(vin, r);
      added++;
    }

    if (log) {
      log(`Sold book: ${auto.length} auto-ingest + ${added} stored = ${merged.size}`, 'ok');
      if (!auto.length) {
        log(`  note: 'sold' table is empty — book is frozen until the Frazer sold flow runs`, '');
      }
    }
    return [...merged.values()];
  }

  // ── Clean the sold book ────────────────────────────────────────────────────
  // Two kinds of rows must not shape a buying decision:
  //   1. Pass-through title transfers — $0 profit, $0 recon. Not wholesale deals.
  //   2. Extreme outliers at either tail — the car that lost $8k because it was a
  //      disaster, or made $7k because we got lucky. Neither repeats.
  function cleanBook(rows) {
    const usable = rows.filter((r) => r.net_profit !== null && r.net_profit !== undefined);

    const passthrough = usable.filter((r) => Number(r.net_profit) === 0 && Number(r.added_costs || 0) === 0);
    const ptSet = new Set(passthrough.map((r) => r.vin));
    let book = usable.filter((r) => !ptSet.has(r.vin));

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

    const removed = [...book.slice(0, lo), ...book.slice(hi + 1)];
    book = book.slice(lo, hi + 1);

    return { book, removedOutliers: removed, removedPassthrough: passthrough };
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
      });
    }
    return byMake;
  }

  // ── Scoring ────────────────────────────────────────────────────────────────
  function cohortStats(cohort) {
    if (!cohort.length) return { n: 0, meanProfit: null, medProfit: null, meanDays: null, hitRate: null, medResale: null };
    const profits = cohort.map((s) => s.profit);
    const days = cohort.map((s) => s.days).filter((d) => d != null);
    const prices = cohort.map((s) => s.price).filter((v) => v != null);
    return {
      n: cohort.length,
      meanProfit: mean(profits),
      medProfit: median(profits),
      meanDays: days.length ? mean(days) : null,
      hitRate: (profits.filter((v) => v > 1000).length / profits.length) * 100,
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
      // The exact-car cohort is reported on every row, match or not.
      exactN: 0, exactProfit: null, exactMedProfit: null, exactDays: null, exactHit: null,
    };

    if (!pool.length) return { ...base, verdict: 'PASS', why: 'No record of us selling this model' };
    // A missing year makes every year-distance NaN, and NaN fails every
    // comparison — the car would silently match cars of any age.
    if (car.year == null) {
      return { ...base, n: pool.length, verdict: 'PASS', why: 'Run list has no year — cannot match on age' };
    }
    if (badOdo) {
      return {
        ...base, n: pool.length, verdict: 'PASS',
        why: `Run-list mileage looks wrong (${car.odo == null ? 'blank' : car.odo}) — can't match on miles`,
      };
    }

    // Always compute how this exact car has performed, even when there are too
    // few to act on — seeing "we've sold 1 of these" is itself the answer.
    const exact = cohortStats(inTier(pool, car, EXACT));
    const withExact = {
      ...base,
      exactN: exact.n, exactProfit: exact.meanProfit, exactMedProfit: exact.medProfit,
      exactDays: exact.meanDays, exactHit: exact.hitRate,
    };

    for (const tier of TIERS) {
      const cohort = inTier(pool, car, tier);
      if (cohort.length < tier.min) continue;
      const st = cohortStats(cohort);

      let verdict = 'PASS';
      if (st.meanDays != null && st.meanProfit > TARGET_PROFIT && st.meanDays < TARGET_DAYS && st.medProfit > TARGET_MEDIAN_FLOOR) {
        verdict = 'TARGET';
      } else if (st.meanDays != null && st.meanProfit > WATCH_PROFIT && st.meanDays < WATCH_DAYS) {
        verdict = 'WATCH';
      }
      // Only an exact-car match may call something a TARGET.
      if (verdict === 'TARGET' && tier.cap === 'WATCH') verdict = 'WATCH';

      const confidence = tier.id !== 'exact' ? 'LOW' : cohort.length >= 4 ? 'HIGH' : 'MEDIUM';
      const scope = tier.id === 'exact'
        ? `same year, ±${tier.miles / 1000}k mi`
        : `±${tier.years}yr / ±${tier.miles / 1000}k mi — context only`;

      return {
        ...withExact,
        tier: tier.label, n: cohort.length,
        meanProfit: st.meanProfit, medProfit: st.medProfit, meanDays: st.meanDays,
        hitRate: st.hitRate, medResale: st.medResale, confidence, verdict,
        why: `${cohort.length} sold (${scope}) · avg ${fmtMoney(st.meanProfit)}, median ${fmtMoney(st.medProfit)} · ` +
             `${st.meanDays == null ? '—' : Math.round(st.meanDays)}d avg on lot · ${Math.round(st.hitRate)}% cleared $1k`,
      };
    }

    const near = exact.n ? ` Closest: ${exact.n} exact match${exact.n > 1 ? 'es' : ''}, avg ${fmtMoney(exact.meanProfit)}.` : '';
    return {
      ...withExact, n: pool.length, verdict: 'PASS',
      why: `${pool.length} of this model sold, but none close enough on year+miles to judge.${near}`,
    };
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
    if (!rows.length) throw new Error('sold book is empty — no rows in `sold` or `wholesale_sold`');

    const { book, removedOutliers, removedPassthrough } = cleanBook(rows);
    log(`  ${rows.length} rows → ${book.length} after cleaning`, 'ok');
    log(`  dropped ${removedPassthrough.length} pass-through, ${removedOutliers.length} outliers`, '');
    for (const r of removedOutliers) {
      log(`  outlier: $${Number(r.net_profit).toLocaleString()} ${r.year} ${r.make} ${r.model}`, '');
    }

    const byMake = indexBook(book);
    const scored = cars.map((c) => evaluateCar(c, byMake));

    // TARGET first, then by average profit.
    const rank = { TARGET: 0, WATCH: 1, PASS: 2 };
    scored.sort((a, b) =>
      rank[a.verdict] - rank[b.verdict] || (b.meanProfit ?? -1e9) - (a.meanProfit ?? -1e9));
    scored.forEach((c, i) => { c.rank = i + 1; });

    const t = scored.filter((c) => c.verdict === 'TARGET').length;
    const w = scored.filter((c) => c.verdict === 'WATCH').length;

    lastResult = { scored, bookSize: book.length, rawBook: rows.length, source: fmt.label,
                   removedOutliers, removedPassthrough };

    log(`${t} TARGET · ${w} WATCH · ${scored.length - t - w} PASS`, 'ok');
    setStatus(`✓ ${t} targets of ${scored.length}`, 'loaded');
    renderPanel(lastResult);
  }

  // ── Excel export ───────────────────────────────────────────────────────────
  // Keep in lockstep with COLUMNS in inspection-app/src/pages/ListBuilder.jsx —
  // both exports are meant to be the same workbook.
  const COLUMNS = [
    ['Rank', 'rank', 6], ['Verdict', 'verdict', 9], ['Confidence', 'confidence', 11],
    ['Run #', 'run', 9], ['Lane', 'lane', 6], ['Lot', 'lot', 7], ['Sale Date', 'saleDate', 11],
    ['Year', 'year', 6], ['Make', 'make', 14], ['Model', 'model', 18], ['Trim / Style', 'style', 18],
    ['Miles', 'odo', 10], ['Color', 'color', 11], ['CR Grade', 'grade', 9], ['Has CR', 'hasCR', 7],
    ['Photos', 'pics', 7], ['Drivetrain', 'drivetrain', 11], ['Engine', 'engine', 16],
    ['Transmission', 'transmission', 13], ['Fuel', 'fuel', 9],
    ['Avg Profit', 'meanProfit', 11], ['Median Profit', 'medProfit', 13], ['Avg Days', 'meanDays', 10],
    ['% Cleared $1k', 'hitRate', 13], ['Cars Matched', 'n', 12], ['Match Tier', 'tier', 11],
    ['Our Median Resale', 'medResale', 16], ['MMR / Auction Value', 'auctionValue', 18],
    ['Why', 'why', 62], ['VIN', 'vin', 20], ['Stock', 'stock', 11],
    ['Seller', 'seller', 22], ['Location', 'location', 22], ['Channel', 'channel', 12],
    ['Title Status', 'titleStatus', 13], ['Announcements', 'announcements', 30],
  ];
  const MONEY_KEYS = new Set(['meanProfit', 'medProfit', 'medResale', 'auctionValue']);
  const INT_KEYS = new Set(['odo', 'meanDays', 'hitRate', 'n', 'pics', 'rank', 'year']);

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

  // ── UI ─────────────────────────────────────────────────────────────────────
  function renderPanel(result) {
    const el = document.getElementById('tblPanel');
    if (!el) return;
    const { scored, bookSize } = result;
    const targets = scored.filter((c) => c.verdict === 'TARGET');
    const watch = scored.filter((c) => c.verdict === 'WATCH');

    let html = `<div style="font-size:11px;font-weight:700;color:#1b5e20;margin-bottom:2px;">
      ${targets.length} TARGET · ${watch.length} WATCH · ${scored.length} cars on the list</div>`;
    html += `<div style="font-size:10px;color:#666;margin-bottom:5px;">
      vs ${bookSize} sold cars · avg profit &gt; $${TARGET_PROFIT} and under ${TARGET_DAYS} days</div>`;
    html += `<div style="display:flex;gap:4px;margin-bottom:6px;">
      <button id="tblExport" class="btn btn-small" style="background:#1b5e20;font-size:10px;padding:3px 8px;">⬇ Excel</button>
      <button id="tblCopyRuns" class="btn btn-small" style="background:#1565c0;font-size:10px;padding:3px 8px;">Copy Run #s</button>
      <button id="tblCopyVins" class="btn btn-small" style="background:#6a1b9a;font-size:10px;padding:3px 8px;">Copy VINs</button>
    </div>`;

    html += `<div style="max-height:260px;overflow-y:auto;font-size:10px;"><table style="width:100%;border-collapse:collapse;">
      <tr style="background:#f0f0f0;font-weight:700;position:sticky;top:0;">
      <td>Run</td><td>Vehicle</td><td>Miles</td><td>Avg $</td><td>Days</td><td>n</td></tr>`;
    for (const c of scored.filter((x) => x.verdict !== 'PASS')) {
      const bg = c.verdict === 'TARGET' ? '#e8f5e9' : '#fffde7';
      html += `<tr style="border-top:1px solid #e0e0e0;background:${bg};" title="${c.why}">
        <td style="font-family:monospace;">${c.run || ''}</td>
        <td>${[c.year, c.make, c.model].filter(Boolean).join(' ')}</td>
        <td>${c.odo != null ? c.odo.toLocaleString() : ''}</td>
        <td style="font-weight:700;">$${Math.round(c.meanProfit).toLocaleString()}</td>
        <td>${Math.round(c.meanDays)}</td>
        <td>${c.n}</td></tr>`;
    }
    html += `</table></div>`;
    html += `<div style="font-size:10px;color:#888;padding-top:4px;">
      Showing TARGET + WATCH — all ${scored.length} cars are in the Excel export.</div>`;
    el.innerHTML = html;

    document.getElementById('tblExport')?.addEventListener('click', exportXlsx);
    document.getElementById('tblCopyRuns')?.addEventListener('click', () =>
      navigator.clipboard.writeText(targets.map((c) => c.run).filter(Boolean).join('\n')));
    document.getElementById('tblCopyVins')?.addEventListener('click', () =>
      navigator.clipboard.writeText(targets.map((c) => c.vin).filter(Boolean).join('\n')));
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
  }

  window.TargetBuyList = {
    bindUI, parseCSV, normModel, normMake, modelMatch,
    cleanBook, indexBook, evaluateCar, fetchSoldBook, FORMATS,
  };
})();
