// SmartAuction Auto-Fill — Popup Controller
// Manages 5-step wizard, photo uploads, AI analysis, and form fill orchestration

(function () {
  'use strict';

  // ── State ──
  let currentStep = 1;
  let currentMode = 'queue'; // 'queue' or 'wizard'
  let exteriorPhotos = []; // { dataUrl, resizedBase64 } — walk-around, interior, tires
  let damagePhotos = [];   // { dataUrl, resizedBase64 } — close-ups + panel shots, sent to AI
  let damages = [];
  let inventory = [];
  let matchedVehicle = null;
  let manheimOdoSet = false; // true when odometer came from Manheim import
  let queueData = [];
  let activeFilter = 'ready';
  let saListings = [];
  let soldData = [];
  let crossCheckData = null;
  // parsedAuctionVins removed — auction paste flow deleted
  let queueSearchFilter = '';

  // ── DOM refs ──
  const statusDiv = document.getElementById('status');
  const stepIndicators = document.querySelectorAll('.steps .step');
  const stepContents = document.querySelectorAll('.step-content');

  // Power Apps
  const powerAppsInventoryUrlInput = document.getElementById('powerAppsInventoryUrl');
  const powerAppsSoldUrlInput = document.getElementById('powerAppsSoldUrl');
  const savePowerAppsBtn = document.getElementById('savePowerApps');
  const powerAppsStatusDiv = document.getElementById('powerAppsStatus');
  const syncPowerAppsBtn = document.getElementById('syncPowerAppsBtn');
  const syncPowerAppsSoldBtn = document.getElementById('syncPowerAppsSoldBtn');
  const powerAppsBadge = document.getElementById('powerAppsBadge');
  const powerAppsSyncResult = document.getElementById('powerAppsSyncResult');

  // Scraper
  const scrapeBtn = document.getElementById('scrapeBtn');
  const scraperStatus = document.getElementById('scraperStatus');
  const scrapeResult = document.getElementById('scrapeResult');
  const scraperDates = document.getElementById('scraperDates');
  const toggleScrapeDates = document.getElementById('toggleScrapeDates');
  const scrapeStart = document.getElementById('scrapeStart');
  const scrapeEnd = document.getElementById('scrapeEnd');
  const scrapeDateBtn = document.getElementById('scrapeDateBtn');
  const msgLookupBtn = document.getElementById('msgLookupBtn');
  const msgLookupResult = document.getElementById('msgLookupResult');

  const SCRAPER_URL = 'http://localhost:7749';

  // Carz Inc inspection PWA (Supabase) — source of completed inspections
  const SUPABASE_URL = 'https://yprihgygmreibcuybwoy.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlwcmloZ3lnbXJlaWJjdXlid295Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzODYzNTAsImV4cCI6MjA4ODk2MjM1MH0.L1oDMq7wYnyZwjZOYcYhNvrP0I5wFxf5BZPAwRM3m0o';
  let supabaseCompleted = []; // completed inspections pulled from the PWA
  let inventoryCostByLast6 = new Map(); // last_6_vin → { totalCost, addedCosts, daysOnLot }

  // Flip `inspections.skipped_at` on the server so the skip is cross-device.
  // Updates the in-memory record so the list re-renders immediately.
  async function setInspectionSkipped(inspId, skipped) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/set_inspection_skipped`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_inspection_id: inspId, p_skipped: !!skipped }),
    });
    if (!res.ok) throw new Error(`set_inspection_skipped ${res.status}: ${await res.text()}`);
    const stampedAt = await res.json(); // NOW() when skipping, null when unskipping
    const local = supabaseCompleted.find(v => v.id === inspId);
    if (local) local.skipped_at = stampedAt;
    return stampedAt;
  }

  // Tracks whether the local WhatsApp scraper server is running.
  // Flipped by setServerOnline(). When false we short-circuit the localhost
  // fetches so Chrome's console isn't filled with ERR_CONNECTION_REFUSED.
  let scraperServerAvailable = false;

  // Lists every photo in the inspection's storage bucket folder. This is a
  // fallback for the damage-modal bug that sometimes uploads photos but
  // doesn't link them to the damage's photos[] array. Returns an array of
  // { name, url } for every object under <inspectionId>/damage/.
  async function listDamagePhotosInStorage(inspectionId) {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/storage/v1/object/list/inspection-photos`,
        {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            prefix: `${inspectionId}/damage`,
            limit: 500,
            offset: 0,
            sortBy: { column: 'name', order: 'asc' },
          }),
        },
      );
      if (!res.ok) {
        console.error('[listDamagePhotosInStorage]', res.status, await res.text());
        return [];
      }
      const rows = await res.json();
      return rows.map((r) => ({
        name: r.name, // e.g. "front_bumper-38401713-67d.jpg"
        url: `${SUPABASE_URL}/storage/v1/object/public/inspection-photos/${inspectionId}/damage/${r.name}`,
      }));
    } catch (err) {
      console.error('[listDamagePhotosInStorage]', err);
      return [];
    }
  }

  // Enrich the inspection's damage photos with any orphaned storage files.
  // For each damage panel, if the checklist says photos: [] but storage has
  // a file matching that panel name, attach it.
  async function enrichDamagesWithStoragePhotos(insp) {
    const stored = await listDamagePhotosInStorage(insp.id);
    if (stored.length === 0) return;

    const checklist = insp.checklist || {};
    const exterior = checklist.exterior || {};
    const interior = checklist.interior || {};

    const addMatches = (panelId, damages) => {
      if (!Array.isArray(damages) || damages.length === 0) return;
      // Find all storage files for this panel. Filename starts with "<panel>-"
      const matches = stored.filter((f) => f.name.toLowerCase().startsWith(panelId.toLowerCase() + '-'));
      if (matches.length === 0) return;

      // Split matches evenly across damages (usually only 1 damage per panel).
      // If there's 1 damage and N photos, all photos go on that damage.
      damages.forEach((d) => {
        const existing = Array.isArray(d.photos) ? d.photos : [];
        if (existing.length > 0) return; // already linked, skip
        d.photos = matches.map((m) => ({ url: m.url, path: `${insp.id}/damage/${m.name}` }));
      });
    };

    for (const [panelId, panel] of Object.entries(exterior)) {
      addMatches(panelId, panel?.damages);
    }
    for (const [zoneId, zone] of Object.entries(interior)) {
      addMatches(zoneId, zone?.damages);
    }
  }

  // Download all photos for an inspection into organized subfolders under
  // Downloads/SA/<vin6>/ so the user can manually attach them to SA's native
  // file picker. This is the reliable fallback since SA's Photos tab uses a
  // native OS picker that browsers block JS from filling.
  //
  // Folder layout:
  //   Downloads/SA/<vin6>/stock/             — the 11 stock photos
  //   Downloads/SA/<vin6>/damage-01-<panel>/ — photos for damage #1
  //   Downloads/SA/<vin6>/damage-02-<panel>/ — photos for damage #2
  //   ...etc
  //
  // Returns { vin6, folder, stockCount, damageCount, totalFiles }.
  async function downloadInspectionPhotos(insp) {
    if (typeof InspectionTransform === 'undefined') {
      throw new Error('Transform lib not loaded');
    }
    // Enrich orphaned damage photos from storage BEFORE transforming so the
    // transform sees the full set (works around a PWA bug that sometimes
    // uploads damage photos but doesn't link them to the damage record).
    await enrichDamagesWithStoragePhotos(insp);
    const data = InspectionTransform.transformInspectionToSA(insp);
    const vin6 = data.vin6 || 'unknown';
    const rootPrefix = `SA/${vin6}`;

    // Helper: trigger a download and resolve with {ok, error?} once complete.
    // Captures chrome.runtime.lastError on init + interrupted state on change,
    // and times out after 20 s so a hung download doesn't block Promise.all.
    function download(url, filename) {
      return new Promise((resolve) => {
        let settled = false;
        const finish = (ok, error) => {
          if (settled) return;
          settled = true;
          resolve({ ok, error, url, filename });
        };
        const listener = (delta) => {
          if (delta.id !== downloadId) return;
          if (delta.state?.current === 'complete') {
            chrome.downloads.onChanged.removeListener(listener);
            finish(true);
          }
          if (delta.state?.current === 'interrupted') {
            chrome.downloads.onChanged.removeListener(listener);
            finish(false, delta.error?.current || 'interrupted');
          }
        };
        let downloadId;
        try {
          chrome.downloads.download(
            // 'overwrite' replaces any existing file at the target path. Prevents
            // the `(1)`, `(2)` duplicates that piled up when Fill was run twice
            // on the same car. User explicitly wants stale photos purged, not
            // preserved.
            { url, filename, conflictAction: 'overwrite', saveAs: false },
            (id) => {
              if (chrome.runtime.lastError) {
                finish(false, chrome.runtime.lastError.message);
                return;
              }
              if (!id) {
                finish(false, 'no download id returned');
                return;
              }
              downloadId = id;
              chrome.downloads.onChanged.addListener(listener);
            },
          );
        } catch (err) {
          finish(false, err.message || String(err));
        }
        // Safety net: don't wait forever. Bumped from 20s → 45s because
        // Supabase storage can be slow under parallel load.
        setTimeout(() => {
          if (!settled) {
            try { chrome.downloads.onChanged.removeListener(listener); } catch {}
            finish(false, 'timeout after 45s');
          }
        }, 45000);
      });
    }

    // Fire up to `CONCURRENCY` downloads at a time. Supabase storage's public
    // endpoint starts timing out / throttling when we blast all 11+ stock
    // photos at once, which is why Fill was reporting "timeout after 20s" for
    // half the jobs. A small concurrency cap keeps every request under the
    // timeout while still finishing the whole batch in a few seconds.
    async function runWithConcurrency(items, worker, concurrency) {
      const results = new Array(items.length);
      let next = 0;
      const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (true) {
          const i = next++;
          if (i >= items.length) return;
          results[i] = await worker(items[i], i);
        }
      });
      await Promise.all(runners);
      return results;
    }

    // Build the full job list. Everything flattens into one folder under
    // Downloads/SA/<vin6>/. Filenames are prefixed so Finder's alphabetical
    // sort puts car (stock) photos first, then damage photos.
    //   car-<slot>.jpg           ← the 11 whole-car shots (front, rear, tires...)
    //   damage-NN-<panel>-<N>.jpg ← damage close-ups after
    const jobs = [];

    // 1. Stock photos — filenames match SA's Image Location dropdown wording
    //    so the user can map each file at a glance when classifying on SA.
    //    Numeric prefix controls upload order: exterior corners first, then
    //    interior, then tires, then damage (in section 2), with dashboard/odo
    //    pinned LAST via the `99-` prefix.
    const SA_SLOT_NAMES = {
      driver_front_corner: '01-front-left',
      pass_front_corner:   '02-front-right',
      pass_rear_corner:    '03-rear-right',
      driver_rear_corner:  '04-rear-left',
      interior_front:      '05-interior-front',
      interior_rear:       '06-interior-rear',
      tire_lf:             '07-tire-front-left',
      tire_rf:             '08-tire-front-right',
      tire_lr:             '09-tire-rear-left',
      tire_rr:             '10-tire-rear-right',
      dash_odo:            '99-dashboard-odometer',
    };
    const checklistPhotos = insp.checklist?.photos || {};
    const stockSlots = Object.entries(checklistPhotos).filter(([, v]) => v?.url);
    for (const [slotId, photo] of stockSlots) {
      const ext = (photo.url.split('?')[0].split('.').pop() || 'jpg').toLowerCase();
      // Fallback keeps any unknown slotIds readable and sorted before damage
      const namePart = SA_SLOT_NAMES[slotId] || `20-${slotId}`;
      jobs.push({
        url: photo.url,
        filename: `${rootPrefix}/${namePart}.${ext}`,
      });
    }

    // 2. Damage photos — prefix `50-` so they sort after stock shots (01-20s)
    // and before the dashboard (99). Name includes panel + damage type so the
    // user can map each to SA's Image Location dropdown by filename.
    // E.g. `50-01-hood-dent-1.jpg`, `50-02-driver_door-scratch-1.jpg`.
    let damageIdx = 0;
    const damagesWithPhotos = data.damages.filter((d) => d.photos && d.photos.length > 0);
    const safeSlug = (s, max = 30) => (s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, max);
    for (const dmg of data.damages) {
      damageIdx++;
      if (!dmg.photos || dmg.photos.length === 0) continue;
      const panelSlug = safeSlug(dmg.panel, 30) || 'panel';
      const typeSlug = safeSlug(dmg.type, 20);
      const prefix = `50-${String(damageIdx).padStart(2, '0')}-${panelSlug}${typeSlug ? '-' + typeSlug : ''}`;
      for (let p = 0; p < dmg.photos.length; p++) {
        const url = dmg.photos[p];
        const ext = (url.split('?')[0].split('.').pop() || 'jpg').toLowerCase();
        jobs.push({
          url,
          filename: `${rootPrefix}/${prefix}-${p + 1}.${ext}`,
        });
      }
    }

    // Dedupe jobs by URL — the same photo can land under multiple slot names
    // (e.g. a tire shot referenced from both `checklist.photos` and as a
    // damage photo). Without this, each duplicate URL would hit its own
    // filename and we'd still end up with two copies on disk.
    const seenUrls = new Set();
    const uniqueJobs = jobs.filter((j) => {
      if (seenUrls.has(j.url)) return false;
      seenUrls.add(j.url);
      return true;
    });
    if (uniqueJobs.length < jobs.length) {
      console.log(`[downloadInspectionPhotos] deduped ${jobs.length - uniqueJobs.length} duplicate URLs`);
    }

    // Throttled fan-out: 4 downloads in flight at a time.
    const results = await runWithConcurrency(
      uniqueJobs,
      (j) => download(j.url, j.filename),
      4,
    );
    const succeeded = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    const totalFiles = succeeded.length;

    // Log failures so we can see exactly what's broken
    if (failed.length > 0) {
      console.warn('[downloadInspectionPhotos] failed downloads:', failed);
      failed.forEach((f) => {
        console.warn(`  ✗ ${f.filename} — ${f.error} — ${f.url}`);
      });
    }
    console.log(`[downloadInspectionPhotos] ${totalFiles}/${uniqueJobs.length} downloaded to Downloads/${rootPrefix}`);

    return {
      vin6,
      folder: `~/Downloads/${rootPrefix}`,
      stockCount: stockSlots.length,
      damageCount: damagesWithPhotos.length,
      totalFiles,
      attempted: uniqueJobs.length,
      failed: failed.length,
      failures: failed.map((f) => ({ filename: f.filename, error: f.error })),
    };
  }

  // Wipe every Downloads entry whose filename lives under SA/<vin6>/. Uses
  // chrome.downloads.search to find both completed and in-progress downloads,
  // removeFile to nuke the file on disk, and erase to clear the history row.
  // Best-effort — failures don't bubble up.
  async function purgeLocalDownloadsForVin6(vin6) {
    if (!vin6 || !chrome?.downloads?.search) return { removed: 0 };
    const safeVin6 = String(vin6).replace(/[^A-Za-z0-9]/g, '');
    if (!safeVin6) return { removed: 0 };
    try {
      // filenameRegex matches the full filename path chrome.downloads stores.
      // Escaped slashes work on both macOS and Windows — macOS uses '/',
      // Windows uses '\\' which we match via a character class.
      const items = await new Promise((resolve) => {
        chrome.downloads.search(
          { filenameRegex: `[/\\\\]SA[/\\\\]${safeVin6}[/\\\\]` },
          (results) => resolve(results || []),
        );
      });
      let removed = 0;
      for (const item of items) {
        await new Promise((resolve) => {
          chrome.downloads.removeFile(item.id, () => {
            // Ignore "file already removed" errors
            void chrome.runtime.lastError;
            chrome.downloads.erase({ id: item.id }, () => {
              void chrome.runtime.lastError;
              resolve();
            });
          });
        });
        removed++;
      }
      console.log(`[SA] purged ${removed} local downloads under Downloads/SA/${safeVin6}/`);
      return { removed };
    } catch (err) {
      console.warn('[SA] local download purge failed:', err);
      return { removed: 0, error: err.message || String(err) };
    }
  }

  // Skip + purge: sets inspections.skipped_at AND wipes every photo the
  // inspection touched (storage + DB rows + local Downloads folder). Skip is
  // destructive now — there's no unskip once photos are gone. Used by the
  // Skip button on each queue card.
  async function skipAndPurgeInspection(inspId) {
    const inspDetail = supabaseCompleted.find((v) => v.id === inspId);
    const cl = inspDetail?.checklist || {};
    const inlinePaths = [];
    for (const section of ['photos']) {
      const s = cl[section] || {};
      for (const slot of Object.values(s)) {
        if (slot?.path) inlinePaths.push(slot.path);
      }
    }
    for (const group of ['exterior', 'interior']) {
      const s = cl[group] || {};
      for (const panel of Object.values(s)) {
        for (const dmg of (panel?.damages || [])) {
          for (const p of (dmg?.photos || [])) {
            if (p?.path) inlinePaths.push(p.path);
          }
        }
      }
    }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/skip_and_purge_inspection`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ insp_id: inspId }),
    });
    if (!res.ok) {
      return { ok: false, error: await res.text() };
    }
    const rpcRows = await res.json().catch(() => []);
    const rpcPaths = (Array.isArray(rpcRows) ? rpcRows : []).map((r) => r?.file_path).filter(Boolean);

    try {
      const uniquePaths = [...new Set([...rpcPaths, ...inlinePaths])];
      if (uniquePaths.length) {
        for (let i = 0; i < uniquePaths.length; i += 100) {
          const chunk = uniquePaths.slice(i, i + 100);
          await fetch(`${SUPABASE_URL}/storage/v1/object/inspection-photos`, {
            method: 'DELETE',
            headers: {
              apikey: SUPABASE_ANON_KEY,
              Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ prefixes: chunk }),
          }).catch(() => {});
        }
      }
    } catch (purgeErr) {
      console.warn('[SA] skip storage purge partial failure:', purgeErr);
    }

    try {
      if (typeof InspectionTransform !== 'undefined' && inspDetail) {
        const data = InspectionTransform.transformInspectionToSA(inspDetail);
        const vin6 = (data?.vin6 || inspDetail.vin_last6 || inspDetail.vin || '').slice(-6);
        if (vin6) await purgeLocalDownloadsForVin6(vin6);
      }
    } catch (localErr) {
      console.warn('[SA] skip local Downloads purge failed:', localErr);
    }

    supabaseCompleted = supabaseCompleted.filter((v) => v.id !== inspId);
    return { ok: true };
  }

  // Flip an inspection to status='listed' and purge all photos associated with
  // it. Shared between the Complete button and the auto-complete tail of the
  // Fill flow.
  //
  // All DB work goes through `mark_inspection_listed` (SECURITY DEFINER) so the
  // extension's anon key can UPDATE `inspections` and DELETE `inspection_photos`
  // without tripping the authenticated-only RLS policies. The RPC returns every
  // file_path the inspection touched; we then gather extra paths from the
  // checklist JSON and delete all storage objects in one chunked DELETE.
  // Finally we wipe Downloads/SA/<vin6>/ so nothing about the car is left on
  // the user's computer.
  //
  // Returns { ok: true } on success, { ok: false, error } otherwise.
  async function completeAndPurgeInspection(inspId) {
    // 1. Collect inline paths from the local checklist copy BEFORE calling the
    //    RPC (the RPC nulls out checklist.photos, so we'd lose these otherwise).
    const inspDetail = supabaseCompleted.find((v) => v.id === inspId);
    const cl = inspDetail?.checklist || {};
    const inlinePaths = [];
    for (const section of ['photos']) {
      const s = cl[section] || {};
      for (const slot of Object.values(s)) {
        if (slot?.path) inlinePaths.push(slot.path);
      }
    }
    for (const group of ['exterior', 'interior']) {
      const s = cl[group] || {};
      for (const panel of Object.values(s)) {
        for (const dmg of (panel?.damages || [])) {
          for (const p of (dmg?.photos || [])) {
            if (p?.path) inlinePaths.push(p.path);
          }
        }
      }
    }

    // 2. Call the SECURITY DEFINER RPC: flips status='listed', deletes
    //    inspection_photos rows, nulls checklist.photos, returns all file_paths
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/mark_inspection_listed`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ insp_id: inspId }),
    });
    if (!res.ok) {
      return { ok: false, error: await res.text() };
    }
    const rpcRows = await res.json().catch(() => []);
    const rpcPaths = (Array.isArray(rpcRows) ? rpcRows : []).map((r) => r?.file_path).filter(Boolean);

    // 3. Storage purge (best-effort — storage RLS still in play, not the RPC)
    try {
      const uniquePaths = [...new Set([...rpcPaths, ...inlinePaths])];
      if (uniquePaths.length) {
        for (let i = 0; i < uniquePaths.length; i += 100) {
          const chunk = uniquePaths.slice(i, i + 100);
          await fetch(`${SUPABASE_URL}/storage/v1/object/inspection-photos`, {
            method: 'DELETE',
            headers: {
              apikey: SUPABASE_ANON_KEY,
              Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ prefixes: chunk }),
          }).catch(() => {});
        }
      }
    } catch (purgeErr) {
      console.warn('[SA] storage purge partial failure:', purgeErr);
    }

    // 4. Wipe Downloads/SA/<vin6>/ so the car's photos don't linger on disk
    try {
      if (typeof InspectionTransform !== 'undefined' && inspDetail) {
        const data = InspectionTransform.transformInspectionToSA(inspDetail);
        const vin6 = (data?.vin6 || inspDetail.vin_last6 || inspDetail.vin || '').slice(-6);
        if (vin6) await purgeLocalDownloadsForVin6(vin6);
      }
    } catch (localErr) {
      console.warn('[SA] local Downloads purge failed:', localErr);
    }

    // 5. Drop from local cache so the card vanishes on next renderDashList()
    supabaseCompleted = supabaseCompleted.filter((v) => v.id !== inspId);
    return { ok: true };
  }

  // Look up the full 17-char VIN for an inspection by its last 6 digits.
  // The inspection PWA only captures the last 6 (fast mobile entry); the
  // full VIN lives in the inventory table synced from Frazer. Returns null
  // if no matching car is found.
  async function lookupFullVinByLast6(last6) {
    if (!last6 || last6.length < 5) return null;
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/lookup_vin_by_last6`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ last6: last6.toUpperCase() }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        console.error('[lookupFullVinByLast6] failed:', res.status, await res.text());
        return null;
      }
      const rows = await res.json();
      return rows && rows.length > 0 ? rows[0] : null;
    } catch (err) {
      console.error('[lookupFullVinByLast6] error:', err);
      return null;
    }
  }

  // Step 2
  const vin6Input = document.getElementById('vin6');
  const odometerInput = document.getElementById('odometer');
  const dupTiresBtn = document.getElementById('dupTires');
  const inventoryInput = document.getElementById('inventoryInput');
  const inventoryStatus = document.getElementById('inventoryStatus');
  const inventoryMatch = document.getElementById('inventoryMatch');
  const vehicleDisplay = document.getElementById('vehicleDisplay');
  const fullVinRow = document.getElementById('fullVinRow');
  const fullVinDisplay = document.getElementById('fullVinDisplay');
  const copyVinBtn = document.getElementById('copyVinBtn');

  // Step 3
  const exteriorZone = document.getElementById('exteriorZone');
  const exteriorInput = document.getElementById('exteriorInput');
  const exteriorPreviews = document.getElementById('exteriorPreviews');
  const exteriorCountEl = document.getElementById('exteriorCount');
  const damageZoneEl = document.getElementById('damageZone');
  const damageInput = document.getElementById('damageInput');
  const damagePreviews = document.getElementById('damagePreviews');
  const damageCountEl = document.getElementById('damageCount');

  // Step 4 (Fill SmartAuction)
  const fillVehicleEntryBtn = document.getElementById('fillVehicleEntry');
  const fillVIWBtn = document.getElementById('fillVIW');
  const discoveryModeBtn = document.getElementById('discoveryMode');
  const fillLog = document.getElementById('fillLog');

  // Dashboard
  const modeQueueBtn = document.getElementById('modeQueue');
  const modeWizardBtn = document.getElementById('modeWizard');
  const modeInfoBtn = document.getElementById('modeInfo');
  const queueDashboard = document.getElementById('queueDashboard');
  const wizardSection = document.getElementById('wizardSection');
  const infoSection = document.getElementById('infoSection');
  const queueList = document.getElementById('queueList');
  const crossCheckResults = document.getElementById('crossCheckResults');

  // Server control
  const serverDot = document.getElementById('serverDot');
  const serverLabel = document.getElementById('serverLabel');
  const serverToggle = document.getElementById('serverToggle');

  // ── Initialization ──
  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    // Wire up the List Uploader (SA/Manheim/OVE/UAX/DAA/ADESA/Super Dispatch)
    // as soon as the DOM is ready. Pulls from lib/list-uploader.js.
    if (typeof window.ListUploader !== 'undefined') {
      window.ListUploader.bindUI({
        supabaseUrl: SUPABASE_URL,
        supabaseKey: SUPABASE_ANON_KEY,
      });
    }

    // Power Apps sync was removed — Supabase Live Sync replaces it.

    // Load saved inventory
    const inv = await chrome.storage.local.get(['inventory', 'inventoryDate']);
    if (inv.inventory && inv.inventory.length > 0) {
      inventory = inv.inventory;
      const dateStr = inv.inventoryDate ? formatAge(inv.inventoryDate) : '';
      inventoryStatus.textContent = `${inventory.length} vehicles${dateStr}`;
      inventoryStatus.className = 'inventory-badge loaded';
      const dashInvStatus = document.getElementById('dashInventoryStatus');
      if (dashInvStatus) {
        dashInvStatus.textContent = `${inventory.length} vehicles${dateStr}`;
        dashInvStatus.className = 'upload-file-status loaded';
      }
    }

    // Restore dashboard uploads (SA, sold, inventory full)
    const dashStored = await chrome.storage.local.get(['saListings', 'soldData', 'inventoryFull']);
    if (dashStored.saListings?.length) saListings = dashStored.saListings;
    if (dashStored.soldData?.length) soldData = dashStored.soldData;
    if (dashStored.inventoryFull?.length) inventory = dashStored.inventoryFull;

    // Don't auto-load photos from IndexedDB on startup — they eat memory
    // Photos will load fresh from server when a car is selected
    try { await PhotoDB.clear(); } catch (e) {}

    // Load saved session data
    const session = await chrome.storage.local.get(['sessionData']);
    if (session.sessionData) {
      restoreSession(session.sessionData);
    }

    // Clear status — will be updated by checkScraperStatus or cross-check
    statusDiv.textContent = '';
    statusDiv.className = 'status';

    checkScraperStatus();
    bindEvents();
    goToStep(1);

    // Default to queue dashboard mode
    setMode('queue');

    // Auto-sync inventory + sold from Supabase (source of truth). Fire and
    // forget — the UI stays usable if Supabase is slow or the RPCs aren't
    // created yet (falls back to whatever's in chrome.storage.local).
    syncSupabaseInventory({ silent: true });
    syncSupabaseSold({ silent: true });
    // Refresh every 3 minutes while the side panel is open so numbers stay
    // fresh without the user doing anything.
    setInterval(() => {
      syncSupabaseInventory({ silent: true });
      syncSupabaseSold({ silent: true });
    }, 3 * 60 * 1000);
  }

  // ── Scraper ──
  async function checkScraperStatus() {
    try {
      const res = await fetch(`${SCRAPER_URL}/status`);
      const data = await res.json();
      
      // Check if WhatsApp is connected
      if (data.whatsapp_connected) {
        scraperStatus.textContent = 'WhatsApp Connected';
        scraperStatus.className = 'scraper-badge online';
        scrapeBtn.disabled = false;
      } else {
        scraperStatus.textContent = 'WhatsApp Not Connected';
        scraperStatus.className = 'scraper-badge offline';
        scrapeBtn.disabled = false;  // Still allow attempts
      }
      
      // Get queue stats from /queue/stats endpoint
      try {
        const qRes = await fetch(`${SCRAPER_URL}/queue/stats`);
        const stats = await qRes.json();
        const total = (stats.queued || 0) + (stats.listed || 0) + (stats.sold || 0);
        setServerOnline(true, { total });
      } catch {
        setServerOnline(true);
      }
    } catch {
      scraperStatus.textContent = 'Server offline - Start it first';
      scraperStatus.className = 'scraper-badge offline';
      scrapeBtn.disabled = true;
      setServerOnline(false);
    }
  }

  function setServerOnline(online, stats) {
    scraperServerAvailable = !!online;
    serverDot.className = `server-dot ${online ? 'online' : 'offline'}`;
    serverLabel.textContent = online ? (stats ? `${stats.total} vehicles` : 'Online') : 'Offline';
    serverToggle.textContent = online ? 'Stop' : 'Start';
    serverToggle.className = `btn btn-small server-btn ${online ? 'stop' : 'start'}`;
  }

  async function toggleServer() {
    const isOnline = serverDot.classList.contains('online');

    if (isOnline) {
      // Stop server
      serverToggle.disabled = true;
      serverLabel.textContent = 'Stopping...';
      try {
        await fetch(`${SCRAPER_URL}/shutdown`, { method: 'POST' });
      } catch { /* expected — server shuts down */ }
      await new Promise(r => setTimeout(r, 1000));
      setServerOnline(false);
      serverToggle.disabled = false;
      statusDiv.textContent = 'Server stopped';
      statusDiv.className = 'status';
    } else {
      // Can't start from extension — show command
      serverToggle.disabled = true;
      serverLabel.textContent = 'Starting...';

      // Try connecting first — maybe it's already running
      try {
        const res = await fetch(`${SCRAPER_URL}/status`);
        if (res.ok) {
          const data = await res.json();
          setServerOnline(true, data.queue_stats);
          serverToggle.disabled = false;
          checkScraperStatus();
          return;
        }
      } catch { /* not running */ }

      // Show the start command with copy button
      const cmd = 'cd ~/Desktop/carz\\ inc/scrapers && python3 whatsapp_server.py &';
      statusDiv.innerHTML = 'Server not running. <button id="copyStartCmd" class="btn btn-small" style="background:#1976d2;margin:0 4px;padding:2px 8px;font-size:10px;">Copy Start Command</button>';
      statusDiv.className = 'status';
      document.getElementById('copyStartCmd').addEventListener('click', () => {
        copyToClipboard(cmd);
        document.getElementById('copyStartCmd').textContent = 'Copied!';
        setTimeout(() => { document.getElementById('copyStartCmd').textContent = 'Copy Start Command'; }, 1500);
      });
      serverToggle.disabled = false;
      setServerOnline(false);

      // Poll for it to come online
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        if (attempts > 30) { clearInterval(poll); return; }
        try {
          const res = await fetch(`${SCRAPER_URL}/status`);
          if (res.ok) {
            clearInterval(poll);
            checkScraperStatus();
            statusDiv.textContent = 'Server started!';
            statusDiv.className = 'status success';
            if (currentMode === 'queue') loadQueue();
          }
        } catch { /* still offline */ }
      }, 2000);
    }
  }

  async function runScrape(body = {}) {
    scrapeBtn.disabled = true;
    scrapeResult.textContent = 'Scraping all WhatsApp groups...';
    scrapeResult.className = 'scraper-result';
    try {
      // Always scrape all groups unless specific parameters provided
      if (!body.groupType) {
        body.groupType = 'all';
      }
      if (!body.limit) {
        body.limit = 1000;  // Get plenty of messages
      }
      
      const res = await fetch(`${SCRAPER_URL}/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (data.success) {
        // Show WhatsApp scrape results
        const messages = data.message_count || 0;
        const locationUpdates = data.location_updates || 0;
        const vehicleUpdates = data.vehicle_updates || 0;
        
        if (locationUpdates > 0 || vehicleUpdates > 0) {
          scrapeResult.textContent = `✓ ${messages} messages • ${locationUpdates} locations • ${vehicleUpdates} vehicles`;
        } else if (messages > 0) {
          scrapeResult.textContent = `✓ Processed ${messages} messages`;
        } else {
          scrapeResult.textContent = '✓ Done!';
        }
        scrapeResult.className = 'scraper-result ok';
        checkScraperStatus();
      } else {
        scrapeResult.textContent = 'Error: ' + (data.error || 'Unknown');
        scrapeResult.className = 'scraper-result err';
      }
    } catch (err) {
      scrapeResult.textContent = 'WhatsApp server not running';
      scrapeResult.className = 'scraper-result err';
    } finally {
      scrapeBtn.disabled = false;
    }
  }

  // ── Scraper: Lookup VIN from Messages ──
  async function lookupFromMessages() {
    const vin6 = vin6Input.value.trim();
    if (vin6.length < 4) {
      msgLookupResult.textContent = 'Enter at least 4 digits of VIN first';
      msgLookupResult.className = 'msg-lookup-result visible err';
      return;
    }

    msgLookupBtn.disabled = true;
    msgLookupResult.textContent = 'Looking up...';
    msgLookupResult.className = 'msg-lookup-result visible';

    try {
      const res = await fetch(`${SCRAPER_URL}/vehicle/${vin6}`);
      if (!res.ok) {
        msgLookupResult.textContent = `No match for "${vin6}" in scraped messages`;
        msgLookupResult.className = 'msg-lookup-result visible err';
        return;
      }

      const data = await res.json();
      const info = data.info || '';

      // Parse fields from info.txt
      const miles = (info.match(/^Miles:\s*(.+)/m) || [])[1]?.trim();
      const condition = (info.match(/^Overall Condition:\s*(.+)/m) || [])[1]?.trim();
      const tireCondition = (info.match(/^Tire Condition:\s*(.+)/m) || [])[1]?.trim();
      const notes = (info.match(/^Notes:\s*([\s\S]*?)(?=\n\n|Scraped from)/m) || [])[1]?.trim();

      // Auto-fill odometer
      if (miles) {
        const numericMiles = miles.replace(/[^0-9]/g, '');
        odometerInput.value = numericMiles;
      }

      // Auto-fill tire condition if we can map it
      if (tireCondition) {
        const tireScore = parseFloat(tireCondition);
        if (!isNaN(tireScore)) {
          // Map 1-10 score to tread depth: 10→10/32, 5→5/32, etc.
          const tread32 = Math.round(Math.min(10, Math.max(1, tireScore)));
          const treadVal = `${tread32}/32`;
          document.querySelectorAll('.tire-row').forEach(row => {
            const sel = row.querySelector('.tire-tread');
            if (sel && !sel.value) sel.value = treadVal;
          });
        }
      }

      // Show results
      let html = '';
      if (miles) html += `<span class="lookup-label">Miles:</span> ${miles}<br>`;
      if (condition) html += `<span class="lookup-label">Condition:</span> ${condition}<br>`;
      if (tireCondition) html += `<span class="lookup-label">Tires:</span> ${tireCondition}<br>`;
      if (notes) html += `<span class="lookup-label">Notes:</span> ${notes}<br>`;
      if (data.photo_count > 0) {
        html += `<span class="lookup-label">Photos:</span> ${data.photo_count} in folder `;
        html += `<button id="openPhotoFolder" class="btn btn-small" style="background:#1976d2;margin:0;padding:3px 8px;font-size:10px;">Open Folder</button> `;
        html += `<button id="loadPhotosBtn" class="btn btn-small" style="background:#388e3c;margin:0;padding:3px 8px;font-size:10px;">Load Photos</button>`;
      }

      msgLookupResult.innerHTML = html;
      msgLookupResult.className = 'msg-lookup-result visible';

      // Bind the open folder button
      const openBtn = document.getElementById('openPhotoFolder');
      if (openBtn) {
        openBtn.addEventListener('click', () => openPhotoFolder(vin6));
      }
      // Bind the load photos button (just loads, no AI)
      const loadBtn = document.getElementById('loadPhotosBtn');
      if (loadBtn) {
        loadBtn.addEventListener('click', () => autoLoadPhotosFromFolder(vin6));
      }

      saveSession();
    } catch (err) {
      msgLookupResult.textContent = 'Scraper server not running';
      msgLookupResult.className = 'msg-lookup-result visible err';
    } finally {
      msgLookupBtn.disabled = false;
    }
  }

  async function openPhotoFolder(vin6) {
    try {
      await fetch(`${SCRAPER_URL}/open-folder/${vin6}`, { method: 'POST' });
    } catch {
      // Server not running — ignore
    }
  }

  // ── Mode Toggle ──
  async function setMode(mode) {
    currentMode = mode;
    modeQueueBtn.classList.toggle('active', mode === 'queue');
    modeWizardBtn.classList.toggle('active', mode === 'wizard');
    modeInfoBtn.classList.toggle('active', mode === 'info');
    queueDashboard.style.display = mode === 'queue' ? 'block' : 'none';
    wizardSection.style.display = mode === 'wizard' ? 'block' : 'none';
    infoSection.style.display = mode === 'info' ? 'block' : 'none';
    if (mode === 'queue') {
      await Promise.all([loadQueue(), loadCompletedInspections()]);
      await restoreDashUploads();
      if (inventory.length > 0 && !crossCheckData) await runCrossCheck();
      renderDashList();
    }
    if (mode === 'info') {
      document.getElementById('infoVinInput').focus();
    }
  }

  // ── CSV Parser (for Sold/SA CSVs) ──
  function parseCSV(text) {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];
    const headers = parseCSVLine(lines[0]);
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const vals = parseCSVLine(lines[i]);
      if (vals.length < 3) continue;
      const row = {};
      headers.forEach((h, idx) => { row[h.trim()] = (vals[idx] || '').trim(); });
      rows.push(row);
    }
    return rows;
  }
  function parseCSVLine(line) {
    const r = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (q && line[i+1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === ',' && !q) { r.push(cur); cur = ''; }
      else cur += c;
    }
    r.push(cur); return r;
  }

  async function parseUploadFile(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.csv')) return parseCSV(await file.text());
    const buffer = await file.arrayBuffer();
    return XLSXParser.parse(buffer);
  }

  // ── Dashboard File Uploads ──
  // Inventory + SA Export uploads removed (replaced by List Uploader).
  // Sold Report upload kept.

  async function handleDashSoldUpload(e) {
    const file = e.target.files[0]; if (!file) return;
    const st = document.getElementById('dashSoldStatus');
    if (st) st.textContent = 'Parsing...';
    try {
      soldData = await parseUploadFile(file);
      await chrome.storage.local.set({ soldData, soldDate: Date.now() });
      if (st) { st.textContent = `${soldData.length} sold`; st.className = 'upload-file-status loaded'; }
      if (inventory.length > 0) runCrossCheck();
    } catch (err) { if (st) st.textContent = 'Error: ' + err.message; }
  }

  async function restoreDashUploads() {
    const stored = await chrome.storage.local.get(['inventoryFull', 'inventoryDate', 'soldData', 'soldDate', 'saListings', 'saListingsDate']);
    if (stored.inventoryFull?.length) {
      inventory = stored.inventoryFull;
      const el = document.getElementById('dashInventoryStatus');
      if (el) { el.textContent = `${inventory.length} vehicles`; el.className = 'upload-file-status loaded'; }
    }
    if (stored.soldData?.length) {
      soldData = stored.soldData;
      const el = document.getElementById('dashSoldStatus');
      if (el) { el.textContent = `${soldData.length} sold`; el.className = 'upload-file-status loaded'; }
    }
    if (stored.saListings?.length) {
      saListings = stored.saListings;
      const el = document.getElementById('saExportStatus');
      if (el) { el.textContent = `${saListings.length} SA vehicles`; el.className = 'upload-file-status loaded'; }
    }
  }

  // ── VIN6 helpers ──
  function vin6From(row) {
    return (row['Last 6 VIN'] || row['Vehicle VIN']?.slice(-6) || row['VIN']?.slice(-6) || row['vin6'] || '').toUpperCase();
  }
  function saVin6From(row) {
    const vin = row['VIN'] || row['Vehicle VIN'] || row['Vin'] || '';
    return vin.length >= 6 ? vin.slice(-6).toUpperCase() : '';
  }

  // Function to refresh SA listings when List Uploader updates them
  window.refreshSAListings = function(newListings) {
    saListings = newListings || [];
    console.log(`[CrossCheck] SA listings refreshed: ${saListings.length} vehicles`);
    // Re-run cross-check if we have inventory
    if (inventory.length > 0) {
      runCrossCheck();
    }
  };

  // ── Cross-Check (all client-side) ──
  async function runCrossCheck() {
    if (inventory.length === 0) {
      statusDiv.textContent = 'Upload Inventory first';
      statusDiv.className = 'status error';
      return;
    }

    // Build inventory lookup
    const invSet = new Set();
    const invMap = new Map();
    const invStockByVin6 = new Map();
    for (const v of inventory) {
      const v6 = vin6From(v);
      const stock = (v['Stock #'] || '').trim();
      if (v6.length >= 5) { invSet.add(v6); invMap.set(v6, v); invStockByVin6.set(v6, stock); }
    }

    // Build sold set with stock# arbitration
    const soldStockSet = new Set();
    const soldVin6All = new Set();
    for (const v of soldData) {
      const v6 = vin6From(v);
      const stock = (v['Stock #'] || '').trim();
      if (v6.length >= 5) soldVin6All.add(v6);
      if (stock) soldStockSet.add(stock);
    }
    // Add auction paste sold
    const auctionSold = await chrome.storage.local.get(['auctionSoldVins']);
    for (const v6 of (auctionSold.auctionSoldVins || [])) soldVin6All.add(v6.toUpperCase());

    const soldSet = new Set();
    for (const v6 of soldVin6All) {
      if (!invSet.has(v6)) { soldSet.add(v6); }
      else {
        const curStock = invStockByVin6.get(v6);
        if (curStock && soldStockSet.has(curStock)) soldSet.add(v6);
      }
    }

    // Filter SA listings by status — cars with Sale Date are SOLD
    const saActive = new Map();
    const saRemoved = new Map();
    const saSold = new Set();
    let saLiveCount = 0, saHoldCount = 0;
    for (const v of saListings) {
      const v6 = saVin6From(v);
      if (v6.length < 5) continue;
      const status = (v['Status'] || '').toLowerCase().trim();
      const saleDate = (v['Sale Date'] || '').trim();
      const removalDate = (v['Removal Date'] || '').trim();
      const holdDate = (v['Hold Date'] || '').trim();
      // Cars with a sale date are sold — add to soldSet so they're excluded everywhere
      if (saleDate) {
        saSold.add(v6);
        soldSet.add(v6);
        continue;
      }
      let cat = 'ignore';
      if (status) {
        if (status === 'live' || status === 'active') cat = 'live';
        else if (status === 'on hold') cat = 'hold';
        else if (status === 'deactivated' || status === 'removed') cat = 'removed';
      } else {
        if (removalDate) cat = 'removed';
        else if (holdDate) cat = 'hold';
        else cat = 'live';
      }
      if (cat === 'live') { saActive.set(v6, { ...v, _saStatus: 'Live' }); saLiveCount++; }
      else if (cat === 'hold') { saActive.set(v6, { ...v, _saStatus: 'On Hold' }); saHoldCount++; }
      else if (cat === 'removed') { saRemoved.set(v6, v); }
    }

    // Build set of queue-removed/sold VINs to exclude
    const queueExcluded = new Set();
    for (const v of queueData) {
      const v6 = (v.vin6 || '').toUpperCase();
      if (v.status === 'removed' || v.status === 'sold') queueExcluded.add(v6);
    }

    // Build result categories
    const notOnSA = [], properlyListed = [], soldButOnSA = [], onSANotInv = [], removedInInv = [];
    for (const v6 of invSet) {
      if (soldSet.has(v6)) continue;
      if (queueExcluded.has(v6)) continue;
      const v = invMap.get(v6);
      if (saActive.has(v6)) properlyListed.push({ vin6: v6, saStatus: saActive.get(v6)._saStatus, ...v });
      else notOnSA.push({ vin6: v6, ...v });
    }
    for (const [v6, saV] of saActive) {
      if (soldSet.has(v6)) soldButOnSA.push({ vin6: v6, ...saV });
      if (!invSet.has(v6)) onSANotInv.push({ vin6: v6, ...saV });
    }
    // Removed from SA but still in inventory — need to relist
    for (const [v6, saV] of saRemoved) {
      if (invSet.has(v6) && !soldSet.has(v6)) {
        removedInInv.push({ vin6: v6, ...invMap.get(v6) });
      }
    }

    // Also filter queue: only show cars with photos that are in inventory, not sold, not on SA
    const readyToList = [];
    for (const v of queueData) {
      const v6 = (v.vin6 || '').toUpperCase();
      if (v.status === 'queued' && invSet.has(v6) && !soldSet.has(v6) && !saActive.has(v6) && v.photo_count > 0) {
        readyToList.push(v);
      }
    }

    crossCheckData = { notOnSA, properlyListed, soldButOnSA, onSANotInv, readyToList, removedInInv };

    // Update stats
    document.getElementById('statQueued').textContent = inventory.length;
    document.getElementById('statListed').textContent = `${saLiveCount}+${saHoldCount}`;
    document.getElementById('statSold').textContent = notOnSA.length;
    document.getElementById('statTotal').textContent = readyToList.length;

    activeFilter = 'ready';
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === 'ready'));
    renderDashList();
    statusDiv.textContent = `Cross-check: ${notOnSA.length} not on SA, ${readyToList.length} ready with photos`;
    statusDiv.className = 'status success';
  }

  function renderDashList() {
    // Ready-to-List can show Carz Inc completed inspections even before any
    // inventory/SA upload, so skip the empty-state guard for that case.
    const hasInspections = activeFilter === 'ready' && supabaseCompleted.length > 0;
    if (!crossCheckData && !hasInspections) {
      let msg = '';
      if (inventory.length === 0) msg = 'Upload Inventory to get started';
      else if (saListings.length === 0) msg = 'Upload SA Export, then click Cross-Check';
      else msg = 'Click Cross-Check to see results';
      queueList.innerHTML = `<div style="text-align:center;color:#999;padding:20px;">${msg}</div>`;
      return;
    }
    const r = crossCheckData || { readyToList: [], removedInInv: [], notOnSA: [], soldButOnSA: [], properlyListed: [] };
    let items = [];
    let cols = [];

    if (activeFilter === 'ready') {
      items = r.readyToList || [];
      cols = ['vin6', 'miles', 'condition', 'tire_condition', 'photo_count', 'notes'];
    } else if (activeFilter === 'hold') {
      // Show held cars from server queue
      items = queueData.filter(v => v.status === 'hold');
      cols = ['vin6', 'miles', 'condition', 'notes'];
    } else if (activeFilter === 'removed') {
      items = r.removedInInv || [];
      cols = ['Stock #', 'Vehicle Year', 'Vehicle Make', 'Vehicle Model', 'Last 6 VIN', 'Mileage', 'Buyer'];
    } else if (activeFilter === 'not-on-sa') {
      items = r.notOnSA;
      cols = ['Stock #', 'Vehicle Year', 'Vehicle Make', 'Vehicle Model', 'Last 6 VIN', 'Mileage', 'Buyer'];
    } else if (activeFilter === 'sold-on-sa') {
      items = r.soldButOnSA;
      cols = ['vin6', 'VIN', 'Year', 'Make', 'Model'];
    } else if (activeFilter === 'listed') {
      // Show recently listed cars from queue (with undo) + properly listed from SA
      const queueListed = queueData.filter(v => v.status === 'listed');
      items = [...queueListed, ...(r.properlyListed || [])];
      cols = ['vin6', 'saStatus', 'Stock #', 'Vehicle Year', 'Vehicle Make', 'Vehicle Model', 'Last 6 VIN'];
    }

    // Apply search filter
    if (queueSearchFilter) {
      items = items.filter(v => JSON.stringify(v).toUpperCase().includes(queueSearchFilter));
    }

    // Skip the "No vehicles" early return on the Ready tab when we have
    // Carz Inc inspections from Supabase — we render them below even when
    // the local scraper queue is empty.
    const hasSupabaseInspections = activeFilter === 'ready' && supabaseCompleted.length > 0;

    if (items.length === 0 && !hasSupabaseInspections) {
      let hint = '';
      if (activeFilter === 'ready' && queueData.length === 0) hint = '<br><span style="font-size:11px;">Server not running or no texts scraped. Click "Scrape Texts" with server running.</span>';
      else if (activeFilter === 'ready') hint = '<br><span style="font-size:11px;">No cars in queue match: in inventory + not sold + not on SA + has photos</span>';
      queueList.innerHTML = `<div style="text-align:center;color:#999;padding:20px;">No vehicles${hint}</div>`;
      return;
    }

    const validCols = cols.filter(c => items.some(item => item[c]));

    // Hold tab — show held cars with Unhold button
    if (activeFilter === 'hold') {
      queueList.innerHTML = items.map(v => `
        <div class="queue-card">
          <div class="queue-card-info">
            <div class="queue-card-vin">${v.vin6} <span style="font-size:9px;background:#fff3e0;color:#f57c00;padding:1px 5px;border-radius:3px;font-weight:600;">HOLD</span></div>
            <div class="queue-card-details">${v.miles || '?'} mi | ${v.condition || ''} | ${v.notes || ''}</div>
          </div>
          <div class="queue-card-actions">
            <button class="btn btn-small queue-unhold-btn" style="background:#1976d2;" data-vin6="${v.vin6}">Unhold</button>
            <button class="btn btn-small queue-remove-btn" style="background:#999;" data-vin6="${v.vin6}">Remove</button>
          </div>
        </div>
      `).join('');
      queueList.querySelectorAll('.queue-unhold-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const vin6 = btn.dataset.vin6;
          try { await fetch(`${SCRAPER_URL}/queue/unhold/${vin6}`, { method: 'POST' }); } catch {}
          btn.closest('.queue-card').remove();
          statusDiv.textContent = `${vin6} back in queue`;
        });
      });
      queueList.querySelectorAll('.queue-remove-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const vin6 = btn.dataset.vin6;
          try { await fetch(`${SCRAPER_URL}/queue/remove/${vin6}`, { method: 'POST' }); } catch {}
          const qv = queueData.find(v => v.vin6 === vin6);
          if (qv) qv.status = 'removed';
          btn.closest('.queue-card').remove();
          statusDiv.textContent = `${vin6} removed`;
        });
      });
      return;
    }

    // Listed tab — show recently listed with Undo button
    if (activeFilter === 'listed') {
      const queueListed = items.filter(v => v.status === 'listed');
      const saListed = items.filter(v => v.saStatus);
      let html = '';
      if (queueListed.length > 0) {
        html += '<div style="font-size:11px;font-weight:600;color:#388e3c;margin-bottom:4px;">Recently Listed (click Undo to bring back):</div>';
        html += queueListed.map(v => `
          <div class="queue-card">
            <div class="queue-card-info">
              <div class="queue-card-vin">${v.vin6}</div>
              <div class="queue-card-details">${v.miles || ''} mi | ${v.condition || ''}</div>
            </div>
            <div class="queue-card-actions">
              <button class="btn btn-small queue-undo-btn" style="background:#f57c00;" data-vin6="${v.vin6}">Undo</button>
            </div>
          </div>
        `).join('');
      }
      if (saListed.length > 0) {
        html += '<div style="font-size:11px;font-weight:600;color:#1976d2;margin-top:8px;margin-bottom:4px;">On SmartAuction:</div>';
        const validCols = ['saStatus', 'Stock #', 'Vehicle Year', 'Vehicle Make', 'Vehicle Model', 'Last 6 VIN'].filter(c => saListed.some(v => v[c]));
        html += '<div style="max-height:200px;overflow-y:auto;"><table class="queue-table"><thead><tr>';
        for (const c of validCols) html += `<th>${escHtml(c)}</th>`;
        html += '</tr></thead><tbody>';
        for (const v of saListed) {
          html += '<tr>';
          for (const c of validCols) html += `<td>${escHtml(String(v[c] || ''))}</td>`;
          html += '</tr>';
        }
        html += '</tbody></table></div>';
      }
      if (!html) html = '<div style="text-align:center;color:#999;padding:20px;">No listed vehicles</div>';
      queueList.innerHTML = html;
      queueList.querySelectorAll('.queue-undo-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const vin6 = btn.dataset.vin6;
          try { await fetch(`${SCRAPER_URL}/queue/unhold/${vin6}`, { method: 'POST' }); } catch {}
          btn.closest('.queue-card').remove();
          statusDiv.textContent = `${vin6} back in queue`;
        });
      });
      return;
    }

    // For "ready" items, render as cards with List button
    if (activeFilter === 'ready') {
      // Section 1: completed Carz Inc inspections from Supabase
      let html = '';
      const visibleInspections = supabaseCompleted.filter((v) => !v.skipped_at);
      const inspections = queueSearchFilter
        ? visibleInspections.filter(v => JSON.stringify(v).toUpperCase().includes(queueSearchFilter))
        : visibleInspections;

      if (inspections.length > 0) {
        html += `<div style="font-size:11px;font-weight:700;color:#00695c;margin:4px 0 6px 0;padding:4px 8px;background:#e0f2f1;border-radius:4px;">READY TO LIST — ${inspections.length} inspected ${inspections.length === 1 ? 'car' : 'cars'}</div>`;
        html += inspections.map(v => {
          const vin6 = (v.vin_last6 || v.vin || '').toUpperCase().slice(-6);
          const photos = countPhotos(v.checklist);
          const damages = countDamages(v.checklist);
          const vehicle = [v.year, v.make, v.model].filter(Boolean).join(' ');
          const completed = v.completed_at ? new Date(v.completed_at).toLocaleDateString() : '';
          const cost = inventoryCostByLast6.get(vin6);
          const totalCost = cost ? cost.totalCost : 0;  // Use totalCost directly, it's already complete
          const costLine = cost
            ? `<div class="queue-card-details" style="color:#00695c;font-weight:700;">Total Cost: ${fmtMoney(totalCost)}${cost.daysOnLot ? ` &middot; ${cost.daysOnLot} days on lot` : ''}</div>`
            : '';
          return `
            <div class="queue-card" style="border-left:3px solid #00695c;">
              <div class="queue-card-info">
                <div class="queue-card-vin">${vin6} <span style="font-size:9px;background:#e0f2f1;color:#00695c;padding:1px 5px;border-radius:3px;font-weight:600;">INSPECTED</span></div>
                <div class="queue-card-details" style="font-weight:700;color:${damages > 0 ? '#c62828' : '#666'};">${damages} damage${damages !== 1 ? 's' : ''}</div>
                <div class="queue-card-details">${(v.mileage || 0).toLocaleString()} mi${vehicle ? ' · ' + escHtml(vehicle) : ''}</div>
                ${costLine}
                <div class="queue-card-details" style="color:#999;">Completed ${completed} · ${photos} photos</div>
              </div>
              <div class="queue-card-actions">
                <button class="btn btn-small insp-vin-btn" style="background:#7b1fa2;font-weight:700;" data-insp-id="${v.id}" title="Step 1: insert VIN into SmartAuction + copy to clipboard">1. VIN</button>
                <button class="btn btn-small insp-fill-btn" style="background:#00695c;font-weight:700;" data-insp-id="${v.id}" title="Step 2: fill damages, tires, odometer + download photos">2. Fill</button>
                <button class="btn btn-small insp-complete-btn" style="background:#2e7d32;font-weight:700;" data-insp-id="${v.id}" title="Step 3: mark listed on SmartAuction and remove from queue">3. Complete</button>
                <button class="btn btn-small insp-skip-btn" style="background:#f57c00;font-weight:700;" data-insp-id="${v.id}" title="Skip this car and DELETE all its photos (no undo)">Skip</button>
              </div>
            </div>
          `;
        }).join('');
        const skippedCount = supabaseCompleted.filter(v => v.skipped_at).length;
        if (skippedCount > 0) {
          html += `<div style="font-size:10px;color:#888;margin:4px 8px;text-align:center;"><a href="#" class="insp-unskip-all" style="color:#1976d2;text-decoration:none;">Show ${skippedCount} skipped</a></div>`;
        }
      }

      // Section 2: existing local scraper queue items
      const scraperItems = [...items];
      if (scraperItems.length > 0) {
        if (inspections.length > 0) {
          html += `<div style="font-size:11px;font-weight:700;color:#666;margin:12px 0 6px 0;padding:4px 8px;background:#f5f5f5;border-radius:4px;">FROM LOCAL SCRAPER — ${scraperItems.length}</div>`;
        }
        html += scraperItems.map(v => {
          return `
            <div class="queue-card">
              <div class="queue-card-info">
                <div class="queue-card-vin">${v.vin6}</div>
                <div class="queue-card-details">${v.miles || '?'} mi | ${v.condition || ''} | Tires: ${v.tire_condition || '?'} | ${v.photo_count} photos</div>
                ${v.notes ? `<div class="queue-card-details" style="color:#999;font-style:italic;">${escHtml(v.notes.substring(0, 60))}</div>` : ''}
              </div>
              <div class="queue-card-actions">
                <button class="btn btn-small queue-list-btn" style="background:#388e3c;" data-vin6="${v.vin6}">List</button>
                <button class="btn btn-small queue-view-btn" style="background:#1976d2;" data-vin6="${v.vin6}">Photos</button>
                <button class="btn btn-small queue-hold-btn" style="background:#f57c00;" data-vin6="${v.vin6}">Hold</button>
                <button class="btn btn-small queue-skip-btn" style="background:#999;" data-vin6="${v.vin6}">Skip</button>
              </div>
            </div>
          `;
        }).join('');
      }

      if (!html) {
        html = '<div style="text-align:center;color:#999;padding:20px;">No vehicles ready to list<br><span style="font-size:11px;">Complete an inspection in the Carz Inc PWA or scrape local queue</span></div>';
      }

      queueList.innerHTML = html;

      // Populate the wizard state (vin + odometer + damages) from a Supabase
      // inspection, so the EXISTING tested fillVINOnPage() / fillEverything()
      // functions work identically to the manual wizard flow. Looks up the
      // full 17-char VIN from inventory by last 6 — the inspection PWA only
      // stores the last 6 since that's all inspectors type in on mobile.
      async function loadInspectionIntoWizard(insp) {
        if (typeof InspectionTransform === 'undefined') return false;
        const data = InspectionTransform.transformInspectionToSA(insp);

        const last6 = data.vin6 || '';
        const invRow = await lookupFullVinByLast6(last6);
        const fullVin = invRow?.vehicle_vin || null;

        // VIN — prefer the full VIN from inventory, fall back to last 6
        vin6Input.value = fullVin || last6 || '';
        if (fullVin && fullVin.length === 17) {
          fullVinDisplay.value = fullVin;
          fullVinRow.style.display = 'block';
        }

        // Odometer
        odometerInput.value = data.odometer || '';

        // Matched vehicle — used by fillVINOnPage as a fallback VIN source
        matchedVehicle = {
          vin: fullVin || '',
          'Vehicle VIN': fullVin || '',
          'Vehicle Year': invRow?.vehicle_year || insp.year || '',
          'Vehicle Make': invRow?.vehicle_make || insp.make || '',
          'Vehicle Model': invRow?.vehicle_model || insp.model || '',
          'Mileage': insp.mileage || '',
          'Stock #': invRow?.stock_number || '',
        };
        try {
          const label = [
            matchedVehicle['Vehicle Year'],
            matchedVehicle['Vehicle Make'],
            matchedVehicle['Vehicle Model'],
          ].filter(Boolean).join(' ') || fullVin || last6 || 'Carz Inc inspection';
          vehicleDisplay.value = label;
        } catch {}

        // Damages — shape matches the existing gatherFormData() output
        // plus photos[] for the per-damage "Upload new" injection added to
        // content.js fillDamagesAndTires.
        damages = data.damages.map((d) => ({
          panel: d.panel,
          category: d.category, // 'Interior' | 'Exterior' — drives SA type dropdown
          type: d.type,
          description: d.description,
          chargeable: d.chargeable ? 'Yes' : 'No',
          estimatedCost: d.estimatedCost || 0,
          photos: Array.isArray(d.photos) ? d.photos : [],
        }));
        renderDamages();

        if (!fullVin) {
          statusDiv.textContent = `No full VIN in inventory for ...${last6} — wait for the next Frazer sync or insert VIN manually`;
          statusDiv.className = 'status error';
        }

        return true;
      }

      // Step 1: insert the full VIN into SmartAuction + copy to clipboard.
      // Delegates to the existing fillVINOnPage() — zero new logic.
      queueList.querySelectorAll('.insp-vin-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const inspId = btn.dataset.inspId;
          const insp = supabaseCompleted.find(i => i.id === inspId);
          if (!insp) return;

          const originalLabel = btn.textContent;
          btn.disabled = true;
          btn.textContent = '...';
          try {
            if (!(await loadInspectionIntoWizard(insp))) {
              statusDiv.textContent = 'Transform lib not loaded — reload extension';
              statusDiv.className = 'status error';
              return;
            }
            await fillVINOnPage();
          } catch (err) {
            statusDiv.textContent = 'VIN step failed: ' + err.message;
            statusDiv.className = 'status error';
          } finally {
            btn.disabled = false;
            btn.textContent = originalLabel;
          }
        });
      });

      // Step 2: fill odometer, damages, tires, then stage photos for manual attach.
      // SA uses native OS file pickers for both the Photos tab and per-damage
      // Upload new buttons — browsers block JS from filling those for security.
      // So the flow is: auto-fill everything except photos, then download all
      // photos into organized folders under ~/Downloads/SA/<vin6>/, and copy
      // the folder path to clipboard so the user can jump straight to it in
      // the OS file picker (Cmd+Shift+G on Mac, Ctrl+L on Windows).
      queueList.querySelectorAll('.insp-fill-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const inspId = btn.dataset.inspId;
          const insp = supabaseCompleted.find(i => i.id === inspId);
          if (!insp) return;

          const originalLabel = btn.textContent;
          btn.disabled = true;
          btn.textContent = '...';
          try {
            if (!(await loadInspectionIntoWizard(insp))) {
              statusDiv.textContent = 'Transform lib not loaded — reload extension';
              statusDiv.className = 'status error';
              return;
            }

            // 2a. Fill damages / tires / odometer (existing wizard path)
            statusDiv.textContent = 'Filling damages, tires, odometer...';
            statusDiv.className = 'status';
            await fillEverything();

            // 2b. Download all photos to ~/Downloads/SA/<vin6>/
            statusDiv.textContent = 'Staging photos for upload...';
            const result = await downloadInspectionPhotos(insp);

            // 2c. Copy folder path to clipboard so user can paste in OS picker
            //     (Cmd+Shift+G on Mac, Ctrl+L on Windows)
            try {
              // chrome.downloads returns filenames relative to the default
              // Downloads folder; we can't read the absolute path directly
              // but we can tell the user the relative path.
              const relPath = `Downloads/SA/${result.vin6}`;
              await navigator.clipboard.writeText(relPath).catch(() => {});
            } catch {}

            const failedNote = result.failed > 0
              ? ` <span style="color:#c62828;">(${result.failed} failed)</span>`
              : '';
            statusDiv.innerHTML =
              `<b>Done.</b> ${result.totalFiles} photos in <code>Downloads/SA/${result.vin6}</code>${failedNote}<br>`
              + `<span style="font-size:10px;line-height:1.4;">`
              + `1. In SA: <b>Photos</b> tab → <b>Add Photos</b><br>`
              + `2. In file picker: <b>Cmd+Shift+G</b> → paste (already copied) → Enter<br>`
              + `3. <b>Cmd+A</b> → Open — all ${result.totalFiles} photos upload at once<br>`
              + `4. Classify each photo with SA's Image Location dropdown<br>`
              + `5. Click <b>3. Complete</b> below to clean up Supabase + Downloads folder`
              + `</span>`;
            statusDiv.className = result.failed > 0 ? 'status' : 'status success';
          } catch (err) {
            statusDiv.textContent = 'Fill failed: ' + err.message;
            statusDiv.className = 'status error';
            console.error(err);
          } finally {
            btn.disabled = false;
            btn.textContent = originalLabel;
          }
        });
      });

      // Step 3: mark listed on SA — PATCH the inspection row to status='listed'
      // so the next refresh won't return it (loadCompletedInspections filters
      // status=eq.complete). Also remove it from the local array immediately
      // so the card vanishes without waiting for the round-trip.
      queueList.querySelectorAll('.insp-complete-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const inspId = btn.dataset.inspId;
          if (!confirm('Mark this car as listed on SmartAuction and DELETE all its photos?')) return;
          const originalLabel = btn.textContent;
          btn.disabled = true;
          btn.textContent = '...';
          try {
            const result = await completeAndPurgeInspection(inspId);
            if (!result.ok) {
              statusDiv.textContent = 'Mark listed failed: ' + result.error;
              statusDiv.className = 'status error';
              btn.disabled = false;
              btn.textContent = originalLabel;
              return;
            }
            statusDiv.textContent = 'Listed + photos purged';
            statusDiv.className = 'status success';
            renderDashList();
          } catch (err) {
            statusDiv.textContent = 'Mark listed error: ' + err.message;
            statusDiv.className = 'status error';
            btn.disabled = false;
            btn.textContent = originalLabel;
          }
        });
      });

      // Bind Skip buttons — destructive: sets inspections.skipped_at AND
      // deletes every photo tied to the inspection (storage + DB rows + the
      // local Downloads/SA/<vin6>/ folder). No confirm dialog — the user
      // already asked for one-click cleanup; the button's amber color + tooltip
      // signal that it's destructive.
      queueList.querySelectorAll('.insp-skip-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const inspId = btn.dataset.inspId;
          const originalLabel = btn.textContent;
          btn.disabled = true;
          btn.textContent = '...';
          try {
            const result = await skipAndPurgeInspection(inspId);
            if (!result.ok) {
              statusDiv.textContent = 'Skip failed: ' + result.error;
              statusDiv.className = 'status error';
              btn.disabled = false;
              btn.textContent = originalLabel;
              return;
            }
            statusDiv.textContent = 'Skipped + photos purged';
            statusDiv.className = 'status success';
            renderDashList();
          } catch (err) {
            statusDiv.textContent = 'Skip error: ' + err.message;
            statusDiv.className = 'status error';
            btn.disabled = false;
            btn.textContent = originalLabel;
          }
        });
      });

      // "Show skipped" link — photos are GONE for skipped cars, but we can
      // still un-hide the card so the user can see what was skipped. They'll
      // just see an inspection row with no photos attached.
      queueList.querySelectorAll('.insp-unskip-all').forEach(link => {
        link.addEventListener('click', async (e) => {
          e.preventDefault();
          const skipped = supabaseCompleted.filter(v => v.skipped_at);
          try {
            await Promise.all(skipped.map(v => setInspectionSkipped(v.id, false)));
            renderDashList();
          } catch (err) {
            statusDiv.textContent = 'Unskip failed: ' + err.message;
            statusDiv.className = 'status error';
          }
        });
      });

      // Bind buttons
      queueList.querySelectorAll('.queue-list-btn').forEach(btn => {
        btn.addEventListener('click', () => window._queueAction('list', btn.dataset.vin6));
      });
      queueList.querySelectorAll('.queue-view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          chrome.tabs.create({ url: `${SCRAPER_URL}/gallery/${btn.dataset.vin6}` });
        });
      });
      queueList.querySelectorAll('.queue-hold-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const vin6 = btn.dataset.vin6;
          try { await fetch(`${SCRAPER_URL}/queue/hold/${vin6}`, { method: 'POST' }); } catch {}
          btn.closest('.queue-card').remove();
          statusDiv.textContent = `${vin6} on hold`;
        });
      });
      queueList.querySelectorAll('.queue-skip-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const vin6 = btn.dataset.vin6;
          try { await fetch(`${SCRAPER_URL}/queue/remove/${vin6}`, { method: 'POST' }); } catch {}
          // Update local state so vehicle doesn't reappear on re-render
          const qv = queueData.find(v => v.vin6 === vin6);
          if (qv) qv.status = 'removed';
          if (crossCheckData?.readyToList) {
            crossCheckData.readyToList = crossCheckData.readyToList.filter(v => v.vin6 !== vin6);
          }
          btn.closest('.queue-card').remove();
          statusDiv.textContent = `${vin6} skipped`;
        });
      });
      return;
    }

    // Table view for other tabs
    const vins = items.map(v => v['Vehicle VIN'] || v['VIN'] || v.vin6 || '').filter(Boolean);
    let html = '<div style="max-height:300px;overflow-y:auto;"><table class="queue-table"><thead><tr>';
    for (const c of validCols) html += `<th>${escHtml(c)}</th>`;
    html += '</tr></thead><tbody>';
    for (const item of items) {
      html += '<tr>';
      for (const c of validCols) html += `<td>${escHtml(String(item[c] || ''))}</td>`;
      html += '</tr>';
    }
    html += '</tbody></table></div>';
    if (vins.length) html += `<button class="btn btn-small copy-vins-result" style="background:#1976d2;margin-top:6px;">Copy ${vins.length} VINs</button>`;
    queueList.innerHTML = html;
    // Bind copy button
    const copyBtn = queueList.querySelector('.copy-vins-result');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        copyToClipboard(vins.join('\n'));
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = `Copy ${vins.length} VINs`; }, 1500);
      });
    }
  }

  // Global action handler
  window._queueAction = async function(action, vin6) {
    if (action === 'list') {
      // Clear old car data first. Standards auto-applied for every new car.
      damages = [];
      addStandardDamages();
      renderDamages();
      exteriorPhotos = [];
      damagePhotos = [];
      renderPreviews('exterior');
      renderPreviews('damage');
      odometerInput.value = '';
      matchedVehicle = null;
      document.getElementById('autoPhotoStatus').textContent = '';

      // Jump straight to wizard
      currentMode = 'wizard';
      modeQueueBtn.classList.remove('active');
      modeWizardBtn.classList.add('active');
      queueDashboard.style.display = 'none';
      wizardSection.style.display = 'block';
      vin6Input.value = vin6;
      goToStep(1);
      lookupVIN();
      await lookupFromMessages();
      await autoLoadPhotosFromFolder(vin6);
    }
  };

  async function autoLoadPhotosFromFolder(vin6) {
    const photoStatus = document.getElementById('autoPhotoStatus');
    if (!photoStatus) return;
    photoStatus.textContent = `Loading photos for ${vin6}...`;
    photoStatus.className = 'field-status';
    try {
      // First get count only (fast)
      const infoRes = await fetch(`${SCRAPER_URL}/vehicle/${vin6}`);
      if (!infoRes.ok) { photoStatus.textContent = 'No photos found'; return; }
      const info = await infoRes.json();
      const total = info.photo_count || 0;
      if (total === 0) { photoStatus.textContent = 'No photos in folder'; return; }

      // Load photos in small batches (5 at a time) so UI updates fast
      exteriorPhotos = [];
      const batchSize = 5;
      for (let offset = 0; offset < total; offset += batchSize) {
        const res = await fetch(`${SCRAPER_URL}/vehicle/${vin6}/photos?limit=${batchSize}&offset=${offset}`);
        if (!res.ok) break;
        const data = await res.json();
        for (const p of (data.photos || [])) {
          if (p.dataUrl) exteriorPhotos.push({ dataUrl: p.dataUrl, resizedBase64: p.base64, zone: 'exterior' });
        }
        renderPreviews('exterior');
        photoStatus.textContent = `Loading photos... ${exteriorPhotos.length}/${total}`;
      }
      persistPhotos();
      photoStatus.textContent = `${exteriorPhotos.length} photos loaded`;
      photoStatus.className = 'field-status ok';
    } catch (err) {
      photoStatus.textContent = `Photo error: ${err.message}`;
      photoStatus.className = 'field-status err';
      console.error('autoLoadPhotosFromFolder error:', err);
    }
  }

  // ── Load from Manheim/OVE export (drag-drop or folder picker) ──
  function setupManheimDropZone() {
    const dropZone = document.getElementById('manheimDropZone');
    const folderInput = document.getElementById('manheimFolderInput');
    if (!dropZone || !folderInput) return;

    dropZone.addEventListener('click', () => folderInput.click());
    folderInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) loadManheimFiles(e.target.files);
    });

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.style.background = '#ffe0b2';
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.style.background = '#fff8f0';
    });
    dropZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropZone.style.background = '#fff8f0';
      // Handle folder drop via DataTransfer items
      const items = e.dataTransfer.items;
      if (!items || items.length === 0) return;
      const files = [];
      const entries = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }
      if (entries.length === 1 && entries[0].isDirectory) {
        // Dropped a folder — read its contents
        const dirFiles = await readDirectoryFiles(entries[0]);
        loadManheimFiles(dirFiles);
      } else {
        // Dropped individual files — use them directly
        const fileList = e.dataTransfer.files;
        loadManheimFiles(fileList);
      }
    });
  }

  function readDirectoryFiles(dirEntry) {
    return new Promise((resolve, reject) => {
      const reader = dirEntry.createReader();
      const allFiles = [];
      function readBatch() {
        reader.readEntries((entries) => {
          if (entries.length === 0) {
            resolve(allFiles);
            return;
          }
          let pending = entries.length;
          for (const entry of entries) {
            if (entry.isFile) {
              entry.file((f) => {
                allFiles.push(f);
                if (--pending === 0) readBatch();
              }, () => { if (--pending === 0) readBatch(); });
            } else {
              if (--pending === 0) readBatch();
            }
          }
        }, (err) => reject(new Error('Failed to read folder: ' + err)));
      }
      readBatch();
    });
  }

  function parseManheimSummary(text) {
    const info = {};
    const rawDamages = [];
    let section = null;
    let lastKey = null;
    const afterColon = (s) => s.substring(s.indexOf(':') + 1).trim();

    for (const line of text.split('\n')) {
      const s = line.trim();
      if (s.startsWith('VIN:')) { info.vin = afterColon(s); lastKey = null; }
      else if (s.startsWith('Vehicle:')) { info.vehicle = afterColon(s); lastKey = 'vehicle'; }
      else if (s.startsWith('Odometer:')) { info.odometer = afterColon(s); lastKey = null; }
      else if (s.startsWith('Condition Score:')) { info.conditionScore = afterColon(s); lastKey = null; }
      else if (s.includes('DAMAGES & ISSUES')) { section = 'damages'; lastKey = null; }
      else if (s.includes('IMAGES DOWNLOADED') || s.includes('TIRES AND WHEELS') || s.includes('ANNOUNCEMENTS')) { section = null; lastKey = null; }
      else if (section === 'damages' && s && /^\d+\./.test(s)) {
        const entry = s.replace(/^\d+\.\s*/, '');
        if (entry) rawDamages.push(entry);
        lastKey = null;
      } else if (lastKey === 'vehicle' && s && !s.startsWith('---') && !s.startsWith('===')) {
        info.vehicle += ' ' + s;
        lastKey = null;
      } else if (s) { lastKey = null; }
    }

    // Parse damages — summary has each damage in 3 formats:
    // Format 1: "Panel (Type)" — parentheses
    // Format 2: "Panel| Type" — pipe
    // Format 3: "Panel- Type" — dash (no space before dash)
    // Plus standalone: "Light scratches", "Multi dents"
    const seen = new Set();
    const damages = [];

    for (const d of rawDamages) {
      let panel = '', dtype = '';

      if (d.includes('(') && d.includes(')')) {
        // Format 1: "R Qtr Panel (Mult Dents/Paint Dmg)"
        const m = d.match(/^(.+?)\s*\((.+?)\)\s*$/);
        if (m) { panel = m[1].trim(); dtype = m[2].trim(); }
        else { panel = d; }
      } else if (d.includes(':')) {
        // Format: "F Bumper Cover Lower: Heavy Mult Scratches"
        const idx = d.indexOf(':');
        panel = d.substring(0, idx).trim();
        dtype = d.substring(idx + 1).trim();
      } else if (d.includes('|')) {
        // Format 2: "R Qtr Panel| Mult Dents/Paint Dmg"
        const idx = d.indexOf('|');
        panel = d.substring(0, idx).trim();
        dtype = d.substring(idx + 1).trim();
      } else if (/\S-\s+\S/.test(d)) {
        // Format 3: "R Qtr Panel- Mult Dents" — dash right after text, space after
        // Greedy match so "Cargo Door - Right Rear- Type" keeps full panel name
        const m = d.match(/^(.+\S)-\s+(.+)$/);
        if (m) { panel = m[1].trim(); dtype = m[2].trim(); }
        else { panel = d; }
      } else {
        // Standalone: "Light scratches", "Multi dents"
        panel = d;
      }

      // Skip standalone entries (no type) — these are general observations
      // like "Light scratches" or "Multi dents" that aren't panel-specific.
      // The actual panel damages already cover them.
      if (!dtype && panel) continue;

      const key = (panel + '|' + dtype).toLowerCase();
      if (!seen.has(key) && panel) {
        seen.add(key);
        damages.push({ panel, type: dtype });
      }
    }
    return { info, damages };
  }

  async function loadManheimFiles(fileList) {
    const manheimResult = document.getElementById('manheimResult');
    const files = Array.from(fileList);

    // Find summary file
    const summaryFile = files.find(f => f.name.endsWith('_summary.txt'));
    // Find image files
    const imageFiles = files
      .filter(f => /\.(jpg|jpeg|png)$/i.test(f.name) && /_image_\d+/.test(f.name))
      .sort((a, b) => {
        const numA = parseInt(a.name.match(/_image_(\d+)/)?.[1] || '0');
        const numB = parseInt(b.name.match(/_image_(\d+)/)?.[1] || '0');
        return numA - numB;
      });

    if (!summaryFile && imageFiles.length === 0) {
      manheimResult.textContent = 'No Manheim export found — need _summary.txt or images';
      manheimResult.className = 'scraper-result err';
      return;
    }

    manheimResult.textContent = 'Loading...';
    manheimResult.className = 'scraper-result';

    try {
      let vehicleName = '';
      // Parse summary
      if (summaryFile) {
        const text = await summaryFile.text();
        const { info, damages: parsedDamages } = parseManheimSummary(text);

        if (info.vin) {
          vin6Input.value = info.vin;
          fullVinDisplay.value = info.vin;
          fullVinRow.style.display = 'block';
        }
        if (info.odometer) {
          odometerInput.value = info.odometer.replace(/[^0-9]/g, '');
          manheimOdoSet = true;
        }
        if (info.vehicle) {
          vehicleDisplay.value = info.vehicle;
          vehicleName = info.vehicle;
        }
        if (parsedDamages.length > 0) {
          damages = parsedDamages.map(d => ({
            panel: d.panel, type: d.type, severity: 'Minor', chargeable: 'No',
          })).sort((a, b) => a.panel.localeCompare(b.panel));
          renderDamages();
        }
      }

      // Load photos
      if (imageFiles.length > 0) {
        exteriorPhotos = [];
        const photoStatus = document.getElementById('autoPhotoStatus');
        for (let i = 0; i < imageFiles.length; i++) {
          const file = imageFiles[i];
          const dataUrl = await readFileAsDataUrl(file);
          const base64 = dataUrl.split(',')[1];
          exteriorPhotos.push({ dataUrl, resizedBase64: base64, zone: 'exterior' });
          if (photoStatus) photoStatus.textContent = `Loading photos... ${i + 1}/${imageFiles.length}`;
          if ((i + 1) % 5 === 0) renderPreviews('exterior');
        }
        renderPreviews('exterior');
        persistPhotos();
        if (photoStatus) {
          photoStatus.textContent = `${exteriorPhotos.length} photos loaded from Manheim`;
          photoStatus.className = 'field-status ok';
        }
      }

      // Copy photos to ~/Desktop/SA Photos/ via server (for SA file dialog)
      const vin = vin6Input.value.trim();
      if (vin.length === 17) {
        try { await fetch(`${SCRAPER_URL}/manheim/open-folder/${vin}`, { method: 'POST' }); }
        catch { /* server not running — photos still in extension memory */ }
      }

      lookupVIN();

      const dmgCount = damages.length;
      manheimResult.textContent = `Loaded: ${vehicleName || vin} — ${dmgCount} damages, ${imageFiles.length} photos → SA Photos`;
      manheimResult.className = 'scraper-result ok';
      statusDiv.textContent = 'Manheim import complete';
      statusDiv.className = 'status success';
    } catch (err) {
      manheimResult.textContent = 'Error: ' + err.message;
      manheimResult.className = 'scraper-result err';
    }
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ── Queue from server ──
  async function loadQueue() {
    if (!scraperServerAvailable) { queueData = []; return; }
    try {
      const res = await fetch(`${SCRAPER_URL}/queue/all`, { signal: AbortSignal.timeout(2000) });
      const data = await res.json();
      queueData = data.vehicles || [];
    } catch { /* server offline, use empty */ }
  }

  // ── Completed inspections from Carz Inc PWA (Supabase) ──
  // Sorted oldest-first so the cars that have been waiting longest bubble up.
  async function loadCompletedInspections() {
    try {
      const url = `${SUPABASE_URL}/rest/v1/inspections`
        + `?status=eq.complete`
        + `&order=completed_at.asc`
        + `&limit=100`
        + `&select=id,vin,vin_last6,mileage,year,make,model,checklist,completed_at,skipped_at,skipped_by`;
      const res = await fetch(url, {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        console.error('[SupabaseInspections] fetch failed:', res.status, await res.text());
        supabaseCompleted = [];
        return;
      }
      supabaseCompleted = await res.json();
      // Also fetch costs so cards can display total cost
      await loadInventoryCostsForInspections();
    } catch (err) {
      console.error('[SupabaseInspections] fetch error:', err.name, err.message || err);
      supabaseCompleted = [];
    }
  }

  // Batch-fetch total_cost + added_costs for every completed inspection via
  // a single RPC. Builds inventoryCostByLast6 for fast lookup during render.
  async function loadInventoryCostsForInspections() {
    const last6s = [...new Set(
      supabaseCompleted
        .map((i) => (i.vin_last6 || i.vin || '').toUpperCase().slice(-6))
        .filter((v) => v.length >= 5),
    )];
    if (last6s.length === 0) { inventoryCostByLast6 = new Map(); return; }
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/lookup_inventory_costs`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ last6_list: last6s }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        console.error('[InventoryCosts] fetch failed:', res.status);
        inventoryCostByLast6 = new Map();
        return;
      }
      const rows = await res.json();
      const map = new Map();
      for (const r of rows) {
        map.set(String(r.last_6_vin || '').toUpperCase(), {
          totalCost: Number(r.total_cost_num) || 0,  // This is already the complete total
          addedCosts: Number(r.added_costs_num) || 0,
          daysOnLot: r.days_on_lot || null,
        });
      }
      inventoryCostByLast6 = map;
    } catch (err) {
      console.error('[InventoryCosts] error:', err);
      inventoryCostByLast6 = new Map();
    }
  }

  function fmtMoney(n) {
    if (!Number.isFinite(n) || n === 0) return '—';
    return '$' + Math.round(n).toLocaleString();
  }

  function countDamages(checklist) {
    let n = 0;
    const ext = checklist?.exterior || {};
    Object.values(ext).forEach((p) => { n += (p.damages?.length || 0); });
    const int = checklist?.interior || {};
    Object.values(int).forEach((z) => { n += (z.damages?.length || 0); });
    return n;
  }

  function countPhotos(checklist) {
    const photos = checklist?.photos || {};
    return Object.values(photos).filter((p) => p && p.url).length;
  }

  // ── Scrape button ──
  async function scrapeNewTexts() {
    const btn = document.getElementById('scrapeSoldBtn');
    btn.disabled = true;
    btn.textContent = 'Scraping...';
    statusDiv.textContent = 'Scraping new texts...';
    statusDiv.className = 'status';
    try {
      const res = await fetch(`${SCRAPER_URL}/scrape`, { method: 'POST', signal: AbortSignal.timeout(600000) });
      const data = await res.json();
      if (data.success) {
        await loadQueue();
        const newCount = data.new_vehicles || 0;
        statusDiv.textContent = newCount > 0
          ? `Found ${newCount} new vehicle${newCount > 1 ? 's' : ''} from texts. ${queueData.length} in queue.`
          : `No new vehicles. ${queueData.length} in queue.`;
        statusDiv.className = 'status success';
        if (inventory.length > 0) await runCrossCheck();
      } else {
        statusDiv.textContent = data.error || 'Scrape failed';
        statusDiv.className = 'status error';
      }
    } catch (err) {
      if (err.name === 'TimeoutError') {
        statusDiv.textContent = 'Scrape taking too long — try again';
      } else {
        statusDiv.textContent = 'Server not running';
      }
      statusDiv.className = 'status error';
    }
    btn.disabled = false;
    btn.textContent = 'Scrape Texts';
  }

  // ── Event Binding ──
  function bindEvents() {
    // Server control
    serverToggle.addEventListener('click', toggleServer);

    // Mode toggle
    modeQueueBtn.addEventListener('click', () => setMode('queue'));
    modeWizardBtn.addEventListener('click', () => setMode('wizard'));
    modeInfoBtn.addEventListener('click', () => setMode('info'));

    // ── Info tab — auto-search VIN as you type ──
    const infoVinInput = document.getElementById('infoVinInput');
    const infoResult = document.getElementById('infoResult');
    let infoDebounce = null;
    let infoAbort = null;

    infoVinInput.addEventListener('input', () => {
      if (infoDebounce) clearTimeout(infoDebounce);
      const raw = infoVinInput.value.trim().toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');
      if (raw.length < 4) {
        infoResult.innerHTML = '<div style="text-align:center;color:#999;padding:30px;">Enter at least 4 characters</div>';
        return;
      }
      infoResult.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">Searching...</div>';
      infoDebounce = setTimeout(() => infoSearch(raw), 300);
    });

    async function infoSearch(raw) {
      if (infoAbort) infoAbort.abort();
      infoAbort = new AbortController();
      const signal = infoAbort.signal;
      const last6 = raw.length > 6 ? raw.slice(-6) : raw;
      const headers = { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' };

      try {
        // Use RPCs (bypass RLS) — direct table queries are blocked by RLS for anon
        const [vinRes, costRes] = await Promise.all([
          fetch(`${SUPABASE_URL}/rest/v1/rpc/lookup_vin_by_last6`, {
            method: 'POST', headers, signal,
            body: JSON.stringify({ last6: last6.toUpperCase() }),
          }),
          fetch(`${SUPABASE_URL}/rest/v1/rpc/lookup_inventory_costs`, {
            method: 'POST', headers, signal,
            body: JSON.stringify({ last6_list: [last6.toUpperCase()] }),
          }),
        ]);

        if (signal.aborted) return;

        const vinRows = vinRes.ok ? await vinRes.json() : [];
        const costRows = costRes.ok ? await costRes.json() : [];
        const cost = costRows.length > 0 ? costRows[0] : {};

        if (!vinRows || vinRows.length === 0) {
          infoResult.innerHTML = `<div style="text-align:center;padding:30px;"><div style="font-size:36px;margin-bottom:8px;">&#10060;</div><div style="font-weight:700;color:#c62828;font-size:14px;">Not in Inventory</div><div style="color:#999;font-size:11px;margin-top:4px;">"${escHtml(raw)}" not found</div></div>`;
          return;
        }

        let html = '';
        for (const v of vinRows) {
          const yr = v.vehicle_year || '';
          const mk = v.vehicle_make || '';
          const md = v.vehicle_model || '';
          const vin = v.vehicle_vin || '';
          // total_cost_num already includes all costs - don't double count
          const totalCost = Number(cost.total_cost_num || 0);
          const addedCosts = Number(cost.added_costs_num || 0);
          const allIn = totalCost; // total_cost_num is already the complete total
          const daysOnLot = cost.days_on_lot || '';
          const miles = parseInt(String(v.mileage || '').replace(/[^0-9]/g, ''), 10) || 0;
          const buyer = v.buyer || '';
          const vendor = v.vendor || '';
          
          // Check physical_location from vehicle_locations table first
          let locLabel = '—';
          if (v.physical_location) {
            // Auction locations
            if (v.physical_location === 'uax') locLabel = 'UAX';
            else if (v.physical_location === 'daa') locLabel = 'DAA';
            else if (v.physical_location === 'adesa') locLabel = 'ADESA';
            else if (v.physical_location === 'in_transit') locLabel = 'In Transit';
            else if (v.physical_location === 'mechanic') locLabel = 'Mechanic';
            else if (v.physical_location === 'body_shop') locLabel = 'Jorge';
            else if (v.physical_location === 'detail') locLabel = 'Ready / Detail';
            else if (v.physical_location === 'front_lot') locLabel = 'Front Lot';
            else if (v.physical_location !== 'unknown') locLabel = v.physical_location;
          }
          
          // Fall back to location_code if no physical_location
          if (locLabel === '—' && v.location_code) {
            const LOC_CODE = { M: 'Memphis', J: 'Jackson', Z: 'Transport', X: 'Dispatched', A: 'Auction' };
            locLabel = LOC_CODE[v.location_code] || v.location_code || '—';
          }

          html += `<div style="background:#fff;border:1px solid #e0e0e0;border-radius:10px;padding:14px;margin-bottom:8px;">`;
          html += `<div style="font-size:16px;font-weight:800;color:#1a1a2e;margin-bottom:2px;">${escHtml(yr)} ${escHtml(mk)} ${escHtml(md)}</div>`;
          html += `<div style="font-family:monospace;font-size:11px;color:#666;margin-bottom:8px;display:flex;align-items:center;gap:6px;">${escHtml(vin)} <button class="btn btn-small info-copy-vin" data-vin="${escHtml(vin)}" style="margin:0;padding:1px 8px;font-size:9px;background:#1976d2;">Copy</button></div>`;
          if (allIn) {
            html += `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px;margin-bottom:8px;">`;
            html += `<div style="font-size:20px;font-weight:900;color:#166534;">Total: $${Math.round(allIn).toLocaleString()}</div>`;
            if (addedCosts) html += `<div style="font-size:11px;color:#666;">Added costs: $${Math.round(addedCosts).toLocaleString()}</div>`;
            html += `</div>`;
          }
          html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;font-size:12px;">`;
          html += `<div><span style="color:#999;">Buyer</span><br><b>${escHtml(buyer) || '—'}</b></div>`;
          html += `<div><span style="color:#999;">Vendor</span><br><b>${escHtml(vendor) || '—'}</b></div>`;
          html += `<div><span style="color:#999;">Odometer</span><br><b>${miles ? miles.toLocaleString() : '—'}</b></div>`;
          html += `<div><span style="color:#999;">Days on Lot</span><br><b>${daysOnLot !== '' && daysOnLot != null ? `${daysOnLot} days` : '—'}</b></div>`;
          html += `<div><span style="color:#999;">Location</span><br><b>${escHtml(locLabel)}</b></div>`;
          html += `</div></div>`;
        }
        infoResult.innerHTML = html;

        infoResult.querySelectorAll('.info-copy-vin').forEach(btn => {
          btn.addEventListener('click', () => {
            copyToClipboard(btn.dataset.vin);
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
          });
        });
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('[InfoSearch] error:', err);
        infoResult.innerHTML = '<div style="text-align:center;color:#c62828;padding:20px;">Search failed — check connection</div>';
      }
    }

    // Dashboard buttons
    document.getElementById('refreshQueue').addEventListener('click', async () => { await Promise.all([loadQueue(), loadCompletedInspections()]); runCrossCheck(); renderDashList(); });
    document.getElementById('scrapeSoldBtn').addEventListener('click', scrapeNewTexts);

    // Sync chat locations — pulls new messages from CARZ INC / Seller Group /
    // Mechanics / Body shop chats and upserts physical_location to Supabase.
    const syncChatBtn = document.getElementById('syncChatLocationsBtn');
    if (syncChatBtn) syncChatBtn.addEventListener('click', async () => {
      syncChatBtn.disabled = true;
      const orig = syncChatBtn.textContent;
      syncChatBtn.textContent = 'Syncing…';
      statusDiv.textContent = 'Syncing chat locations…';
      statusDiv.className = 'status';
      try {
        const res = await fetch(`${SCRAPER_URL}/scrape-locations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ incremental: true }),
          signal: AbortSignal.timeout(600000),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Sync failed');
        const t = data.totals || {};
        const parts = [];
        for (const [name, s] of Object.entries(t.by_chat || {})) {
          if (s.msgs > 0) parts.push(`${name}: ${s.matched}/${s.msgs}`);
        }
        const body = parts.length ? parts.join(' · ') : 'no new messages';
        statusDiv.textContent = `Chat sync: ${data.upserted} car${data.upserted === 1 ? '' : 's'} updated (${body})`;
        statusDiv.className = 'status success';
      } catch (err) {
        statusDiv.textContent = err.name === 'TimeoutError'
          ? 'Chat sync timed out — try again'
          : 'Chat sync failed: ' + (err.message || String(err));
        statusDiv.className = 'status error';
      } finally {
        syncChatBtn.disabled = false;
        syncChatBtn.textContent = orig;
      }
    });

    // Front Lot Aging Report
    const frontLotAgingBtn = document.getElementById('frontLotAgingBtn');
    if (frontLotAgingBtn) frontLotAgingBtn.addEventListener('click', async () => {
      frontLotAgingBtn.disabled = true;
      const orig = frontLotAgingBtn.textContent;
      frontLotAgingBtn.textContent = 'Loading...';
      statusDiv.textContent = 'Fetching front lot aging data...';
      
      const resultsDiv = document.getElementById('frontLotAgingResults');
      const queueListDiv = document.getElementById('queueList');
      const crossCheckDiv = document.getElementById('crossCheckResults');
      
      try {
        // Initialize the tracker
        const tracker = new FrontLotTracker();
        
        // Get aging vehicles
        const vehicles = await tracker.getFrontLotAging();
        
        // Generate and display report
        resultsDiv.innerHTML = tracker.generateAgingReport(vehicles);
        
        // Initialize event listeners for the report
        tracker.initEventListeners(resultsDiv);
        
        // Show the results and hide others
        resultsDiv.style.display = 'block';
        queueListDiv.style.display = 'none';
        crossCheckDiv.style.display = 'none';
        
        statusDiv.textContent = `Found ${vehicles.length} vehicles on front lot over 10 days old not on SmartAuction`;
        
        // Listen for add to upload list events
        window.addEventListener('addToUploadList', async (event) => {
          const { stockNumbers } = event.detail;
          
          // Update SmartAuction status when added to upload list
          if (stockNumbers && stockNumbers.length > 0) {
            await tracker.updateSmartAuctionStatus(stockNumbers);
            statusDiv.textContent = `Added ${stockNumbers.length} vehicles to upload list and marked as listed`;
          }
        }, { once: true });
        
      } catch (err) {
        console.error('Front lot aging report failed', err);
        statusDiv.textContent = `Report failed: ${err.message}`;
        resultsDiv.innerHTML = `<div style="color: red; padding: 10px;">Error: ${err.message}</div>`;
      }
      
      frontLotAgingBtn.textContent = orig;
      frontLotAgingBtn.disabled = false;
    });

    document.getElementById('runCrossCheck').addEventListener('click', runCrossCheck);
    document.getElementById('queueSearch').addEventListener('input', (e) => {
      queueSearchFilter = e.target.value.toUpperCase();
      renderDashList();
    });
    // SA Export + Inventory upload + Paste Auction Sale Report removed —
    // replaced by the List Uploader block. Sold Report kept for sales
    // reporting. Null-safe the handlers in case the DOM nodes disappear.
    const dashSoldInput = document.getElementById('dashSoldInput');
    if (dashSoldInput) dashSoldInput.addEventListener('change', handleDashSoldUpload);

    // Filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeFilter = btn.dataset.filter;
        renderDashList();
      });
    });

    // Step navigation — circle indicators
    stepIndicators.forEach(el => {
      el.addEventListener('click', () => goToStep(parseInt(el.dataset.step)));
    });
    // All buttons with data-goto (Back/Next in step-nav, toStep2/3/4/5)
    document.querySelectorAll('[data-goto]').forEach(btn => {
      btn.addEventListener('click', () => goToStep(parseInt(btn.dataset.goto)));
    });

    // VIN6 bar copy
    document.getElementById('vin6BarCopy').addEventListener('click', () => {
      const v6 = document.getElementById('vin6BarText').textContent;
      copyToClipboard(v6);
      document.getElementById('vin6BarCopy').textContent = 'Copied!';
      setTimeout(() => { document.getElementById('vin6BarCopy').textContent = 'Copy'; }, 1500);
    });

    // Settings panel toggle
    const openSettingsBtn = document.getElementById('openSettingsBtn');
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');
    if (openSettingsBtn) openSettingsBtn.addEventListener('click', toggleSettings);
    if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', toggleSettings);

    // Scraper buttons
    scrapeBtn.addEventListener('click', () => runScrape());
    scrapeDateBtn.addEventListener('click', () => {
      const body = {};
      if (scrapeStart.value) body.start = scrapeStart.value;
      if (scrapeEnd.value) body.end = scrapeEnd.value;
      if (body.start) body.all = true;
      runScrape(body);
    });
    toggleScrapeDates.addEventListener('click', (e) => {
      e.preventDefault();
      const shown = scraperDates.style.display !== 'none';
      scraperDates.style.display = shown ? 'none' : 'flex';
      toggleScrapeDates.textContent = shown ? 'Custom date range' : 'Hide date range';
    });

    // Scraper: message lookup
    msgLookupBtn.addEventListener('click', lookupFromMessages);

    // Step 2: Inventory upload + VIN lookup + copy + reset
    inventoryInput.addEventListener('change', handleInventoryUpload);
    vin6Input.addEventListener('input', () => {
      const val = vin6Input.value.trim().toUpperCase();
      if (val.length > 6) {
        // Full VIN entered — show it and use last 6 for inventory lookup
        fullVinDisplay.value = val;
        fullVinRow.style.display = 'block';
      }
      lookupVIN();
    });
    copyVinBtn.addEventListener('click', copyFullVIN);
    document.getElementById('copyMiles').addEventListener('click', () => {
      const miles = odometerInput.value.trim();
      if (miles) {
        copyToClipboard(miles);
        document.getElementById('copyMiles').textContent = 'Copied!';
        setTimeout(() => { document.getElementById('copyMiles').textContent = 'Copy'; }, 1500);
      }
    });
    document.getElementById('newVehicleBtn').addEventListener('click', resetForNewVehicle);
    document.getElementById('newVehicleBtn2').addEventListener('click', resetForNewVehicle);
    document.getElementById('openSettingsBtn').addEventListener('click', () => {
      document.getElementById('settingsPanel').style.display = 'block';
    });
    document.getElementById('closeSettingsBtn').addEventListener('click', () => {
      document.getElementById('settingsPanel').style.display = 'none';
    });
    setupManheimDropZone();
    dupTiresBtn.addEventListener('click', duplicateTires);

    // Step 3: Photo uploads (two zones)
    exteriorInput.addEventListener('change', (e) => handleFiles(e.target.files, 'exterior'));
    damageInput.addEventListener('change', (e) => handleFiles(e.target.files, 'damage'));
    setupDragDrop(exteriorZone, 'exterior');
    setupDragDrop(damageZoneEl, 'damage');

    // Step 3: Fill forms
    document.getElementById('fillVIN').addEventListener('click', fillVINOnPage);
    document.getElementById('fillAll').addEventListener('click', fillEverything);
    fillVehicleEntryBtn.addEventListener('click', fillVehicleEntry);
    fillVIWBtn.addEventListener('click', fillVIW);
    discoveryModeBtn.addEventListener('click', runDiscoveryMode);

    // Step 2: Supabase inventory + sold manual refresh (auto-syncs on init)
    const syncInvBtn = document.getElementById('syncSupabaseInvBtn');
    const syncSoldBtn = document.getElementById('syncSupabaseSoldBtn');
    if (syncInvBtn) syncInvBtn.addEventListener('click', () => syncSupabaseInventory({ silent: false }));
    if (syncSoldBtn) syncSoldBtn.addEventListener('click', () => syncSupabaseSold({ silent: false }));

    // Step 2: Manual damage entry
    initDamageUI();
    const dmgQuickInput = document.getElementById('damageQuickInput');
    const dmgQuickBtn = document.getElementById('damageQuickAddBtn');
    const dmgStructBtn = document.getElementById('damageStructuredAddBtn');
    const dmgList = document.getElementById('damageList');
    if (dmgQuickBtn) dmgQuickBtn.addEventListener('click', handleQuickAddDamage);
    if (dmgQuickInput) dmgQuickInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); handleQuickAddDamage(); }
    });
    if (dmgStructBtn) dmgStructBtn.addEventListener('click', handleStructuredAddDamage);
    const dmgStandardsBtn = document.getElementById('damageStandardsBtn');
    if (dmgStandardsBtn) dmgStandardsBtn.addEventListener('click', addStandardDamages);
    if (dmgList) dmgList.addEventListener('click', (e) => {
      const btn = e.target.closest('.damage-remove-btn');
      if (!btn) return;
      const idx = parseInt(btn.dataset.idx, 10);
      if (!Number.isNaN(idx)) {
        damages.splice(idx, 1);
        renderDamages();
        saveSession();
      }
    });

    // ADESA Data Import
    const adesaFileInput = document.getElementById('adesaFileInput');
    if (adesaFileInput) {
      adesaFileInput.addEventListener('change', handleAdesaImport);
    }
  }

  // ── Step Navigation ──
  function goToStep(step) {
    currentStep = step;
    stepIndicators.forEach(el => {
      const s = parseInt(el.dataset.step);
      el.classList.toggle('active', s === step);
      el.classList.toggle('completed', s < step);
    });
    stepContents.forEach(el => {
      el.classList.toggle('active', el.id === `step${step}`);
    });
    // Show vehicle info on step 3 (Fill SmartAuction)
    if (step === 3 && matchedVehicle) {
      const bar = document.getElementById('vehicleInfoBar');
      const cost = matchedVehicle['Total Cost'] || matchedVehicle['total_cost'] || '';
      const odo = matchedVehicle['Mileage'] || matchedVehicle['mileage'] || odometerInput.value || '';
      const fullVin = matchedVehicle.vin || matchedVehicle['Vehicle VIN'] || '';

      if (bar && (cost || fullVin)) {
        bar.style.display = 'block';
        document.getElementById('vehicleCostDisplay').textContent = cost ? `Cost: $${Number(cost).toLocaleString()}` : '';
        document.getElementById('vehicleOdoDisplay').textContent = odo ? `${Number(odo).toLocaleString()} mi` : '';
        document.getElementById('vinText').textContent = fullVin;
        document.getElementById('copyVinBtn2').addEventListener('click', () => {
          copyToClipboard(fullVin);
          document.getElementById('copyVinBtn2').textContent = 'Copied!';
          setTimeout(() => { document.getElementById('copyVinBtn2').textContent = 'Copy'; }, 1500);
        }, { once: true });
      }
    }
    // Update VIN6 bar on every step
    const v6 = vin6Input.value.trim();
    const vin6Bar = document.getElementById('vin6Bar');
    if (v6 && step >= 2 && step <= 3) {
      document.getElementById('vin6BarText').textContent = v6;
      vin6Bar.style.display = 'flex';
    } else {
      vin6Bar.style.display = 'none';
    }
    saveSession();
  }

  // ── Settings Panel Toggle ──
  function toggleSettings() {
    const panel = document.getElementById('settingsPanel');
    if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  }

  // ── Power Apps Config ──
  async function savePowerAppsConfig() {
    const invUrl = powerAppsInventoryUrlInput.value.trim();
    const soldUrl = powerAppsSoldUrlInput.value.trim();
    if (invUrl === '••••••••' && (!soldUrl || soldUrl === '••••••••')) {
      powerAppsStatusDiv.textContent = 'Already configured';
      powerAppsStatusDiv.className = 'field-status ok';
      return;
    }
    if (!invUrl || !invUrl.includes('logic.azure.com')) {
      powerAppsStatusDiv.textContent = 'Enter a valid Power Automate flow URL';
      powerAppsStatusDiv.className = 'field-status err';
      return;
    }
    const save = { powerAppsInventoryUrl: invUrl };
    if (soldUrl && soldUrl !== '••••••••') save.powerAppsSoldUrl = soldUrl;
    await chrome.storage.local.set(save);
    powerAppsInventoryUrlInput.value = '••••••••';
    if (soldUrl && soldUrl !== '••••••••') powerAppsSoldUrlInput.value = '••••••••';
    powerAppsStatusDiv.textContent = 'Power Apps URLs saved';
    powerAppsStatusDiv.className = 'field-status ok';
    powerAppsBadge.textContent = 'Configured';
    powerAppsBadge.className = 'scraper-badge online';
  }

  // ── Power Apps Live Sync ──
  function mapPowerAppsRow(row) {
    return {
      vin:           row['Vehicle VIN'] || row['VehicleVIN'] || row.vin || row.VIN || '',
      'Vehicle VIN': row['Vehicle VIN'] || row['VehicleVIN'] || row.vin || row.VIN || '',
      year:          row['Vehicle Year'] || row['VehicleYear'] || row.year || '',
      'Vehicle Year':row['Vehicle Year'] || row['VehicleYear'] || row.year || '',
      make:          row['Vehicle Make'] || row['VehicleMake'] || row.make || '',
      'Vehicle Make': row['Vehicle Make'] || row['VehicleMake'] || row.make || '',
      model:         row['Vehicle Model'] || row['VehicleModel'] || row.model || '',
      'Vehicle Model':row['Vehicle Model'] || row['VehicleModel'] || row.model || '',
      mileage:       row['Mileage'] || row.mileage || '',
      'Mileage':     row['Mileage'] || row.mileage || '',
      engine:        row['Engine'] || row.engine || '',
      buyer:         row['Buyer'] || row.buyer || '',
      vendor:        row['Vendor'] || row.vendor || '',
      totalCost:     row['Total Cost'] || row['TotalCost'] || row.totalCost || '',
      addedCosts:    row['Added Costs'] || row['AddedCosts'] || row.addedCosts || '',
      daysOnLot:     row['DaysOnLot'] || row.daysOnLot || '',
      titleIn:       row['Title In'] || row['TitleIn'] || row.titleIn || '',
      locationCode:  row['Location Code'] || row['LocationCode'] || row.locationCode || '',
      notes:         row['Vehicle Notes'] || row['VehicleNotes'] || row.notes || '',
      customer:      row['Customer'] || row.customer || '',
      salesPrice:    row['Sales Price'] || row['SalesPrice'] || row.salesPrice || '',
      netProfit:     row['Net Profit'] || row['NetProfit'] || row.netProfit || '',
      saleDate:      row['Sale Date'] || row['SaleDate'] || row.saleDate || '',
      'Stock #':     row['Stock #'] || row.stockNumber || '',
    };
  }

  async function syncFromPowerApps(type) {
    const urlKey = type === 'sold' ? 'powerAppsSoldUrl' : 'powerAppsInventoryUrl';
    const stored = await chrome.storage.local.get([urlKey]);
    const flowUrl = stored[urlKey];

    if (!flowUrl) {
      powerAppsSyncResult.textContent = 'Set up flow URL in Settings first';
      powerAppsSyncResult.className = 'scraper-result err';
      return;
    }

    const btn = type === 'sold' ? syncPowerAppsSoldBtn : syncPowerAppsBtn;
    btn.disabled = true;
    powerAppsSyncResult.textContent = `Syncing ${type}...`;
    powerAppsSyncResult.className = 'scraper-result';
    powerAppsBadge.textContent = 'Syncing...';

    try {
      const res = await fetch(flowUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      if (!res.ok) throw new Error(`Flow returned ${res.status}`);

      const data = await res.json();

      // Power Automate may wrap rows in { value: [...] } or return flat array
      const rows = Array.isArray(data) ? data : (data.value || data.rows || data.data || []);
      if (!rows.length) {
        powerAppsSyncResult.textContent = 'Flow returned 0 rows';
        powerAppsSyncResult.className = 'scraper-result err';
        powerAppsBadge.textContent = 'Empty';
        return;
      }

      const mapped = rows.map(mapPowerAppsRow);

      if (type === 'inventory') {
        inventory = mapped;
        await chrome.storage.local.set({
          inventory: mapped,
          inventoryFull: mapped,
          inventoryDate: Date.now(),
        });
        inventoryStatus.textContent = `${mapped.length} vehicles (live)`;
        inventoryStatus.className = 'inventory-badge loaded';
        const dashInvStatus = document.getElementById('dashInventoryStatus');
        if (dashInvStatus) {
          dashInvStatus.textContent = `${mapped.length} vehicles (live)`;
          dashInvStatus.className = 'upload-file-status loaded';
        }
        lookupVIN();
      } else {
        soldData = mapped;
        await chrome.storage.local.set({ soldData: mapped });
        const dashSoldStatus = document.getElementById('dashSoldStatus');
        if (dashSoldStatus) {
          dashSoldStatus.textContent = `${mapped.length} sold (live)`;
          dashSoldStatus.className = 'upload-file-status loaded';
        }
      }

      powerAppsSyncResult.textContent = `${mapped.length} ${type} vehicles synced`;
      powerAppsSyncResult.className = 'scraper-result ok';
      powerAppsBadge.textContent = 'Synced';
      powerAppsBadge.className = 'scraper-badge online';
      statusDiv.textContent = `Power Apps: ${mapped.length} ${type} vehicles loaded`;
      statusDiv.className = 'status success';
    } catch (err) {
      powerAppsSyncResult.textContent = err.message || 'Sync failed';
      powerAppsSyncResult.className = 'scraper-result err';
      powerAppsBadge.textContent = 'Error';
      console.error('syncFromPowerApps error:', err);
    } finally {
      btn.disabled = false;
    }
  }

  // ── Supabase Live Sync ─────────────────────────────────────────────
  // Pulls inventory + sold tables directly from Supabase (source of truth)
  // via SECURITY DEFINER RPCs (anon SELECT on these tables is RLS-blocked).
  // Keys are normalized to the "Vehicle VIN" / "Stock #" / "Mileage" shape
  // the rest of the extension already consumes (see mapPowerAppsRow).
  function mapSupabaseInventoryRow(r) {
    return {
      vin:            (r.vehicle_vin || '').toUpperCase(),
      'Vehicle VIN':  (r.vehicle_vin || '').toUpperCase(),
      'Last 6 VIN':   (r.last_6_vin || (r.vehicle_vin || '').slice(-6)).toUpperCase(),
      last_6_vin:     (r.last_6_vin || (r.vehicle_vin || '').slice(-6)).toUpperCase(),
      year:           r.vehicle_year || '',
      'Vehicle Year': r.vehicle_year || '',
      make:           r.vehicle_make || '',
      'Vehicle Make': r.vehicle_make || '',
      model:          r.vehicle_model || '',
      'Vehicle Model':r.vehicle_model || '',
      mileage:        r.mileage || '',
      Mileage:        r.mileage || '',
      engine:         r.engine || '',
      buyer:          r.buyer || '',
      vendor:         r.vendor || '',
      totalCost:      r.total_cost || '',
      'Total Cost':   r.total_cost || '',
      addedCosts:     r.added_costs || '',
      daysOnLot:      r.days_on_lot || '',
      titleIn:        r.title_in || '',
      locationCode:   r.location_code || '',
      notes:          r.vehicle_notes || '',
      purchaseDate:   r.purchase_date || '',
      vehicleColor:   r.vehicle_color || '',
      vehicleSource:  r.vehicle_source || '',
      'Stock #':      r.stock_number || '',
      stock_number:   r.stock_number || '',
      // Also keep originals so downstream code that expects snake_case works
      ...r,
    };
  }

  function mapSupabaseSoldRow(r) {
    return {
      vin:            (r.vehicle_vin || '').toUpperCase(),
      'Vehicle VIN':  (r.vehicle_vin || '').toUpperCase(),
      VIN:            (r.vehicle_vin || '').toUpperCase(),
      'Last 6 VIN':   (r.last_6_vin || (r.vehicle_vin || '').slice(-6)).toUpperCase(),
      last_6_vin:     (r.last_6_vin || (r.vehicle_vin || '').slice(-6)).toUpperCase(),
      year:           r.vehicle_year || '',
      'Vehicle Year': r.vehicle_year || '',
      make:           r.vehicle_make || '',
      'Vehicle Make': r.vehicle_make || '',
      model:          r.vehicle_model || '',
      'Vehicle Model':r.vehicle_model || '',
      mileage:        r.mileage || '',
      Mileage:        r.mileage || '',
      salesPrice:     r.sales_price || '',
      'Sales Price':  r.sales_price || '',
      saleDate:       r.sale_date || '',
      'Sale Date':    r.sale_date || '',
      buyer:          r.buyer || '',
      customer:       [r.first_name, r.last_name].filter(Boolean).join(' '),
      'Stock #':      r.stock_number || '',
      stock_number:   r.stock_number || '',
      ...r,
    };
  }

  async function syncSupabaseInventory(opts = {}) {
    const { silent = false } = opts;
    const badge = document.getElementById('supabaseInvBadge');
    const result = document.getElementById('supabaseInvResult');
    if (!silent && badge) badge.textContent = 'Syncing...';
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/list_all_inventory`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`${res.status} — ${body.slice(0, 120)}`);
      }
      const rows = await res.json();
      if (!Array.isArray(rows) || !rows.length) {
        if (badge) { badge.textContent = 'Empty'; badge.className = 'scraper-badge'; }
        if (result && !silent) { result.textContent = 'Supabase returned 0 rows'; result.className = 'scraper-result err'; }
        return;
      }
      const mapped = rows.map(mapSupabaseInventoryRow);
      inventory = mapped;
      await chrome.storage.local.set({
        inventory: mapped,
        inventoryFull: mapped,
        inventoryDate: Date.now(),
      });
      inventoryStatus.textContent = `${mapped.length} vehicles (Supabase)`;
      inventoryStatus.className = 'inventory-badge loaded';
      const dashInvStatus = document.getElementById('dashInventoryStatus');
      if (dashInvStatus) {
        dashInvStatus.textContent = `${mapped.length} vehicles (Supabase)`;
        dashInvStatus.className = 'upload-file-status loaded';
      }
      // Update the "In Inv" stat card directly — cross-check won't run unless
      // SA listings are also loaded, but the raw count should always show.
      const statQueuedEl = document.getElementById('statQueued');
      if (statQueuedEl) statQueuedEl.textContent = mapped.length;
      if (badge) { badge.textContent = `${mapped.length} inv`; badge.className = 'scraper-badge online'; }
      if (result && !silent) { result.textContent = `${mapped.length} inventory rows`; result.className = 'scraper-result ok'; }
      // Re-run the cross-check if SA data is already loaded
      if (saListings.length > 0) runCrossCheck();
    } catch (err) {
      console.error('[syncSupabaseInventory]', err);
      if (badge) { badge.textContent = 'Error'; badge.className = 'scraper-badge offline'; }
      if (result) { result.textContent = (err.message || 'Sync failed').slice(0, 120); result.className = 'scraper-result err'; }
    }
  }

  async function syncSupabaseSold(opts = {}) {
    const { silent = false } = opts;
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/list_all_sold`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`${res.status} — ${body.slice(0, 120)}`);
      }
      const rows = await res.json();
      if (!Array.isArray(rows)) return;
      const mapped = rows.map(mapSupabaseSoldRow);
      soldData = mapped;
      await chrome.storage.local.set({ soldData: mapped });
      const dashSoldStatus = document.getElementById('dashSoldStatus');
      if (dashSoldStatus) {
        dashSoldStatus.textContent = `${mapped.length} sold (Supabase)`;
        dashSoldStatus.className = 'upload-file-status loaded';
      }
      const result = document.getElementById('supabaseInvResult');
      if (result && !silent) { result.textContent = `${mapped.length} sold rows`; result.className = 'scraper-result ok'; }
      if (saListings.length > 0) runCrossCheck();
    } catch (err) {
      console.error('[syncSupabaseSold]', err);
      const result = document.getElementById('supabaseInvResult');
      if (result && !silent) { result.textContent = (err.message || 'Sold sync failed').slice(0, 80); result.className = 'scraper-result err'; }
    }
  }

  // ── Step 2: Manual Damage Entry ──
  // Quick-add damages without the retired AI analyzer. Parses free text
  // ("dent front bumper") into SA-standard panel + type via DamageMapper's
  // PANEL_MAP / TYPE_NORMALIZE — same maps the filler uses downstream, so
  // what the user types here lands cleanly in SA's dropdowns.
  const INTERIOR_SA_PANELS = new Set([
    'Interior', 'Dashboard', 'Steering Wheel',
    'Seat - Driver', 'Seat - Passenger', 'Seat - Rear',
    'Driver Door Panel', 'Passenger Door Panel',
    'Headliner', 'Carpet/Floor', 'Console'
  ]);

  // Standard damages applied to every car — these are the disclosures that
  // always need to go on the SA condition report regardless of vehicle
  // specifics. Auto-added on "New Vehicle" / reset, and available via the
  // "+ Std" button at any time.
  const STANDARD_DAMAGES = [
    { panel: 'Bumper - Front',     type: 'Paint Chip', description: 'multiple' },
    { panel: 'Hood',               type: 'Paint Chip', description: 'multiple' },
    { panel: 'Driver Door Panel',  type: 'Worn',       description: '' },
    { panel: 'Seat - Driver',      type: 'Worn',       description: '' },
    { panel: 'Steering Wheel',     type: 'Worn',       description: '' },
    { panel: 'Dashboard',          type: 'Worn',       description: 'radio/buttons' },
    { panel: 'Console',            type: 'Worn',       description: '' },
  ];

  function addStandardDamages() {
    // Don't duplicate if standards are already present (match by panel+type).
    const existing = new Set(damages.map((d) => `${d.panel}|${d.type}`));
    let added = 0;
    for (const s of STANDARD_DAMAGES) {
      if (existing.has(`${s.panel}|${s.type}`)) continue;
      damages.push({
        panel: s.panel,
        type: s.type,
        description: s.description,
        chargeable: 'No',
        estimatedCost: 0,
        photos: [],
        category: INTERIOR_SA_PANELS.has(s.panel) ? 'Interior' : 'Exterior',
      });
      added++;
    }
    if (added > 0) { renderDamages(); saveSession(); }
    return added;
  }

  function initDamageUI() {
    if (typeof DamageMapper === 'undefined') return;
    const panelSel = document.getElementById('damagePanelSelect');
    const typeSel = document.getElementById('damageTypeSelect');
    if (!panelSel || !typeSel) return;
    if (panelSel.options.length > 1) return; // already populated

    const panels = [...new Set(Object.values(DamageMapper.PANEL_MAP))].sort();
    panels.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      panelSel.appendChild(opt);
    });
    DamageMapper.SA_DAMAGE_TYPES.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      typeSel.appendChild(opt);
    });
    renderDamages();
  }

  // Extra panel synonyms not in DamageMapper.PANEL_MAP — cover truck/bed
  // vocabulary and loose phrases the user actually types.
  const EXTRA_PANEL_SYNONYMS = {
    'bed side':         'Quarter Panel - Right', // ambiguous; override with left/right below
    'left bed':         'Quarter Panel - Left',
    'right bed':        'Quarter Panel - Right',
    'bed':              'Bed',
    'tailgate':         'Tailgate',
    'frame':            'Frame',
    'hitch':            'Hitch',
    'frame/hitch':      'Frame',
    'undercarriage':    'Undercarriage',
    'exhaust':          'Exhaust',
    'running board':    'Running Board',
    'left running board':  'Running Board - Left',
    'right running board': 'Running Board - Right',
    'step bar':         'Running Board',
    // Quarters without the "panel" suffix (the canonical PANEL_MAP key
    // requires it; users don't always type it).
    'left quarter':     'Quarter Panel - Left',
    'right quarter':    'Quarter Panel - Right',
    'lf quarter':       'Quarter Panel - Left',
    'rr quarter':       'Quarter Panel - Right',
    'rf quarter':       'Quarter Panel - Right',
    'lr quarter':       'Quarter Panel - Left',
    // "Rear fender" / "fender flare" — physically the quarter panel area.
    // Longer keys beat the bare "right fender" in PANEL_MAP via longest-
    // match-wins, so these correctly route to the rear.
    'right rear fender': 'Quarter Panel - Right',
    'left rear fender':  'Quarter Panel - Left',
    'rear fender':       'Quarter Panel - Right',
    'right fender flare':'Quarter Panel - Right',
    'left fender flare': 'Quarter Panel - Left',
    'fender flare':      'Quarter Panel - Right',
    // Interior door trim (not the exterior door). Must be longer than the
    // exterior door keys ("driver front door") so longest-match-wins picks
    // these when the user types "panel" after "door".
    'driver front door panel':    'Driver Door Panel',
    'driver door panel':          'Driver Door Panel',
    'passenger front door panel': 'Passenger Door Panel',
    'passenger door panel':       'Passenger Door Panel',
    'left front door panel':      'Driver Door Panel',
    'right front door panel':     'Passenger Door Panel',
    'left door panel':            'Driver Door Panel',
    'right door panel':           'Passenger Door Panel',
    'driver rear door panel':     'Rear Door Panel - Left',
    'passenger rear door panel':  'Rear Door Panel - Right',
    'left rear door panel':       'Rear Door Panel - Left',
    'right rear door panel':      'Rear Door Panel - Right',
    // Seat positional synonyms — PANEL_MAP only knows "driver/passenger
    // seat", so a user typing "left front seat" falls through. Driver = left,
    // passenger = right in US-market vehicles.
    'left front seat':   'Seat - Driver',
    'right front seat':  'Seat - Passenger',
    'driver front seat': 'Seat - Driver',
    'passenger front seat': 'Seat - Passenger',
    'front seat':        'Seat - Driver',
    'left rear seat':    'Seat - Rear',
    'right rear seat':   'Seat - Rear',
    'back seat':         'Seat - Rear',
    'left seat':         'Seat - Driver',
    'right seat':        'Seat - Passenger',
    // Dashboard warning lights — common wholesale disclosures.
    'tpms':              'Dashboard',
    'tpms light':        'Dashboard',
    'tire pressure':     'Dashboard',
    'warning light':     'Dashboard',
    'check engine':      'Dashboard',
    'engine light':      'Dashboard',
    'abs light':         'Dashboard',
    'airbag light':      'Dashboard',
    'service light':     'Dashboard',
    'srs light':         'Dashboard',
    'oil light':         'Dashboard',
    'battery light':     'Dashboard',
    'dashboard warning': 'Dashboard',
    'dash warning':      'Dashboard',
  };

  // Extra type aliases on top of DamageMapper.TYPE_NORMALIZE — catches
  // phrasings a wholesale operator actually types.
  const EXTRA_TYPE_SYNONYMS = {
    'substandard repair':  'Other',
    'sub-standard repair': 'Other',
    'bad repair':          'Other',
    'poor repair':         'Other',
    'prior repair':        'Other',
    'previous repair':     'Other',
    'previously repaired': 'Other',
    'aftermarket':         'Other',
    'cracked glass':       'Crack',
    'broken glass':        'Broken',
    'chipped glass':       'Chip',
    'peeling':             'Paint Damage',
    'oxidized':            'Faded',
    'oxidation':           'Faded',
    'gouged':              'Scratch',
    'scuffed':             'Scuff',
  };

  function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // Escape HTML to avoid rendering user input as markup inside the chip list.
  // escHtml is defined lower in the file — provide a safe fallback here so the
  // hoisted damage UI never crashes if a render fires before that definition.
  function safeEscHtml(s) {
    try { return escHtml(s); } catch (_) {
      return String(s || '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }
  }

  function parseDamageText(text) {
    if (!text || typeof DamageMapper === 'undefined') return null;
    const q = text.toLowerCase().trim();
    if (!q) return null;

    // Longest-keyword-wins scan so "front bumper" beats "bumper".
    let panel = '', panelLen = 0, panelKey = '';
    for (const [key, val] of Object.entries(DamageMapper.PANEL_MAP)) {
      if (q.includes(key) && key.length > panelLen) { panel = val; panelLen = key.length; panelKey = key; }
    }
    for (const [key, val] of Object.entries(EXTRA_PANEL_SYNONYMS)) {
      if (q.includes(key) && key.length > panelLen) { panel = val; panelLen = key.length; panelKey = key; }
    }

    let type = '', typeLen = 0, typeKey = '';
    for (const [key, val] of Object.entries(DamageMapper.TYPE_NORMALIZE)) {
      if (q.includes(key) && key.length > typeLen) { type = val; typeLen = key.length; typeKey = key; }
    }
    for (const [key, val] of Object.entries(EXTRA_TYPE_SYNONYMS)) {
      if (q.includes(key) && key.length > typeLen) { type = val; typeLen = key.length; typeKey = key; }
    }
    if (!type) {
      for (const t of DamageMapper.SA_DAMAGE_TYPES) {
        const lt = t.toLowerCase();
        if (q.includes(lt) && lt.length > typeLen) { type = t; typeLen = lt.length; typeKey = lt; }
      }
    }

    // Strip the matched panel + type keywords out of the description — the
    // panel goes in SA's LOCATION field and the type is already the prefix
    // the filler prepends, so duplicating them in DESCRIPTION eats the
    // 50-char budget for no gain.
    let desc = text.trim();
    if (panelKey) desc = desc.replace(new RegExp(escapeRegex(panelKey), 'gi'), ' ');
    if (typeKey) desc = desc.replace(new RegExp(escapeRegex(typeKey), 'gi'), ' ');
    desc = desc.replace(/\s+/g, ' ')
               .replace(/^[\s,;.:/-]+|[\s,;.:/-]+$/g, '')
               .trim();
    return { panel, type: type || '', description: desc };
  }

  // Split a multi-damage blob into separate entries. Handles the punctuation
  // + conjunctions the user actually types: commas, semicolons, newlines,
  // periods, " and ", " + ". A standalone "/" is left alone because of usages
  // like "frame/hitch" or "dent/scratch" inside a single clause.
  function splitDamageInput(text) {
    if (!text) return [];
    const parts = text
      .split(/\n|;|\.|(?:\s+and\s+)|(?:\s*,\s*)|(?:\s*\+\s*)/i)
      .map((s) => s.trim())
      .filter((s) => s.length > 1);
    return parts.length ? parts : [text.trim()];
  }

  function addDamage({ panel, type, description }) {
    const clean = {
      panel: panel || '',
      type: type || '',
      description: description || '',
      chargeable: 'No',
      estimatedCost: 0,
      photos: [],
      category: INTERIOR_SA_PANELS.has(panel) ? 'Interior' : 'Exterior',
    };
    damages.push(clean);
    renderDamages();
    saveSession();
  }

  function renderDamages() {
    const list = document.getElementById('damageList');
    if (!list) return;
    if (!damages.length) {
      list.innerHTML = '<div style="font-size:11px;color:#999;padding:4px 0;">No damages added</div>';
      return;
    }
    list.innerHTML = damages.map((d, i) => {
      // Always show panel · type so standards like "multiple" have context.
      // Description appended after " — " if present.
      const head = [d.panel, d.type].filter(Boolean).join(' · ');
      const desc = (d.description || '').trim();
      const body = desc ? (head ? ` — ${safeEscHtml(desc)}` : safeEscHtml(desc)) : '';
      const label = (head ? safeEscHtml(head) : '') + body || '—';
      return `<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;padding:4px 8px;background:#f5f5f5;border:1px solid #e0e0e0;border-radius:4px;font-size:11px;">
        <span>${label}</span>
        <button class="damage-remove-btn" data-idx="${i}" style="margin:0;padding:0 6px;background:#c62828;color:#fff;border:none;border-radius:3px;cursor:pointer;font-size:12px;line-height:18px;">×</button>
      </div>`;
    }).join('');
  }

  function handleQuickAddDamage() {
    const input = document.getElementById('damageQuickInput');
    if (!input) return;
    const raw = input.value;
    if (!raw.trim()) return;
    const parts = splitDamageInput(raw);
    let added = 0;
    for (const part of parts) {
      const parsed = parseDamageText(part);
      if (parsed) { addDamage(parsed); added++; }
    }
    input.value = '';
    input.focus();
    // If nothing parsed, drop the raw text as an "Other" row so the user
    // doesn't lose their typing.
    if (added === 0) addDamage({ panel: '', type: '', description: raw.trim() });
  }

  function handleStructuredAddDamage() {
    const panelSel = document.getElementById('damagePanelSelect');
    const typeSel = document.getElementById('damageTypeSelect');
    const descEl = document.getElementById('damageDescInput');
    const panel = panelSel.value;
    const type = typeSel.value;
    const description = descEl.value.trim();
    if (!panel && !type && !description) return;
    addDamage({ panel, type, description });
    panelSel.value = '';
    typeSel.value = '';
    descEl.value = '';
  }

  // ── ADESA Data Import ──
  async function handleAdesaImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    statusDiv.textContent = 'Loading ADESA data...';
    statusDiv.className = 'status';
    
    try {
      const text = await file.text();
      const adesaData = JSON.parse(text);
      
      // Use AdesaBridge to convert the data
      if (typeof window.AdesaBridge === 'undefined') {
        statusDiv.textContent = 'Error: ADESA bridge not loaded';
        statusDiv.className = 'status error';
        return;
      }
      
      const converted = window.AdesaBridge.convertVehicleData(adesaData);
      
      // Fill VIN fields
      if (converted.vin) {
        const last6 = converted.vin.slice(-6);
        vin6Input.value = last6;
        document.getElementById('fullVin').value = converted.vin;
      }
      
      // Fill mileage
      if (converted.mileage) {
        odometerInput.value = converted.mileage.toString().replace(/\D/g, '');
      }
      
      // Clear existing damages and add ADESA damages
      damages = [];
      if (converted.damages && converted.damages.length > 0) {
        converted.damages.forEach(damage => {
          // Map ADESA damage format to SmartAuction format
          addDamage({
            panel: damage.panel || 'Unknown',
            type: damage.type || 'Damage',
            description: damage.description || `${damage.type} on ${damage.panel}`,
            severity: damage.severity || '',
            chargeable: damage.chargeable || 'No',
            estimatedCost: damage.estimatedCost || 0,
            category: damage.category || 'Exterior'
          });
        });
      }
      
      // Update vehicle info display
      if (adesaData.year && adesaData.make && adesaData.model) {
        const vehicleStr = `${adesaData.year} ${adesaData.make} ${adesaData.model}`;
        document.getElementById('vehicleTitle').textContent = vehicleStr;
      }
      
      renderDamages();
      saveSession();
      
      statusDiv.textContent = `Loaded: ${converted.vin ? converted.vin.slice(-6) : 'Unknown'} - ${damages.length} damages`;
      statusDiv.className = 'status success';
      
      // Reset file input so the same file can be selected again
      e.target.value = '';
      
    } catch (err) {
      console.error('ADESA import error:', err);
      statusDiv.textContent = 'Error loading ADESA file: ' + err.message;
      statusDiv.className = 'status error';
    }
  }

  // ── Step 2: Tire Duplication ──
  function duplicateTires() {
    const frRow = document.querySelector('.tire-row[data-pos="FR"]');
    const mfr = frRow.querySelector('.tire-mfr').value;
    const size = frRow.querySelector('.tire-size').value;
    const tread = frRow.querySelector('.tire-tread').value;
    const damage = frRow.querySelector('.tire-damage').value;

    document.querySelectorAll('.tire-row').forEach(row => {
      if (row.dataset.pos === 'FR') return;
      row.querySelector('.tire-mfr').value = mfr;
      row.querySelector('.tire-size').value = size;
      row.querySelector('.tire-tread').value = tread;
      row.querySelector('.tire-damage').value = damage;
    });
  }

  // ── Step 2: Inventory Upload ──
  async function handleInventoryUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    inventoryStatus.textContent = 'Parsing...';
    inventoryStatus.className = 'inventory-badge';

    try {
      const buffer = await file.arrayBuffer();
      const rows = await XLSXParser.parse(buffer);

      if (!rows.length) {
        inventoryStatus.textContent = 'No data found in file';
        return;
      }

      // Normalize column names (handle slight variations)
      inventory = rows.map(row => {
        const norm = {};
        for (const [key, val] of Object.entries(row)) {
          norm[key.trim()] = val;
        }
        return norm;
      });

      // Persist to storage (only keep VIN-related fields to save space)
      const slim = inventory.map(r => ({
        vin: String(r['Vehicle VIN'] || ''),
        year: r['Vehicle Year'] || '',
        make: r['Vehicle Make'] || '',
        model: r['Vehicle Model'] || '',
        mileage: r['Mileage'] || '',
        engine: r['Engine'] || '',
        buyer: r['Buyer'] || '',
        vendor: r['Vendor'] || ''
      }));
      const fullRows = inventory; // keep full rows for cross-check
      const now = Date.now();
      await chrome.storage.local.set({ inventory: slim, inventoryDate: now, inventoryFull: fullRows });
      // Keep inventory as full format so cross-check works from either mode
      inventory = fullRows;

      inventoryStatus.textContent = `${inventory.length} vehicles (just updated)`;
      inventoryStatus.className = 'inventory-badge loaded';

      // If VIN already entered, re-lookup
      if (vin6Input.value.length >= 4) lookupVIN();

    } catch (err) {
      inventoryStatus.textContent = 'Error: ' + err.message;
      console.error('Inventory parse error:', err);
    }
  }

  function lookupVIN() {
    const raw = vin6Input.value.trim().toUpperCase();
    // Use last 6 for inventory matching regardless of input length
    const input = raw.length > 6 ? raw.slice(-6) : raw;
    const isFullVin = raw.length > 6;

    if (input.length < 4) {
      inventoryMatch.classList.remove('visible');
      if (!isFullVin) fullVinRow.style.display = 'none';
      matchedVehicle = null;
      vehicleDisplay.value = '';
      return;
    }

    // No local inventory uploaded — try Supabase directly
    if (inventory.length === 0) {
      lookupVINFromSupabase(input, isFullVin);
      return;
    }

    // Match last N chars of VIN (handles both slim and full format)
    const matches = inventory.filter(v => {
      const vin = String(v.vin || v['Vehicle VIN'] || '').toUpperCase();
      return vin.length >= input.length && vin.endsWith(input);
    });

    inventoryMatch.classList.add('visible');

    if (matches.length === 1) {
      matchedVehicle = matches[0];
      const v = matchedVehicle;
      const yr = v.year || v['Vehicle Year'] || '';
      const mk = v.make || v['Vehicle Make'] || '';
      const md = v.model || v['Vehicle Model'] || '';
      const fullVin = v.vin || v['Vehicle VIN'] || '';
      // 'Total Cost' field already includes all costs - don't double count
      const totalCost = Number(v['Total Cost'] || v.total_cost || 0);
      const addedCosts = Number(v['Added Costs'] || v.added_costs || 0);
      const allIn = totalCost; // Total Cost is already the complete total
      const mileage = v.mileage || v['Mileage'] || '';
      const milesNum = parseInt(String(mileage).replace(/[^0-9]/g, ''), 10) || 0;
      const buyer = v.buyer || v['Buyer'] || v['Purchased From'] || '';
      const stock = v.stock_number || v['Stock #'] || v['Stock Number'] || '';
      const daysOnLot = v.days_on_lot || v['Days on Lot'] || '';

      // Vehicle info card with full details
      let html = `<span class="match-found" style="font-weight:700;">${escHtml(yr)} ${escHtml(mk)} ${escHtml(md)}</span>`;
      html += `<div style="margin-top:6px;padding:8px 10px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;font-size:11px;line-height:1.7;">`;
      if (allIn) html += `<div style="font-size:14px;font-weight:800;color:#166534;">Total Cost: $${Math.round(allIn).toLocaleString()}</div>`;
      if (addedCosts) html += `<div style="color:#666;">Added costs: $${Math.round(addedCosts).toLocaleString()}</div>`;
      if (milesNum) html += `<div><b>Miles:</b> ${milesNum.toLocaleString()}</div>`;
      if (daysOnLot) html += `<div><b>Age:</b> ${daysOnLot} days</div>`;
      if (buyer) html += `<div><b>Buyer:</b> ${escHtml(buyer)}</div>`;
      if (stock) html += `<div><b>Stock:</b> ${escHtml(stock)}</div>`;
      html += `</div>`;
      inventoryMatch.innerHTML = html;
      vehicleDisplay.value = `${yr} ${mk} ${md}`;

      // Show full VIN with copy button
      fullVinDisplay.value = fullVin;
      fullVinRow.style.display = 'block';

      // Auto-fill odometer from inventory — but don't override Manheim listing miles
      if (mileage && !manheimOdoSet) {
        odometerInput.value = String(mileage).replace(/[^0-9]/g, '');
      }

      // Also auto-lookup from scraped messages
      lookupFromMessages();
    } else if (matches.length > 1) {
      matchedVehicle = null;
      vehicleDisplay.value = '';
      if (!isFullVin) fullVinRow.style.display = 'none';
      const list = matches.slice(0, 3).map(v => `${v.year} ${v.make} ${v.model}`).join(', ');
      const extra = matches.length > 3 ? ` +${matches.length - 3} more` : '';
      inventoryMatch.innerHTML = `<span class="match-multi">${matches.length} matches: ${list}${extra}</span>`;
    } else {
      // No local match — try Supabase
      lookupVINFromSupabase(input, isFullVin);
    }
  }

  // Supabase fallback: look up vehicle details when no local inventory spreadsheet is loaded
  async function lookupVINFromSupabase(last6, isFullVin) {
    inventoryMatch.classList.add('visible');
    inventoryMatch.innerHTML = '<span style="color:#999;font-size:11px;">Looking up in Supabase...</span>';
    const headers = { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' };
    try {
      // Use RPCs (bypass RLS) — direct table queries are blocked for anon key
      const [vinRes, costRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/rpc/lookup_vin_by_last6`, {
          method: 'POST', headers, body: JSON.stringify({ last6: last6.toUpperCase() }),
          signal: AbortSignal.timeout(5000),
        }),
        fetch(`${SUPABASE_URL}/rest/v1/rpc/lookup_inventory_costs`, {
          method: 'POST', headers, body: JSON.stringify({ last6_list: [last6.toUpperCase()] }),
          signal: AbortSignal.timeout(5000),
        }),
      ]);

      const vinRows = vinRes.ok ? await vinRes.json() : [];
      const costRows = costRes.ok ? await costRes.json() : [];
      const costData = costRows.length > 0 ? costRows[0] : null;
      const v = vinRows.length > 0 ? vinRows[0] : null;

      if (!v && !costData) {
        matchedVehicle = null;
        vehicleDisplay.value = '';
        if (!isFullVin) fullVinRow.style.display = 'none';
        inventoryMatch.innerHTML = '<span class="match-none">Not found in inventory</span>';
        return;
      }

      const yr = v?.vehicle_year || '';
      const mk = v?.vehicle_make || '';
      const md = v?.vehicle_model || '';
      const fullVin = v?.vehicle_vin || '';
      const stock = v?.stock_number || '';
      // total_cost_num already includes all costs - don't double count
      const totalCost = Number(costData?.total_cost_num || 0);
      const addedCosts = Number(costData?.added_costs_num || 0);
      const allIn = totalCost; // total_cost_num is already the complete total
      const daysOnLot = costData?.days_on_lot || '';

      matchedVehicle = v || {};
      vehicleDisplay.value = `${yr} ${mk} ${md}`;

      if (fullVin) {
        fullVinDisplay.value = fullVin;
        fullVinRow.style.display = 'block';
      }

      let html = `<span class="match-found" style="font-weight:700;">${escHtml(yr)} ${escHtml(mk)} ${escHtml(md)}</span>`;
      html += `<div style="margin-top:6px;padding:8px 10px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;font-size:11px;line-height:1.7;">`;
      if (allIn) html += `<div style="font-size:14px;font-weight:800;color:#166534;">Total Cost: $${Math.round(allIn).toLocaleString()}</div>`;
      if (addedCosts) html += `<div style="color:#666;">Added costs: $${Math.round(addedCosts).toLocaleString()}</div>`;
      if (daysOnLot) html += `<div><b>Age:</b> ${daysOnLot} days</div>`;
      if (stock) html += `<div><b>Stock:</b> ${escHtml(stock)}</div>`;
      html += `</div>`;
      inventoryMatch.innerHTML = html;

      lookupFromMessages();
    } catch (err) {
      console.error('[lookupVINFromSupabase] error:', err);
      matchedVehicle = null;
      vehicleDisplay.value = '';
      if (!isFullVin) fullVinRow.style.display = 'none';
      inventoryMatch.innerHTML = '<span class="match-none">Lookup failed</span>';
    }
  }

  function copyFullVIN() {
    const vin = fullVinDisplay.value;
    if (!vin) return;
    copyToClipboard(vin);
    copyVinBtn.textContent = 'Copied!';
    setTimeout(() => { copyVinBtn.textContent = 'Copy'; }, 1500);
  }

  async function resetForNewVehicle() {
    // ── Step 2: Vehicle Info ──
    vin6Input.value = '';
    odometerInput.value = '';
    vehicleDisplay.value = '';
    fullVinDisplay.value = '';
    fullVinRow.style.display = 'none';
    inventoryMatch.innerHTML = '';
    inventoryMatch.classList.remove('visible');
    matchedVehicle = null;
    manheimOdoSet = false;
    // Scraper / message lookup results
    document.getElementById('msgLookupResult').innerHTML = '';
    document.getElementById('msgLookupResult').className = 'msg-lookup-result';
    document.getElementById('scrapeResult').textContent = '';
    document.getElementById('manheimResult').textContent = '';

    // ── Step 3: Photos + Tires ──
    exteriorPhotos = [];
    damagePhotos = [];
    renderPreviews('exterior');
    renderPreviews('damage');
    await PhotoDB.clear().catch(() => {});
    document.getElementById('autoPhotoStatus').textContent = '';
    // Tires
    document.querySelectorAll('.tire-row').forEach(row => {
      row.querySelector('.tire-mfr').value = '';
      row.querySelector('.tire-size').value = '';
      row.querySelector('.tire-tread').value = '';
      row.querySelector('.tire-damage').value = 'None';
    });

    // ── Damages state reset ──
    // Every new car starts with the seven standard disclosures (front bumper +
    // hood chips, wear items). User can remove or add more on top.
    damages = [];
    addStandardDamages();
    renderDamages();

    // ── Step 3: Fill Forms ──
    fillLog.innerHTML = '';
    fillLog.classList.remove('visible');
    const vehicleInfoBar = document.getElementById('vehicleInfoBar');
    if (vehicleInfoBar) vehicleInfoBar.style.display = 'none';

    // ── VIN6 bar ──
    document.getElementById('vin6Bar').style.display = 'none';
    document.getElementById('vin6BarText').textContent = '';

    // Clear session
    await chrome.storage.local.remove(['sessionData']);

    // Go to step 1 (Vehicle Info)
    goToStep(1);
    statusDiv.textContent = 'Ready for new vehicle';
    statusDiv.className = 'status success';
  }

  // ── Step 3: Photo Upload ──
  function setupDragDrop(zone, type) {
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', () => {
      zone.classList.remove('drag-over');
    });
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      handleFiles(e.dataTransfer.files, type);
    });
  }

  async function handleFiles(fileList, zone) {
    // Accept image files AND heic (which may not have image/ mime type)
    const files = Array.from(fileList).filter(f =>
      f.type.startsWith('image/') || f.name.toLowerCase().endsWith('.heic') || f.name.toLowerCase().endsWith('.heif')
    );
    if (!files.length) return;

    // Warn if damage photos exceed a reasonable limit for the API
    const target = zone === 'exterior' ? exteriorPhotos : damagePhotos;
    if (zone === 'damage' && target.length + files.length > 30) {
      statusDiv.textContent = `Warning: ${target.length + files.length} damage photos — API costs increase with count`;
      statusDiv.className = 'status error';
    }

    // Process in parallel chunks — resize is CPU-bound on the browser's image
    // decoder but browsers can run several decodes concurrently. 6 is a
    // reasonable sweet spot between throughput and keeping the UI responsive.
    const CHUNK = 6;
    let failed = 0;
    for (let i = 0; i < files.length; i += CHUNK) {
      const chunk = files.slice(i, i + CHUNK);
      const results = await Promise.all(chunk.map(async (file) => {
        try {
          const resized = await resizeImage(file, 768, 576);
          return { dataUrl: resized.dataUrl, resizedBase64: resized.base64, zone };
        } catch (e) {
          console.warn('Skipping bad image:', file.name, e.message);
          return null;
        }
      }));
      for (const r of results) {
        if (r) target.push(r); else failed++;
      }
      // Incremental render so the user sees progress on large drops.
      renderPreviews(zone);
    }
    if (failed > 0) {
      statusDiv.textContent = `${failed} image(s) could not be processed`;
      statusDiv.className = 'status error';
    }
    saveSession();
    persistPhotos();
  }

  function persistPhotos() {
    // No longer persisting to IndexedDB — photos load fresh from server each time
    // This saves significant memory and storage
  }

  function resizeImage(file, maxW, maxH) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Resize timeout: ${file.name}`)), 15000);
      const reader = new FileReader();
      reader.onerror = () => { clearTimeout(timeout); reject(new Error(`Failed to read: ${file.name}`)); };
      reader.onload = (e) => {
        const dataUrl = e.target.result;
        const img = new Image();
        img.onerror = () => {
          clearTimeout(timeout);
          // Browser can't decode (likely HEIC) — use raw data URL without resize
          const base64 = dataUrl.split(',')[1] || '';
          resolve({ dataUrl, base64 });
        };
        img.onload = () => {
          clearTimeout(timeout);
          let w = img.width;
          let h = img.height;
          if (w > maxW || h > maxH) {
            const ratio = Math.min(maxW / w, maxH / h);
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          const jpegUrl = canvas.toDataURL('image/jpeg', 0.85);
          const base64 = jpegUrl.split(',')[1];
          resolve({ dataUrl: jpegUrl, base64 });
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    });
  }

  // Create a tiny thumbnail to save memory (80x60 vs 768x576)
  function makeThumbnail(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 80;
        canvas.height = 60;
        canvas.getContext('2d').drawImage(img, 0, 0, 80, 60);
        resolve(canvas.toDataURL('image/jpeg', 0.5));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  function buildPhotoTile(p, photos, zone) {
    const wrap = document.createElement('div');
    wrap.className = 'photo-thumb-wrap';

    const img = document.createElement('img');
    img.className = 'photo-thumb';
    img.loading = 'lazy';
    img.decoding = 'async';
    // Prefer cached thumb; generate in background if we only have the full
    // dataUrl. Keeping the generation async means the initial render isn't
    // blocked on decoding the full 768x576 JPEG for every tile.
    if (p.thumbUrl) {
      img.src = p.thumbUrl;
    } else if (p.dataUrl) {
      img.src = p.dataUrl;
      makeThumbnail(p.dataUrl).then(thumb => {
        p.thumbUrl = thumb;
        img.src = thumb;
        delete p.dataUrl; // free memory once a thumb exists
      }).catch(() => {});
    }

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-photo';
    removeBtn.textContent = 'x';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = photos.indexOf(p);
      if (idx >= 0) photos.splice(idx, 1);
      // Remove this tile from the DOM directly — no full grid rebuild.
      wrap.remove();
      const countEl = zone === 'exterior' ? exteriorCountEl : damageCountEl;
      if (countEl) countEl.textContent = `${photos.length} photo${photos.length !== 1 ? 's' : ''}`;
      saveSession();
      persistPhotos();
    });

    wrap.appendChild(img);
    wrap.appendChild(removeBtn);
    return wrap;
  }

  function renderPreviews(zone) {
    const photos = zone === 'exterior' ? exteriorPhotos : damagePhotos;
    const container = zone === 'exterior' ? exteriorPreviews : damagePreviews;
    const countEl = zone === 'exterior' ? exteriorCountEl : damageCountEl;

    const existing = container.children.length;
    if (existing > photos.length) {
      // A photo was removed outside the per-tile handler (e.g. reset): rebuild.
      container.innerHTML = '';
      const frag = document.createDocumentFragment();
      for (const p of photos) frag.appendChild(buildPhotoTile(p, photos, zone));
      container.appendChild(frag);
    } else if (existing < photos.length) {
      // Incremental: append only the new tiles. Avoids re-decoding every
      // image when the user adds a batch (the expensive part).
      const frag = document.createDocumentFragment();
      for (let i = existing; i < photos.length; i++) {
        frag.appendChild(buildPhotoTile(photos[i], photos, zone));
      }
      container.appendChild(frag);
    }
    countEl.textContent = `${photos.length} photo${photos.length !== 1 ? 's' : ''}`;
  }

  // ── Step 3: Fill Forms ──
  function log(msg, cls = 'log-info') {
    fillLog.classList.add('visible');
    const div = document.createElement('div');
    div.className = `log-entry ${cls}`;
    div.textContent = msg;
    fillLog.appendChild(div);
    fillLog.scrollTop = fillLog.scrollHeight;
  }

  function clearLog() {
    fillLog.innerHTML = '';
    fillLog.classList.remove('visible');
  }

  // Inject content script if not already loaded, then send message
  async function injectAndSend(tab, message) {
    try {
      // Try sending first — if content script is already there, this works
      return await chrome.tabs.sendMessage(tab.id, message);
    } catch (e) {
      // Content script not loaded — inject the correct one based on action
      const isVIW = message.action === 'fillVIW' &&
                    (tab.url.includes('directinspect') || !tab.url.includes('smartauction'));
      const contentScript = isVIW ? 'content-viw.js' : 'content.js';
      log(`Injecting ${contentScript}...`, 'log-info');
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['lib/form-mapper.js', 'lib/damage-mapper.js', contentScript]
      });
      await new Promise(r => setTimeout(r, 300));
      return await chrome.tabs.sendMessage(tab.id, message);
    }
  }

  async function fillEverything() {
    clearLog();
    const data = gatherFormData();
    log('Filling everything...');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.url.includes('smartauction')) {
        log('Not on SmartAuction page!', 'log-err');
        return;
      }

      // Step 1: Fill vehicle entry (basic info — Vehicle Type, Odometer)
      log('--- Filling Vehicle Entry ---');
      const r1 = await injectAndSend(tab, { action: 'fillVehicleEntry', data });
      if (r1?.log) r1.log.forEach(entry => log(entry.msg, entry.cls));

      // Step 2: Fill damages + tires
      if (data.damages?.length > 0 || data.tires?.length > 0) {
        log('--- Filling Damages + Tires ---');
        await new Promise(r => setTimeout(r, 500));
        const r2 = await injectAndSend(tab, { action: 'fillDamagesAndTires', data });
        if (r2?.log) r2.log.forEach(entry => log(entry.msg, entry.cls));
      }

      // Step 3: Photos LAST — opens folder + file dialog
      if (data.photoCount > 0) {
        log('--- Photos ---');
        await new Promise(r => setTimeout(r, 500));
        const r3 = await injectAndSend(tab, { action: 'fillPhotos', data });
        if (r3?.log) r3.log.forEach(entry => log(entry.msg, entry.cls));
      }

      log('All done!', 'log-ok');

      // Mark as listed and remove from local queue (legacy scraper server only)
      const vin6 = data.vin6;
      if (vin6 && scraperServerAvailable) {
        try {
          await fetch(`${SCRAPER_URL}/queue/mark-listed/${vin6}`, { method: 'POST' });
          queueData = queueData.filter(v => v.vin6 !== vin6);
          if (crossCheckData?.readyToList) {
            crossCheckData.readyToList = crossCheckData.readyToList.filter(v => v.vin6 !== vin6);
          }
          log(`${vin6} marked as listed — removed from queue`, 'log-ok');
        } catch { /* non-critical */ }
      }
    } catch (err) {
      log('Error: ' + err.message, 'log-err');
    }
  }

  async function fillVINOnPage() {
    clearLog();
    const data = gatherFormData();
    const raw = vin6Input.value.trim().toUpperCase();
    const fullVin = (raw.length > 6 ? raw : '') || data.vehicle?.vin || data.vehicle?.['Vehicle VIN'] || fullVinDisplay.value || '';
    if (!fullVin) {
      log('No full VIN — enter a full 17-digit VIN or match from inventory', 'log-err');
      return;
    }
    log(`Entering VIN: ${fullVin}`);
    // Copy VIN to clipboard from popup (content script can't access clipboard)
    copyToClipboard(fullVin);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.url.includes('smartauction')) {
        log('Navigate to SmartAuction "Post Vehicle" page first', 'log-err');
        return;
      }
      const response = await injectAndSend(tab, { action: 'fillVIN', data: { fullVin, vehicle: data.vehicle } });
      if (response?.log) response.log.forEach(entry => log(entry.msg, entry.cls));
      if (response?.success) log('VIN copied & entered — click Continue on SA, then click "2. Fill Vehicle Entry"', 'log-ok');
    } catch (err) {
      log('Error: ' + err.message, 'log-err');
    }
  }

  async function fillVehicleEntry() {
    clearLog();
    const data = gatherFormData();
    log('Starting Vehicle Entry fill...');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.url.includes('smartauction')) {
        log('Not on SmartAuction page!', 'log-err');
        return;
      }

      const response = await injectAndSend(tab, { action: 'fillVehicleEntry', data });

      if (response && response.log) {
        response.log.forEach(entry => log(entry.msg, entry.cls));
      }
      if (response && response.success) {
        log('Vehicle Entry fill complete!', 'log-ok');
        // Mark as listed in queue now that form is actually filled
        const vin6 = data.vin6;
        if (vin6) {
          try {
            await fetch(`${SCRAPER_URL}/queue/mark-listed/${vin6}`, { method: 'POST' });
            log(`Marked ${vin6} as listed in queue`, 'log-ok');
          } catch { /* non-critical */ }
        }
      }
    } catch (err) {
      log('Error: ' + err.message, 'log-err');
    }
  }

  async function fillVIW() {
    clearLog();
    const data = gatherFormData();
    log('Starting Damages + Tires fill...');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = tab.url || '';
      if (!url.includes('smartauction') && !url.includes('directinspect')) {
        log('Not on SmartAuction or DirectInspect page!', 'log-err');
        return;
      }

      // Use correct action based on target site
      const isDirectInspect = url.includes('directinspect');
      const action = isDirectInspect ? 'fillVIW' : 'fillDamagesAndTires';
      const response = await injectAndSend(tab, { action, data });

      if (response && response.log) {
        response.log.forEach(entry => log(entry.msg, entry.cls));
      }
      if (response && response.success) {
        log('Fill complete!', 'log-ok');
      }
    } catch (err) {
      log('Error: ' + err.message, 'log-err');
    }
  }

  async function runDiscoveryMode() {
    clearLog();
    log('Running Discovery Mode...');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      // Scan main page + all iframes (executeScript doesn't need content script)
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: () => {
          const data = { fields: [], links: [], iframes: 0, url: window.location.href };

          // Count iframes
          data.iframes = document.querySelectorAll('iframe').length;

          // Scan form fields
          document.querySelectorAll('input, select, textarea').forEach(el => {
            const label = el.closest('label')?.textContent?.trim()
              || document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim()
              || '';
            data.fields.push({
              tag: el.tagName.toLowerCase(),
              type: el.type || '',
              id: el.id || '',
              name: el.name || '',
              label: label.substring(0, 60),
              value: el.value?.substring(0, 30) || '',
              visible: el.offsetParent !== null
            });
          });

          // Scan clickable links and buttons
          document.querySelectorAll('a, button').forEach(el => {
            const text = el.textContent.trim().substring(0, 60);
            if (text && text.length > 1) {
              data.links.push({
                tag: el.tagName.toLowerCase(),
                text,
                href: el.href ? el.href.substring(0, 80) : '',
                visible: el.offsetParent !== null
              });
            }
          });

          return data;
        }
      });

      // Aggregate results from all frames
      let totalFields = 0;
      let totalLinks = 0;
      for (const result of results) {
        const d = result.result;
        if (!d) continue;

        const frameLabel = d.url.includes('about:') ? '(iframe)' : d.url.substring(0, 60);
        if (d.iframes > 0) log(`Page has ${d.iframes} iframe(s)`, 'log-info');

        if (d.fields.length > 0) {
          log(`--- Fields in ${frameLabel} ---`, 'log-info');
          d.fields.forEach(f => {
            const vis = f.visible ? '' : ' [hidden]';
            log(`  ${f.tag}[${f.type}] id="${f.id}" name="${f.name}" label="${f.label}" val="${f.value}"${vis}`);
          });
          totalFields += d.fields.length;
        }

        if (d.links.length > 0) {
          log(`--- Links/Buttons (${d.links.length}) ---`, 'log-info');
          d.links.forEach(l => {
            log(`  <${l.tag}> "${l.text}" ${l.href ? '→ ' + l.href : ''}`);
          });
          totalLinks += d.links.length;
        }
      }

      log(`Total: ${totalFields} fields, ${totalLinks} links/buttons`, 'log-ok');

    } catch (err) {
      log('Discovery error: ' + err.message, 'log-err');
    }
  }

  // ── Data Gathering ──
  function gatherFormData() {
    const tires = [];
    document.querySelectorAll('.tire-row').forEach(row => {
      tires.push({
        position: row.dataset.pos,
        manufacturer: row.querySelector('.tire-mfr').value,
        size: row.querySelector('.tire-size').value,
        treadDepth: row.querySelector('.tire-tread').value,
        damage: row.querySelector('.tire-damage').value
      });
    });

    const allPhotos = [...exteriorPhotos, ...damagePhotos];

    // Filter out empty damage rows before sending to auto-filler
    const filledDamages = damages.filter(d => (d.panel || '').trim() || (d.type || '').trim());

    return {
      vin6: vin6Input.value.trim(),
      odometer: odometerInput.value.trim(),
      vehicle: matchedVehicle || null,
      tires,
      damages: filledDamages,
      photoCount: allPhotos.length,
      photoVin6: vin6Input.value.trim(),
    };
  }

  // ── Session Persistence ──
  function saveSession() {
    const data = {
      currentStep,
      vin6: vin6Input.value,
      odometer: odometerInput.value,
      tires: [],
      damages
    };
    document.querySelectorAll('.tire-row').forEach(row => {
      data.tires.push({
        pos: row.dataset.pos,
        mfr: row.querySelector('.tire-mfr').value,
        size: row.querySelector('.tire-size').value,
        tread: row.querySelector('.tire-tread').value,
        damage: row.querySelector('.tire-damage').value
      });
    });
    // Don't save photo base64 to storage (too large) — they need to be re-uploaded
    chrome.storage.local.set({ sessionData: data });
  }

  function restoreSession(data) {
    if (data.vin6) {
      vin6Input.value = data.vin6;
      if (data.vin6.trim().length > 6) {
        fullVinDisplay.value = data.vin6.trim().toUpperCase();
        fullVinRow.style.display = 'block';
      }
    }
    if (data.odometer) odometerInput.value = data.odometer;
    if (data.tires) {
      data.tires.forEach(t => {
        const row = document.querySelector(`.tire-row[data-pos="${t.pos}"]`);
        if (row) {
          row.querySelector('.tire-mfr').value = t.mfr || '';
          row.querySelector('.tire-size').value = t.size || '';
          row.querySelector('.tire-tread').value = t.tread || '';
          row.querySelector('.tire-damage').value = t.damage || '';
        }
      });
    }
    if (data.damages) {
      damages = data.damages;
      renderDamages();
    }
    if (data.currentStep) {
      goToStep(data.currentStep);
    }
  }

  // ── Helpers ──
  function copyToClipboard(text) {
    // Modern Clipboard API works in Chrome side panels as long as the call
    // fires during a user gesture (which it does — every caller is a click
    // handler). The old execCommand path has been deprecated and was
    // silently failing in recent Chrome versions, which is why "Copy VIN"
    // started returning nothing. Fall back to execCommand if the async
    // write throws (blocked-by-permissions, not-user-gesture, etc.).
    try {
      const p = navigator.clipboard?.writeText?.(String(text ?? ''));
      if (p && typeof p.then === 'function') {
        p.catch((err) => {
          console.warn('[copy] clipboard API failed, falling back to execCommand:', err);
          execCommandCopy(text);
        });
        return;
      }
    } catch (err) {
      console.warn('[copy] clipboard API threw, falling back to execCommand:', err);
    }
    execCommandCopy(text);
  }

  function execCommandCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = String(text ?? '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch {}
    document.body.removeChild(ta);
  }

  function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML.replace(/"/g, '&quot;');
  }

  function formatAge(timestamp) {
    const days = Math.floor((Date.now() - timestamp) / 86400000);
    if (days === 0) return ' (today)';
    if (days === 1) return ' (1 day ago)';
    return ` (${days} days ago)`;
  }
})();
