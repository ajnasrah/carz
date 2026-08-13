import { supabase } from './supabase'

// Damages for a marketplace listing, written exactly the way the SmartAuction
// extension writes them: bucketed under 'sa_'-prefixed keys in the inspection's
// checklist, through the same upsert_listing_damages RPC. Same vocabulary, same
// store — so a car can be typed up in the app or in the extension and the other
// side reads it back unchanged.
//
// The RPC replaces the whole 'sa_' set on every save and leaves PWA-inspection
// damages (any key without that prefix) alone. This module therefore round-trips
// every 'sa_' row it loaded, and never touches the inspection's own findings.

// SmartAuction's own dropdown values — mirrored from the extension's
// DamageMapper so what's typed here maps 1:1 onto the SA condition report.
export const SA_DAMAGE_TYPES = [
  'Dent', 'Scratch', 'Scuff', 'Paint Chip', 'Paint Damage',
  'Crack', 'Broken', 'Missing', 'Rust', 'Corrosion',
  'Tear', 'Stain', 'Burn', 'Worn', 'Faded',
  'Hail Damage', 'Water Damage', 'Other',
]

export const SA_INTERIOR_PANELS = [
  'Interior', 'Dashboard', 'Steering Wheel',
  'Seat - Driver', 'Seat - Passenger', 'Seat - Rear',
  'Driver Door Panel', 'Passenger Door Panel',
  'Rear Door Panel - Left', 'Rear Door Panel - Right',
  'Headliner', 'Carpet/Floor', 'Console',
]

export const SA_EXTERIOR_PANELS = [
  'Bumper - Front', 'Bumper - Rear', 'Door - Driver Front', 'Door - Driver Rear',
  'Door - Passenger Front', 'Door - Passenger Rear', 'Fender - Left Front',
  'Fender - Right Front', 'Grille', 'Headlight - Left', 'Headlight - Right',
  'Hood', 'Mirror - Left', 'Mirror - Right', 'Quarter Panel - Left',
  'Quarter Panel - Right', 'Rear Window', 'Rocker Panel - Left',
  'Rocker Panel - Right', 'Roof', 'Tailgate', 'Taillight - Left',
  'Taillight - Right', 'Trunk Lid', 'Warning Light', 'Wheel - Left Front',
  'Wheel - Left Rear', 'Wheel - Right Front', 'Wheel - Right Rear', 'Windshield',
]

const INTERIOR_SET = new Set(SA_INTERIOR_PANELS)
export const isInteriorPanel = (panel) => INTERIOR_SET.has(panel)

// The disclosures that go on every car's condition report, matching the
// extension's "+ Std" button.
export const STANDARD_DAMAGES = [
  { panel: 'Bumper - Front', type: 'Paint Chip', note: 'multiple' },
  { panel: 'Hood', type: 'Paint Chip', note: 'multiple' },
  { panel: 'Console', type: 'Worn', note: '' },
]

// Pull the editable ('sa_') rows out of a listing checklist, plus a count of the
// inspection's own damages so the UI can say why they aren't listed here.
export function readDamages(checklist) {
  const rows = []
  let fromInspection = 0
  for (const section of ['exterior', 'interior']) {
    for (const [key, entry] of Object.entries(checklist?.[section] || {})) {
      const damages = entry?.damages || []
      if (!key.startsWith('sa_')) {
        fromInspection += damages.length
        continue
      }
      for (const d of damages) {
        rows.push({
          panel: d.panel || (section === 'interior' ? 'Interior' : 'Exterior'),
          type: d.type || '',
          note: d.note || '',
          photos: Array.isArray(d.photos) ? d.photos : [],
        })
      }
    }
  }
  return { rows, fromInspection }
}

// Back into the extension's exact shape: one damage per 'sa_ext_N' / 'sa_int_N'.
export function buildDamageChecklist(rows) {
  const exterior = {}
  const interior = {}
  let ei = 0
  let ii = 0
  for (const r of rows) {
    if (!r.panel && !r.type) continue
    const dmg = {
      type: r.type || r.note || 'Damage',
      size: '',
      count: '',
      note: r.type && r.note ? r.note : '',
      photos: (r.photos || []).filter((p) => p?.url).map((p) => ({ url: p.url, path: p.path || '' })),
      panel: r.panel || (isInteriorPanel(r.panel) ? 'Interior' : 'Exterior'),
    }
    if (isInteriorPanel(r.panel)) interior[`sa_int_${ii++}`] = { damages: [dmg] }
    else exterior[`sa_ext_${ei++}`] = { damages: [dmg] }
  }
  return { exterior, interior }
}

export async function saveDamages(vin, rows) {
  const { exterior, interior } = buildDamageChecklist(rows)
  const { data, error } = await supabase.rpc('upsert_listing_damages', {
    p_vin: vin,
    p_exterior: exterior,
    p_interior: interior,
  })
  if (error) throw error
  if (data === 'bad_vin') throw new Error('That VIN is too short to match a car')
  return data
}
