// List Uploader — parses vendor CSV exports (SmartAuction, Manheim/OVE,
// UAX, DAA, ADESA, Super Dispatch) and upserts them into the
// `vehicle_locations` overlay table in Supabase.
//
// Usage (from popup.js):
//   ListUploader.bindUI({ supabaseUrl: SUPABASE_URL, supabaseKey: SUPABASE_ANON_KEY });
//
// Assumes the DOM has the elements defined in popup.html under the
// "List Uploader" <details> block (luSaInput, luManheimInput, etc.).

(function () {
  'use strict';

  // RFC4180-ish CSV parser that handles quoted fields with commas, embedded
  // quotes (escaped as ""), and newlines inside quotes. Returns an array of
  // objects keyed by the header row.
  function parseCSV(text) {
    const rows = [];
    let current = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; continue; }
          inQuotes = false;
          continue;
        }
        field += c;
      } else {
        if (c === '"') { inQuotes = true; continue; }
        if (c === ',') { current.push(field); field = ''; continue; }
        if (c === '\r') continue;
        if (c === '\n') { current.push(field); rows.push(current); current = []; field = ''; continue; }
        field += c;
      }
    }
    if (field !== '' || current.length > 0) { current.push(field); rows.push(current); }
    if (rows.length === 0) return [];
    const headers = rows[0].map((h) => h.trim());
    return rows.slice(1)
      .filter((r) => r.some((v) => v && v.trim().length > 0))
      .map((r) => {
        const obj = {};
        headers.forEach((h, idx) => { obj[h] = (r[idx] || '').trim(); });
        return obj;
      });
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  function last6(vin) {
    return (vin || '').toString().toUpperCase().slice(-6);
  }

  function toNumber(val) {
    if (val == null) return null;
    const n = Number(String(val).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : null;
  }

  function toDateISO(val) {
    if (!val) return null;
    // Strip timezone abbreviations like "ET" that Date() can't parse
    const cleaned = String(val).replace(/\b(ET|EDT|EST|CT|CDT|CST|PT|PDT|PST|UTC|GMT)\b/gi, '').trim();
    const d = new Date(cleaned);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  // ── Shared CSV helpers ─────────────────────────────────────────────

  function csvEscape(v) {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  // Load the locally cached Frazer inventory (populated by syncSupabaseInventory
  // in popup.js) and key it by stock number. Used to enrich export CSVs with
  // vendor / buyer / purchase_date / notes that the per-upload RPCs don't return.
  async function loadInventoryCacheByStock() {
    try {
      const stored = await chrome.storage.local.get(['inventory']);
      const map = new Map();
      for (const r of (stored.inventory || [])) {
        const key = r['Stock #'] || r.stock_number || r.stockNumber;
        if (key) map.set(String(key), r);
      }
      return map;
    } catch (_) {
      return new Map();
    }
  }

  // Extract Frazer-side fields for a given stock (vendor, buyer, age, notes).
  // Works against both normalized (popup.js mapPowerAppsRow) and raw Frazer shapes.
  function frazerFields(inv) {
    inv = inv || {};
    return {
      vendor: inv.vendor || inv['Vendor'] || '',
      buyer: inv.buyer || inv['Buyer'] || '',
      daysOnLot: inv.days_on_lot || inv.daysOnLot || inv['Days on lot'] || inv['DaysOnLot'] || '',
      purchaseDate: inv.purchase_date || inv['Purchase Date'] || '',
      purchaseNotes: inv.purchase_notes || inv['Purchase Notes'] || '',
      vehicleNotes: inv.vehicle_notes || inv['Vehicle Notes'] || inv.notes || '',
      locationCode: inv.location_code || inv['Location Code'] || inv.locationCode || '',
      totalCost: inv.total_cost || inv['Total Cost'] || inv.totalCost || '',
      addedCosts: inv.added_costs || inv['Added Costs'] || inv.addedCosts || '',
    };
  }

  function downloadCsv(lines, filename) {
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Supabase upsert helpers ─────────────────────────────────────────

  let config = { supabaseUrl: '', supabaseKey: '', log: () => {} };

  async function fetchInventoryStocksForVins(vins) {
    // Calls the SECURITY DEFINER RPC `inventory_stocks_by_vins` which
    // bypasses RLS and returns matches for the VINs we care about.
    // Anon SELECT on inventory is blocked, so a direct ?select=* returns 0.
    if (!vins.length) return { byVin: new Map(), byLast6: new Map(), last6Conflicts: new Map() };
    const url = `${config.supabaseUrl}/rest/v1/rpc/inventory_stocks_by_vins`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: config.supabaseKey,
        Authorization: `Bearer ${config.supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ vin_list: vins }),
    });
    if (!res.ok) {
      config.log('Inventory RPC failed: ' + res.status + ' ' + (await res.text()).slice(0, 200), 'err');
      return { byVin: new Map(), byLast6: new Map(), last6Conflicts: new Map() };
    }
    const rows = await res.json();
    const byVin = new Map();
    const byLast6 = new Map();
    const last6Conflicts = new Map(); // Track multiple VINs with same last6
    const last6Count = new Map();
    
    // First pass: count last6 occurrences
    for (const r of rows) {
      const full = (r.vehicle_vin || '').toUpperCase();
      const l6 = (r.last_6_vin || full.slice(-6) || '').toUpperCase();
      if (l6) {
        if (!last6Count.has(l6)) {
          last6Count.set(l6, []);
        }
        last6Count.get(l6).push({ vin: full, stock: r.stock_number });
      }
    }
    
    // Second pass. `byVin` (full 17-char VIN) is the ONLY map used to resolve a
    // stock number — run lists always carry full VINs. `byLast6` is kept as a
    // PRESENCE lookup only (never used to pick a stock): two different cars can
    // share the same last 6 — e.g. a Mercedes WDDLJ7DB5EA102576 on a DAA Rockies
    // run list vs. our Chevy 3GCPDDEKXPG102576 in inventory — so matching on
    // last-6 would stamp the wrong car's physical location. We only use
    // byLast6.has(...) to warn that a skipped VIN was a last-6 near-miss.
    for (const r of rows) {
      const full = (r.vehicle_vin || '').toUpperCase();
      const l6 = (r.last_6_vin || full.slice(-6) || '').toUpperCase();
      if (full) byVin.set(full, r.stock_number);
      if (l6) {
        byLast6.set(l6, r.stock_number); // presence only — NOT a match source
        const vehicles = last6Count.get(l6);
        if (vehicles && vehicles.length > 1) last6Conflicts.set(l6, vehicles);
      }
    }
    return { byVin, byLast6, last6Conflicts };
  }

  // Look up VINs in vehicle_locations that have been sold on a marketplace
  async function fetchSoldByVins(vins) {
    if (!vins.length) return new Map();
    const byVin = new Map();
    const CHUNK = 100;
    for (let i = 0; i < vins.length; i += CHUNK) {
      const batch = vins.slice(i, i + CHUNK);
      const vinList = batch.map(encodeURIComponent).join(',');
      const url = `${config.supabaseUrl}/rest/v1/vehicle_locations?vin=in.(${vinList})&sold_on=not.is.null&select=stock_number,vin,sold_on,sold_at,sold_price,buyer_name`;
      const res = await fetch(url, {
        headers: {
          apikey: config.supabaseKey,
          Authorization: `Bearer ${config.supabaseKey}`,
        },
      });
      if (!res.ok) {
        config.log('Sold lookup failed: ' + res.status, 'err');
        continue;
      }
      const rows = await res.json();
      for (const r of rows) {
        byVin.set((r.vin || '').toUpperCase(), r);
      }
    }
    return byVin;
  }

  // Read locally stored Frazer sold report data from chrome.storage
  async function fetchLocalSoldVins() {
    try {
      const stored = await chrome.storage.local.get(['soldData']);
      const soldData = stored.soldData || [];
      const byVin = new Map();
      const byLast6 = new Map();
      for (const r of soldData) {
        const full = (r['Vehicle VIN'] || r['VIN'] || '').toUpperCase();
        const l6 = (r['Last 6 VIN'] || full.slice(-6) || '').toUpperCase();
        const info = {
          stock: (r['Stock #'] || '').trim(),
          year: r['Vehicle Year'] || r['Year'] || '',
          make: r['Vehicle Make'] || r['Make'] || '',
          model: r['Vehicle Model'] || r['Model'] || '',
          vin: full,
        };
        if (full) byVin.set(full, info);
        if (l6) byLast6.set(l6, info);
      }
      return { byVin, byLast6 };
    } catch (_) {
      return { byVin: new Map(), byLast6: new Map() };
    }
  }

  async function upsertLocations(rows) {
    if (!rows.length) return { ok: 0, err: 0 };
    // Collapse duplicate conflict keys first — PostgREST rejects a bulk upsert
    // that touches the same stock_number twice in one request ("ON CONFLICT DO
    // UPDATE command cannot affect row a second time"), which fails the whole
    // batch. Keep the last row for each stock_number (callers pre-rank so the
    // winning status is last).
    const byStockKey = new Map();
    for (const r of rows) byStockKey.set(r.stock_number, r);
    rows = [...byStockKey.values()];
    // PostgREST requires every object in a bulk upsert to have the exact same
    // keys. Normalize by computing the union of keys across all rows and
    // filling missing keys with null so each object matches the shape.
    const allKeys = new Set();
    for (const r of rows) for (const k of Object.keys(r)) allKeys.add(k);
    const normalized = rows.map((r) => {
      const out = {};
      for (const k of allKeys) out[k] = Object.prototype.hasOwnProperty.call(r, k) ? r[k] : null;
      return out;
    });
    const CHUNK = 200;
    let ok = 0;
    let err = 0;
    for (let i = 0; i < normalized.length; i += CHUNK) {
      const batch = normalized.slice(i, i + CHUNK);
      const url = `${config.supabaseUrl}/rest/v1/vehicle_locations?on_conflict=stock_number`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          apikey: config.supabaseKey,
          Authorization: `Bearer ${config.supabaseKey}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(batch),
      });
      if (!res.ok) {
        const txt = await res.text();
        config.log(`Upsert batch ${Math.floor(i / CHUNK) + 1} failed: ${txt.slice(0, 200)}`, 'err');
        err += batch.length;
      } else {
        ok += batch.length;
      }
    }
    return { ok, err };
  }

  // Replace the sa_active_cars snapshot (drives the marketplace Buy-Now price,
  // "View on SmartAuction" link, and sa-only coverage). Mirrors the Buyer Match
  // Active-List upload so one SmartAuction report keeps the marketplace current.
  async function replaceActiveCars(rows) {
    const byVin = new Map();
    for (const r of rows) if (r.vin) byVin.set(r.vin, r);
    const list = [...byVin.values()];
    // Never clear on an empty set. The DELETE below is unconditional, so a
    // report with no active rows — a run list, a sold-only export, a file whose
    // columns didn't map — used to wipe sa_active_cars and take every
    // marketplace Buy-Now price and SmartAuction link with it. Leaving the last
    // good snapshot in place is always the safer failure.
    if (!list.length) {
      config.log('sa_active_cars: no active rows in this report — snapshot left as-is', 'warn');
      return 0;
    }
    const hdr = (extra) => Object.assign({
      apikey: config.supabaseKey, Authorization: `Bearer ${config.supabaseKey}`,
      'Content-Type': 'application/json',
    }, extra || {});
    // Clear (PostgREST refuses an unfiltered DELETE; vin=like.* matches every row)
    await fetch(`${config.supabaseUrl}/rest/v1/sa_active_cars?vin=like.*`, {
      method: 'DELETE', headers: hdr({ Prefer: 'return=minimal' }),
    });
    let ok = 0;
    for (let i = 0; i < list.length; i += 500) {
      const batch = list.slice(i, i + 500);
      const res = await fetch(`${config.supabaseUrl}/rest/v1/sa_active_cars?on_conflict=vin`, {
        method: 'POST', headers: hdr({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(batch),
      });
      if (res.ok) ok += batch.length;
      else config.log(`sa_active_cars batch failed: ${(await res.text()).slice(0, 160)}`, 'warn');
    }
    return ok;
  }

  // Fetch current vehicle_locations rows for a list of stock numbers. Used
  // to preserve `*_updated_at` timestamps when the same car is re-uploaded
  // at the same status — we only want the timestamp to reset when the
  // status actually changes, so stale cars (>7d at same status) stay visible.
  async function fetchExistingLocationRows(stocks) {
    const byStock = new Map();
    if (!stocks.length) return byStock;
    const CHUNK = 100;
    for (let i = 0; i < stocks.length; i += CHUNK) {
      const batch = stocks.slice(i, i + CHUNK);
      const url = `${config.supabaseUrl}/rest/v1/vehicle_locations`
        + `?stock_number=in.(${batch.map(encodeURIComponent).join(',')})`
        + `&select=stock_number,physical_location,physical_source,location_updated_at,sa_status,sa_updated_at,manheim_status,manheim_updated_at,ove_status,ove_updated_at`;
      const res = await fetch(url, {
        headers: { apikey: config.supabaseKey, Authorization: `Bearer ${config.supabaseKey}` },
      });
      if (!res.ok) continue;
      const rows = await res.json();
      for (const r of rows) byStock.set(r.stock_number, r);
    }
    return byStock;
  }

  // Mark any vehicle_locations row currently at `source` that is NOT in
  // `keepStocks` as physical_location='unknown'. Splits stale cars into:
  //   - Sold (per Frazer) → clear silently, no prompt. They're gone; tracker is moot.
  //   - Still in inventory → this is the real signal; prompt with a preview.
  async function clearStaleForSource(source, keepStocks) {
    const selUrl = `${config.supabaseUrl}/rest/v1/vehicle_locations?physical_source=eq.${source}&select=stock_number,vin`;
    const selRes = await fetch(selUrl, {
      headers: { apikey: config.supabaseKey, Authorization: `Bearer ${config.supabaseKey}` },
    });
    if (!selRes.ok) return 0;
    const existing = await selRes.json();
    const stale = existing.filter((r) => !keepStocks.has(r.stock_number));
    if (stale.length === 0) return 0;

    // Cross-check against Frazer sold so we don't waste the user's attention
    // on cars that already sold (most common case for UAX post-sale clean-up).
    const vins = stale.map((s) => s.vin).filter(Boolean);
    let soldVins = new Set();
    if (vins.length) {
      try {
        const soldRes = await fetch(`${config.supabaseUrl}/rest/v1/rpc/sold_stocks_by_vins`, {
          method: 'POST',
          headers: {
            apikey: config.supabaseKey,
            Authorization: `Bearer ${config.supabaseKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ vin_list: vins }),
        });
        if (soldRes.ok) {
          const rows = await soldRes.json();
          soldVins = new Set(rows.map((r) => (r.vehicle_vin || '').toUpperCase()));
        }
      } catch (_) { /* fall through — treat all as still-in-inventory */ }
    }

    const soldStale = stale.filter((s) => soldVins.has((s.vin || '').toUpperCase()));
    const activeStale = stale.filter((s) => !soldVins.has((s.vin || '').toUpperCase()));

    const patchStocks = async (stocks) => {
      if (!stocks.length) return 0;
      const CHUNK = 50;
      let done = 0;
      const payload = {
        physical_location: 'unknown',
        physical_source: null,
        location_updated_at: new Date().toISOString(),
      };
      for (let i = 0; i < stocks.length; i += CHUNK) {
        const batch = stocks.slice(i, i + CHUNK);
        const patchUrl = `${config.supabaseUrl}/rest/v1/vehicle_locations?stock_number=in.(${batch.map(encodeURIComponent).join(',')})`;
        const res = await fetch(patchUrl, {
          method: 'PATCH',
          headers: {
            apikey: config.supabaseKey,
            Authorization: `Bearer ${config.supabaseKey}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify(payload),
        });
        if (res.ok) done += batch.length;
      }
      return done;
    };

    // Silent clear for sold cars — tracker cleanup, no user attention needed.
    if (soldStale.length) {
      const silentlyCleared = await patchStocks(soldStale.map((s) => s.stock_number));
      config.log(`Auto-cleared ${silentlyCleared} sold car(s) from ${source.toUpperCase()} tracker`, 'ok');
    }

    if (activeStale.length === 0) return soldStale.length;

    // Prompt only for still-in-inventory cars — the real "where did it go?" list.
    const preview = activeStale.slice(0, 10).map((s) => `  • ${s.stock_number}  …${(s.vin || '').slice(-6)}`).join('\n');
    const moreBit = activeStale.length > 10 ? `\n  … and ${activeStale.length - 10} more` : '';
    const msg = [
      `${activeStale.length} car(s) are still in Frazer inventory, were tracked at ${source.toUpperCase()} before, but are NOT on today's ${source.toUpperCase()} list:`,
      '',
      preview + moreBit,
      '',
      `(${soldStale.length} already-sold cars were auto-cleared — not in this count.)`,
      '',
      `→ OK: mark these as "unknown location" (use if today's list is a full ${source.toUpperCase()} run)`,
      `→ Cancel: leave them marked "at ${source.toUpperCase()}" (use if today's list is a partial subset)`,
    ].join('\n');
    if (!confirm(msg)) {
      config.log(`Stale flip cancelled — ${activeStale.length} active cars left at ${source}`, 'warn');
      return soldStale.length;
    }
    const activeCleared = await patchStocks(activeStale.map((s) => s.stock_number));
    return soldStale.length + activeCleared;
  }

  // ── Per-source parsers ──────────────────────────────────────────────

  // Handle UAX Post-Sale data - compare YOUR presale list with post-sale results
  async function handleUaxPostSale(file) {
    // Clear previous results
    const summaryEl = document.getElementById('luSummaryBanner');
    const panelEl = document.getElementById('luMatchedPanel');
    if (summaryEl) summaryEl.innerHTML = '';
    if (panelEl) panelEl.innerHTML = '';
    
    const text = await file.text();
    const rows = parseCSV(text);
    config.log(`Parsed ${rows.length} UAX Post-Sale rows`);
    
    // Get stored presale data (from yesterday's UAX Run upload)
    const stored = await chrome.storage.local.get(['uaxPresaleStocks', 'inventory']);
    
    if (!stored.uaxPresaleStocks || stored.uaxPresaleStocks.length === 0) {
      config.log('No UAX presale data found - upload UAX Run list first!', 'warn');
      if (panelEl) {
        panelEl.innerHTML = `<div style="padding:12px;background:#fff3e0;border-radius:4px;color:#ef6c00;text-align:center;">
          <div style="font-size:14px;font-weight:600;margin-bottom:6px;">⚠️ No UAX Run List Found</div>
          <div style="font-size:11px;">Please upload yesterday's UAX Run list first (green UAX Run button), then upload the post-sale results.</div>
        </div>`;
      }
      return;
    }
    
    // Create map of post-sale results
    const postSaleMap = new Map();
    for (const r of rows) {
      const stockNum = (r['Stock #'] || r['Stock Number'] || '').trim();
      const price = toNumber(r.Price || r['Sale Price']);
      if (stockNum) {
        postSaleMap.set(stockNum, {
          sold: price && price > 0,
          price: price || 0,
          year: r.Year,
          make: r.Make,
          model: r.Model,
          lane: r.Lane,
          grade: toNumber(r.Grade)
        });
      }
    }
    
    // Get YOUR vehicles by VIN matching since UAX uses their own stock numbers
    const yourVins = new Set();
    const yourLast6 = new Set();
    if (stored.inventory && stored.inventory.length > 0) {
      for (const inv of stored.inventory) {
        const vin = inv.vehicle_vin || inv.vin || inv.VIN;
        if (vin) {
          yourVins.add(String(vin).toUpperCase());
          yourLast6.add(String(vin).slice(-6).toUpperCase());
        }
      }
      config.log(`Your inventory has ${yourVins.size} VINs loaded for matching`, 'ok');
    } else {
      config.log('No inventory found - sync inventory first to identify YOUR vehicles', 'warn');
    }
    
    // Debug logging
    console.log('UAX Post-Sale Processing:', {
      presaleCount: stored.uaxPresaleStocks.length,
      firstPresale: stored.uaxPresaleStocks[0],
      hasVin: stored.uaxPresaleStocks[0]?.vin ? 'YES' : 'NO'
    });
    
    // Check ALL presale vehicles against post-sale for market analysis
    const sold = [];
    const noSale = [];
    let totalRevenue = 0;
    let yourRevenue = 0;
    let yourSoldCount = 0;
    let yourNoSaleCount = 0;
    
    // First, let's see some sample matches
    let sampleCount = 0;
    for (const presaleStock of stored.uaxPresaleStocks) {
      const stockStr = String(presaleStock.stock).trim();
      const postSale = postSaleMap.get(stockStr);
      
      // Check if this is YOUR vehicle by VIN
      let isYours = false;
      if (presaleStock.vin) {
        const vinUpper = presaleStock.vin.toUpperCase();
        const last6 = vinUpper.slice(-6);
        isYours = yourVins.has(vinUpper) || yourLast6.has(last6);
      }
      
      // Log first few YOUR vehicles found
      if (isYours && sampleCount < 3) {
        config.log(`Found YOUR vehicle: UAX Stock #${stockStr} - ${presaleStock.year} ${presaleStock.make} ${presaleStock.model}`, 'ok');
        sampleCount++;
      }
      
      if (postSale && postSale.sold) {
        sold.push({
          stock: stockStr,
          year: postSale.year || presaleStock.year,
          make: postSale.make || presaleStock.make,
          model: postSale.model || presaleStock.model,
          vin: presaleStock.vin,  // ADD VIN HERE!
          price: postSale.price,
          lane: postSale.lane,
          grade: postSale.grade,
          isYours: isYours
        });
        totalRevenue += postSale.price;
        if (isYours) {
          yourRevenue += postSale.price;
          yourSoldCount++;
        }
      } else {
        noSale.push({
          stock: stockStr,
          year: presaleStock.year,
          make: presaleStock.make,
          model: presaleStock.model,
          vin: presaleStock.vin,  // ADD VIN HERE!
          lane: presaleStock.lane,
          isYours: isYours
        });
        if (isYours) {
          yourNoSaleCount++;
        }
      }
    }
    
    config.log(`Market: ${sold.length} SOLD, ${noSale.length} NO SALE | YOUR: ${yourSoldCount} sold, ${yourNoSaleCount} no sale, $${yourRevenue.toLocaleString()} revenue`, 'ok');
    
    // Auto-remove sold vehicles from queue
    const yourSoldVins = sold.filter(v => v.isYours).map(v => v.vin).filter(Boolean);
    if (yourSoldVins.length > 0) {
      let removedCount = 0;
      try {
        for (const vin of yourSoldVins) {
          const last6 = vin.slice(-6);
          const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/sa_queue_set_status`, { method: 'POST', headers: { apikey: config.supabaseKey, Authorization: `Bearer ${config.supabaseKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_vin6: last6, p_status: 'sold' }) });
          if (response.ok) {
            removedCount++;
            config.log(`Marked ${last6} as sold - removed from queue and deleted photos`, 'ok');
          }
          // Skip 404s silently - vehicle not in queue
        }
        if (removedCount > 0) {
          config.log(`Auto-removed ${removedCount} sold vehicles from queue`, 'ok');
        }
      } catch (err) {
        config.log(`Error auto-removing sold vehicles: ${err.message}`, 'warn');
      }
    }
    
    // Show summary
    showSummary('UAX SALE RESULTS', sold.length, stored.uaxPresaleStocks.length, 0, 0, 0);
    
    // Render results with market analysis and YOUR vehicles highlighted
    renderUaxSaleResults(sold, noSale, totalRevenue, yourSoldCount, yourNoSaleCount, yourRevenue);
  }
  
  // Helper to fetch inventory stocks
  async function fetchInventoryStocksForStocks(stocks) {
    const stockSet = new Set();
    try {
      // First try local storage cache (from Sync Inventory button)
      const stored = await chrome.storage.local.get(['inventory']);
      if (stored.inventory && stored.inventory.length > 0) {
        config.log(`Found ${stored.inventory.length} vehicles in cached inventory`, 'ok');
        
        // Create a Set of all stock numbers from inventory for faster lookup
        const invStocks = new Set();
        for (const r of stored.inventory) {
          // The Supabase sync stores as 'stock_number'
          const stock = r.stock_number || r['Stock #'] || r.stockNumber || r['Stock Number'];
          if (stock) {
            invStocks.add(String(stock).trim());
          }
        }
        
        // Now check which UAX stocks match your inventory
        for (const uaxStock of stocks) {
          const stockStr = String(uaxStock).trim();
          if (invStocks.has(stockStr)) {
            stockSet.add(stockStr);
          }
        }
        
        config.log(`Matched ${stockSet.size} of your vehicles in UAX post-sale (from ${invStocks.size} total inventory)`, 'ok');
      } else {
        config.log('No inventory cached - please click "Sync Inventory" first!', 'warn');
      }
      
      // If no local cache, try Supabase
      if (stockSet.size === 0 && stocks.length > 0) {
        const CHUNK = 100;
        for (let i = 0; i < stocks.length; i += CHUNK) {
          const batch = stocks.slice(i, i + CHUNK);
          const url = `${config.supabaseUrl}/rest/v1/inventory?stock_number=in.(${batch.map(encodeURIComponent).join(',')})&select=stock_number`;
          const res = await fetch(url, {
            headers: { apikey: config.supabaseKey, Authorization: `Bearer ${config.supabaseKey}` }
          });
          if (res.ok) {
            const rows = await res.json();
            for (const r of rows) {
              if (r.stock_number) stockSet.add(String(r.stock_number));
            }
          }
        }
      }
    } catch (e) {
      config.log(`Error fetching inventory: ${e.message}`, 'err');
    }
    return stockSet;
  }
  
  function renderUaxSaleResults(sold, noSale, totalRevenue, yourSoldCount, yourNoSaleCount, yourRevenue) {
    const panel = document.getElementById('luMatchedPanel');
    if (!panel) return;
    
    // Separate YOUR vehicles
    const yourSold = sold.filter(v => v.isYours);
    const yourNoSale = noSale.filter(v => v.isYours);
    
    let html = '<div style="padding:8px;background:#f5f5f5;border-radius:4px;margin-bottom:6px;">';
    
    // 1. YOUR CARS SOLD
    html += '<div style="padding:8px;background:#e8f5e9;border-left:3px solid #2e7d32;border-radius:4px;margin-bottom:6px;">';
    html += `<div style="font-size:12px;font-weight:700;color:#2e7d32;margin-bottom:6px;">YOUR CARS SOLD (${yourSold.length})</div>`;
    if (yourSold.length > 0) {
      html += `<button class="btn btn-small copy-your-sold" style="background:#2e7d32;color:white;font-size:11px;padding:4px 10px;margin-bottom:6px;margin-right:4px;">Copy UAX Stock #s</button>`;
      html += `<button class="btn btn-small copy-your-sold-vins" style="background:#1976d2;color:white;font-size:11px;padding:4px 10px;margin-bottom:6px;">Copy VINs</button>`;
      html += '<div style="max-height:120px;overflow-y:auto;font-size:11px;background:white;padding:4px;border-radius:3px;">';
      for (const v of yourSold) {
        const vinDisplay = v.vin ? ` · VIN: ${v.vin}` : '';
        html += `<div>UAX #${v.stock} - ${v.year} ${v.make} ${v.model} - $${v.price.toLocaleString()}${vinDisplay}</div>`;
      }
      html += '</div>';
    } else {
      html += '<div style="font-size:11px;color:#999;">None of your vehicles sold</div>';
    }
    html += '</div>';
    
    // 2. YOUR CARS NO SALE
    html += '<div style="padding:8px;background:#fff3e0;border-left:3px solid #ef6c00;border-radius:4px;margin-bottom:6px;">';
    html += `<div style="font-size:12px;font-weight:700;color:#ef6c00;margin-bottom:6px;">YOUR CARS NO SALE (${yourNoSale.length})</div>`;
    if (yourNoSale.length > 0) {
      html += `<button class="btn btn-small copy-your-nosale" style="background:#ef6c00;color:white;font-size:11px;padding:4px 10px;margin-bottom:6px;margin-right:4px;">Copy UAX Stock #s</button>`;
      html += `<button class="btn btn-small copy-your-nosale-vins" style="background:#ff9800;color:white;font-size:11px;padding:4px 10px;margin-bottom:6px;">Copy VINs</button>`;
      html += '<div style="max-height:120px;overflow-y:auto;font-size:11px;background:white;padding:4px;border-radius:3px;">';
      for (const v of yourNoSale) {
        const vinDisplay = v.vin ? ` · VIN: ${v.vin}` : '';
        html += `<div>UAX #${v.stock} - ${v.year} ${v.make} ${v.model}${vinDisplay}</div>`;
      }
      html += '</div>';
    } else {
      html += '<div style="font-size:11px;color:#999;">None of your vehicles failed to sell</div>';
    }
    html += '</div>';
    
    // 3. MARKET REPORT - What sells good
    html += '<div style="padding:8px;background:#f0f4f8;border-left:3px solid #1565c0;border-radius:4px;">';
    html += `<div style="font-size:12px;font-weight:700;color:#1565c0;margin-bottom:6px;">WHAT SELLS GOOD AT UAX</div>`;
    html += `<button class="btn btn-small export-report" style="background:#1565c0;color:white;font-size:11px;padding:4px 10px;margin-bottom:6px;">Export Full Report</button>`;
    
    // Quick stats
    const totalVehicles = sold.length + noSale.length;
    html += `<div style="font-size:11px;margin-bottom:6px;">`;
    html += `<strong>${sold.length}/${totalVehicles}</strong> sold (${Math.round(sold.length/totalVehicles*100)}%) | `;
    html += `<strong>$${(totalRevenue/1000).toFixed(0)}K</strong> total revenue`;
    html += '</div>';
    
    // Top performing models
    const modelStats = new Map();
    for (const v of sold) {
      const key = `${v.year} ${v.make} ${v.model}`;
      if (!modelStats.has(key)) {
        modelStats.set(key, { count: 0, prices: [], totalSale: 0, totalNoSale: 0 });
      }
      const stat = modelStats.get(key);
      stat.count++;
      stat.prices.push(v.price);
      stat.totalSale++;
    }
    
    for (const v of noSale) {
      const key = `${v.year} ${v.make} ${v.model}`;
      if (!modelStats.has(key)) {
        modelStats.set(key, { count: 0, prices: [], totalSale: 0, totalNoSale: 0 });
      }
      modelStats.get(key).totalNoSale++;
    }
    
    // Calculate sale rates and averages
    const topModels = [];
    for (const [model, stat] of modelStats.entries()) {
      const total = stat.totalSale + stat.totalNoSale;
      const saleRate = Math.round(stat.totalSale / total * 100);
      const avgPrice = stat.prices.length > 0 ? Math.round(stat.prices.reduce((a,b) => a+b, 0) / stat.prices.length) : 0;
      if (stat.totalSale >= 2 || saleRate >= 75) { // At least 2 sales or 75% rate
        topModels.push({ model, sold: stat.totalSale, rate: saleRate, avgPrice });
      }
    }
    
    // Sort by success (combination of volume and rate)
    topModels.sort((a, b) => (b.sold * b.rate) - (a.sold * a.rate));
    
    html += '<div style="max-height:150px;overflow-y:auto;font-size:10px;background:white;padding:6px;border-radius:3px;">';
    html += '<div style="font-weight:600;margin-bottom:4px;border-bottom:1px solid #ddd;padding-bottom:2px;">Top Performers:</div>';
    for (const item of topModels.slice(0, 15)) {
      html += `<div style="padding:2px 0;">${item.model} - ${item.sold} sold @ $${item.avgPrice.toLocaleString()} avg (${item.rate}% rate)</div>`;
    }
    html += '</div>';
    html += '</div>';
    
    html += '</div>';
    panel.innerHTML = html;
    
    // Add event listeners for YOUR cars copy buttons
    const yourSoldBtn = panel.querySelector('.copy-your-sold');
    if (yourSoldBtn) {
      yourSoldBtn.addEventListener('click', () => {
        const stocks = yourSold.map(v => v.stock).join('\n');
        navigator.clipboard.writeText(stocks).then(() => {
          yourSoldBtn.textContent = 'Copied!';
          setTimeout(() => { yourSoldBtn.textContent = 'Copy UAX Stock #s'; }, 1500);
        });
      });
    }
    
    // Copy VINs for sold vehicles
    const yourSoldVinsBtn = panel.querySelector('.copy-your-sold-vins');
    if (yourSoldVinsBtn) {
      yourSoldVinsBtn.addEventListener('click', () => {
        console.log('Copy VINs clicked. YourSold data:', yourSold);
        console.log('First vehicle VIN:', yourSold[0]?.vin);
        const vins = yourSold.map(v => v.vin || `NO_VIN_${v.stock}`).join('\n');
        navigator.clipboard.writeText(vins).then(() => {
          yourSoldVinsBtn.textContent = 'Copied VINs!';
          setTimeout(() => { yourSoldVinsBtn.textContent = 'Copy VINs'; }, 1500);
        });
      });
    }
    
    const yourNoSaleBtn = panel.querySelector('.copy-your-nosale');
    if (yourNoSaleBtn) {
      yourNoSaleBtn.addEventListener('click', () => {
        const stocks = yourNoSale.map(v => v.stock).join('\n');
        navigator.clipboard.writeText(stocks).then(() => {
          yourNoSaleBtn.textContent = 'Copied!';
          setTimeout(() => { yourNoSaleBtn.textContent = 'Copy UAX Stock #s'; }, 1500);
        });
      });
    }
    
    // Copy VINs for no-sale vehicles
    const yourNoSaleVinsBtn = panel.querySelector('.copy-your-nosale-vins');
    if (yourNoSaleVinsBtn) {
      yourNoSaleVinsBtn.addEventListener('click', () => {
        const vins = yourNoSale.map(v => v.vin || `NO_VIN_${v.stock}`).join('\n');
        navigator.clipboard.writeText(vins).then(() => {
          yourNoSaleVinsBtn.textContent = 'Copied VINs!';
          setTimeout(() => { yourNoSaleVinsBtn.textContent = 'Copy VINs'; }, 1500);
        });
      });
    }
    
    // Export full report button
    const exportBtn = panel.querySelector('.export-report');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        exportUaxAnalysis(sold, noSale);
      });
    }
  }
  
  function exportUaxAnalysis(sold, noSale) {
    // Create analysis by make/model
    const analysis = new Map();
    
    for (const v of sold) {
      const key = `${v.year}-${v.make}-${v.model}`;
      if (!analysis.has(key)) {
        analysis.set(key, {
          year: v.year,
          make: v.make,
          model: v.model,
          sold: 0,
          noSale: 0,
          prices: [],
          avgPrice: 0,
          minPrice: 0,
          maxPrice: 0
        });
      }
      const stat = analysis.get(key);
      stat.sold++;
      stat.prices.push(v.price);
    }
    
    for (const v of noSale) {
      const key = `${v.year}-${v.make}-${v.model}`;
      if (!analysis.has(key)) {
        analysis.set(key, {
          year: v.year,
          make: v.make,
          model: v.model,
          sold: 0,
          noSale: 0,
          prices: [],
          avgPrice: 0,
          minPrice: 0,
          maxPrice: 0
        });
      }
      analysis.get(key).noSale++;
    }
    
    // Calculate stats
    for (const stat of analysis.values()) {
      if (stat.prices.length > 0) {
        stat.avgPrice = Math.round(stat.prices.reduce((a, b) => a + b, 0) / stat.prices.length);
        stat.minPrice = Math.min(...stat.prices);
        stat.maxPrice = Math.max(...stat.prices);
      }
      stat.saleRate = stat.sold + stat.noSale > 0 ? Math.round(stat.sold / (stat.sold + stat.noSale) * 100) : 0;
    }
    
    // Create CSV
    const headers = ['Year', 'Make', 'Model', 'Sold', 'No Sale', 'Sale Rate %', 'Avg Price', 'Min Price', 'Max Price'];
    const lines = [headers.join(',')];
    
    // Sort by sale performance
    const sorted = Array.from(analysis.values()).sort((a, b) => b.sold - a.sold);
    
    for (const stat of sorted) {
      lines.push([
        stat.year,
        csvEscape(stat.make),
        csvEscape(stat.model),
        stat.sold,
        stat.noSale,
        stat.saleRate,
        stat.avgPrice || '',
        stat.minPrice || '',
        stat.maxPrice || ''
      ].join(','));
    }
    
    // Add detailed lists
    lines.push('');
    lines.push('SOLD VEHICLES');
    lines.push('Stock,Year,Make,Model,Price,Grade,Lane');
    for (const v of sold) {
      lines.push([v.stock, v.year, csvEscape(v.make), csvEscape(v.model), v.price, v.grade || '', v.lane || ''].join(','));
    }
    
    lines.push('');
    lines.push('NO SALE VEHICLES');
    lines.push('Stock,Year,Make,Model,Lane');
    for (const v of noSale) {
      lines.push([v.stock, v.year, csvEscape(v.make), csvEscape(v.model), v.lane || ''].join(','));
    }
    
    const filename = `uax-sale-analysis-${new Date().toISOString().slice(0, 10)}.csv`;
    downloadCsv(lines, filename);
    
    config.log(`Exported UAX analysis: ${sold.length} sold, ${noSale.length} no sale`, 'ok');
  }

  // Handle DAA Post-Sale data - compare YOUR presale list with post-sale results
  async function handleDaaPostSale(file) {
    // Clear previous results
    const summaryEl = document.getElementById('luSummaryBanner');
    const panelEl = document.getElementById('luMatchedPanel');
    if (summaryEl) summaryEl.innerHTML = '';
    if (panelEl) panelEl.innerHTML = '';
    
    const text = await file.text();
    const rows = parseCSV(text);
    config.log(`Parsed ${rows.length} DAA Post-Sale rows`);
    
    // Get stored presale data (from DAA Run upload)
    const stored = await chrome.storage.local.get(['daaPresaleStocks', 'inventory']);
    
    if (!stored.daaPresaleStocks || stored.daaPresaleStocks.length === 0) {
      config.log('No DAA presale data found - upload DAA Run list first!', 'warn');
      if (panelEl) {
        panelEl.innerHTML = `<div style="padding:12px;background:#fff3e0;border-radius:4px;color:#ef6c00;text-align:center;">
          <div style="font-size:14px;font-weight:600;margin-bottom:6px;">⚠️ No DAA Run List Found</div>
          <div style="font-size:11px;">Please upload yesterday's DAA Run list first (blue DAA Run button), then upload the post-sale results.</div>
        </div>`;
      }
      return;
    }
    
    // Create map of post-sale results
    const postSaleMap = new Map();
    for (const r of rows) {
      const stockNum = (r['Stock #'] || r['Stock Number'] || '').trim();
      const price = toNumber(r.Price || r['Sale Price']);
      if (stockNum) {
        postSaleMap.set(stockNum, {
          sold: price && price > 0,
          price: price || 0,
          year: r.Year,
          make: r.Make,
          model: r.Model,
          lane: r.Lane,
          grade: toNumber(r.Grade)
        });
      }
    }
    
    // Get YOUR vehicles by VIN matching
    const yourVins = new Set();
    const yourLast6 = new Set();
    if (stored.inventory && stored.inventory.length > 0) {
      for (const inv of stored.inventory) {
        const vin = inv.vehicle_vin || inv.vin || inv.VIN;
        if (vin) {
          yourVins.add(String(vin).toUpperCase());
          yourLast6.add(String(vin).slice(-6).toUpperCase());
        }
      }
      config.log(`Your inventory has ${yourVins.size} VINs loaded for matching`, 'ok');
    } else {
      config.log('No inventory found - sync inventory first to identify YOUR vehicles', 'warn');
    }
    
    // Check ALL presale vehicles against post-sale for market analysis
    const sold = [];
    const noSale = [];
    let totalRevenue = 0;
    let yourRevenue = 0;
    let yourSoldCount = 0;
    let yourNoSaleCount = 0;
    
    for (const presaleStock of stored.daaPresaleStocks) {
      const stockStr = String(presaleStock.stock).trim();
      const postSale = postSaleMap.get(stockStr);
      
      // Check if this is YOUR vehicle by VIN
      let isYours = false;
      if (presaleStock.vin) {
        const vinUpper = presaleStock.vin.toUpperCase();
        const last6 = vinUpper.slice(-6);
        isYours = yourVins.has(vinUpper) || yourLast6.has(last6);
      }
      
      if (postSale && postSale.sold) {
        sold.push({
          stock: stockStr,
          year: postSale.year || presaleStock.year,
          make: postSale.make || presaleStock.make,
          model: postSale.model || presaleStock.model,
          vin: presaleStock.vin,
          price: postSale.price,
          lane: postSale.lane,
          grade: postSale.grade,
          isYours: isYours
        });
        totalRevenue += postSale.price;
        if (isYours) {
          yourRevenue += postSale.price;
          yourSoldCount++;
        }
      } else {
        noSale.push({
          stock: stockStr,
          year: presaleStock.year,
          make: presaleStock.make,
          model: presaleStock.model,
          vin: presaleStock.vin,
          lane: presaleStock.lane,
          isYours: isYours
        });
        if (isYours) {
          yourNoSaleCount++;
        }
      }
    }
    
    config.log(`Market: ${sold.length} SOLD, ${noSale.length} NO SALE | YOUR: ${yourSoldCount} sold, ${yourNoSaleCount} no sale, $${yourRevenue.toLocaleString()} revenue`, 'ok');
    
    // Auto-remove sold vehicles from queue (same as UAX)
    const yourSoldVins = sold.filter(v => v.isYours).map(v => v.vin).filter(Boolean);
    if (yourSoldVins.length > 0) {
      let removedCount = 0;
      try {
        for (const vin of yourSoldVins) {
          const last6 = vin.slice(-6);
          const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/sa_queue_set_status`, { method: 'POST', headers: { apikey: config.supabaseKey, Authorization: `Bearer ${config.supabaseKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_vin6: last6, p_status: 'sold' }) });
          if (response.ok) {
            removedCount++;
            config.log(`Marked ${last6} as sold - removed from queue and deleted photos`, 'ok');
          }
        }
        if (removedCount > 0) {
          config.log(`Auto-removed ${removedCount} sold vehicles from queue`, 'ok');
        }
      } catch (err) {
        config.log(`Error auto-removing sold vehicles: ${err.message}`, 'warn');
      }
    }
    
    // Show summary
    showSummary('DAA SALE RESULTS', sold.length, stored.daaPresaleStocks.length, 0, 0, 0);
    
    // Render results with market analysis and YOUR vehicles highlighted
    renderDaaSaleResults(sold, noSale, totalRevenue, yourSoldCount, yourNoSaleCount, yourRevenue);
  }

  function renderDaaSaleResults(sold, noSale, totalRevenue, yourSoldCount, yourNoSaleCount, yourRevenue) {
    const panel = document.getElementById('luMatchedPanel');
    if (!panel) return;
    
    // Separate YOUR vehicles
    const yourSold = sold.filter(v => v.isYours);
    const yourNoSale = noSale.filter(v => v.isYours);
    
    let html = '<div style="padding:8px;background:#f5f5f5;border-radius:4px;margin-bottom:6px;">';
    
    // 1. YOUR CARS SOLD
    html += '<div style="padding:8px;background:#e8f5e9;border-left:3px solid #2e7d32;border-radius:4px;margin-bottom:6px;">';
    html += `<div style="font-size:12px;font-weight:700;color:#2e7d32;margin-bottom:6px;">YOUR CARS SOLD (${yourSold.length})</div>`;
    if (yourSold.length > 0) {
      html += `<button class="btn btn-small copy-your-sold" style="background:#2e7d32;color:white;font-size:11px;padding:4px 10px;margin-bottom:6px;margin-right:4px;">Copy DAA Stock #s</button>`;
      html += `<button class="btn btn-small copy-your-sold-vins" style="background:#1976d2;color:white;font-size:11px;padding:4px 10px;margin-bottom:6px;">Copy VINs</button>`;
      html += '<div style="max-height:120px;overflow-y:auto;font-size:11px;background:white;padding:4px;border-radius:3px;">';
      for (const v of yourSold) {
        const vinDisplay = v.vin ? ` · VIN: ${v.vin}` : '';
        html += `<div>DAA #${v.stock} - ${v.year} ${v.make} ${v.model} - $${v.price.toLocaleString()}${vinDisplay}</div>`;
      }
      html += '</div>';
    } else {
      html += '<div style="font-size:11px;color:#999;">None of your vehicles sold</div>';
    }
    html += '</div>';
    
    // 2. YOUR CARS NO SALE
    html += '<div style="padding:8px;background:#fff3e0;border-left:3px solid #ef6c00;border-radius:4px;margin-bottom:6px;">';
    html += `<div style="font-size:12px;font-weight:700;color:#ef6c00;margin-bottom:6px;">YOUR CARS NO SALE (${yourNoSale.length})</div>`;
    if (yourNoSale.length > 0) {
      html += `<button class="btn btn-small copy-your-nosale" style="background:#ef6c00;color:white;font-size:11px;padding:4px 10px;margin-bottom:6px;margin-right:4px;">Copy DAA Stock #s</button>`;
      html += `<button class="btn btn-small copy-your-nosale-vins" style="background:#ff9800;color:white;font-size:11px;padding:4px 10px;margin-bottom:6px;">Copy VINs</button>`;
      html += '<div style="max-height:120px;overflow-y:auto;font-size:11px;background:white;padding:4px;border-radius:3px;">';
      for (const v of yourNoSale) {
        const vinDisplay = v.vin ? ` · VIN: ${v.vin}` : '';
        html += `<div>DAA #${v.stock} - ${v.year} ${v.make} ${v.model}${vinDisplay}</div>`;
      }
      html += '</div>';
    } else {
      html += '<div style="font-size:11px;color:#999;">None of your vehicles failed to sell</div>';
    }
    html += '</div>';
    
    // 3. MARKET REPORT - What sells good at DAA
    html += '<div style="padding:8px;background:#f0f4f8;border-left:3px solid #1565c0;border-radius:4px;">';
    html += `<div style="font-size:12px;font-weight:700;color:#1565c0;margin-bottom:6px;">WHAT SELLS GOOD AT DAA</div>`;
    
    // Quick stats
    const totalVehicles = sold.length + noSale.length;
    html += `<div style="font-size:11px;margin-bottom:6px;">`;
    html += `<strong>${sold.length}/${totalVehicles}</strong> sold (${Math.round(sold.length/totalVehicles*100)}%) | `;
    html += `<strong>$${(totalRevenue/1000).toFixed(0)}K</strong> total revenue`;
    html += '</div>';
    
    html += '</div>';
    html += '</div>';
    panel.innerHTML = html;
    
    // Add event listeners for copy buttons
    const yourSoldBtn = panel.querySelector('.copy-your-sold');
    if (yourSoldBtn) {
      yourSoldBtn.addEventListener('click', () => {
        const stocks = yourSold.map(v => v.stock).join('\n');
        navigator.clipboard.writeText(stocks).then(() => {
          yourSoldBtn.textContent = 'Copied!';
          setTimeout(() => { yourSoldBtn.textContent = 'Copy DAA Stock #s'; }, 1500);
        });
      });
    }
    
    const yourSoldVinsBtn = panel.querySelector('.copy-your-sold-vins');
    if (yourSoldVinsBtn) {
      yourSoldVinsBtn.addEventListener('click', () => {
        const vins = yourSold.map(v => v.vin || `NO_VIN_${v.stock}`).join('\n');
        navigator.clipboard.writeText(vins).then(() => {
          yourSoldVinsBtn.textContent = 'Copied VINs!';
          setTimeout(() => { yourSoldVinsBtn.textContent = 'Copy VINs'; }, 1500);
        });
      });
    }
    
    const yourNoSaleBtn = panel.querySelector('.copy-your-nosale');
    if (yourNoSaleBtn) {
      yourNoSaleBtn.addEventListener('click', () => {
        const stocks = yourNoSale.map(v => v.stock).join('\n');
        navigator.clipboard.writeText(stocks).then(() => {
          yourNoSaleBtn.textContent = 'Copied!';
          setTimeout(() => { yourNoSaleBtn.textContent = 'Copy DAA Stock #s'; }, 1500);
        });
      });
    }
    
    const yourNoSaleVinsBtn = panel.querySelector('.copy-your-nosale-vins');
    if (yourNoSaleVinsBtn) {
      yourNoSaleVinsBtn.addEventListener('click', () => {
        const vins = yourNoSale.map(v => v.vin || `NO_VIN_${v.stock}`).join('\n');
        navigator.clipboard.writeText(vins).then(() => {
          yourNoSaleVinsBtn.textContent = 'Copied VINs!';
          setTimeout(() => { yourNoSaleVinsBtn.textContent = 'Copy VINs'; }, 1500);
        });
      });
    }
  }

  // Edge Pipeline format (UAX / DAA). Identical columns, user picks the
  // target source via which button they click.
  async function handleEdgePipeline(file, source /* 'uax' | 'daa' */) {
    // Clear previous results
    const summaryEl = document.getElementById('luSummaryBanner');
    const panelEl = document.getElementById('luMatchedPanel');
    if (summaryEl) summaryEl.innerHTML = '';
    if (panelEl) panelEl.innerHTML = '';
    
    const text = await file.text();
    const rows = parseCSV(text);
    config.log(`Parsed ${rows.length} ${source.toUpperCase()} rows`);
    const vins = rows.map((r) => (r.Vin || r.VIN || '').toUpperCase()).filter(Boolean);
    const { byVin, byLast6, last6Conflicts } = await fetchInventoryStocksForVins(vins);
    config.log(`Matched ${byVin.size} full VINs against inventory`);
    if (last6Conflicts.size > 0) {
      config.log(`⚠️ Warning: ${last6Conflicts.size} last-6 VINs have multiple matches`, 'warn');
    }
    const now = new Date().toISOString();
    // Pre-resolve stocks so we can pull existing location rows in one shot.
    const candidateStocks = [];
    for (const r of rows) {
      const vin = (r.Vin || r.VIN || '').toUpperCase();
      // Try full VIN first, fallback to last6 if needed
      const stock = vin ? byVin.get(vin) : null; // full VIN only — no last-6 fallback
      if (stock) candidateStocks.push(stock);
    }
    const existingByStock = await fetchExistingLocationRows(candidateStocks);
    const upserts = [];
    const keepStocks = new Set();
    const unmatchedVins = [];
    const unmatchedRows = new Map();
    let matched = 0;
    let skipped = 0;
    let preserved = 0;
    for (const r of rows) {
      const vin = (r.Vin || r.VIN || '').toUpperCase();
      if (!vin) { skipped++; continue; }
      
      // Match on the FULL VIN only — never last-6 (see fetchInventoryStocksForVins).
      const stock = byVin.get(vin);
      if (!stock && byLast6.has(last6(vin))) {
        config.log(`↷ ${vin} not in inventory, but its last-6 ${last6(vin)} belongs to a DIFFERENT inventory VIN — skipping (this was the mis-match bug)`, 'warn');
      }
      
      if (!stock) {
        skipped++;
        unmatchedVins.push(vin);
        unmatchedRows.set(vin, r);
        continue;
      }
      matched++;
      keepStocks.add(stock);
      // Preserve location_updated_at when the car is already at the same
      // source — lets staleness (>7d at UAX/DAA/ADESA) surface forgotten cars.
      const existing = existingByStock.get(stock);
      const sameSource = existing && existing.physical_source === source && existing.location_updated_at;
      if (sameSource) preserved++;
      upserts.push({
        stock_number: stock,
        vin,
        physical_location: source,
        physical_source: source,
        location_updated_at: sameSource ? existing.location_updated_at : now,
        notes: {
          run_number: r['Run Number'] || null,
          lane: r.Lane || null,
          lot: r.Lot || null,
          sale_date: r['Sale Date'] || null,
          grade: r.Grade || null,
          picture_count: toNumber(r['Picture Count']),
        },
        updated_at: now,
      });
    }
    if (preserved > 0) config.log(`Preserved ${preserved} existing timestamps (cars already at ${source.toUpperCase()})`);

    // Cross-check unmatched VINs against sold data
    const soldAtAuction = [];
    if (unmatchedVins.length) {
      const [marketplaceSold, localSold] = await Promise.all([
        fetchSoldByVins(unmatchedVins),
        fetchLocalSoldVins(),
      ]);
      for (const vin of unmatchedVins) {
        const mSold = marketplaceSold.get(vin);
        const lSold = localSold.byVin.get(vin); // full VIN only — no last-6 fallback
        if (mSold || lSold) {
          const csvRow = unmatchedRows.get(vin) || {};
          soldAtAuction.push({
            vin,
            stock: (mSold && mSold.stock_number) || (lSold && lSold.stock) || '',
            sold_on: mSold ? mSold.sold_on : 'frazer',
            sold_at: mSold ? mSold.sold_at : null,
            sold_price: mSold ? mSold.sold_price : null,
            buyer_name: mSold ? mSold.buyer_name : null,
            year: (lSold && lSold.year) || csvRow.Year || '',
            make: (lSold && lSold.make) || csvRow.Make || '',
            model: (lSold && lSold.model) || csvRow.Model || '',
            lane: csvRow.Lane || null,
            lot: csvRow.Lot || null,
            run_number: csvRow['Run Number'] || null,
            sale_date: csvRow['Sale Date'] || null,
          });
        }
      }
    }

    const { ok, err } = await upsertLocations(upserts);
    const cleared = await clearStaleForSource(source, keepStocks);
    config.log(`${source.toUpperCase()}: matched ${matched} of ${rows.length} (skipped ${skipped} non-inventory), upserted ${ok}, errors ${err}, cleared ${cleared} stale`, 'ok');
    if (soldAtAuction.length) {
      config.log(`${soldAtAuction.length} SOLD car(s) on ${source.toUpperCase()} run list — pull from auction!`, 'warn');
    }
    
    // Save ALL vehicles from presale for comprehensive market analysis (UAX or DAA)
    if (source === 'uax' || source === 'daa') {
      const allPresaleVehicles = [];
      
      // Save ALL vehicles from presale for market analysis
      for (const r of rows) {
        const stockNum = (r['Stock Number'] || r['Stock #'] || r['Stock #'] || '').trim();
        
        if (stockNum) {
          allPresaleVehicles.push({
            stock: stockNum,
            year: r.Year,
            make: r.Make, 
            model: r.Model,
            mileage: toNumber(r.Mileage || r.Odometer),
            lane: r.Lane,
            grade: toNumber(r.Grade),
            vin: (r.Vin || r.VIN || '').toUpperCase(),
            runNumber: r['Run Number'] || ''
          });
        }
      }
      
      // Store in different keys for UAX vs DAA
      if (source === 'uax') {
        await chrome.storage.local.set({ uaxPresaleStocks: allPresaleVehicles });
        config.log(`Saved ALL ${allPresaleVehicles.length} vehicles from UAX presale for market analysis`, 'ok');
      } else if (source === 'daa') {
        await chrome.storage.local.set({ daaPresaleStocks: allPresaleVehicles });
        config.log(`Saved ALL ${allPresaleVehicles.length} vehicles from DAA presale for market analysis`, 'ok');
      }
    }
    
    showSummary(source, matched, rows.length, ok, err, cleared);
    const uploadNotes = upserts.map((u) => ({ stock_number: u.stock_number, lane: u.notes?.lane, lot: u.notes?.lot, sale_date: u.notes?.sale_date, grade: u.notes?.grade }));
    const locUpdatedByStock = new Map(upserts.map((u) => [u.stock_number, u.location_updated_at]));
    renderAuctionRunListPanel(source, [...keepStocks], uploadNotes, soldAtAuction, locUpdatedByStock);
  }

  // Manheim auction inventory export (Vehicles_YYYYMMDD.csv). ONE file lists
  // every Manheim vehicle — online-only listings AND cars physically on a
  // Manheim lot — told apart by the first column, AUCTION:
  //   "Offsite"                → listed online, NOT physically at Manheim → skip
  //   "Manheim Denver" / "Manheim San Francisco" / "Manheim Riverside" / …
  //                            → physically at that lot
  // We ONLY set a physical location for the on-lot cars (per-row, from AUCTION);
  // Offsite rows are left alone so a car listed online keeps its real location.
  // physical_source is 'manheim' for every lot, so one daily upload re-marks the
  // on-lot fleet and clears cars that have left all Manheim lots.
  const MANHEIM_LOT_CODES = {
    'manheim denver': 'manheim_denver',
    'manheim san francisco bay': 'manheim_sf',   // exact string in the export
    'manheim san francisco': 'manheim_sf',
    'manheim riverside': 'manheim_riverside',
    'manheim little rock': 'manheim_little_rock',
  };
  function manheimLotCode(auction) {
    const a = (auction || '').trim().toLowerCase();
    if (!a || a === 'offsite') return null;          // online listing — not on a lot
    if (MANHEIM_LOT_CODES[a]) return MANHEIM_LOT_CODES[a];
    // A physical Manheim lot we haven't hard-coded yet still routes correctly
    // ("Manheim Nashville" → manheim_nashville) instead of being dropped.
    if (a.startsWith('manheim ')) {
      return 'manheim_' + a.slice(8).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    }
    return null;                                      // non-Manheim / unknown — skip
  }

  async function handleManheimAuction(file) {
    const summaryEl = document.getElementById('luSummaryBanner');
    const panelEl = document.getElementById('luMatchedPanel');
    if (summaryEl) summaryEl.innerHTML = '';
    if (panelEl) panelEl.innerHTML = '';

    const text = await file.text();
    const rows = parseCSV(text);
    config.log(`Parsed ${rows.length} Manheim rows`);

    // Keep ONLY cars physically at a Manheim lot; drop Offsite/online listings
    // BEFORE matching so we never touch a car that's just listed online.
    const lotRows = [];
    const lotTally = {};
    for (const r of rows) {
      const code = manheimLotCode(r.AUCTION);
      if (!code) continue;
      lotRows.push({ row: r, code });
      lotTally[code] = (lotTally[code] || 0) + 1;
    }
    const offsiteSkipped = rows.length - lotRows.length;
    config.log(`${lotRows.length} physically at a Manheim lot · skipped ${offsiteSkipped} Offsite/online`);

    const vins = lotRows.map(({ row }) => (row.VIN || row.Vin || '').toUpperCase()).filter(Boolean);
    const { byVin, byLast6, last6Conflicts } = await fetchInventoryStocksForVins(vins);
    config.log(`Matched ${byVin.size} full VINs against inventory`);
    if (last6Conflicts.size > 0) config.log(`⚠️ ${last6Conflicts.size} last-6 VINs have multiple matches`, 'warn');

    const now = new Date().toISOString();
    // Pre-resolve stocks so we can pull existing rows to preserve timestamps.
    const candidateStocks = [];
    for (const { row } of lotRows) {
      const vin = (row.VIN || row.Vin || '').toUpperCase();
      const stock = vin ? byVin.get(vin) : null; // full VIN only — no last-6 fallback
      if (stock) candidateStocks.push(stock);
    }
    const existingByStock = await fetchExistingLocationRows(candidateStocks);

    const upserts = [];
    const keepStocks = new Set();
    let matched = 0, skipped = 0, preserved = 0;
    for (const { row, code } of lotRows) {
      const vin = (row.VIN || row.Vin || '').toUpperCase();
      if (!vin) { skipped++; continue; }
      // Match on the FULL VIN only — never last-6 (see fetchInventoryStocksForVins).
      const stock = byVin.get(vin);
      if (!stock && byLast6.has(last6(vin))) {
        config.log(`↷ ${vin} not in inventory, but its last-6 ${last6(vin)} belongs to a DIFFERENT inventory VIN — skipping (this was the mis-match bug)`, 'warn');
      }
      if (!stock) { skipped++; continue; }   // not our car — the auction lists everyone's
      matched++;
      keepStocks.add(stock);
      // Preserve the timestamp only when the car is already at THIS Manheim lot,
      // so "days at Manheim" staleness survives re-uploads but a lot-to-lot move
      // (Denver → Riverside) resets the clock.
      const existing = existingByStock.get(stock);
      const sameSpot = existing && existing.physical_source === 'manheim'
        && existing.physical_location === code && existing.location_updated_at;
      if (sameSpot) preserved++;
      upserts.push({
        stock_number: stock,
        vin,
        physical_location: code,
        physical_source: 'manheim',
        location_updated_at: sameSpot ? existing.location_updated_at : now,
        notes: {
          auction: row.AUCTION || null,
          lane: row['LANE NUMBER'] || null,
          run_number: row['RUN NUMBER'] || null,
          lot_location: row['LOT LOCATION'] || null,
        },
        updated_at: now,
      });
    }
    if (preserved > 0) config.log(`Preserved ${preserved} existing timestamps (cars already at same Manheim lot)`);

    const { ok, err } = await upsertLocations(upserts);
    const cleared = await clearStaleForSource('manheim', keepStocks);
    const tallyStr = Object.entries(lotTally).map(([c, n]) => `${c}:${n}`).join(', ');
    config.log(`Manheim: matched ${matched} of ${lotRows.length} on-lot (skipped ${skipped} non-inventory, ${offsiteSkipped} Offsite), upserted ${ok}, errors ${err}, cleared ${cleared} stale`, 'ok');
    if (tallyStr) config.log(`On-lot by auction — ${tallyStr}`);

    showSummary('manheim', matched, lotRows.length, ok, err, cleared);
    const uploadNotes = upserts.map((u) => ({ stock_number: u.stock_number, lane: u.notes?.lane, lot: u.notes?.lot_location, sale_date: null, grade: null }));
    const locUpdatedByStock = new Map(upserts.map((u) => [u.stock_number, u.location_updated_at]));
    renderAuctionRunListPanel('manheim', [...keepStocks], uploadNotes, [], locUpdatedByStock);
  }

  // ADESA simulcast run list. Different format — has Lane / Run and
  // Location columns; VIN column is upper-case 'VIN'.
  async function handleAdesa(file) {
    // Clear previous results
    const summaryEl = document.getElementById('luSummaryBanner');
    const panelEl = document.getElementById('luMatchedPanel');
    if (summaryEl) summaryEl.innerHTML = '';
    if (panelEl) panelEl.innerHTML = '';
    
    const text = await file.text();
    const rows = parseCSV(text);
    config.log(`Parsed ${rows.length} ADESA rows`);
    const vins = rows.map((r) => (r.VIN || r.Vin || '').toUpperCase()).filter(Boolean);
    const { byVin, byLast6, last6Conflicts } = await fetchInventoryStocksForVins(vins);
    config.log(`Matched ${byVin.size} full VINs against inventory`);
    if (last6Conflicts.size > 0) {
      config.log(`⚠️ Warning: ${last6Conflicts.size} last-6 VINs have multiple matches`, 'warn');
    }
    const now = new Date().toISOString();
    const candidateStocks = [];
    for (const r of rows) {
      const vin = (r.VIN || r.Vin || '').toUpperCase();
      // Try full VIN first, fallback to last6 if needed
      const stock = vin ? byVin.get(vin) : null; // full VIN only — no last-6 fallback
      if (stock) candidateStocks.push(stock);
    }
    const existingByStock = await fetchExistingLocationRows(candidateStocks);
    const upserts = [];
    const keepStocks = new Set();
    const unmatchedVins = [];
    const unmatchedRows = new Map();
    let matched = 0;
    let skipped = 0;
    let preserved = 0;
    for (const r of rows) {
      const vin = (r.VIN || r.Vin || '').toUpperCase();
      if (!vin) { skipped++; continue; }
      
      // Match on the FULL VIN only — never last-6 (see fetchInventoryStocksForVins).
      const stock = byVin.get(vin);
      if (!stock && byLast6.has(last6(vin))) {
        config.log(`↷ ${vin} not in inventory, but its last-6 ${last6(vin)} belongs to a DIFFERENT inventory VIN — skipping (this was the mis-match bug)`, 'warn');
      }
      
      if (!stock) {
        skipped++;
        unmatchedVins.push(vin);
        unmatchedRows.set(vin, r);
        continue;
      }
      matched++;
      keepStocks.add(stock);
      const existing = existingByStock.get(stock);
      const sameSource = existing && existing.physical_source === 'adesa' && existing.location_updated_at;
      if (sameSource) preserved++;
      upserts.push({
        stock_number: stock,
        vin,
        physical_location: 'adesa',
        physical_source: 'adesa',
        location_updated_at: sameSource ? existing.location_updated_at : now,
        notes: {
          lane_run: r['Lane / Run'] || null,
          sale_date: r.Date || null,
          sale_channel: r['Sale Channel'] || null,
          auction_location: r.Location || null,
          grade: r.Grade || null,
          car_value: toNumber(r.CarValue),
        },
        updated_at: now,
      });
    }
    if (preserved > 0) config.log(`Preserved ${preserved} existing timestamps (cars already at ADESA)`);

    // Cross-check unmatched VINs against sold data
    const soldAtAuction = [];
    if (unmatchedVins.length) {
      const [marketplaceSold, localSold] = await Promise.all([
        fetchSoldByVins(unmatchedVins),
        fetchLocalSoldVins(),
      ]);
      for (const vin of unmatchedVins) {
        const mSold = marketplaceSold.get(vin);
        const lSold = localSold.byVin.get(vin); // full VIN only — no last-6 fallback
        if (mSold || lSold) {
          const csvRow = unmatchedRows.get(vin) || {};
          soldAtAuction.push({
            vin,
            stock: (mSold && mSold.stock_number) || (lSold && lSold.stock) || '',
            sold_on: mSold ? mSold.sold_on : 'frazer',
            sold_at: mSold ? mSold.sold_at : null,
            sold_price: mSold ? mSold.sold_price : null,
            buyer_name: mSold ? mSold.buyer_name : null,
            year: (lSold && lSold.year) || csvRow.Year || '',
            make: (lSold && lSold.make) || csvRow.Make || '',
            model: (lSold && lSold.model) || csvRow.Model || '',
            lane_run: csvRow['Lane / Run'] || null,
            sale_date: csvRow.Date || null,
            auction_location: csvRow.Location || null,
          });
        }
      }
    }

    const { ok, err } = await upsertLocations(upserts);
    const cleared = await clearStaleForSource('adesa', keepStocks);
    config.log(`ADESA: matched ${matched} of ${rows.length} (skipped ${skipped} non-inventory), upserted ${ok}, errors ${err}, cleared ${cleared} stale`, 'ok');
    if (soldAtAuction.length) {
      config.log(`${soldAtAuction.length} SOLD car(s) on ADESA run list — pull from auction!`, 'warn');
    }
    showSummary('adesa', matched, rows.length, ok, err, cleared);
    const uploadNotes = upserts.map((u) => ({ stock_number: u.stock_number, lane: u.notes?.lane_run, lot: '', sale_date: u.notes?.sale_date, grade: u.notes?.grade }));
    const locUpdatedByStock = new Map(upserts.map((u) => [u.stock_number, u.location_updated_at]));
    renderAuctionRunListPanel('adesa', [...keepStocks], uploadNotes, soldAtAuction, locUpdatedByStock);
  }

  // SmartAuction inventory export. All statuses in one file — infer
  // status from which date columns are populated. No physical location
  // change; only listing status + sold tracking.
  async function handleSmartAuction(file) {
    // Clear previous results
    const summaryEl = document.getElementById('luSummaryBanner');
    const panelEl = document.getElementById('luMatchedPanel');
    if (summaryEl) summaryEl.innerHTML = '';
    if (panelEl) panelEl.innerHTML = '';
    
    const text = await file.text();
    const rows = parseCSV(text);
    config.log(`Parsed ${rows.length} SmartAuction rows`);
    const vins = rows.map((r) => (r.VIN || r.Vin || '').toUpperCase()).filter(Boolean);
    const { byVin, byLast6, last6Conflicts } = await fetchInventoryStocksForVins(vins);
    config.log(`Matched ${byVin.size} full VINs against inventory`);
    if (last6Conflicts.size > 0) {
      config.log(`⚠️ Warning: ${last6Conflicts.size} last-6 VINs have multiple matches`, 'warn');
    }
    const now = new Date().toISOString();
    let upserts = [];
    // Breakdown buckets
    const activeNotInInv = [];   // SA shows active listing, not in our inventory → ghost listing to pull
    const removedStillInInv = []; // SA removed/hold but still in inventory → Frazer state mismatch
    const soldStillInInv = [];    // SA sold but still in inventory → needs Frazer update
    let matched = 0;
    let skipped = 0;
    let soldCount = 0;
    for (const r of rows) {
      const vin = (r.VIN || r.Vin || '').toUpperCase();
      if (!vin) { skipped++; continue; }
      const saleDate = r['Sale Date'];
      const removalDate = r['Removal Date'];
      const holdDate = r['Hold Date'];
      let saStatus = 'active';
      if (saleDate) saStatus = 'sold';
      else if (removalDate) saStatus = 'removed';
      else if (holdDate) saStatus = 'hold';
      
      // Match on the FULL VIN only — never last-6 (see fetchInventoryStocksForVins).
      const stock = byVin.get(vin);
      if (!stock && byLast6.has(last6(vin))) {
        config.log(`↷ ${vin} not in inventory, but its last-6 ${last6(vin)} belongs to a DIFFERENT inventory VIN — skipping (this was the mis-match bug)`, 'warn');
      }
      if (!stock) {
        skipped++;
        if (saStatus === 'active') {
          activeNotInInv.push({
            vin,
            year: r.Year || r['Vehicle Year'] || '',
            make: r.Make || r['Vehicle Make'] || '',
            model: r.Model || r['Vehicle Model'] || '',
          });
        }
        continue;
      }
      matched++;
      const bucketRow = {
        stock,
        vin,
        year: r.Year || r['Vehicle Year'] || '',
        make: r.Make || r['Vehicle Make'] || '',
        model: r.Model || r['Vehicle Model'] || '',
        saleDate: saleDate || '',
        removalDate: removalDate || '',
      };
      if (saStatus === 'sold') soldStillInInv.push(bucketRow);
      else if (saStatus === 'removed' || saStatus === 'hold') removedStillInInv.push(bucketRow);
      const row = {
        stock_number: stock,
        vin,
        sa_status: saStatus,
        sa_updated_at: now,
        updated_at: now,
      };
      // SmartAuction is just the online listing platform
      // Physical location is set separately when uploading UAX/ADESA run lists
      if (saStatus === 'sold') {
        soldCount++;
        row.sold_on = 'smart_auction';
        row.sold_at = toDateISO(saleDate) || now;
        row.sold_price = toNumber(r['Sale Price']);
        row.buyer_name = r['Buyer Name'] || null;
        // Sold on SA → clear listing status on other marketplaces
        row.manheim_status = 'removed';
        row.manheim_updated_at = now;
        row.ove_status = 'removed';
        row.ove_updated_at = now;
      }
      upserts.push(row);
    }
    // Collapse multiple SA rows for the same car — a relisted unit can appear as
    // both sold and active in one export. ACTIVE always wins so the car stays
    // visible on the marketplace instead of being hidden as sold. Ranking also
    // makes the winning row LAST, which upsertLocations' keep-last dedupe honors.
    const saRank = { sold: 1, removed: 2, hold: 3, active: 4 };
    const winByStock = new Map();
    for (const row of upserts) {
      const prev = winByStock.get(row.stock_number);
      if (!prev || (saRank[row.sa_status] || 0) >= (saRank[prev.sa_status] || 0)) {
        winByStock.set(row.stock_number, row);
      }
    }
    upserts = [...winByStock.values()];
    const { ok, err } = await upsertLocations(upserts);
    config.log(`SmartAuction: matched ${matched} of ${rows.length} (skipped ${skipped}), sold ${soldCount}, upserted ${ok}, errors ${err}`, 'ok');

    // Refresh sa_active_cars from this same report so the marketplace shows the
    // SmartAuction link + Buy-Now price for every active car (one upload does it
    // all — no separate Active-List upload needed). Reuses BuyerMatch's mapping.
    try {
      const mapA = window.BuyerMatchUploader && window.BuyerMatchUploader.mapActive;
      if (mapA) {
        const activeSa = [];
        const seenVin = new Set();
        for (const r of rows) {
          const vin = (r.VIN || r.Vin || '').toUpperCase();
          if (!vin || seenVin.has(vin)) continue;
          if (r['Sale Date'] || r['Removal Date'] || r['Hold Date']) continue; // active only
          seenVin.add(vin);
          const rec = mapA(r);
          if (rec.vin) activeSa.push(rec);
        }
        const saOk = await replaceActiveCars(activeSa);
        config.log(`sa_active_cars: replaced with ${saOk} active cars (SA links + prices)`, 'ok');
      } else {
        config.log('BuyerMatch uploader not loaded — skipped sa_active_cars refresh', 'warn');
      }
    } catch (e) {
      config.log(`sa_active_cars refresh failed: ${e.message}`, 'warn');
    }

    // Accumulate sold buyers into sa_sold_sales (buyer-match training) and push
    // brand-new buyers to GoHighLevel — so ONE SmartAuction report also feeds the
    // buyer pipeline. Without this, sold buyers only landed via the separate Buyer
    // Match "Sold List" button, so daily SMART_AUCTION uploads never fed GHL.
    try {
      const mapS = window.BuyerMatchUploader && window.BuyerMatchUploader.mapSold;
      if (mapS) {
        const soldRows = rows.map(mapS)
          .filter((r) => r.vin && r.buyer_name)
          .sort((a, b) => String(a.sale_date || '').localeCompare(String(b.sale_date || ''))); // oldest→newest, dedupe keeps newest
        const byVinSold = new Map();
        for (const r of soldRows) byVinSold.set(r.vin, r);
        const soldList = [...byVinSold.values()];
        const hdr = (extra) => Object.assign({
          apikey: config.supabaseKey, Authorization: `Bearer ${config.supabaseKey}`,
          'Content-Type': 'application/json',
        }, extra || {});
        let soldSaved = 0;
        for (let i = 0; i < soldList.length; i += 500) {
          const batch = soldList.slice(i, i + 500);
          const res = await fetch(`${config.supabaseUrl}/rest/v1/sa_sold_sales?on_conflict=vin`, {
            method: 'POST', headers: hdr({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
            body: JSON.stringify(batch),
          });
          if (res.ok) soldSaved += batch.length;
          else config.log(`sa_sold_sales batch failed: ${(await res.text()).slice(0, 160)}`, 'warn');
        }
        config.log(`sa_sold_sales: saved ${soldSaved} sold buyer row(s)`, 'ok');
        // New sold rows carry buyer contacts → fire GHL sync (idempotent; only
        // never-contacted buyers get pushed). Best-effort — never blocks the upload.
        if (soldSaved > 0) {
          try {
            const gres = await fetch(`${config.supabaseUrl}/functions/v1/ghl-lead-sync`, {
              method: 'POST', headers: hdr(), body: '{}',
            });
            const gout = await gres.json().catch(() => ({}));
            if (gres.ok && gout.ok) {
              config.log(`GHL: ${gout.pushed} new buyer(s) pushed to GoHighLevel of ${gout.candidates} candidate(s)${gout.failed ? `, ${gout.failed} failed` : ''}`, gout.failed ? 'warn' : 'ok');
            } else {
              config.log(`GHL sync failed: ${gout.error || gres.status}`, 'warn');
            }
          } catch (ge) {
            config.log(`GHL sync failed: ${ge.message}`, 'warn');
          }
        }
      }
    } catch (e) {
      config.log(`sa_sold_sales / GHL sync failed: ${e.message}`, 'warn');
    }

    // Auto-mark active vehicles as listed in the queue
    const activeVehicles = upserts.filter(u => u.sa_status === 'active');
    if (activeVehicles.length > 0) {
      let listedCount = 0;
      try {
        for (const vehicle of activeVehicles) {
          const last6 = vehicle.vin.slice(-6);
          const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/sa_queue_set_status`, { method: 'POST', headers: { apikey: config.supabaseKey, Authorization: `Bearer ${config.supabaseKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_vin6: last6, p_status: 'listed' }) });
          if (response.ok) {
            listedCount++;
            config.log(`Marked ${last6} as listed on SmartAuction`, 'ok');
          }
          // Skip 404s silently - vehicle not in queue
        }
        if (listedCount > 0) {
          config.log(`Auto-marked ${listedCount} vehicles as listed in queue`, 'ok');
        }
      } catch (err) {
        config.log(`Error marking vehicles as listed: ${err.message}`, 'warn');
      }
    }
    
    // Auto-mark hold vehicles as on hold in the queue
    const holdVehicles = upserts.filter(u => u.sa_status === 'hold');
    if (holdVehicles.length > 0) {
      let holdCount = 0;
      try {
        for (const vehicle of holdVehicles) {
          const last6 = vehicle.vin.slice(-6);
          const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/sa_queue_set_status`, { method: 'POST', headers: { apikey: config.supabaseKey, Authorization: `Bearer ${config.supabaseKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_vin6: last6, p_status: 'hold' }) });
          if (response.ok) {
            holdCount++;
            config.log(`Marked ${last6} as on hold`, 'ok');
          }
          // Skip 404s silently - vehicle not in queue
        }
        if (holdCount > 0) {
          config.log(`Auto-marked ${holdCount} vehicles as on hold in queue`, 'ok');
        }
      } catch (err) {
        config.log(`Error marking vehicles as on hold: ${err.message}`, 'warn');
      }
    }
    
    // Auto-mark sold vehicles as sold and remove from queue
    const soldVehicles = upserts.filter(u => u.sa_status === 'sold');
    if (soldVehicles.length > 0) {
      let soldMarkedCount = 0;
      try {
        for (const vehicle of soldVehicles) {
          const last6 = vehicle.vin.slice(-6);
          const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/sa_queue_set_status`, {
            method: 'POST',
            headers: { apikey: config.supabaseKey, Authorization: `Bearer ${config.supabaseKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ p_vin6: last6, p_status: 'sold' })
          });
          if (response.ok) {
            soldMarkedCount++;
            config.log(`Marked ${last6} as sold and removed from queue`, 'ok');
          }
          // Skip 404s silently - vehicle not in queue
        }
        if (soldMarkedCount > 0) {
          config.log(`Auto-removed ${soldMarkedCount} sold vehicles from queue`, 'ok');
        }
      } catch (err) {
        config.log(`Error marking vehicles as sold: ${err.message}`, 'warn');
      }
    }
    
    // Auto-remove vehicles that are removed from SmartAuction
    const removedVehicles = upserts.filter(u => u.sa_status === 'removed');
    if (removedVehicles.length > 0) {
      let removedCount = 0;
      try {
        for (const vehicle of removedVehicles) {
          const last6 = vehicle.vin.slice(-6);
          const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/sa_queue_set_status`, { method: 'POST', headers: { apikey: config.supabaseKey, Authorization: `Bearer ${config.supabaseKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_vin6: last6, p_status: 'removed' }) });
          if (response.ok) {
            removedCount++;
            config.log(`Removed ${last6} from queue (removed from SA)`, 'ok');
          }
          // Skip 404s silently - vehicle not in queue
        }
        if (removedCount > 0) {
          config.log(`Auto-removed ${removedCount} vehicles removed from SA from queue`, 'ok');
        }
      } catch (err) {
        config.log(`Error removing vehicles: ${err.message}`, 'warn');
      }
    }
    
    showSummary('smart_auction', matched, rows.length, ok, err, 0);
    renderSmartAuctionBreakdown({ activeNotInInv, removedStillInInv, soldStillInInv });
    
    // CRITICAL FIX: Update the popup's saListings array so cross-check works correctly
    // The ListUploader updates Supabase but popup.js cross-check needs local saListings
    try {
      // Store the parsed SA data for popup.js cross-check to use
      await chrome.storage.local.set({ 
        saListings: rows,
        saListingsDate: Date.now()
      });
      
      // Also update the status display
      const statusEl = document.getElementById('saExportStatus');
      if (statusEl) {
        statusEl.textContent = `${rows.length} SA vehicles`;
        statusEl.className = 'upload-file-status loaded';
      }
      
      // Notify popup.js if it has a function to refresh
      if (window.refreshSAListings) {
        window.refreshSAListings(rows);
      }
      
      config.log(`Updated saListings for cross-check: ${rows.length} vehicles`, 'ok');
    } catch (err) {
      config.log(`Error updating saListings: ${err.message}`, 'warn');
    }
  }

  function renderSmartAuctionBreakdown({ activeNotInInv, removedStillInInv, soldStillInInv }) {
    const panel = document.getElementById('luMatchedPanel');
    if (!panel) return;
    const rowHtml = (r) => {
      const label = [r.year, r.make, r.model].filter(Boolean).join(' ');
      const stockBit = r.stock ? `${escHtml(r.stock)} — ` : '';
      const vinTail = (r.vin || '').slice(-6);
      return `<div style="padding:2px 0;border-top:1px solid #eee;">• ${stockBit}${escHtml(label)} <span style="color:#888;font-family:monospace;">…${escHtml(vinTail)}</span></div>`;
    };
    const bucket = (title, items, color, bg, slug) => {
      if (!items.length) return `<div style="padding:6px 8px;background:${bg};border-left:3px solid ${color};border-radius:4px;margin-bottom:6px;font-size:11px;color:${color};font-weight:600;">${escHtml(title)}: 0 ✓</div>`;
      const vinsOnly = items.map((r) => r.vin).filter(Boolean).join('\n');
      const stocksOnly = items.map((r) => r.stock).filter(Boolean).join('\n');
      const copyBtns = `<button class="sa-copy-vins btn btn-small" data-payload="${escHtml(vinsOnly)}" style="background:${color};font-size:10px;padding:3px 8px;">Copy VINs</button>` +
        (stocksOnly ? ` <button class="sa-copy-stocks btn btn-small" data-payload="${escHtml(stocksOnly)}" style="background:#444;font-size:10px;padding:3px 8px;">Copy Stock #s</button>` : '') +
        ` <button class="sa-export-bucket btn btn-small" data-slug="${escHtml(slug)}" style="background:#1565c0;font-size:10px;padding:3px 8px;">Export CSV</button>`;
      return `<div style="padding:8px;background:${bg};border-left:3px solid ${color};border-radius:4px;margin-bottom:6px;">
        <div style="font-size:11px;font-weight:700;color:${color};margin-bottom:4px;">${escHtml(title)}: ${items.length}</div>
        <div style="display:flex;gap:4px;margin-bottom:6px;flex-wrap:wrap;">${copyBtns}</div>
        <div style="max-height:150px;overflow-y:auto;font-size:11px;">${items.map(rowHtml).join('')}</div>
      </div>`;
    };
    const bucketMap = {
      'sa-ghost': activeNotInInv,
      'sa-removed': removedStillInInv,
      'sa-sold': soldStillInInv,
    };
    panel.innerHTML =
      bucket('Active on SA but NOT in inventory (ghost listings)', activeNotInInv, '#c62828', '#ffebee', 'sa-ghost') +
      bucket('Removed/Hold on SA but STILL in inventory (Frazer mismatch)', removedStillInInv, '#ef6c00', '#fff3e0', 'sa-removed') +
      bucket('Sold on SA but STILL in inventory (update Frazer)', soldStillInInv, '#6a1b9a', '#f3e5f5', 'sa-sold');
    panel.querySelectorAll('.sa-copy-vins, .sa-copy-stocks').forEach((btn) => {
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(btn.dataset.payload || '').then(() => {
          const orig = btn.textContent;
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = orig; }, 1500);
        });
      });
    });
    panel.querySelectorAll('.sa-export-bucket').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const slug = btn.dataset.slug;
        const items = bucketMap[slug] || [];
        if (!items.length) return;
        const invByStock = await loadInventoryCacheByStock();
        const headers = [
          'Stock #', 'VIN', 'Last 6', 'Year', 'Make', 'Model',
          'SA Sale Date', 'SA Removal Date',
          'Vendor', 'Buyer', 'Days on Lot', 'Location Code',
          'Purchase Date', 'Purchase Notes', 'Vehicle Notes',
        ];
        const lines = [headers.join(',')];
        for (const it of items) {
          const vin = it.vin || '';
          const f = frazerFields(invByStock.get(String(it.stock)));
          lines.push([
            it.stock || '', vin, vin.slice(-6),
            it.year, it.make, it.model,
            it.saleDate || '', it.removalDate || '',
            f.vendor, f.buyer, f.daysOnLot, f.locationCode,
            f.purchaseDate, f.purchaseNotes, f.vehicleNotes,
          ].map(csvEscape).join(','));
        }
        downloadCsv(lines, `smartauction-${slug}-${new Date().toISOString().slice(0, 10)}.csv`);
        const matched = items.filter((it) => invByStock.has(String(it.stock))).length;
        config.log(`Exported ${items.length} rows from ${slug} (${matched} enriched)`, 'ok');
      });
    });
  }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Manheim / OVE combined export. `Account Group` tells us whether the
  // row is Manheim or OVE. `Status` = "Live" etc. Sold tracking is
  // inferred from absence — if a car WAS on the list but isn't anymore,
  // assume it sold elsewhere (or was pulled).
  async function handleManheimOve(file) {
    // Clear previous results
    const summaryEl = document.getElementById('luSummaryBanner');
    const panelEl = document.getElementById('luMatchedPanel');
    if (summaryEl) summaryEl.innerHTML = '';
    if (panelEl) panelEl.innerHTML = '';
    
    const text = await file.text();
    const rows = parseCSV(text);
    config.log(`Parsed ${rows.length} Manheim/OVE rows`);
    const vins = rows.map((r) => (r.VIN || r.Vin || '').toUpperCase()).filter(Boolean);
    const { byVin, byLast6, last6Conflicts } = await fetchInventoryStocksForVins(vins);
    config.log(`Matched ${byVin.size} full VINs against inventory`);
    if (last6Conflicts.size > 0) {
      config.log(`⚠️ Warning: ${last6Conflicts.size} last-6 VINs have multiple matches`, 'warn');
    }
    const now = new Date().toISOString();
    const upserts = [];
    let matched = 0;
    let skipped = 0;
    for (const r of rows) {
      const vin = (r.VIN || r.Vin || '').toUpperCase();
      if (!vin) { skipped++; continue; }
      
      // Match on the FULL VIN only — never last-6 (see fetchInventoryStocksForVins).
      const stock = byVin.get(vin);
      if (!stock && byLast6.has(last6(vin))) {
        config.log(`↷ ${vin} not in inventory, but its last-6 ${last6(vin)} belongs to a DIFFERENT inventory VIN — skipping (this was the mis-match bug)`, 'warn');
      }
      
      if (!stock) { skipped++; continue; }
      matched++;
      const group = (r['Account Group'] || '').toUpperCase();
      const isOve = group.includes('OVE');
      const status = (r.Status || '').toLowerCase() === 'live' ? 'active' : (r.Status || 'unknown').toLowerCase();
      const row = {
        stock_number: stock,
        vin,
        updated_at: now,
      };
      if (isOve) {
        row.ove_status = status;
        row.ove_updated_at = now;
      } else {
        row.manheim_status = status;
        row.manheim_updated_at = now;
      }
      upserts.push(row);
    }
    const { ok, err } = await upsertLocations(upserts);
    config.log(`Manheim/OVE: matched ${matched} of ${rows.length} (skipped ${skipped}), upserted ${ok}, errors ${err}`, 'ok');
    showSummary('manheim/ove', matched, rows.length, ok, err, 0);
    
    // Create breakdown of vehicles (excluding sold)
    const listedOnManheim = [];  // Found in inventory - mark as listed
    const notInInventory = [];   // NOT found in inventory
    let soldCount = 0;
    
    for (const r of rows) {
      const vin = (r.VIN || r.Vin || '').toUpperCase();
      
      // Match on the FULL VIN only — never last-6 (see fetchInventoryStocksForVins).
      const stock = byVin.get(vin);

      const status = (r.Status || '').toLowerCase();
      
      // Skip sold vehicles entirely
      if (status === 'sold') {
        soldCount++;
        continue;
      }
      
      const vehicle = {
        vin: vin,
        stock: stock || '',
        year: r.Year || r['Model Year'] || '',
        make: r.Make || '',
        model: r.Model || '',
        status: r.Status || ''
      };
      
      // Only process Live, Deactivated, Incomplete, or other non-sold statuses
      if (stock) {
        listedOnManheim.push(vehicle);
      } else if (vin) {
        notInInventory.push(vehicle);
      }
    }
    
    config.log(`Filtered out ${soldCount} sold vehicles. ${listedOnManheim.length} listed on Manheim, ${notInInventory.length} not in inventory`);
    
    renderManheimOveBreakdown({ listedOnManheim, notInInventory });
  }
  
  function renderManheimOveBreakdown({ listedOnManheim, notInInventory }) {
    const panel = document.getElementById('luMatchedPanel');
    if (!panel) return;
    
    const rowHtml = (r) => {
      const label = [r.year, r.make, r.model].filter(Boolean).join(' ') || 'Unknown Vehicle';
      const stockBit = r.stock ? `${escHtml(r.stock)} — ` : '';
      const vinTail = (r.vin || '').slice(-6);
      const statusBadge = r.status ? ` <span style="padding:1px 4px;background:#666;color:#fff;border-radius:3px;font-size:9px;">${escHtml(r.status)}</span>` : '';
      return `<div style="padding:2px 0;border-top:1px solid #eee;">• ${stockBit}${escHtml(label)} <span style="color:#888;font-family:monospace;">…${escHtml(vinTail)}</span>${statusBadge}</div>`;
    };
    
    const bucket = (title, items, color, bg) => {
      if (!items.length) return `<div style="padding:6px 8px;background:${bg};border-left:3px solid ${color};border-radius:4px;margin-bottom:6px;font-size:11px;color:${color};font-weight:600;">✓ ${escHtml(title)}: 0</div>`;
      
      const vinsOnly = items.map((r) => r.vin).filter(Boolean).join('\n');
      const stocksOnly = items.map((r) => r.stock).filter(Boolean).join('\n');
      const copyBtns = `<button class="mh-copy-vins btn btn-small" data-payload="${escHtml(vinsOnly)}" style="background:${color};font-size:10px;padding:3px 8px;">Copy VINs</button>` +
        (stocksOnly ? ` <button class="mh-copy-stocks btn btn-small" data-payload="${escHtml(stocksOnly)}" style="background:#444;font-size:10px;padding:3px 8px;">Copy Stock #s</button>` : '');
      
      return `<div style="padding:8px;background:${bg};border-left:3px solid ${color};border-radius:4px;margin-bottom:6px;">
        <div style="font-size:11px;font-weight:700;color:${color};margin-bottom:4px;">${escHtml(title)}: ${items.length}</div>
        <div style="display:flex;gap:4px;margin-bottom:6px;flex-wrap:wrap;">${copyBtns}</div>
        <div style="max-height:150px;overflow-y:auto;font-size:11px;">${items.map(rowHtml).join('')}</div>
      </div>`;
    };
    
    panel.innerHTML =
      bucket('Listed on Manheim/OVE (In Inventory)', listedOnManheim, '#00695c', '#e0f2f1') +
      bucket('NOT Found in Inventory', notInInventory, '#c62828', '#ffebee');
    
    // Add click handlers for copy buttons
    panel.querySelectorAll('.mh-copy-vins, .mh-copy-stocks').forEach((btn) => {
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(btn.dataset.payload || '').then(() => {
          const orig = btn.textContent;
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = orig; }, 1500);
        });
      });
    });
  }

  // Super Dispatch audit. No writes — produces a report of Frazer cars
  // with location='Z' that are NOT present in the uploaded dispatch file.
  // The user fixes those in Frazer directly.
  async function handleSuperDispatch(file) {
    // Clear previous results
    const summaryEl = document.getElementById('luSummaryBanner');
    const panelEl = document.getElementById('luMatchedPanel');
    if (summaryEl) summaryEl.innerHTML = '';
    if (panelEl) panelEl.innerHTML = '';
    
    const text = await file.text();
    const rows = parseCSV(text);
    config.log(`Parsed ${rows.length} Super Dispatch rows`);

    // Dedupe by VIN, keep most recent order by Created Date
    const latestByVin = new Map();
    for (const r of rows) {
      const vin = (r['VIN #'] || r.VIN || '').toUpperCase();
      if (!vin) continue;
      const prev = latestByVin.get(vin);
      const created = toDateISO(r['Created Date']);
      if (!prev || (created && created > prev._createdISO)) {
        latestByVin.set(vin, { ...r, _createdISO: created });
      }
    }

    // "Missing from dispatch" = Z-cars with NO row in the file at all. A
    // Delivered/Completed/Canceled row still counts as "the dispatch side
    // was handled" — any remaining inconsistency is a stale Frazer record,
    // not a missing dispatch. So match against every unique VIN, not just
    // active ones.
    const dispatchedVins = new Set(latestByVin.keys());
    const activeCount = [...latestByVin.values()].filter((r) => {
      const s = (r.Status || '').toLowerCase().trim();
      return s !== 'completed' && s !== 'canceled' && s !== 'cancelled' && s !== 'delivered' && s !== 'archived' && s !== 'closed';
    }).length;
    config.log(`${dispatchedVins.size} unique VINs in dispatch file (${activeCount} still active)`);

    // Fetch Frazer cars where location_code='Z' via the SECURITY DEFINER
    // RPC (anon SELECT on inventory is blocked by RLS).
    const invRes = await fetch(`${config.supabaseUrl}/rest/v1/rpc/inventory_at_location`, {
      method: 'POST',
      headers: {
        apikey: config.supabaseKey,
        Authorization: `Bearer ${config.supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ loc: 'Z' }),
    });
    if (!invRes.ok) {
      config.log('Frazer Z-location RPC failed: ' + invRes.status + ' ' + (await invRes.text()).slice(0, 200), 'err');
      return;
    }
    const zCars = await invRes.json();
    config.log(`${zCars.length} Frazer cars at location Z`);

    const missed = [];
    const dispatchedMatches = [];   // ANY Z-car with a row in the dispatch file (active or closed)
    for (const car of zCars) {
      const vin = (car.vehicle_vin || '').toUpperCase();
      if (!vin) continue;
      if (!dispatchedVins.has(vin)) { missed.push(car); continue; }
      const dispatch = latestByVin.get(vin);
      dispatchedMatches.push({ car, dispatch });
    }

    // Write physical_location='in_transit' + pickup/delivery metadata for
    // EVERY matched Z-car — active or closed. Frazer's Z state persists
    // until inspection, so a Delivered/Completed dispatch is still "in transit
    // from Frazer's perspective" until Frazer flips it to M/J. This way the
    // webapp's "needs dispatch" count matches the extension's audit exactly.
    if (dispatchedMatches.length) {
      const stocks = dispatchedMatches.map(({car}) => car.stock_number);
      const existingLoc = await fetchExistingLocationRows(stocks);
      const now = new Date().toISOString();
      const upserts = dispatchedMatches.map(({car, dispatch}) => {
        const existing = existingLoc.get(car.stock_number);
        const sameSource = existing && existing.physical_source === 'super_dispatch' && existing.location_updated_at;
        // Stamp the REAL date the car went in transit, not "now". A dispatch row
        // can be a month old; stamping now() would make it look freshly in
        // transit and (under newest-wins) wrongly beat a more recent location.
        // Priority: actually picked up > scheduled pickup > dispatch created.
        const eventISO = toDateISO(dispatch['Pickup Completed At'])
          || toDateISO(dispatch['Pickup Scheduled At'])
          || dispatch._createdISO
          || now;
        return {
          stock_number: car.stock_number,
          vin: car.vehicle_vin || '',
          physical_location: 'in_transit',
          physical_source: 'super_dispatch',
          location_updated_at: sameSource ? existing.location_updated_at : eventISO,
          updated_at: now,
          notes: {
            status: dispatch.Status || null,
            created_date: dispatch['Created Date'] || null,
            pickup_business: dispatch['Pickup Business Name'] || null,
            pickup_city: dispatch['Pickup City'] || null,
            pickup_state: dispatch['Pickup State'] || null,
            pickup_scheduled_at: dispatch['Pickup Scheduled At'] || null,
            pickup_completed_at: dispatch['Pickup Completed At'] || null,
            delivery_business: dispatch['Delivery Business Name'] || null,
            delivery_city: dispatch['Delivery City'] || null,
            delivery_state: dispatch['Delivery State'] || null,
            delivery_scheduled_at: dispatch['Delivery Scheduled At'] || null,
            tariff: dispatch['Tariff Per Vehicle'] || null,
            order_id: dispatch['Order ID'] || null,
            lot_number: dispatch['Lot Number'] || null,
          },
        };
      });
      const { ok, err } = await upsertLocations(upserts);
      config.log(`Super Dispatch: wrote in_transit for ${ok} of ${dispatchedMatches.length} matched Z-cars${err ? ` (${err} errors)` : ''}`, 'ok');
    }
    if (missed.length === 0) {
      config.log(`Super Dispatch audit: all Z-location cars have active dispatches ✓`, 'ok');
      showSummary('super_dispatch', zCars.length, zCars.length, 0, 0, 0);
      const panel = document.getElementById('luMatchedPanel');
      if (panel) panel.innerHTML = `<div style="padding:8px;background:#e8f5e9;border-radius:4px;font-size:11px;color:#2e7d32;font-weight:600;">All ${zCars.length} location-Z cars have active dispatches ✓</div>`;
      return;
    }
    config.log(`Super Dispatch audit: ${missed.length} Z-location cars MISSING from dispatch:`, 'warn');

    // Enrich missed cars with Frazer days_on_lot (age sitting at Z with no
    // dispatch) so we can sort/highlight forgotten cars.
    const invByStock = await loadInventoryCacheByStock();
    for (const car of missed) {
      const inv = invByStock.get(String(car.stock_number)) || {};
      const raw = inv.days_on_lot ?? inv['Days on lot'] ?? inv['DaysOnLot'] ?? inv.daysOnLot;
      car._daysOnLot = (raw === '' || raw == null) ? null : parseInt(String(raw), 10);
    }
    missed.sort((a, b) => (b._daysOnLot ?? -1) - (a._daysOnLot ?? -1));
    const stuck = missed.filter((c) => (c._daysOnLot ?? 0) >= 7);

    const panel = document.getElementById('luMatchedPanel');
    if (panel) {
      let html = `<div style="padding:8px;background:#fff3e0;border-left:3px solid #ef6c00;border-radius:4px;">`;
      html += `<div style="font-size:11px;font-weight:700;color:#ef6c00;margin-bottom:4px;">⚠ ${missed.length} location-Z cars NOT dispatched${stuck.length ? ` · <span style="color:#c62828;">${stuck.length} stuck &ge;7d at Z</span>` : ''}</div>`;
      html += `<div style="display:flex;gap:4px;margin-bottom:6px;">`;
      html += `<button id="luCopyStocks" class="btn btn-small" style="background:#ef6c00;font-size:10px;padding:3px 8px;">Copy Stock #s</button>`;
      html += `<button id="luCopyMissedVins" class="btn btn-small" style="background:#6a1b9a;font-size:10px;padding:3px 8px;">Copy VINs</button>`;
      html += `<button id="luExportMissedCsv" class="btn btn-small" style="background:#1565c0;font-size:10px;padding:3px 8px;">Export CSV</button>`;
      html += `</div>`;
      html += `<div style="max-height:150px;overflow-y:auto;font-size:10px;">`;
      for (const car of missed) {
        const label = [car.vehicle_year, car.vehicle_make, car.vehicle_model].filter(Boolean).join(' ');
        const d = car._daysOnLot;
        const ageBit = d == null ? '' : d >= 7
          ? ` <span style="color:#c62828;font-weight:700;">(${d}d)</span>`
          : ` <span style="color:#888;">(${d}d)</span>`;
        const bg = d != null && d >= 7 ? 'background:#fff5f5;' : '';
        html += `<div style="padding:2px 0;border-top:1px solid #ffe0b2;${bg}">• ${car.stock_number} — ${label} (…${(car.vehicle_vin || '').slice(-6)})${ageBit}</div>`;
      }
      html += `</div></div>`;
      panel.innerHTML = html;

      document.getElementById('luCopyStocks')?.addEventListener('click', () => {
        const stocks = missed.map((c) => c.stock_number).join('\n');
        navigator.clipboard.writeText(stocks).then(() => config.log(`Copied ${missed.length} stock numbers`, 'ok'));
      });
      document.getElementById('luCopyMissedVins')?.addEventListener('click', () => {
        const vins = missed.map((c) => c.vehicle_vin).filter(Boolean).join('\n');
        navigator.clipboard.writeText(vins).then(() => config.log(`Copied ${missed.length} VINs`, 'ok'));
      });
      document.getElementById('luExportMissedCsv')?.addEventListener('click', async () => {
        const headers = [
          'Stock #', 'VIN', 'Last 6', 'Year', 'Make', 'Model', 'Color', 'Mileage',
          'Location Code', 'Vendor', 'Days on Lot', 'Stuck >=7d', 'Buyer',
          'Purchase Date', 'Purchase Notes', 'Vehicle Notes',
        ];
        const lines = [headers.join(',')];
        for (const car of missed) {
          const vin = car.vehicle_vin || '';
          const inv = invByStock.get(String(car.stock_number)) || {};
          const f = frazerFields(inv);
          const d = car._daysOnLot;
          lines.push([
            car.stock_number, vin, vin.slice(-6),
            car.vehicle_year, car.vehicle_make, car.vehicle_model,
            car.vehicle_color || inv.vehicle_color || inv['Vehicle Color'] || '',
            car.mileage || inv.mileage || inv['Mileage'] || '',
            car.location_code || f.locationCode || 'Z',
            f.vendor, f.daysOnLot,
            d != null && d >= 7 ? 'YES' : '',
            f.buyer, f.purchaseDate, f.purchaseNotes, f.vehicleNotes,
          ].map(csvEscape).join(','));
        }
        downloadCsv(lines, `missing-from-dispatch-${new Date().toISOString().slice(0, 10)}.csv`);
        const enriched = missed.filter((c) => invByStock.has(String(c.stock_number))).length;
        config.log(`Exported ${missed.length} missing cars (${enriched} enriched, ${stuck.length} stuck >=7d)`, 'ok');
      });
    }
    showSummary('super_dispatch', zCars.length - missed.length, zCars.length, 0, 0, 0);
  }

  // ── UI binding ──────────────────────────────────────────────────────

  function bindUI(cfg) {
    config.supabaseUrl = cfg.supabaseUrl;
    config.supabaseKey = cfg.supabaseKey;

    const logEl = document.getElementById('luLog');
    config.log = (msg, level = 'info') => {
      if (!logEl) { console.log('[ListUploader]', msg); return; }
      const color = level === 'ok' ? '#2e7d32' : level === 'err' ? '#c62828' : level === 'warn' ? '#ef6c00' : '#555';
      const line = document.createElement('div');
      line.style.color = color;
      const ts = new Date().toLocaleTimeString();
      line.textContent = `[${ts}] ${msg}`;
      logEl.appendChild(line);
      logEl.scrollTop = logEl.scrollHeight;
    };

    const bind = (inputId, statusId, handler) => {
      const input = document.getElementById(inputId);
      const status = document.getElementById(statusId);
      if (!input) return;
      input.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (status) status.textContent = file.name;
        config.log(`Uploading ${file.name}…`);
        try {
          await handler(file);
        } catch (err) {
          config.log('Error: ' + err.message, 'err');
          console.error('[ListUploader]', err);
        } finally {
          // Clear input so re-picking the same file retriggers change
          e.target.value = '';
        }
      });
    };

    bind('luSaInput', 'luSaStatus', handleSmartAuction);
    bind('luManheimInput', 'luManheimStatus', handleManheimOve);
    bind('luManheimAuctionInput', 'luManheimAuctionStatus', handleManheimAuction);
    bind('luUaxInput', 'luUaxStatus', (f) => handleEdgePipeline(f, 'uax'));
    bind('luUaxPostSaleInput', 'luUaxPostSaleStatus', handleUaxPostSale);
    bind('luDaaInput', 'luDaaStatus', (f) => handleEdgePipeline(f, 'daa'));
    bind('luDaaPostSaleInput', 'luDaaPostSaleStatus', handleDaaPostSale);
    bind('luDaaRockiesInput', 'luDaaRockiesStatus', (f) => handleEdgePipeline(f, 'daa_rockies'));
    bind('luAdesaInput', 'luAdesaStatus', handleAdesa);
    bind('luDispatchInput', 'luDispatchStatus', handleSuperDispatch);
  }

  function showSummary(source, matched, total, upserted, errors, staleCleared) {
    const el = document.getElementById('luSummaryBanner');
    if (!el) return;
    const color = errors > 0 ? '#c62828' : '#00695c';
    const bg = errors > 0 ? '#ffebee' : '#e0f2f1';
    // Super Dispatch is an audit (no upserts). Phrase the banner differently
    // so "0 upserted" doesn't look like a failure.
    const body = source === 'super_dispatch'
      ? `${matched} of ${total} Z-location cars on dispatch file${total - matched > 0 ? ` · ${total - matched} need dispatch` : ' ✓'}`
      : `${matched} of ${total} matched inventory · ${upserted} upserted${errors ? ` · ${errors} errors` : ''}${staleCleared ? ` · ${staleCleared} cleared stale` : ''}`;
    const div = document.createElement('div');
    div.style.cssText = `padding:6px 10px;border-radius:4px;background:${bg};border-left:3px solid ${color};font-size:11px;line-height:1.4;position:relative;`;
    div.innerHTML = `<strong style="color:${color};">${source.toUpperCase()}</strong> — ${body}
      <span style="float:right;cursor:pointer;color:#999;" class="close-banner">✕</span>`;
    el.innerHTML = '';
    el.appendChild(div);
    div.querySelector('.close-banner').addEventListener('click', () => div.remove());
  }

  // ── Matched cars panel + Export CSV + Copy VINs ──────────────────

  async function fetchRunListDetails(stocks) {
    const url = `${config.supabaseUrl}/rest/v1/rpc/run_list_details`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: config.supabaseKey,
        Authorization: `Bearer ${config.supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ stock_list: stocks }),
    });
    if (!res.ok) return [];
    return res.json();
  }

  function renderMatchedPanel(source, matchedStocks, uploadNotes) {
    const container = document.getElementById('luMatchedPanel');
    if (!container) return;
    if (matchedStocks.length === 0) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = '<div style="text-align:center;font-size:11px;color:#888;">Loading details…</div>';

    fetchRunListDetails(matchedStocks).then((rows) => {
      // Merge upload-time notes (lane/lot/sale_date) into each row
      const noteMap = new Map();
      for (const n of uploadNotes) noteMap.set(n.stock_number, n);

      let html = `<div style="font-size:11px;font-weight:700;color:#00695c;margin-bottom:4px;">${source.toUpperCase()} — ${rows.length} Carz Inc cars</div>`;
      html += `<div style="display:flex;gap:4px;margin-bottom:6px;">`;
      html += `<button id="luExportCsv" class="btn btn-small" style="background:#1565c0;font-size:10px;padding:3px 8px;">Export CSV</button>`;
      html += `<button id="luCopyVins" class="btn btn-small" style="background:#6a1b9a;font-size:10px;padding:3px 8px;">Copy VINs</button>`;
      html += `</div>`;
      html += `<div style="max-height:200px;overflow-y:auto;font-size:10px;"><table style="width:100%;border-collapse:collapse;">`;
      html += `<tr style="background:#f0f0f0;font-weight:700;"><td>Stock</td><td>VIN</td><td>Vehicle</td><td>Miles</td><td>Cost</td><td>Lane</td></tr>`;
      for (const r of rows) {
        const n = noteMap.get(r.stock_number) || {};
        const vehicle = [r.vehicle_year, r.vehicle_make, r.vehicle_model].filter(Boolean).join(' ');
        const cost = r.total_cost ? '$' + Number(String(r.total_cost).replace(/[^0-9.-]/g, '')).toLocaleString() : '—';
        html += `<tr style="border-top:1px solid #e0e0e0;">`;
        html += `<td>${r.stock_number || ''}</td>`;
        html += `<td style="font-family:monospace;font-size:9px;">${(r.vehicle_vin || '').slice(-6)}</td>`;
        html += `<td>${vehicle}</td>`;
        html += `<td>${r.mileage || ''}</td>`;
        html += `<td>${cost}</td>`;
        html += `<td>${n.lane || ''} ${n.lot || ''}</td>`;
        html += `</tr>`;
      }
      html += `</table></div>`;
      container.innerHTML = html;

      // Export CSV
      document.getElementById('luExportCsv').addEventListener('click', () => {
        const headers = ['Stock', 'VIN', 'Year', 'Make', 'Model', 'Color', 'Mileage', 'Total Cost', 'Added Costs', 'Days on Lot', 'Lane', 'Lot', 'Sale Date', 'Grade'];
        const csvRows = [headers.join(',')];
        for (const r of rows) {
          const n = noteMap.get(r.stock_number) || {};
          csvRows.push([
            r.stock_number, r.vehicle_vin, r.vehicle_year, r.vehicle_make, r.vehicle_model,
            r.vehicle_color, r.mileage, r.total_cost, r.added_costs, r.days_on_lot,
            n.lane || '', n.lot || '', n.sale_date || '', n.grade || '',
          ].map((v) => `"${(v || '').toString().replace(/"/g, '""')}"`).join(','));
        }
        const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${source}-run-list-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        config.log(`Exported ${rows.length} rows to CSV`, 'ok');
      });

      // Copy VINs
      document.getElementById('luCopyVins').addEventListener('click', () => {
        const vins = rows.map((r) => r.vehicle_vin).filter(Boolean).join('\n');
        navigator.clipboard.writeText(vins).then(() => {
          config.log(`Copied ${rows.length} VINs to clipboard`, 'ok');
          const btn = document.getElementById('luCopyVins');
          if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy VINs'; }, 1500); }
        });
      });
    });
  }

  // ── Auction Run List panel — sold bucket + active inventory ─────────

  // Days between an ISO timestamp and now, rounded down. Returns '' for null.
  function daysSince(iso) {
    if (!iso) return '';
    const ms = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(ms) || ms < 0) return '';
    return Math.floor(ms / 86400000);
  }

  function renderAuctionRunListPanel(source, activeStocks, uploadNotes, soldAtAuction, locUpdatedByStock) {
    locUpdatedByStock = locUpdatedByStock || new Map();
    const container = document.getElementById('luMatchedPanel');
    if (!container) return;
    if (activeStocks.length === 0 && soldAtAuction.length === 0) {
      container.innerHTML = '';
      return;
    }

    let soldHtml = '';

    // ── Sold cars bucket (red) ──
    if (soldAtAuction.length > 0) {
      const soldVins = soldAtAuction.map((s) => s.vin).filter(Boolean).join('\n');
      const soldStocks = soldAtAuction.map((s) => s.stock).filter(Boolean).join('\n');
      soldHtml += `<div style="padding:8px;background:#ffebee;border-left:3px solid #c62828;border-radius:4px;margin-bottom:6px;">`;
      soldHtml += `<div style="font-size:11px;font-weight:700;color:#c62828;margin-bottom:4px;">SOLD — Pull from Auction: ${soldAtAuction.length}</div>`;
      soldHtml += `<div style="display:flex;gap:4px;margin-bottom:6px;">`;
      soldHtml += `<button class="lu-copy-sold-vins btn btn-small" data-payload="${escHtml(soldVins)}" style="background:#c62828;font-size:10px;padding:3px 8px;">Copy VINs</button>`;
      if (soldStocks) {
        soldHtml += `<button class="lu-copy-sold-vins btn btn-small" data-payload="${escHtml(soldStocks)}" style="background:#444;font-size:10px;padding:3px 8px;">Copy Stock #s</button>`;
      }
      soldHtml += `</div>`;
      soldHtml += `<div style="max-height:150px;overflow-y:auto;font-size:10px;">`;
      for (const s of soldAtAuction) {
        const label = [s.year, s.make, s.model].filter(Boolean).join(' ');
        const stockBit = s.stock ? `${escHtml(s.stock)} — ` : '';
        const vinTail = (s.vin || '').slice(-6);
        const soldLabel = s.sold_on === 'frazer' ? 'Frazer'
          : s.sold_on === 'smart_auction' ? 'SmartAuction'
          : s.sold_on === 'manheim' ? 'Manheim'
          : s.sold_on === 'ove' ? 'OVE' : (s.sold_on || 'Unknown');
        const dateBit = s.sold_at ? ` (${new Date(s.sold_at).toLocaleDateString()})` : '';
        const priceBit = s.sold_price ? ` $${Number(s.sold_price).toLocaleString()}` : '';
        const buyerBit = s.buyer_name ? ` → ${escHtml(s.buyer_name)}` : '';
        const runInfo = [s.lane, s.lane_run, s.lot, s.run_number].filter(Boolean);
        const runBit = runInfo.length ? ` | ${runInfo.map(escHtml).join(' ')}` : '';
        soldHtml += `<div style="padding:3px 0;border-top:1px solid #ffcdd2;">`;
        soldHtml += `<span style="font-weight:600;">• ${stockBit}${label ? escHtml(label) + ' ' : ''}</span><span style="color:#888;font-family:monospace;">…${escHtml(vinTail)}</span>`;
        soldHtml += `<div style="font-size:9px;color:#c62828;margin-left:10px;">Sold on ${soldLabel}${dateBit}${priceBit}${buyerBit}${runBit}</div>`;
        soldHtml += `</div>`;
      }
      soldHtml += `</div></div>`;
    }

    // ── Active inventory bucket (green) ──
    if (activeStocks.length === 0) {
      container.innerHTML = soldHtml;
      bindCopyButtons(container);
      return;
    }

    container.innerHTML = soldHtml + '<div style="text-align:center;font-size:11px;color:#888;">Loading inventory details…</div>';
    bindCopyButtons(container);

    fetchRunListDetails(activeStocks).then((rows) => {
      const noteMap = new Map();
      for (const n of uploadNotes) noteMap.set(n.stock_number, n);

      // Sort by lane, then run/lot number — the physical order cars run at the
      // sale, so the list can be walked lane-by-lane. Numeric where possible
      // (lot "0029" → 29); anything without a lane/run falls to the bottom.
      // Stuck cars are still flagged red + counted below, just not floated up.
      const laneRunKey = (v) => {
        const s = String(v == null ? '' : v).trim();
        if (!s) return { n: Infinity, s: '' };
        const m = s.match(/\d+/);
        return { n: m ? parseInt(m[0], 10) : Infinity, s: s.toUpperCase() };
      };
      rows.sort((a, b) => {
        const na = noteMap.get(a.stock_number) || {};
        const nb = noteMap.get(b.stock_number) || {};
        const la = laneRunKey(na.lane), lb = laneRunKey(nb.lane);
        if (la.n !== lb.n) return la.n - lb.n;
        if (la.s !== lb.s) return la.s.localeCompare(lb.s);
        const ra = laneRunKey(na.lot), rb = laneRunKey(nb.lot);
        if (ra.n !== rb.n) return ra.n - rb.n;
        return ra.s.localeCompare(rb.s);
      });
      const stuck = rows.filter((r) => {
        const d = daysSince(locUpdatedByStock.get(r.stock_number));
        return d !== '' && d >= 7;
      });

      let activeHtml = `<div style="padding:8px;background:#e0f2f1;border-left:3px solid #00695c;border-radius:4px;">`;
      activeHtml += `<div style="font-size:11px;font-weight:700;color:#00695c;margin-bottom:4px;">${source.toUpperCase()} — ${rows.length} Carz Inc cars${stuck.length ? ` · <span style="color:#c62828;">${stuck.length} stuck &ge;7d</span>` : ''}</div>`;
      activeHtml += `<div style="display:flex;gap:4px;margin-bottom:6px;">`;
      activeHtml += `<button id="luAucExportCsv" class="btn btn-small" style="background:#1565c0;font-size:10px;padding:3px 8px;">Export CSV</button>`;
      activeHtml += `<button id="luAucCopyVins" class="btn btn-small" style="background:#6a1b9a;font-size:10px;padding:3px 8px;">Copy VINs</button>`;
      activeHtml += `</div>`;
      activeHtml += `<div style="max-height:200px;overflow-y:auto;font-size:10px;"><table style="width:100%;border-collapse:collapse;">`;
      activeHtml += `<tr style="background:#f0f0f0;font-weight:700;"><td>Stock</td><td>VIN</td><td>Vehicle</td><td>Miles</td><td>Cost</td><td>Age</td><td>Lane</td></tr>`;
      for (const r of rows) {
        const n = noteMap.get(r.stock_number) || {};
        const vehicle = [r.vehicle_year, r.vehicle_make, r.vehicle_model].filter(Boolean).join(' ');
        const cost = r.total_cost ? '$' + Number(String(r.total_cost).replace(/[^0-9.-]/g, '')).toLocaleString() : '—';
        const ageDays = daysSince(locUpdatedByStock.get(r.stock_number));
        const ageCell = ageDays === '' ? '—'
          : ageDays >= 7 ? `<span style="color:#c62828;font-weight:700;">${ageDays}d</span>`
          : `${ageDays}d`;
        activeHtml += `<tr style="border-top:1px solid #e0e0e0;${ageDays !== '' && ageDays >= 7 ? 'background:#fff5f5;' : ''}">`;
        activeHtml += `<td>${r.stock_number || ''}</td>`;
        activeHtml += `<td style="font-family:monospace;font-size:9px;">${(r.vehicle_vin || '').slice(-6)}</td>`;
        activeHtml += `<td>${vehicle}</td>`;
        activeHtml += `<td>${r.mileage || ''}</td>`;
        activeHtml += `<td>${cost}</td>`;
        activeHtml += `<td>${ageCell}</td>`;
        activeHtml += `<td>${n.lane || ''} ${n.lot || ''}</td>`;
        activeHtml += `</tr>`;
      }
      activeHtml += `</table></div></div>`;

      container.innerHTML = soldHtml + activeHtml;
      bindCopyButtons(container);

      // CSV export — enriched with vendor/buyer/purchase_date/notes from the
      // locally cached Frazer inventory + age-at-source (days since the car
      // first appeared at this auction; preserved across re-uploads so stuck
      // cars surface).
      document.getElementById('luAucExportCsv')?.addEventListener('click', async () => {
        const invByStock = await loadInventoryCacheByStock();
        const headers = [
          'Stock', 'VIN', 'Year', 'Make', 'Model', 'Color', 'Mileage',
          'Total Cost', 'Added Costs', 'Days on Lot', 'Location Code',
          'Days at Source', 'Status Started', 'Stuck >=7d',
          'Vendor', 'Buyer', 'Purchase Date', 'Purchase Notes', 'Vehicle Notes',
          'Lane', 'Lot', 'Sale Date', 'Grade',
        ];
        const csvRows = [headers.join(',')];
        for (const r of rows) {
          const n = noteMap.get(r.stock_number) || {};
          const f = frazerFields(invByStock.get(String(r.stock_number)));
          const locIso = locUpdatedByStock.get(r.stock_number) || '';
          const ageDays = daysSince(locIso);
          csvRows.push([
            r.stock_number, r.vehicle_vin, r.vehicle_year, r.vehicle_make, r.vehicle_model,
            r.vehicle_color, r.mileage,
            r.total_cost, r.added_costs, r.days_on_lot || f.daysOnLot, r.location_code || f.locationCode,
            ageDays === '' ? '' : ageDays,
            locIso ? locIso.slice(0, 10) : '',
            ageDays !== '' && ageDays >= 7 ? 'YES' : '',
            f.vendor, f.buyer, f.purchaseDate, f.purchaseNotes, f.vehicleNotes,
            n.lane || '', n.lot || '', n.sale_date || '', n.grade || '',
          ].map(csvEscape).join(','));
        }
        downloadCsv(csvRows, `${source}-run-list-${new Date().toISOString().slice(0, 10)}.csv`);
        const matched = rows.filter((r) => invByStock.has(String(r.stock_number))).length;
        config.log(`Exported ${rows.length} rows (${matched} enriched with vendor/age)`, 'ok');
      });

      // Copy active VINs
      document.getElementById('luAucCopyVins')?.addEventListener('click', () => {
        const vins = rows.map((r) => r.vehicle_vin).filter(Boolean).join('\n');
        navigator.clipboard.writeText(vins).then(() => {
          config.log(`Copied ${rows.length} VINs to clipboard`, 'ok');
          const btn = document.getElementById('luAucCopyVins');
          if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy VINs'; }, 1500); }
        });
      });
    });
  }

  function bindCopyButtons(container) {
    container.querySelectorAll('.lu-copy-sold-vins').forEach((btn) => {
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(btn.dataset.payload || '').then(() => {
          const orig = btn.textContent;
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = orig; }, 1500);
        });
      });
    });
  }

  window.ListUploader = { bindUI };
})();
