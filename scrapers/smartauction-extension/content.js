// SmartAuction Vehicle Entry — Content Script
// Auto-fills the New Post form on smartauctionlogin.com
// Sidebar: Basic Information, Location, Exterior, Interior, Mechanical,
//          Full Description, Photos, Condition, Damages, Tires, Additional, Pricing
// Depends on: lib/form-mapper.js, lib/damage-mapper.js

'use strict';

// Guard against duplicate injection (popup may re-inject via scripting API)
if (!window._smartAuctionContentLoaded) {
  window._smartAuctionContentLoaded = true;
  console.log('SmartAuction Auto-Fill: content.js loaded');

  // ── Message Listener ──
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'fillVehicleEntry') {
      fillVehicleEntry(request.data)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, log: [{ msg: 'Error: ' + err.message, cls: 'log-err' }] }));
      return true;
    }


    if (request.action === 'fillDamagesAndTires') {
      fillDamagesAndTires(request.data)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, log: [{ msg: 'Error: ' + err.message, cls: 'log-err' }] }));
      return true;
    }

    if (request.action === 'fillPhotos') {
      fillPhotos(request.data)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, log: [{ msg: 'Error: ' + err.message, cls: 'log-err' }] }));
      return true;
    }

    if (request.action === 'fillStockPhotosFromUrls') {
      fillStockPhotosFromUrls(request.data)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, log: [{ msg: 'Error: ' + err.message, cls: 'log-err' }] }));
      return true;
    }

    if (request.action === 'fillVIN') {
      fillVINAndCreate(request.data)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, log: [{ msg: 'Error: ' + err.message, cls: 'log-err' }] }));
      return true;
    }

    if (request.action === 'checkPage') {
      sendResponse({ isSmartAuction: true, url: window.location.href });
      return false;
    }

    if (request.action === 'diagnosePage') {
      const results = { url: window.location.href, elements: [] };
      // Find everything related to damage, add, tire, photo, upload
      document.querySelectorAll('a, button, span, input, select, div').forEach(el => {
        const t = el.textContent?.trim()?.substring(0, 80) || '';
        const tl = t.toLowerCase();
        if (tl.includes('damage') || tl.includes('add ') || tl.includes('tire') || tl.includes('photo') || tl.includes('upload') || tl.includes('mark all') || tl.includes('file') || tl.includes('changes')) {
          if (el.children.length <= 2 && t.length < 80) {
            results.elements.push({
              tag: el.tagName,
              type: el.type || '',
              class: (el.className || '').substring(0, 50),
              text: t,
              href: (el.href || '').substring(0, 80),
              visible: el.offsetParent !== null,
              id: el.id || ''
            });
          }
        }
      });
      sendResponse(results);
      return false;
    }
  });
}

// ── Fill Photos (separate action, called last) ──
async function fillPhotos(data) {
  const log = [];
  const addLog = (msg, cls = 'log-info') => log.push({ msg, cls });

  addLog('Opening Photos...');
  await clickSidebarLink('Photos');
  await delay(500);

  if (data.photoCount > 0 && data.photoVin6) {
    // Serverless: photos come from Supabase, not a local folder.
    const photoCount = data.photoCount || 0;
    addLog(`${photoCount} photos ready for ${data.photoVin6}`, 'log-ok');
    // Wait for macOS to fully register the copied files before opening file dialog
    await delay(2500);

    // Click "Add Photos" on SA — opens file dialog
    const addPhotosBtn = [...document.querySelectorAll('button')].find(b =>
      b.textContent.trim() === 'Add Photos' && b.offsetParent !== null
    );
    if (addPhotosBtn) {
      addPhotosBtn.click();
      addLog(`In the file dialog: click Desktop > SA Photos > Cmd+A > Open.`, 'log-ok');
    } else {
      addLog(`Click "Add Photos" on SA. Photos are in Desktop > "SA Photos". Cmd+A > Open.`, 'log-ok');
    }
  } else {
    addLog('No photos available', 'log-warn');
  }

  return { success: true, log };
}

// ── Fill VIN on Post Vehicle page and click Create New Post ──
async function fillVINAndCreate(data) {
  const log = [];
  const addLog = (msg, cls = 'log-info') => log.push({ msg, cls });

  const fullVin = data.fullVin || data.vehicle?.vin || data.vehicle?.['Vehicle VIN'] || '';
  if (!fullVin) {
    addLog('No full VIN available — enter it manually', 'log-err');
    return { success: false, log };
  }

  addLog(`Filling VIN: ${fullVin}`);

  // Find the VIN input field. Order matters: try VIN-specific selectors FIRST
  // (id/name/placeholder/aria-label/maxlength=17), then walk visible labels,
  // only falling back to the first generic text input if nothing specific hits.
  // The old code used `input[type="text"]` as the first try, which happily
  // dumped the VIN into whatever search/filter box SA happened to render
  // first in the DOM.
  function findVinInput() {
    // MORE AGGRESSIVE VIN DETECTION - Check multiple attributes
    const candidates = [
      'input[id*="vin" i]:not([id*="search" i]):not([id*="filter" i])',
      'input[name*="vin" i]:not([name*="search" i]):not([name*="filter" i])',
      'input[placeholder*="vin" i]:not([placeholder*="search" i])',
      'input[placeholder*="enter vin" i]',
      'input[placeholder*="vehicle identification" i]',
      'input[placeholder*="17" i]:not([placeholder*="search" i])',
      'input[aria-label*="vin" i]:not([aria-label*="search" i])',
      'input[aria-label*="vehicle identification" i]',
      'input[maxlength="17"]:not([type="hidden"])',
      'input[data-field="vin" i]',
      'input[data-name="vin" i]',
    ];
    
    // First pass: Try all specific selectors
    for (const sel of candidates) {
      for (const el of document.querySelectorAll(sel)) {
        // Extra validation: skip if this is clearly wrong
        const id = (el.id || '').toLowerCase();
        const name = (el.name || '').toLowerCase();
        const placeholder = (el.placeholder || '').toLowerCase();
        const className = (el.className || '').toLowerCase();
        
        // Skip search/filter/query fields
        if (id.includes('search') || id.includes('filter') || id.includes('query') ||
            name.includes('search') || name.includes('filter') || name.includes('query') ||
            placeholder.includes('search') || placeholder.includes('filter') || placeholder.includes('type to search') ||
            className.includes('search') || className.includes('filter')) {
          console.log('[VIN] Skipping search/filter field:', el);
          continue;
        }
        
        if (isVisibleInput(el)) {
          console.log('[VIN] Found VIN input via selector:', sel, el);
          return el;
        }
      }
    }
    // Label-based lookup — findFieldByLabel handles <label for=>, sibling,
    // and nearby-text strategies.
    try {
      const byLabel = findFieldByLabel('VIN');
      if (byLabel && isVisibleInput(byLabel)) return byLabel;
    } catch {}
    // Last-resort: first visible text input. Only taken when nothing above
    // hits, which should be never on a valid Post Vehicle page.
    for (const el of document.querySelectorAll('input[type="text"], input:not([type])')) {
      // Again, skip search/filter fields
      const id = (el.id || '').toLowerCase();
      const placeholder = (el.placeholder || '').toLowerCase();
      if (id.includes('search') || id.includes('filter') || 
          placeholder.includes('search') || placeholder.includes('filter')) {
        continue;
      }
      if (isVisibleInput(el)) return el;
    }
    return null;
  }

  function isVisibleInput(el) {
    if (!el || el.type === 'hidden' || el.disabled || el.readOnly) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  const vinInput = findVinInput();

  if (!vinInput) {
    addLog('VIN input field not found on this page', 'log-err');
    console.error('[VIN] Could not find VIN input. All inputs on page:', 
      [...document.querySelectorAll('input[type="text"], input:not([type])')].map(i => ({
        id: i.id,
        name: i.name,
        placeholder: i.placeholder,
        visible: i.offsetParent !== null
      }))
    );
    return { success: false, log };
  }

  // Log detailed info about which field we found
  const fieldInfo = `${vinInput.id || vinInput.name || vinInput.placeholder || '(no id/name)'}`;
  addLog(`VIN field found: ${fieldInfo}`);
  console.log('[VIN] Selected input details:', {
    id: vinInput.id,
    name: vinInput.name,
    placeholder: vinInput.placeholder,
    className: vinInput.className,
    maxLength: vinInput.maxLength
  });

  // Force the full VIN without any truncation
  vinInput.maxLength = 17; // Ensure field accepts full VIN
  setFieldValue(vinInput, fullVin);
  
  // Double-check the value was set correctly
  if (vinInput.value !== fullVin) {
    // If first attempt failed, try direct assignment
    vinInput.value = fullVin;
    vinInput.dispatchEvent(new Event('input', { bubbles: true }));
    vinInput.dispatchEvent(new Event('change', { bubbles: true }));
  }
  
  try { await navigator.clipboard.writeText(fullVin); } catch (_) {}
  addLog(`VIN entered (${fullVin}) & copied to clipboard — click Create New Post manually`, 'log-ok');

  return { success: true, log };
}

// ── Safe Click ──
function safeClick(el) {
  // Just dispatch a click — let React handle it naturally
  // Don't call el.click() on <a> tags with javascript: href (CSP blocks it)
  if (el.tagName === 'A' && (el.getAttribute('href') || '').startsWith('javascript:')) {
    // Remove the href temporarily so .click() doesn't trigger CSP
    const origHref = el.getAttribute('href');
    el.removeAttribute('href');
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    // Restore href after a tick so SA's UI doesn't break
    setTimeout(() => el.setAttribute('href', origHref), 10);
  } else {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  }
}

// ── Sidebar Navigation ──
async function clickSidebarLink(name) {
  const links = document.querySelectorAll('a');
  const target = name.toLowerCase();
  for (const link of links) {
    const text = link.textContent.trim().toLowerCase();
    if (text === target) {
      safeClick(link);
      await delay(300);
      return true;
    }
  }
  // Partial match
  for (const link of links) {
    const text = link.textContent.trim().toLowerCase();
    if (text.includes(target) || target.includes(text)) {
      if (text.length >= 3) {
        safeClick(link);
        await delay(300);
        return true;
      }
    }
  }
  return false;
}

// ── Generic Field Helpers ──
// Find an input/select/textarea near a label with matching text
function findFieldByLabel(labelText) {
  const target = labelText.toUpperCase();

  // Strategy 1: Look for label elements
  for (const label of document.querySelectorAll('label')) {
    if (label.textContent.trim().toUpperCase().includes(target)) {
      // Check for "for" attribute
      if (label.htmlFor) {
        const el = document.getElementById(label.htmlFor);
        if (el) return el;
      }
      // Check for input inside label
      const input = label.querySelector('input, select, textarea');
      if (input) return input;
      // Check next sibling
      let next = label.nextElementSibling;
      while (next) {
        const input = next.matches('input, select, textarea') ? next : next.querySelector('input, select, textarea');
        if (input) return input;
        next = next.nextElementSibling;
      }
    }
  }

  // Strategy 2: Look for text nodes near inputs
  const allText = document.querySelectorAll('div, span, p, td, th, h1, h2, h3, h4, h5, h6');
  for (const el of allText) {
    if (el.children.length > 3) continue; // skip containers with many children
    const text = el.textContent.trim().toUpperCase();
    if (text === target || (text.includes(target) && text.length < target.length + 20)) {
      // Look for input in next siblings or parent's next children
      let sibling = el.nextElementSibling;
      for (let i = 0; i < 5 && sibling; i++) {
        const input = sibling.matches('input, select, textarea') ? sibling : sibling.querySelector('input, select, textarea');
        if (input) return input;
        sibling = sibling.nextElementSibling;
      }
      // Look inside parent
      const parent = el.parentElement;
      if (parent) {
        const input = parent.querySelector('input, select, textarea');
        if (input && input !== el) return input;
      }
    }
  }

  // Strategy 3: Placeholder or aria-label
  for (const el of document.querySelectorAll('input, select, textarea')) {
    const ph = (el.placeholder || '').toUpperCase();
    const aria = (el.getAttribute('aria-label') || '').toUpperCase();
    const name = (el.name || '').toUpperCase();
    if (ph.includes(target) || aria.includes(target) || name.includes(target)) {
      return el;
    }
  }

  return null;
}

function setFieldValue(el, value) {
  if (!el) return false;

  try {
    el.focus();
    el.select?.(); // select existing text so we replace it

    // Simulate a paste event — React apps respond to this
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', value);
    const pasteEvent = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: clipboardData
    });
    el.dispatchEvent(pasteEvent);

    // Also set via native setter + _valueTracker as backup
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(el, value);
    } else {
      el.value = value;
    }
    if (el._valueTracker) el._valueTracker.setValue('');

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  } catch (e) {
    try {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } catch (e2) {
      console.warn('setFieldValue failed:', e2);
      return false;
    }
  }
}

function setSelectValue(el, value) {
  if (!el || el.tagName !== 'SELECT') return false;
  const target = value.toLowerCase();

  let optValue = null;
  // Exact match
  for (const opt of el.options) {
    if (opt.textContent.trim().toLowerCase() === target) { optValue = opt.value; break; }
  }
  // Partial match fallback
  if (!optValue) {
    for (const opt of el.options) {
      if (opt.textContent.trim().toLowerCase().includes(target) || target.includes(opt.textContent.trim().toLowerCase())) {
        optValue = opt.value; break;
      }
    }
  }
  if (!optValue) return false;

  try {
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    el.focus();
    if (nativeSetter) {
      nativeSetter.call(el, optValue);
    } else {
      el.value = optValue;
    }
    if (el._valueTracker) el._valueTracker.setValue('');
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  } catch (e) {
    el.value = optValue;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return true;
}

function clickLink(text) {
  const target = text.toLowerCase().trim();
  // Exact match first
  for (const el of document.querySelectorAll('a, button, span[role="button"]')) {
    const elText = el.textContent.trim().toLowerCase();
    if (elText === target || elText === '+ ' + target) {
      safeClick(el);
      return true;
    }
  }
  // Then contains — but only if the element text is close in length (avoid "Add" matching "Add Damage Information")
  for (const el of document.querySelectorAll('a, button, span[role="button"]')) {
    const elText = el.textContent.trim().toLowerCase();
    if (elText.includes(target) && elText.length <= target.length * 2.5) {
      safeClick(el);
      return true;
    }
  }
  return false;
}

function clickButton(text) {
  const target = text.toLowerCase();
  // Exact match first
  for (const el of document.querySelectorAll('button, input[type="button"], input[type="submit"]')) {
    const t = (el.textContent || el.value || '').trim().toLowerCase();
    if (t === target) {
      safeClick(el);
      return true;
    }
  }
  // Then contains with length guard
  for (const el of document.querySelectorAll('button, input[type="button"], input[type="submit"]')) {
    const t = (el.textContent || el.value || '').trim().toLowerCase();
    if (t.includes(target) && t.length <= target.length * 2.5) {
      safeClick(el);
      return true;
    }
  }
  // Links styled as buttons
  for (const el of document.querySelectorAll('a')) {
    if (el.textContent.trim().toLowerCase() === target) {
      safeClick(el);
      return true;
    }
  }
  return false;
}

// ── Fill Vehicle Entry (Basic Info, Description, Condition) ──
async function fillVehicleEntry(data) {
  const log = [];
  const addLog = (msg, cls = 'log-info') => log.push({ msg, cls });

  try {
    // ── Basic Information ──
    addLog('Navigating to Basic Information...');
    const basicOk = await clickSidebarLink('Basic Information');
    if (!basicOk) {
      // Try alternative names
      await clickSidebarLink('Basic Info') || await clickSidebarLink('Vehicle Information');
    }
    await delay(300);

    // Vehicle Type → (DOV) Dealer-Owned
    // Try multiple ways to find the Vehicle Type select
    let vehicleTypeEl = findFieldByLabel('Vehicle Type')
      || document.getElementById('vehicle-type')
      || document.getElementById('vehicleType');

    // Fallback: find any select that has "Dealer-Owned" as an option
    if (!vehicleTypeEl) {
      for (const sel of document.querySelectorAll('select')) {
        const hasDoV = [...sel.options].some(o => o.text.includes('DOV') || o.text.includes('Dealer-Owned'));
        if (hasDoV) { vehicleTypeEl = sel; break; }
      }
    }

    if (vehicleTypeEl) {
      const dovOpt = [...vehicleTypeEl.options].find(o => o.text.includes('DOV'));
      if (dovOpt) {
        vehicleTypeEl.value = dovOpt.value;
        vehicleTypeEl.dispatchEvent(new Event('change', { bubbles: true }));
        addLog('Vehicle Type: (DOV) Dealer-Owned', 'log-ok');
      }
    } else {
      addLog('Vehicle Type dropdown not found — set manually', 'log-warn');
    }
    await delay(300);

    if (data.odometer) {
      const odoEl = findFieldByLabel('Odometer') || findFieldByLabel('Mileage');
      if (odoEl) {
        setFieldValue(odoEl, data.odometer);
        addLog(`Set Odometer: ${data.odometer}`, 'log-ok');
      } else {
        addLog('Odometer field not found', 'log-warn');
      }
    }

    // Skip Exterior, Interior, Mechanical, Condition — no data to fill, clicking them can cause reload

    addLog('Vehicle Entry fill complete!', 'log-ok');
    return { success: true, log };

  } catch (err) {
    addLog('Fill error: ' + err.message, 'log-err');
    return { success: false, log };
  }
}

// ── Fill Damages + Tires (the VIW/DirectInspect button) ──
async function fillDamagesAndTires(data) {
  const log = [];
  const addLog = (msg, cls = 'log-info') => log.push({ msg, cls });

  try {
    // ── DAMAGES ──
    if (data.damages && data.damages.length > 0) {
      addLog('Navigating to Damages...');
      await clickSidebarLink('Damages');
      await delay(300);

      for (let i = 0; i < data.damages.length; i++) {
        const dmg = data.damages[i];
        addLog(`Adding damage ${i + 1}/${data.damages.length}: ${dmg.panel} - ${dmg.type}`);

        // Click "+ Add Damage Information" then poll for the form — much
        // faster than fixed 500ms waits when the form opens in <100ms.
        const addInfoBtn = [...document.querySelectorAll('button')].find(b =>
          b.textContent.trim().includes('Add Damage Information') && b.offsetParent !== null
        );
        if (addInfoBtn) addInfoBtn.click();

        const addTypeEl = await waitUntil(() => {
          const el = document.getElementById('add-damage-type');
          return el && el.offsetParent !== null ? el : null;
        }, { timeoutMs: 2500, intervalMs: 60 });

        if (!addTypeEl) {
          addLog(`  Damage ${i + 1}: add form didn't open, skipping`, 'log-warn');
          continue;
        }

        // Fill all fields back-to-back — React only needs a microtask to
        // re-render between sets. A 10ms tick is enough; no 50ms pauses.
        const panelLower = (dmg.panel || '').toLowerCase();
        const isInterior = dmg.category
          ? dmg.category === 'Interior'
          : ['dashboard', 'driver seat', 'passenger seat', 'rear seat',
             'headliner', 'carpet', 'console', 'steering wheel', 'interior',
             'door panel', 'glove box', 'center console', 'sun visor', 'armrest',
             'seat belt', 'gauge', 'instrument', 'warning light'].some(p => panelLower.includes(p));
        setSelectValue(addTypeEl, isInterior ? 'Interior' : 'Exterior');

        // Map the damage once using DamageMapper
        const mappedDamage = DamageMapper.mapForSA(dmg);
        
        const locEl = document.getElementById('add-damage-location');
        if (locEl) {
          const panelValue = mappedDamage.panel || dmg.panel || 'Other';
          setFieldValue(locEl, panelValue.substring(0, 40));
        }

        const descEl = document.getElementById('add-damage-description');
        if (descEl) {
          const rawDesc = (mappedDamage.description || dmg.description || '').trim();
          const type = mappedDamage.type && mappedDamage.type !== 'Other' ? mappedDamage.type : '';
          const startsWithType = type && rawDesc.toLowerCase().startsWith(type.toLowerCase());
          const prefix = type && !startsWithType ? `${type}${rawDesc ? ' - ' : ''}` : '';
          const descText = (prefix + rawDesc).substring(0, 50);
          setFieldValue(descEl, descText);
        }

        const isChargeable = dmg.chargeable === 'Yes' || dmg.chargeable === true;
        const radioEl = document.getElementById(isChargeable ? 'chargeable-yes' : 'chargeable-no');
        if (radioEl) radioEl.click();

        if (dmg.estimatedCost && dmg.estimatedCost > 0) {
          const costEl = document.getElementById('add-damage-cost');
          if (costEl) setFieldValue(costEl, String(dmg.estimatedCost));
        }

        // Single settle tick before hitting Add — lets SA's validation catch up.
        await delay(60);

        // Click "Add Damage" then POLL for the row to land. SA typically
        // commits in 150-400ms; old code waited a fixed 1200ms per damage
        // regardless. Fall back to a retry click if the row doesn't appear.
        const rowCountBefore = damageRowCount();
        const addBtns = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Add Damage');
        const addBtn = addBtns[addBtns.length - 1];
        if (addBtn) {
          addBtn.click();
        } else {
          addLog('  "Add Damage" button not found', 'log-err');
          continue;
        }

        const landed = await waitUntil(() => damageRowCount() > rowCountBefore, { timeoutMs: 1500, intervalMs: 80 });
        if (!landed) {
          addLog(`  Damage ${i + 1} didn't land on first try — retrying`, 'log-warn');
          addBtn.click();
          await waitUntil(() => damageRowCount() > rowCountBefore, { timeoutMs: 1800, intervalMs: 100 });
        }
        addLog(`  Damage ${i + 1} saved`, 'log-ok');
      }

      addLog(`All ${data.damages.length} damages processed`, 'log-ok');
    }

    // ── TIRES ──
    addLog('Navigating to Tires...');
    await clickSidebarLink('Tires');
    await delay(500);

    // Simple approach: just check the "certify tire info" checkbox
    // This tells SA all tires meet minimum tread depth requirements
    // Avoids complex accordion form filling that can cause page refresh
    const certifyCb = document.getElementById('certify-tire-info');
    if (certifyCb && !certifyCb.checked) {
      certifyCb.click();
      addLog('Checked tire certification checkbox', 'log-ok');
    } else if (!certifyCb) {
      addLog('Tire certification checkbox not found', 'log-warn');
    } else {
      addLog('Tire certification already checked', 'log-ok');
    }

    addLog('Fill complete!', 'log-ok');
    return { success: true, log };

  } catch (err) {
    addLog('Fill error: ' + err.message, 'log-err');
    return { success: false, log };
  }
}

// ───────────────────────────────────────────────────────────────────
// ── Fill From Inspection — single-click bridge from Carz Inc PWA ──
// ───────────────────────────────────────────────────────────────────
// Accepts the raw Supabase `inspection` row, transforms it via
// InspectionTransform, then drives the SA form end-to-end:
//   1. Basic Info  — odometer
//   2. Damages     — adds each damage row, uploads photos per damage
//   3. Tires       — checks certify checkbox
// Photo uploads use the "Upload new" button on each saved damage row.

async function fillFromInspection(payload) {
  const log = [];
  const addLog = (msg, cls = 'log-info') => {
    log.push({ msg, cls });
    console.log('[fillFromInspection]', msg);
  };

  if (typeof InspectionTransform === 'undefined') {
    addLog('InspectionTransform lib not loaded', 'log-err');
    return { success: false, log };
  }

  const data = InspectionTransform.transformInspectionToSA(payload);
  addLog(`Starting fill for VIN ${data.vin6} — ${data.damages.length} damages, ${data.stockPhotoUrls.length} stock photos`);

  // ── Step 1: Basic Information ──
  try {
    await clickSidebarLink('Basic Information')
      || await clickSidebarLink('Basic Info')
      || await clickSidebarLink('Vehicle Information');
    await delay(400);

    if (data.odometer) {
      const odoEl = findFieldByLabel('Odometer') || findFieldByLabel('Mileage');
      if (odoEl) {
        setFieldValue(odoEl, data.odometer);
        addLog(`Odometer: ${data.odometer}`, 'log-ok');
      }
    }
  } catch (err) {
    addLog('Basic Info error: ' + err.message, 'log-warn');
  }

  // ── Step 2: Damages + per-damage photos ──
  if (data.damages.length > 0) {
    try {
      await clickSidebarLink('Damages');
      await delay(500);

      // Count any damages already on the page so we can find our newly added row
      const existingDamageCount = document.querySelectorAll('[id^="damage-location-"]').length;
      addLog(`Found ${existingDamageCount} existing damage rows on page`);

      for (let i = 0; i < data.damages.length; i++) {
        const dmg = data.damages[i];
        addLog(`Adding damage ${i + 1}/${data.damages.length}: ${dmg.panel} – ${dmg.type}`);

        // Open the add form (polls internally)
        const opened = await ensureAddDamageForm();
        if (!opened) { addLog('  Could not open add damage form', 'log-err'); break; }

        // Fill all fields in one pass — React only needs one microtask.
        const typeEl = document.getElementById('add-damage-type');
        if (typeEl) setSelectValue(typeEl, dmg.category === 'Interior' ? 'Interior' : 'Exterior');

        // Map the damage once using DamageMapper
        const mappedDamage = DamageMapper.mapForSA(dmg);
        
        const locEl = document.getElementById('add-damage-location');
        if (locEl) {
          const panelValue = mappedDamage.panel || dmg.panel || '';
          setFieldValue(locEl, panelValue.substring(0, 40));
        }

        const descEl = document.getElementById('add-damage-description');
        if (descEl) {
          const descText = (mappedDamage.description || dmg.description || '').substring(0, 50);
          setFieldValue(descEl, descText);
        }

        const noRadio = document.getElementById('chargeable-no');
        if (noRadio) noRadio.click();

        if (dmg.estimatedCost && dmg.estimatedCost > 0) {
          const costEl = document.getElementById('add-damage-cost');
          if (costEl) setFieldValue(costEl, String(dmg.estimatedCost));
        }

        // Single settle tick before submitting
        await delay(60);

        // Click "Add Damage" and poll for the row to land (bails at ~200ms
        // when the row commits; falls back to 1500ms max).
        const rowCountBefore = damageRowCount();
        const addBtns = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Add Damage' && b.offsetParent !== null);
        const addBtn = addBtns[addBtns.length - 1];
        if (!addBtn) { addLog('  "Add Damage" button not found', 'log-err'); break; }
        addBtn.click();

        const landed = await waitUntil(() => damageRowCount() > rowCountBefore, { timeoutMs: 1500, intervalMs: 80 });
        if (!landed) {
          addLog(`  Damage ${i + 1} didn't land — retrying click`, 'log-warn');
          addBtn.click();
          await waitUntil(() => damageRowCount() > rowCountBefore, { timeoutMs: 1800, intervalMs: 100 });
        }
        addLog(`  Saved damage row`, 'log-ok');
      }
      addLog(`All ${data.damages.length} damages processed`, 'log-ok');
    } catch (err) {
      addLog('Damages error: ' + err.message, 'log-err');
    }
  }

  // ── Step 3: Tires certification ──
  try {
    await clickSidebarLink('Tires');
    await delay(500);
    const certifyCb = document.getElementById('certify-tire-info');
    if (certifyCb && !certifyCb.checked) {
      certifyCb.click();
      addLog('Checked tire certification', 'log-ok');
    }
  } catch (err) {
    addLog('Tires error: ' + err.message, 'log-warn');
  }

  addLog('Fill complete', 'log-ok');
  return { success: true, log, stockPhotoUrls: data.stockPhotoUrls };
}

// Make sure the blank add-damage form is visible; click "+ Add Damage Information" if needed.
async function ensureAddDamageForm() {
  // Already open? Bail immediately.
  let typeEl = document.getElementById('add-damage-type');
  if (typeEl && typeEl.offsetParent !== null) return true;

  // Click the trigger button once, then poll — old code waited 400ms × 10 attempts
  // whether the form was open or not, burning up to 4s per damage.
  const addInfoBtn = [...document.querySelectorAll('button')].find(b =>
    b.textContent.trim().includes('Add Damage Information') && b.offsetParent !== null);
  if (addInfoBtn) addInfoBtn.click();

  const found = await waitUntil(() => {
    const el = document.getElementById('add-damage-type');
    return el && el.offsetParent !== null ? el : null;
  }, { timeoutMs: 2500, intervalMs: 60 });
  return !!found;
}

// ── Stock Photo Bulk Upload ──
// Fetches all stock photos (corners, interior, dash, tires) from Supabase
// URLs and uploads them into SA's Photos tab as a single DataTransfer batch.
async function fillStockPhotosFromUrls(data) {
  const log = [];
  const addLog = (msg, cls = 'log-info') => {
    log.push({ msg, cls });
    console.log('[fillStockPhotos]', msg);
  };

  const urls = Array.isArray(data?.urls) ? data.urls.filter(Boolean) : [];
  if (urls.length === 0) {
    addLog('No stock photo URLs provided', 'log-warn');
    return { success: false, log };
  }

  // 1. Navigate to the Photos tab
  addLog('Navigating to Photos tab...');
  await clickSidebarLink('Photos');
  await delay(600);

  // 2. Fetch all photos as File objects (in parallel)
  addLog(`Fetching ${urls.length} photo(s) from Supabase...`);
  const files = [];
  await Promise.all(
    urls.map(async (url, idx) => {
      try {
        const resp = await fetch(url);
        if (!resp.ok) { addLog(`  Fetch ${idx + 1} → HTTP ${resp.status}`, 'log-warn'); return; }
        const blob = await resp.blob();
        const filename = (url.split('/').pop() || `photo-${idx + 1}.jpg`).split('?')[0];
        files.push(new File([blob], filename, { type: blob.type || 'image/jpeg' }));
      } catch (err) {
        addLog(`  Fetch ${idx + 1} error: ${err.message}`, 'log-warn');
      }
    }),
  );
  if (files.length === 0) {
    addLog('All photo fetches failed', 'log-err');
    return { success: false, log };
  }
  addLog(`Fetched ${files.length} file(s), finding upload input...`);

  // 3. Try clicking any visible upload button to reveal / activate the input
  const uploadBtn = [...document.querySelectorAll('a,button,label')].find((el) => {
    if (!el.offsetParent) return false;
    const t = (el.textContent || '').trim();
    return t === 'Add Photos' || t === 'Upload photos' || t === 'Upload new' || t === 'Upload';
  });
  if (uploadBtn) {
    addLog(`Clicking "${uploadBtn.textContent.trim()}" to reveal/activate file input`);
    uploadBtn.click();
    await delay(500);
  }

  // 4. Broadcast the injection to EVERY image-accepting file input on the page.
  //    SA's React/Angular is only listening on one of them; the others silently
  //    ignore the assignment. We dispatch to all candidates and let the right
  //    one win. This is how we avoid the "wrong input out of 7" problem.
  const candidates = findAllPhotoInputs();
  addLog(`Broadcasting to ${candidates.length} file input(s): ${candidates.map((i) => i.id || i.name || '(anon)').join(', ')}`);

  let winners = 0;
  for (const input of candidates) {
    try {
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(f);
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
      if (desc && desc.set) desc.set.call(input, dt.files);
      else input.files = dt.files;
      input.dispatchEvent(new Event('input',  { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      winners++;
    } catch (err) {
      addLog(`  Skipped ${input.id || '(anon)'}: ${err.message}`, 'log-warn');
    }
  }

  await delay(1500);
  addLog(`Broadcast complete — injected into ${winners} input(s), hoping SA picks it up`, 'log-ok');
  return { success: true, log, count: files.length };
}

function findPhotosTabFileInput() {
  const all = [...document.querySelectorAll('input[type="file"]')];
  if (all.length === 0) return null;
  // Prefer multi-file + image-accepting inputs (the Photos tab bulk uploader)
  const multi = all.filter((i) => i.multiple && ((i.accept || '').includes('image') || !i.accept));
  if (multi.length) return multi[0];
  const imageOnly = all.filter((i) => (i.accept || '').includes('image'));
  return imageOnly[0] || all[0];
}

// When we have multiple candidates, return every file input that accepts images.
// The caller can broadcast the injection to all of them; only the one SA's React
// is actually listening to will consume it — the rest silently no-op.
function findAllPhotoInputs() {
  const all = [...document.querySelectorAll('input[type="file"]')];
  const imageOrAny = all.filter((i) => !i.accept || (i.accept || '').includes('image') || i.accept === '*/*');
  return imageOrAny.length ? imageOrAny : all;
}


// ── Utility ──
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Poll a predicate until it returns truthy or timeoutMs elapses. Returns the
// truthy value (or false on timeout). Much faster than fixed `delay` waits
// when the UI actually settles in <200ms but safer than a hardcoded long wait
// when it doesn't.
async function waitUntil(predicate, { timeoutMs = 1500, intervalMs = 80 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = predicate();
    if (v) return v;
    await delay(intervalMs);
  }
  return false;
}

function damageRowCount() {
  return document.querySelectorAll('[data-damage-row], .damage-row, tr[id^="damage"], [id^="damage-location-"]').length;
}

// Wait for a selector to appear, with a fallback delay if it never does
function waitFor(selector, timeout = 3000) {
  return new Promise((resolve) => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    const timer = setTimeout(() => {
      observer.disconnect();
      resolve(null); // resolve with null instead of rejecting — caller can check
    }, timeout);
  });
}
