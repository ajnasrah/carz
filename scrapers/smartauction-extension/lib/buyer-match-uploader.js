// Buyer-Match Uploader
// Pushes SmartAuction "Inventory Results" exports into the buyer-match tables that
// feed the web app's Buyer Match page (inspection-app):
//   • Active list  -> sa_active_cars   (snapshot: replaced each upload)
//   • Sold report  -> sa_sold_sales    (training data: upsert by VIN, accumulates)
//
// Mirrors lib/list-uploader.js conventions (PostgREST REST, apikey/Bearer headers).
// Usage from popup.js init():  window.BuyerMatchUploader.bindUI({ supabaseUrl, supabaseKey })
(function () {
  'use strict';

  let cfg = { supabaseUrl: '', supabaseKey: '' };

  // ── CSV parsing (handles quoted fields, embedded commas/JSON, CRLF) ──
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
        else if (c === '\r') { /* skip */ }
        else f += c;
      }
      i++;
    }
    if (f.length || row.length) { pushF(); pushR(); }
    const header = (rows.shift() || []).map((h) => h.trim());
    return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, j) => [h, r[j]])));
  }

  const int = (x) => { const n = parseInt(String(x ?? '').replace(/[^0-9-]/g, ''), 10); return Number.isFinite(n) ? n : null; };
  const dec = (x) => { const n = parseFloat(String(x ?? '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? n : null; };
  const toIso = (s) => {
    if (!s) return null;
    const p = String(s).split('/');
    if (p.length !== 3) return null;
    const [m, d, y] = p;
    return `${y.length === 2 ? '20' + y : y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };

  // Segment classifier — MUST stay in sync with inspection-app src/services/buyerMatch.js
  function segment(make, model) {
    const s = `${make || ''} ${model || ''}`.toLowerCase();
    const has = (arr) => arr.some((k) => s.includes(k));
    if (has(['silverado', 'sierra', 'f-150', 'f150', 'f-250', 'f-350', 'ram 1500', 'ram 2500', 'tundra', 'tacoma', 'ranger', 'colorado', 'canyon', 'frontier', 'titan', 'ridgeline', 'gladiator', 'maverick', 'super duty', '1500', '2500', '3500'])) return 'truck';
    if (has(['transit', 'express', 'promaster', 'sienna', 'odyssey', 'carnival', 'pacifica', 'caravan', 'sprinter'])) return 'van';
    if (has(['tesla', 'model 3', 'mach-e', 'ev6', 'id.4', 'lyriq', 'mullen', 'ioniq', 'bolt', 'leaf'])) return 'ev';
    if (has(['tahoe', 'suburban', 'yukon', 'expedition', 'explorer', 'escape', 'equinox', 'traverse', 'blazer', 'pilot', 'highlander', '4runner', 'rav4', 'cr-v', 'crv', 'rogue', 'pathfinder', 'murano', 'telluride', 'palisade', 'santa fe', 'sorento', 'wrangler', 'grand cherokee', 'cherokee', 'compass', 'renegade', 'bronco', 'edge', 'nautilus', 'cx-9', 'cx-5', 'outlander', 'ascent', 'atlas', 'tiguan', 'durango', 'acadia', 'enclave', 'escalade', 'navigator', 'q5', 'x5', 'gx', 'rx', 'kona', 'tucson', 'seltos', 'encore', 'trailblazer', 'envision', 'corsair', 'aviator'])) return 'suv';
    return 'car';
  }

  function mapActive(r) {
    return {
      vin: r.VIN, year: int(r.Year), make: r.Make, model: r.Model, trim: r.Trim,
      drivetrain: r.Drivetrain, odometer: int(r.Odometer), color: r['Short Color'],
      segment: segment(r.Make, r.Model),
      buy_now: dec(r['Buy Now']), opening_price: dec(r['Opening Price']),
      location: r.Location, detail_url: r['Vehicle Detail Page'],
    };
  }

  function mapSold(r) {
    return {
      vin: r.VIN, year: int(r.Year), make: r.Make, model: r.Model, trim: r.Trim,
      drivetrain: r.Drivetrain, odometer: int(r.Odometer), color: r['Short Color'],
      segment: segment(r.Make, r.Model),
      sale_date: toIso(r['Sale Date']), sale_price: dec(r['Sale Price']),
      buyer_name: (r['Buyer Name'] || '').trim(),
      buyer_email: r['Buyer Email'], buyer_phone: r['Buyer Phone'],
      buyer_city: r['Buyer City'], buyer_state: r['Buyer State'], buyer_zip: r['Buyer Zip'],
      seller: r.Seller, source: 'smartauction',
    };
  }

  // Every row of the report, whatever became of it. The removed and held ones are
  // the cars we listed and could NOT move: the only negative examples we have,
  // and the only source of days-to-sell on the selling side. They were classified
  // and counted here for months and then dropped on the floor.
  function mapOutcome(r, status) {
    return {
      vin: r.VIN, status,
      year: int(r.Year), make: r.Make, model: r.Model, odometer: int(r.Odometer),
      segment: segment(r.Make, r.Model),
      opening_price: dec(r['Opening Price']), buy_now: dec(r['Buy Now']),
      days_remaining: int(r['Days Remaining']),
      removal_date: toIso(r['Removal Date']), removal_reason: r['Removal Reason'] || null,
      hold_date: toIso(r['Hold Date']), hold_reason: r['Hold Reason'] || null,
      location: r.Location || null,
    };
  }

  // Classify an InventoryResults row by lifecycle. The full report contains active,
  // sold, removed, and held cars in one file — status is derived from which columns
  // are filled (SmartAuction leaves the others blank).
  function classify(r) {
    const has = (k) => String(r[k] ?? '').trim() !== '';
    if (has('Sale Date') && (has('Sale Price') || has('Buyer Name'))) return 'sold';
    if (has('Removal Date') || has('Removal Reason')) return 'removed';
    if (has('Hold Date') || has('Hold Reason')) return 'hold';
    if (has('Days Remaining')) return 'active';
    return 'other';
  }

  // ── PostgREST helpers ──
  function headers(extra) {
    return Object.assign({
      apikey: cfg.supabaseKey,
      Authorization: `Bearer ${cfg.supabaseKey}`,
      'Content-Type': 'application/json',
    }, extra || {});
  }

  // Dedupe by the conflict key — a single SmartAuction export can list the same VIN twice
  // (re-run / re-listed unit), and PostgREST upsert can't touch the same key twice per command.
  function dedupeByKey(rows, key) {
    const seen = new Map();
    for (const r of rows) seen.set(r[key], r);   // later row wins (caller pre-sorts sold by date asc)
    return [...seen.values()];
  }

  // Same as upsert(), but for a table whose conflict key is more than one column
  // and includes a server-defaulted one (observed_on). Dedupe is done on the
  // columns we actually supply.
  async function upsertMulti(table, rows, onConflict, dedupeKeys) {
    const seen = new Map();
    for (const r of rows) seen.set(dedupeKeys.map((k) => r[k]).join('|'), r);
    const list = [...seen.values()];
    let ok = 0;
    for (let i = 0; i < list.length; i += 500) {
      const batch = list.slice(i, i + 500);
      const url = `${cfg.supabaseUrl}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(batch),
      });
      if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
      ok += batch.length;
    }
    return ok;
  }

  async function upsert(table, rows, onConflict) {
    rows = dedupeByKey(rows, onConflict);
    let ok = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const url = `${cfg.supabaseUrl}/rest/v1/${table}?on_conflict=${onConflict}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(batch),
      });
      if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
      ok += batch.length;
    }
    return ok;
  }

  // Fire the ghl-lead-sync edge function — pushes never-contacted buyers to GHL.
  // Best-effort: never throws, returns a short summary string for the log.
  async function triggerGhlSync() {
    try {
      const res = await fetch(`${cfg.supabaseUrl}/functions/v1/ghl-lead-sync`, {
        method: 'POST',
        headers: headers(),
        body: '{}',
      });
      const out = await res.json().catch(() => ({}));
      if (res.ok && out.ok) return `GHL: ${out.pushed} new lead(s) pushed of ${out.candidates}${out.failed ? `, ${out.failed} failed` : ''}`;
      return `GHL sync failed: ${out.error || res.status}`;
    } catch (e) {
      return `GHL sync failed: ${e.message}`;
    }
  }

  async function rpc(name, args) {
    const res = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: headers(), body: JSON.stringify(args || {}),
    });
    if (!res.ok) throw new Error(`${name}: ${res.status} ${await res.text()}`);
    return res.json().catch(() => null);
  }

  async function clearTable(table) {
    // PostgREST refuses an unfiltered DELETE; `vin=like.*` matches every non-null row.
    const res = await fetch(`${cfg.supabaseUrl}/rest/v1/${table}?vin=like.*`, {
      method: 'DELETE', headers: headers({ Prefer: 'return=minimal' }),
    });
    if (!res.ok) throw new Error(`clear ${table}: ${res.status} ${await res.text()}`);
  }

  // ── UI binding ──
  function bindUI(config) {
    cfg = Object.assign(cfg, config || {});

    const log = (msg, cls) => {
      const el = document.getElementById('bmLog');
      if (!el) return;
      const color = cls === 'ok' ? '#2e7d32' : cls === 'err' ? '#c62828' : '#555';
      el.innerHTML += `<div style="color:${color}">${msg}</div>`;
      el.scrollTop = el.scrollHeight;
    };
    const setStatus = (id, text, cls) => {
      const el = document.getElementById(id);
      if (el) { el.textContent = text; el.className = `upload-file-status${cls ? ' ' + cls : ''}`; }
    };

    async function handle(kind, file) {
      if (!file) return;
      const statusId = kind === 'active' ? 'bmActiveStatus' : 'bmSoldStatus';
      try {
        setStatus(statusId, 'Reading…');
        const raw = parseCSV(await file.text());
        if (kind === 'active') {
          const rows = raw.map(mapActive).filter((r) => r.vin);
          if (!rows.length) throw new Error('No rows with VIN found');
          setStatus(statusId, `Replacing ${rows.length}…`);
          await clearTable('sa_active_cars');
          await upsert('sa_active_cars', rows, 'vin');
          setStatus(statusId, `✓ ${rows.length} active`, 'loaded');
          log(`Active: replaced with ${rows.length} cars`, 'ok');
        } else {
          const rows = raw.map(mapSold).filter((r) => r.vin && r.buyer_name)
            .sort((a, b) => String(a.sale_date || '').localeCompare(String(b.sale_date || '')));  // oldest→newest, so dedupe keeps newest
          if (!rows.length) throw new Error('No sold rows with VIN + buyer found');
          setStatus(statusId, `Uploading ${rows.length}…`);
          const n = await upsert('sa_sold_sales', rows, 'vin');
          setStatus(statusId, `✓ ${n} sold (deduped from ${rows.length})`, 'loaded');
          log(`Sold: upserted ${n} unique VINs from ${rows.length} rows`, 'ok');
          // New sold rows carry buyer contacts → push never-contacted buyers to GHL.
          setStatus(statusId, 'Syncing GHL…');
          const gh = await triggerGhlSync();
          setStatus(statusId, `✓ ${n} sold · ${gh}`, 'loaded');
          log(gh, gh.startsWith('GHL sync failed') ? 'err' : 'ok');
        }
      } catch (e) {
        setStatus(statusId, '✗ failed', 'error');
        log(`${kind} upload failed: ${e.message}`, 'err');
      }
    }

    // Full InventoryResults report → sync the public marketplace in one shot:
    //   • active rows   → replace sa_active_cars snapshot (refreshes Buy-Now prices,
    //                     and surfaces active cars that weren't showing)
    //   • sold rows     → marketplace_mark_sold (sa_status='sold' → dropped from grid)
    //   • active VINs   → marketplace_unmark_sold (un-hide anything relisted)
    async function handleReport(file) {
      if (!file) return;
      const id = 'bmReportStatus';
      try {
        setStatus(id, 'Reading…');
        const raw = parseCSV(await file.text());
        if (!raw.length) throw new Error('Empty file');

        const activeRows = [];
        const soldRows = [];   // full sold rows (buyer contacts) → sa_sold_sales training data
        const outcomeRows = [];// every row, whatever became of it → sa_listing_outcomes
        const soldVins = [];
        const activeVins = [];
        const counts = { active: 0, sold: 0, removed: 0, hold: 0, other: 0 };
        for (const r of raw) {
          const st = classify(r);
          counts[st] = (counts[st] || 0) + 1;
          const vin = String(r.VIN || '').trim();
          if (vin && st !== 'other') outcomeRows.push(mapOutcome(r, st));
          if (st === 'active') {
            const m = mapActive(r);
            if (m.vin) { activeRows.push(m); activeVins.push(m.vin); }
          } else if (st === 'sold' && vin) {
            soldVins.push(vin);
            const m = mapSold(r);
            if (m.vin && m.buyer_name) soldRows.push(m);   // only rows that carry a buyer feed training
          }
        }
        const uniqActive = dedupeByKey(activeRows, 'vin');
        const uniqSoldVins = [...new Set(soldVins)];
        const uniqActiveVins = [...new Set(activeVins)];
        // oldest→newest so upsert dedupe keeps the newest sale per VIN (mirrors handle('sold'))
        soldRows.sort((a, b) => String(a.sale_date || '').localeCompare(String(b.sale_date || '')));

        setStatus(id, `Replacing ${uniqActive.length} active…`);
        await clearTable('sa_active_cars');
        if (uniqActive.length) await upsert('sa_active_cars', uniqActive, 'vin');

        // Sold rows carry buyer contacts → accumulate into sa_sold_sales (buyer-match training).
        setStatus(id, `Adding ${soldRows.length} sold…`);
        const soldSaved = soldRows.length ? await upsert('sa_sold_sales', soldRows, 'vin') : 0;

        // One snapshot per VIN per day per status: re-uploading the same report
        // twice in an afternoon must not look like twice the evidence.
        setStatus(id, `Recording ${outcomeRows.length} outcomes…`);
        let outcomesSaved = 0;
        try {
          outcomesSaved = outcomeRows.length
            ? await upsertMulti('sa_listing_outcomes', outcomeRows, 'vin,observed_on,status', ['vin', 'status'])
            : 0;
        } catch (e) {
          // The outcome log is new and secondary; never let it cost us the sold
          // rows that were already saved above.
          log(`  outcomes not saved: ${e.message}`, 'err');
        }

        setStatus(id, 'Marking sold…');
        const soldMarked = uniqSoldVins.length ? await rpc('marketplace_mark_sold', { p_vins: uniqSoldVins }) : 0;
        const reactivated = uniqActiveVins.length ? await rpc('marketplace_unmark_sold', { p_vins: uniqActiveVins }) : 0;

        // New sold rows just landed → push never-contacted buyers to GHL.
        setStatus(id, 'Syncing GHL…');
        const gh = soldRows.length ? await triggerGhlSync() : 'GHL: skipped (no sold rows)';

        setStatus(id, `✓ ${uniqActive.length} active · ${soldSaved} sold saved · ${soldMarked} hidden`, 'loaded');
        log(`Full report: ${uniqActive.length} active priced · ${soldSaved} sold rows saved · ${soldMarked} sold hidden · ${reactivated} relisted`, 'ok');
        log(`  ${gh}`, gh.startsWith('GHL sync failed') ? 'err' : 'ok');  // ← new-buyer confirmation: "GHL: N new lead(s) pushed of M"
        log(`  rows — active ${counts.active}, sold ${counts.sold}, removed ${counts.removed}, hold ${counts.hold}, other ${counts.other}`, 'ok');
        log(`  ${outcomesSaved} listing outcome(s) recorded (removed + hold are the cars that did not sell)`, 'ok');
      } catch (e) {
        setStatus(id, '✗ failed', 'error');
        log(`Full report failed: ${e.message}`, 'err');
      }
    }

    const a = document.getElementById('bmActiveInput');
    const s = document.getElementById('bmSoldInput');
    const rp = document.getElementById('bmReportInput');
    if (a) a.addEventListener('change', (e) => handle('active', e.target.files && e.target.files[0]));
    if (s) s.addEventListener('change', (e) => handle('sold', e.target.files && e.target.files[0]));
    if (rp) rp.addEventListener('change', (e) => handleReport(e.target.files && e.target.files[0]));
  }

  window.BuyerMatchUploader = { bindUI, parseCSV, mapActive, mapSold, mapOutcome, segment, classify };
})();
