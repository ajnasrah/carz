// SmartAuction VIW / DirectInspect — Content Script
// Handles damage modal automation, tire fill, comments, and photo upload
// on the Vehicle Inspection Website (VIW/DirectInspect) form
// Depends on: lib/form-mapper.js, lib/damage-mapper.js

'use strict';

// Guard against duplicate injection (popup may re-inject on SmartAuction pages)
if (!window._smartAuctionVIWLoaded) {
  window._smartAuctionVIWLoaded = true;
  console.log('SmartAuction Auto-Fill: content-viw.js loaded');

  // ── Message Listener ──
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'fillVIW') {
      fillVIW(request.data)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, log: [{ msg: 'Error: ' + err.message, cls: 'log-err' }] }));
      return true; // async
    }

    if (request.action === 'checkPage') {
      sendResponse({
        isVIW: true,
        url: window.location.href
      });
      return false;
    }
  });
}

// ── Main Fill Function ──
async function fillVIW(data) {
  const log = [];
  const addLog = (msg, cls = 'log-info') => log.push({ msg, cls });

  try {
    // ── Vehicle Info Section ──
    addLog('Filling vehicle info...');

    // Mileage / Odometer
    if (data.odometer) {
      const mileageEl = FormMapper.find('mileage', 'Mileage')
                      || FormMapper.find('odometer', 'Odometer');
      if (mileageEl) {
        FormMapper.setValue(mileageEl, data.odometer);
        addLog(`Set Mileage: ${data.odometer}`, 'log-ok');
      } else {
        addLog('Mileage field not found', 'log-warn');
      }
    }

    // Smoker — default No
    const smokerEl = FormMapper.find('smoker', 'Smoker');
    if (smokerEl) {
      FormMapper.setSelectValue(smokerEl, 'No');
      addLog('Set Smoker: No', 'log-ok');
    }

    // ── Tire Section ──
    if (data.tires && data.tires.length > 0) {
      addLog('Filling tire information...');
      await fillTires(data.tires, addLog);
    }

    // ── Damage Section ──
    if (data.damages && data.damages.length > 0) {
      addLog(`Filling ${data.damages.length} damage entries...`);
      await fillDamages(data.damages, addLog);
    } else {
      addLog('No damages to fill', 'log-info');
    }

    // ── Comments ──
    if (data.damages && data.damages.length > 0) {
      addLog('Filling comments...');
      const commentParts = [`${data.damages.length} damage item(s) noted:`];
      for (const dmg of data.damages) {
        const mapped = window.DamageMapper ? DamageMapper.mapForVIW(dmg) : dmg;
        commentParts.push(`- ${mapped.panel}: ${mapped.type} (${mapped.severity})`);
      }

      const commentsEl = FormMapper.find('comments', 'Comments');
      if (commentsEl) {
        FormMapper.setValue(commentsEl, commentParts.join('\n'));
        addLog('Comments filled', 'log-ok');
      } else {
        addLog('Comments field not found', 'log-warn');
      }
    }

    // ── Photo Upload ──
    const photos = data.photos || [];
    if (photos.length > 0) {
      addLog(`Uploading ${photos.length} photos (max 56)...`);
      await uploadBulkPhotos(photos.slice(0, 56), addLog);
    }

    addLog('DirectInspect/VIW fill complete!', 'log-ok');
    return { success: true, log };

  } catch (err) {
    addLog('Fill error: ' + err.message, 'log-err');
    return { success: false, log };
  }
}

// ── Tire Fill ──
async function fillTires(tires, addLog) {
  // VIW tire section: 5 rows (FR, FL, BR, BL, Spare)
  // Map our positions to VIW positions
  const posMap = {
    'FR': 'Right Front',
    'FL': 'Left Front',
    'BR': 'Right Rear',
    'BL': 'Left Rear',
    'SP': 'Spare'
  };

  // Strategy 1: Find tire rows by position labels
  for (const tire of tires) {
    const posLabel = posMap[tire.position] || tire.position;
    const posLabelAlt = tire.position; // e.g., "FR"

    // Find the row containing this position
    const row = findTireRow(posLabel, posLabelAlt);
    if (!row) {
      addLog(`Tire row not found: ${posLabel}`, 'log-warn');
      continue;
    }

    // Fill manufacturer
    if (tire.manufacturer) {
      const mfrInput = row.querySelector('input[name*="Manufacturer" i], input[name*="mfr" i], input[type="text"]');
      if (mfrInput) {
        FormMapper.setValue(mfrInput, tire.manufacturer);
      }
    }

    // Fill size
    if (tire.size) {
      const sizeInput = row.querySelector('input[name*="Size" i], input[name*="size" i]');
      if (sizeInput) {
        FormMapper.setValue(sizeInput, tire.size);
      } else {
        // Try second text input in the row
        const textInputs = row.querySelectorAll('input[type="text"]');
        if (textInputs.length >= 2) {
          FormMapper.setValue(textInputs[1], tire.size);
        }
      }
    }

    // Fill tread depth
    if (tire.treadDepth) {
      const treadEl = row.querySelector('select[name*="Tread" i], select[name*="tread" i], input[name*="Tread" i]');
      if (treadEl) {
        if (treadEl.tagName === 'SELECT') {
          FormMapper.setSelectValue(treadEl, tire.treadDepth);
        } else {
          FormMapper.setValue(treadEl, tire.treadDepth);
        }
      }
    }

    // Fill tire damage
    if (tire.damage && tire.damage !== 'None') {
      const damageEl = row.querySelector('select[name*="Damage" i], select[name*="damage" i]');
      if (damageEl) {
        FormMapper.setSelectValue(damageEl, tire.damage);
      }
    }

    addLog(`Tire ${tire.position}: ${tire.manufacturer || '-'} ${tire.size || '-'} ${tire.treadDepth || '-'}`, 'log-ok');
  }
}

function findTireRow(posLabel, posLabelAlt) {
  // Look for table rows or div rows containing the position text
  const allRows = document.querySelectorAll('tr, [class*="tire-row"], [class*="row"]');
  for (const row of allRows) {
    const text = row.textContent.toLowerCase();
    if (text.includes(posLabel.toLowerCase()) || text.includes(posLabelAlt.toLowerCase())) {
      // Verify this row has inputs (it's a data row, not a header)
      if (row.querySelector('input, select')) {
        return row;
      }
    }
  }

  // Fallback: search by index order
  // VIW typically orders: LF, RF, LR, RR, Spare
  const tireContainer = document.querySelector('[class*="tire" i], [id*="tire" i]');
  if (tireContainer) {
    const rows = tireContainer.querySelectorAll('tr:has(input), [class*="row"]:has(input)');
    const posIndex = { 'Left Front': 0, 'Right Front': 1, 'Left Rear': 2, 'Right Rear': 3, 'Spare': 4 };
    const idx = posIndex[posLabel];
    if (idx !== undefined && rows[idx]) {
      return rows[idx];
    }
  }

  return null;
}

// ── Damage Fill (VIW Modal) ──
async function fillDamages(damages, addLog) {
  // VIW uses a damage entry modal with 5 rows at a time
  // Flow: Open modal → fill 5 rows → click "Add to Report" → repeat

  const mapped = window.DamageMapper ? DamageMapper.mapAllForVIW(damages) : damages;

  // Find the "Add Damage" button to open the modal
  const addDamageBtn = findButton('Add Damage') || findButton('Add Item') || findButton('Add Entry');

  if (!addDamageBtn) {
    // Modal might already be open, or damage section is inline
    addLog('Add Damage button not found — trying inline fill', 'log-warn');
    await fillDamagesInline(mapped, addLog);
    return;
  }

  // Process in batches of 5
  const batchSize = 5;
  for (let i = 0; i < mapped.length; i += batchSize) {
    const batch = mapped.slice(i, i + batchSize);

    // Open modal — wait for it to render
    addDamageBtn.click();
    await (waitFor('.modal select, [role="dialog"] select, [class*="modal"] select', 3000) || delay(800));

    // Fill rows in the modal
    const modalRows = document.querySelectorAll(
      '.modal tr:has(select), .modal [class*="row"]:has(select), ' +
      '[class*="modal"] tr:has(select), [role="dialog"] tr:has(select), ' +
      '.damage-entry-row, [class*="damage-row"]'
    );

    for (let j = 0; j < batch.length && j < modalRows.length; j++) {
      const dmg = batch[j];
      const row = modalRows[j];

      // Damage Type
      const typeSelect = row.querySelector('select:nth-of-type(1), select[name*="Type" i]');
      if (typeSelect) {
        const bestType = DamageMapper.findBestOption(typeSelect, dmg.type) || dmg.type;
        FormMapper.setSelectValue(typeSelect, bestType);
      }

      // Location / Panel
      const locSelect = row.querySelector('select:nth-of-type(2), select[name*="Location" i], select[name*="Panel" i]');
      if (locSelect) {
        const bestLoc = DamageMapper.findBestOption(locSelect, dmg.panel) || dmg.panel;
        FormMapper.setSelectValue(locSelect, bestLoc);
      }

      // Description
      const descInput = row.querySelector('select:nth-of-type(3), input[name*="Description" i], select[name*="Description" i]');
      if (descInput) {
        if (descInput.tagName === 'SELECT') {
          const bestDesc = DamageMapper.findBestOption(descInput, dmg.description || dmg.type);
          if (bestDesc) FormMapper.setSelectValue(descInput, bestDesc);
        } else {
          FormMapper.setValue(descInput, dmg.description || dmg.type);
        }
      }

      // Chargeable — normalize to boolean first (handles "Yes"/"No" strings and true/false)
      const isChargeable = dmg.chargeable === true || dmg.chargeable === 'Yes' || dmg.chargeable === 'yes';
      const chargeInput = row.querySelector('select[name*="Chargeable" i], input[name*="Chargeable" i], input[type="checkbox"]');
      if (chargeInput) {
        if (chargeInput.type === 'checkbox') {
          if (isChargeable && !chargeInput.checked) chargeInput.click();
          if (!isChargeable && chargeInput.checked) chargeInput.click();
        } else {
          FormMapper.setSelectValue(chargeInput, isChargeable ? 'Yes' : 'No');
        }
      }

      // Cost
      const costInput = row.querySelector('input[name*="Cost" i], input[type="number"]');
      if (costInput) {
        FormMapper.setValue(costInput, String(dmg.estimatedCost || 0));
      }

      addLog(`Damage ${i + j + 1}: ${dmg.panel} - ${dmg.type}`, 'log-ok');
      await delay(200);
    }

    // Click "Add to Report" / "Save" / "Submit"
    const saveBtn = findButtonInContext('Add to Report')
                  || findButtonInContext('Save')
                  || findButtonInContext('Submit')
                  || findButtonInContext('Add');
    if (saveBtn) {
      saveBtn.click();
      await delay(800);
      addLog(`Batch ${Math.floor(i / batchSize) + 1} added to report`, 'log-ok');
    } else {
      addLog('Could not find save/submit button in modal', 'log-warn');
    }
  }
}

// Fallback: fill damage fields inline (no modal)
async function fillDamagesInline(damages, addLog) {
  for (let i = 0; i < damages.length; i++) {
    const dmg = damages[i];

    // Find damage type dropdown
    const typeEl = FormMapper.find('damageType', 'Damage Type');
    if (typeEl) {
      const bestType = DamageMapper.findBestOption(typeEl, dmg.type) || dmg.type;
      FormMapper.setSelectValue(typeEl, bestType);
    }

    // Find location dropdown
    const locEl = FormMapper.find('damageLocation', 'Damage Location') || FormMapper.find('damageLocation', 'Panel');
    if (locEl) {
      const bestLoc = DamageMapper.findBestOption(locEl, dmg.panel) || dmg.panel;
      FormMapper.setSelectValue(locEl, bestLoc);
    }

    // Description
    const descEl = FormMapper.find('damageDescription', 'Damage Description');
    if (descEl) {
      if (descEl.tagName === 'SELECT') {
        const best = DamageMapper.findBestOption(descEl, dmg.description || dmg.type);
        if (best) FormMapper.setSelectValue(descEl, best);
      } else {
        FormMapper.setValue(descEl, dmg.description || dmg.type);
      }
    }

    // Cost
    const costEl = FormMapper.find('damageCost', 'Cost');
    if (costEl) FormMapper.setValue(costEl, String(dmg.estimatedCost || 0));

    // Chargeable — normalize to boolean first
    const isChargeable = dmg.chargeable === true || dmg.chargeable === 'Yes' || dmg.chargeable === 'yes';
    const chargeEl = FormMapper.find('damageChargeable', 'Chargeable');
    if (chargeEl) {
      if (chargeEl.type === 'checkbox') {
        if (isChargeable && !chargeEl.checked) chargeEl.click();
        if (!isChargeable && chargeEl.checked) chargeEl.click();
      } else {
        FormMapper.setSelectValue(chargeEl, isChargeable ? 'Yes' : 'No');
      }
    }

    addLog(`Damage ${i + 1}: ${dmg.panel} - ${dmg.type}`, 'log-ok');

    // Click add/save button if present (for single-entry forms)
    const addBtn = findButton('Add') || findButton('Save Entry');
    if (addBtn && i < damages.length - 1) {
      addBtn.click();
      await delay(600);
    }
  }
}

// ── Bulk Photo Upload ──
async function uploadBulkPhotos(photos, addLog) {
  // Find photo upload area (VIW allows max 56 images)
  const fileInputs = document.querySelectorAll('input[type="file"]');
  let photoInput = null;

  for (const input of fileInputs) {
    const accept = (input.accept || '').toLowerCase();
    const name = (input.name || '').toLowerCase();
    const nearbyText = (input.parentElement?.textContent || '').toLowerCase();

    if (accept.includes('image') || name.includes('photo') || name.includes('image') ||
        nearbyText.includes('photo') || nearbyText.includes('image')) {
      photoInput = input;
      break;
    }
  }

  if (!photoInput && fileInputs.length > 0) {
    photoInput = fileInputs[fileInputs.length - 1]; // Last file input is often the photo upload
  }

  if (!photoInput) {
    addLog('Photo upload input not found', 'log-warn');
    return;
  }

  try {
    const dataTransfer = new DataTransfer();
    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i];
      const response = await fetch(photo.dataUrl);
      const blob = await response.blob();
      const file = new File([blob], `vehicle_photo_${i + 1}.jpg`, { type: 'image/jpeg' });
      dataTransfer.items.add(file);
    }

    photoInput.files = dataTransfer.files;
    photoInput.dispatchEvent(new Event('change', { bubbles: true }));
    addLog(`Uploaded ${photos.length} photos`, 'log-ok');

    // Wait for upload processing
    await delay(1000);

    // Try to assign "Image Location" labels if dropdowns appear
    await assignPhotoLocations(photos, addLog);

  } catch (err) {
    addLog(`Photo upload error: ${err.message}`, 'log-err');
  }
}

// Try to assign location labels to uploaded photos
async function assignPhotoLocations(photos, addLog) {
  const locationSelects = document.querySelectorAll(
    'select[name*="Location" i], select[name*="ImageLocation" i], select[class*="photo-location" i]'
  );

  if (locationSelects.length === 0) return;

  for (let i = 0; i < locationSelects.length && i < photos.length; i++) {
    const select = locationSelects[i];
    // Try "Exterior" first, then "Other"
    const best = DamageMapper.findBestOption(select, 'Exterior')
              || DamageMapper.findBestOption(select, 'Other');
    if (best) FormMapper.setSelectValue(select, best);
  }
  addLog('Photo locations assigned', 'log-ok');
}

// ── Button Finders ──
function findButton(text) {
  const lower = text.toLowerCase();
  const buttons = document.querySelectorAll('button, input[type="button"], input[type="submit"], a.btn');
  // Prefer exact match first
  for (const btn of buttons) {
    const btnText = (btn.textContent || btn.value || '').toLowerCase().trim();
    if (btnText === lower) return btn;
  }
  // Then contains — but only if the button text is close in length (avoid matching "Add" inside "Add Damage Information")
  for (const btn of buttons) {
    const btnText = (btn.textContent || btn.value || '').toLowerCase().trim();
    if (btnText.includes(lower) && btnText.length <= lower.length * 2.5) return btn;
  }
  return null;
}

function findButtonInContext(text) {
  // Search within modal or visible overlay first
  const lower = text.toLowerCase();
  const contexts = document.querySelectorAll('.modal, [class*="modal"], [role="dialog"], .overlay');

  for (const ctx of contexts) {
    if (ctx.offsetParent === null) continue; // skip hidden
    const buttons = ctx.querySelectorAll('button, input[type="button"], input[type="submit"]');
    for (const btn of buttons) {
      const btnText = (btn.textContent || btn.value || '').toLowerCase().trim();
      if (btnText.includes(lower)) return btn;
    }
  }

  // Fallback to page-wide search
  return findButton(text);
}

// ── Utility ──
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Wait for a selector to appear, with fallback
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
      resolve(null);
    }, timeout);
  });
}
