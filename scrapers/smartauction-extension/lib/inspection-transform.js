// Transforms a Carz Inc inspection (from Supabase PWA) into the data shape
// SmartAuction's Vehicle Entry + Damages forms expect.
//
// PWA checklist shape (simplified):
// {
//   exterior: { <panelId>: { damages: [ { type, size, count, note, photos: [{url}] } ] } },
//   interior: { <zoneId>:  { damages: [ { type, size, count, note, photos: [{url}] } ] } },
//   photos:   { <slotId>: { url, path } },
//   interior_needs_detail: bool,
//   test_drive: { <itemId>: { status, note } },
// }
//
// SA expected damage shape (per existing content.js / damage-mapper.js):
// {
//   panel: 'Bumper - Front',   // SA-normalized panel name
//   type: 'Dent',              // SA damage type
//   description: 'passenger corner',
//   chargeable: false,
//   estimatedCost: 0,
//   photos: ['https://...jpg'] // NEW — per-damage photo URLs
// }
if (typeof InspectionTransform === 'undefined') {

'use strict';

// ── PWA panel ID → SmartAuction panel label ────────────────────────
// The PWA uses short snake_case IDs; SA uses a specific phrase per dropdown.
// Keep this in sync with inspection-app/src/services/inspectionFlow.js EXTERIOR_PANELS.
var PWA_EXTERIOR_TO_SA = {
  hood:              'Hood',
  front_bumper:      'Bumper - Front',
  rear_bumper:       'Bumper - Rear',
  grille:            'Grille',
  windshield:        'Windshield',
  rear_window:       'Rear Window',
  left_headlight:    'Headlight - Left',
  right_headlight:   'Headlight - Right',
  left_taillight:    'Taillight - Left',
  right_taillight:   'Taillight - Right',
  left_mirror:       'Mirror - Left',
  right_mirror:      'Mirror - Right',
  left_fender:       'Fender - Left Front',
  right_fender:      'Fender - Right Front',
  driver_front_door: 'Door - Driver Front',
  driver_rear_door:  'Door - Driver Rear',
  pass_front_door:   'Door - Passenger Front',
  pass_rear_door:    'Door - Passenger Rear',
  left_quarter:      'Quarter Panel - Left',
  right_quarter:     'Quarter Panel - Right',
  left_rocker:       'Rocker Panel - Left',
  right_rocker:      'Rocker Panel - Right',
  trunk:             'Trunk Lid',
  roof:              'Roof',
};

// ── PWA interior zone ID → SmartAuction interior label ────────────
// Interior damages in SA go under DAMAGE TYPE = "Interior" with a Location field.
var PWA_INTERIOR_TO_SA = {
  driver_seat:       'Driver Seat',
  passenger_seat:    'Passenger Seat',
  rear_seat_left:    'Rear Seat - Left',
  rear_seat_right:   'Rear Seat - Right',
  rear_seat_center:  'Rear Seat - Center',
  driver_door_panel: 'Driver Door Panel',
  pass_door_panel:   'Passenger Door Panel',
  rear_door_left:    'Rear Door Panel - Left',
  rear_door_right:   'Rear Door Panel - Right',
  steering_wheel:    'Steering Wheel',
  dashboard:         'Dashboard',
  center_console:    'Center Console',
  glove_box:         'Glove Box',
  driver_floor:      'Carpet - Driver',
  passenger_floor:   'Carpet - Passenger',
  rear_floor_left:   'Carpet - Rear Left',
  rear_floor_right:  'Carpet - Rear Right',
  headliner:         'Headliner',
  rear_deck:         'Rear Deck / Cargo',
  sun_visors:        'Sun Visors',
};

// ── PWA damage type → SA-compatible damage type ───────────────────
// SA accepts any text in the Description field, but we map to a clean
// keyword the SA condition standards will recognize.
// ── Startup / Test Drive item labels ───────────────────────────────
// Short labels used when a failed Quick Check or Test Drive item is
// emitted as a synthetic damage row. Keep the key list in sync with
// STARTUP_ITEMS / TEST_DRIVE_ITEMS in inspectionFlow.js.
// Panel labels used for the SA LOCATION field on synthetic damage rows
// (startup + test-drive failures). The inspector's note lands verbatim in
// the DESCRIPTION field, so these labels describe *what system* is affected,
// not the specific symptom.
var STARTUP_ITEM_LABELS = {
  dash_lights: 'Dashboard Warning Lights',
  accessories: 'Accessories',
  engine:      'Engine',
};
var TEST_DRIVE_ITEM_LABELS = {
  drivetrain:      'Drivetrain',
  brakes_steering: 'Brakes & Steering',
  ride_tires:      'Ride & Vibration',
};

// SA description field has a hard 50-char limit. Synthetic damages use
// type 'Other' which content.js no longer prepends, so the full 50 chars
// are available for the inspector's note.
var SYNTHETIC_DESC_MAX = 50;

var DAMAGE_TYPE_ALIAS = {
  'Scratch':        'Scratch',
  'Scuff':          'Scuff',
  'Dent':           'Dent',
  'Previous Repair':'Previous Repair',
  'Paint Chip':     'Paint Chip',
  'Paint Damage':   'Paint Damage',
  'Crack':          'Crack',
  'Rust':           'Rust',
  'Hail Damage':    'Hail Damage',
  'Broken':         'Broken',
  'Missing':        'Missing',
  'Faded':          'Faded',
  // Interior
  'Tear':           'Tear',
  'Stain':          'Stain',
  'Burn':           'Burn',
  'Worn':           'Worn',
  'Cracked':        'Crack',
  'Discolored':     'Faded',
  'Sagging':        'Worn',
  'Other':          'Other',
};

// SA's damage description field has a hard 50-char limit. content.js builds
// the final value as `<type> - <description>`, so the budget available for
// buildDescription is (50 - type.length - 3). Without this, long types like
// "Previous Repair" (15) push the combined string to 58 chars and SA cuts it
// mid-word.
function budgetForType(type) {
  const prefixLen = (type || '').length + 3; // "<type> - "
  return Math.max(10, 50 - prefixLen);
}

function buildDescription(damage, type) {
  const parts = [];
  if (damage.size === 'Multiple') {
    parts.push('multiple' + (damage.count ? ` x${damage.count}` : ''));
  } else if (damage.size) {
    parts.push(`${damage.size} size`);
  }
  if (damage.note) parts.push(damage.note);
  return parts.join(' - ').substring(0, budgetForType(type));
}

function extractPhotoUrls(damage) {
  if (Array.isArray(damage.photos)) {
    return damage.photos.map((p) => p?.url).filter(Boolean);
  }
  if (damage.photo_url) return [damage.photo_url];
  return [];
}

function transformInspectionToSA(inspection) {
  const checklist = inspection.checklist || {};
  const damages = [];

  // Exterior
  const ext = checklist.exterior || {};
  for (const [panelId, panel] of Object.entries(ext)) {
    const panelLabel = PWA_EXTERIOR_TO_SA[panelId] || panelId;
    for (const d of panel.damages || []) {
      const saType = DAMAGE_TYPE_ALIAS[d.type] || d.type || 'Other';
      damages.push({
        panel: panelLabel,
        category: 'Exterior',
        type: saType,
        description: buildDescription(d, saType),
        chargeable: false,
        estimatedCost: 0,
        photos: extractPhotoUrls(d),
      });
    }
  }

  // Interior
  const intr = checklist.interior || {};
  for (const [zoneId, zone] of Object.entries(intr)) {
    const zoneLabel = PWA_INTERIOR_TO_SA[zoneId] || zoneId;
    for (const d of zone.damages || []) {
      const saType = DAMAGE_TYPE_ALIAS[d.type] || d.type || 'Other';
      damages.push({
        panel: zoneLabel,
        category: 'Interior',
        type: saType,
        description: buildDescription(d, saType),
        chargeable: false,
        estimatedCost: 0,
        photos: extractPhotoUrls(d),
      });
    }
  }

  // Startup (Quick Check) failures — the item label becomes the SA LOCATION
  // (e.g. "Dashboard Warning Lights"), the inspector's note becomes the
  // DESCRIPTION (e.g. "engine light and traction control light on").
  const startup = checklist.startup || {};
  for (const [itemId, item] of Object.entries(startup)) {
    if (!item || item.status !== 'fail') continue;
    const label = STARTUP_ITEM_LABELS[itemId] || itemId;
    const note = (item.note || '').trim();
    damages.push({
      panel: label,
      category: 'Interior',
      type: 'Other',
      description: (note || 'Issue reported').substring(0, SYNTHETIC_DESC_MAX),
      chargeable: false,
      estimatedCost: 0,
      photos: [],
    });
  }

  // Test Drive failures — item label → LOCATION, inspector's note → DESCRIPTION.
  const testDrive = checklist.test_drive || {};
  for (const [itemId, item] of Object.entries(testDrive)) {
    if (!item || item.status !== 'fail') continue;
    const label = TEST_DRIVE_ITEM_LABELS[itemId] || itemId;
    const note = (item.note || '').trim();
    damages.push({
      panel: label,
      category: 'Interior',
      type: 'Other',
      description: (note || 'Issue reported').substring(0, SYNTHETIC_DESC_MAX),
      chargeable: false,
      estimatedCost: 0,
      photos: [],
    });
  }

  // If the inspector flagged "interior needs full detail" but logged zero
  // zone damages, add a single summary row so the listing isn't blank.
  if (checklist.interior_needs_detail && !damages.some((d) => d.category === 'Interior')) {
    damages.push({
      panel: 'Interior',
      category: 'Interior',
      type: 'Other',
      description: 'Needs full interior detail review',
      chargeable: true,
      estimatedCost: 0,
      photos: [],
    });
  }

  // Stock photos (the 12 required main shots) — flat list of URLs
  const photos = checklist.photos || {};
  const stockPhotoUrls = Object.values(photos)
    .filter((p) => p && p.url)
    .map((p) => p.url);

  return {
    vin: inspection.vin,
    vin6: (inspection.vin_last6 || inspection.vin || '').slice(-6),
    fullVin: inspection.vin,
    odometer: inspection.mileage ? String(inspection.mileage) : '',
    damages,
    stockPhotoUrls,
    testDriveIssues: Object.entries(checklist.test_drive || {})
      .filter(([, v]) => v && v.status === 'fail')
      .map(([key, v]) => ({ key, note: v.note || '' })),
  };
}

var InspectionTransform = {
  transformInspectionToSA,
  PWA_EXTERIOR_TO_SA,
  PWA_INTERIOR_TO_SA,
  DAMAGE_TYPE_ALIAS,
};

}
