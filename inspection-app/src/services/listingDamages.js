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
  // Truck and body panels SmartAuction has and this list did not. Every one of
  // these is on a car we are selling right now — bed sides alone accounted for
  // 18 damage rows the editor could not display.
  'Bed Side - Left', 'Bed Side - Right', 'Cab Corner - Left', 'Cab Corner - Right',
  'Running Board - Left', 'Running Board - Right', 'Valance - Front', 'Valance - Rear',
  'Pillar - Left', 'Pillar - Right', 'Fuel Door', 'Wheel Arch - Left', 'Wheel Arch - Right',
]

const INTERIOR_SET = new Set(SA_INTERIOR_PANELS)
export const isInteriorPanel = (panel) => INTERIOR_SET.has(panel)

// Every panel the dropdown offers. Used to tell a value the list knows from one
// that arrived some other way and must be shown as it came.
export const KNOWN_PANELS = new Set([...SA_EXTERIOR_PANELS, ...SA_INTERIOR_PANELS])

// What people actually type, mapped to what SmartAuction calls it.
//
// Damages reach a listing three ways and only one of them is a dropdown: the
// extension's manual entry takes free text, the crew describe cars in their own
// words, and a scraped condition report carries SA's own concatenated strings.
// The result on real cars: "rear bumper", "left front door", "driver fender",
// "tail gate" — all perfectly clear, none of them a value this app could show.
//
// Matched on a flattened form so spacing, case and punctuation stop mattering.
// Anything not in here is left exactly as it came: an unrecognised panel is a
// panel we don't understand yet, not one to guess at.
const flat = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

const PANEL_ALIASES = Object.entries({
  'Bumper - Front': ['front bumper', 'bumper front', 'front bumper cover', 'bumper cover front'],
  'Bumper - Rear': ['rear bumper', 'bumper rear', 'rear bumper cover', 'bumper cover rear', 'rear metal bumper chrome'],
  'Door - Driver Front': ['driver front door', 'left front door', 'lf door', 'front left door', 'driver door'],
  'Door - Driver Rear': ['driver rear door', 'left rear door', 'lr door', 'rear left door'],
  'Door - Passenger Front': ['passenger front door', 'right front door', 'rf door', 'front right door', 'passenger door'],
  'Door - Passenger Rear': ['passenger rear door', 'right rear door', 'rr door', 'rear right door', 'rear passenger door'],
  'Fender - Left Front': ['left fender', 'driver fender', 'lf fender', 'front left fender'],
  'Fender - Right Front': ['right fender', 'passenger fender', 'passneger fender', 'rf fender', 'front right fender'],
  'Quarter Panel - Left': ['left quarter panel', 'left quarter', 'driver quarter', 'driver quarter panel', 'lq panel'],
  'Quarter Panel - Right': ['right quarter panel', 'right quarter', 'passenger quarter', 'passenger quarter panel'],
  'Rocker Panel - Left': ['left rocker panel', 'driver rocker panel', 'l rocker panel'],
  'Rocker Panel - Right': ['right rocker panel', 'passenger rocker panel', 'r rocker panel'],
  Tailgate: ['tail gate', 'tailgate', 'lift gate', 'liftgate'],
  Hood: ['hood', 'bonnet'],
  Roof: ['roof'],
  Grille: ['grille', 'grill', 'front grill'],
  Windshield: ['windshield', 'front windshield', 'windscreen'],
  'Rear Window': ['rear window', 'back glass', 'rear glass'],
  'Taillight - Left': ['left tail light', 'left taillight', 'driver tail light'],
  'Taillight - Right': ['right tail light', 'right taillight', 'passenger tail light'],
  'Headlight - Left': ['left head light', 'left headlight', 'driver headlight', 'driver side blinker light'],
  'Headlight - Right': ['right head light', 'right headlight', 'passenger headlight'],
  'Mirror - Left': ['left mirror', 'driver mirror'],
  'Mirror - Right': ['right mirror', 'passenger mirror'],
  'Wheel - Left Front': ['left front wheel', 'lf wheel', 'driver front wheel'],
  'Wheel - Left Rear': ['left rear wheel', 'lr wheel', 'driver rear wheel'],
  'Wheel - Right Front': ['right front wheel', 'rf wheel', 'passenger front wheel'],
  'Wheel - Right Rear': ['right rear wheel', 'rr wheel', 'passenger rear wheel', 'passenger rear tire'],
  'Seat - Driver': ['lf seat', 'driver seat', 'drivers seat'],
  'Seat - Passenger': ['rf seat', 'passenger seat'],
  'Seat - Rear': ['rear seat', 'rear seats', 'left rear seat', 'right rear seat', 'lr seat back'],
  Console: ['center console', 'centre console', 'console'],
  'Carpet/Floor': ['carpet', 'floor mats', 'floor mat', 'left front carpet', 'floor panel'],
  'Steering Wheel': ['steering wheel'],
  Dashboard: ['dash', 'dashboard', 'radio'],
  'Rear Door Panel - Left': ['left rear door panel'],
  'Bed Side - Left': ['l bed side', 'left bed side', 'lh bed side'],
  'Bed Side - Right': ['r bed side', 'right bed side', 'rh bed side'],
  'Cab Corner - Left': ['l cab corner panel', 'left cab corner', 'l cab side'],
  'Cab Corner - Right': ['r cab corner panel', 'right cab corner', 'r cab side'],
  'Running Board - Left': ['l running board', 'left running board'],
  'Running Board - Right': ['r running board', 'right running board'],
  'Valance - Front': ['f valance', 'front valance'],
  'Valance - Rear': ['r valance', 'rear valance'],
  'Pillar - Left': ['l a pillar', 'l b pillar', 'l c pillar', 'left pillar'],
  'Pillar - Right': ['r a pillar', 'r b pillar', 'r c pillar', 'right pillar', 'a pillar r'],
  'Fuel Door': ['fuel door', 'fuel door l', 'gas door', 'fuel filler door'],
  'Wheel Arch - Left': ['left wheel arch', 'driver wheel arch'],
  'Wheel Arch - Right': ['right wheel arch', 'rear passenger wheel arch', 'passenger wheel arch'],
}).flatMap(([canonical, aliases]) => aliases.map((a) => [flat(a), canonical]))

const PANEL_BY_ALIAS = new Map(PANEL_ALIASES)

export function canonicalPanel(panel) {
  const p = String(panel || '').trim()
  if (!p || KNOWN_PANELS.has(p)) return p
  return PANEL_BY_ALIAS.get(flat(p)) || p
}

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
          panel: canonicalPanel(d.panel) || (section === 'interior' ? 'Interior' : 'Exterior'),
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
