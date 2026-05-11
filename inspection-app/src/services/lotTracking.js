import { supabase } from './supabase'

export async function fetchSections() {
  const { data, error } = await supabase
    .from('lot_sections')
    .select('*')
    .eq('active', true)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data || []
}

export async function recordScan({ stock_number, vin, section, input_method, notes }) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated — sign in first')
  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from('lot_scans')
    .insert({
      stock_number,
      vin,
      section,
      input_method,
      notes,
      scanned_by: user.id,
    })
    .select()
    .single()
  if (error) throw error

  // Mirror into vehicle_locations so the Inventory page's unified location
  // pipeline (filters, stuck-21d signal, export CSV) reflects scans too.
  // physical_location is slugified from the raw section name.
  const slug = String(section || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (slug) {
    await supabase
      .from('vehicle_locations')
      .upsert({
        stock_number,
        vin: vin || '',
        physical_location: slug,
        physical_source: 'lot_scan',
        location_updated_at: nowIso,
        updated_at: nowIso,
        notes: { section, input_method, scanned_by: user.id },
      }, { onConflict: 'stock_number' })
  }
  return data
}

export function staleness(daysSinceSeen) {
  if (daysSinceSeen == null) return 'never'
  if (daysSinceSeen >= 14) return 'red'
  if (daysSinceSeen >= 7) return 'yellow'
  return 'green'
}

export const STALENESS_STYLES = {
  green:  { chip: 'bg-emerald-500/20 text-emerald-400', label: 'fresh' },
  yellow: { chip: 'bg-yellow-500/20 text-yellow-400',   label: 'stale' },
  red:    { chip: 'bg-red-500/20 text-red-400',         label: 'old' },
  never:  { chip: 'bg-slate-700 text-slate-400',        label: 'never' },
}

export function formatLastSeen(daysSinceSeen) {
  if (daysSinceSeen == null) return 'never tracked'
  if (daysSinceSeen === 0) return 'today'
  if (daysSinceSeen === 1) return '1 day ago'
  return `${daysSinceSeen} days ago`
}

// Parse a spoken phrase into an alphanumeric query (digits + letters).
// Stock numbers are usually all-digit; VINs have letters (B-Z except I, O, Q).
//
// Web Speech transcribes numbers reasonably well ("four five two one" → "4521")
// but is less reliable for individual letters. We accept multiple forms:
//   - Bare digits ("4521")
//   - Digit words ("four", "five", ...)
//   - NATO phonetic for letters ("alpha", "bravo", "charlie", ...) — most reliable
//   - Common spoken letter forms ("kay" → K, "em" → M, "ex" → X, ...)
//   - Bare single-letter tokens ("k", "m", ...) — Web Speech sometimes returns these
const NUMBER_WORDS = {
  zero: '0', oh: '0', o: '0',
  one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
}
const LETTER_WORDS = {
  // NATO phonetic (most reliable for spelling)
  alpha: 'A',  bravo: 'B',   charlie: 'C', delta: 'D',  echo: 'E',
  foxtrot: 'F', golf: 'G',   hotel: 'H',   india: 'I',  juliet: 'J',
  kilo: 'K',   lima: 'L',    mike: 'M',    november: 'N', oscar: 'O',
  papa: 'P',   quebec: 'Q',  romeo: 'R',   sierra: 'S', tango: 'T',
  uniform: 'U', victor: 'V', whiskey: 'W', xray: 'X',   yankee: 'Y', zulu: 'Z',
  // Common spoken letter forms (what Web Speech often transcribes)
  ay: 'A',    bee: 'B', cee: 'C', dee: 'D', ef: 'F',  gee: 'G',
  aitch: 'H', jay: 'J', kay: 'K', el: 'L',  ell: 'L', em: 'M',  en: 'N',
  pee: 'P',   ar: 'R',  ess: 'S', tee: 'T', vee: 'V', ex: 'X',  wye: 'Y',
  zee: 'Z',   zed: 'Z',
}
export function parseSpokenDigits(text) {
  if (!text) return ''
  const cleaned = text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    // Filler words to strip — note: don't strip "a" or "i", they could be spoken letters
    .replace(/\b(stock|number|num|vin|car|the|is|it|hash|pound|um|uh)\b/g, ' ')
  const tokens = cleaned.split(/\s+/).filter(Boolean)
  let out = ''
  for (const t of tokens) {
    if (/^\d+$/.test(t)) out += t
    else if (NUMBER_WORDS[t] != null) out += NUMBER_WORDS[t]
    else if (LETTER_WORDS[t] != null) out += LETTER_WORDS[t]
    else if (/^[a-z]$/.test(t)) out += t.toUpperCase()  // bare single letter
  }
  return out
}

// Extract a valid 17-char VIN from any decoded barcode text.
// Factory door-jamb stickers usually contain just the VIN, but some include
// extra metadata (manufacturer code, GVWR, etc.). VINs are 17 chars from
// the alphabet [A-HJ-NPR-Z0-9] (no I, O, Q to avoid digit confusion).
// Returns the normalized uppercase VIN, or empty string if no VIN found.
export function extractVIN(text) {
  if (!text) return ''
  const upper = String(text).toUpperCase()
  const match = upper.match(/[A-HJ-NPR-Z0-9]{17}/)
  return match ? match[0] : ''
}

// Find the inventory row matching a full VIN (or last 6, as fallback)
export function matchVehicleByVIN(rows, vin) {
  if (!vin) return null
  const v = vin.toUpperCase()
  // First try exact full-VIN match
  let hit = rows.find((r) => String(r.vehicle_vin || '').toUpperCase() === v)
  if (hit) return hit
  // Fallback: match by last 6 (in case Frazer stores VINs slightly differently)
  if (v.length >= 6) {
    const last6 = v.slice(-6)
    hit = rows.find((r) => String(r.last_6_vin || r.vehicle_vin?.slice(-6) || '').toUpperCase() === last6)
  }
  return hit || null
}

// Filter the inventory by a digit query — matches against stock_number and last_6_vin
export function filterInventory(rows, query) {
  const q = (query || '').trim().toUpperCase()
  if (!q) return []
  return rows.filter((r) => {
    const stock = String(r.stock_number || '').toUpperCase()
    const v6 = String(r.last_6_vin || r.vehicle_vin?.slice(-6) || '').toUpperCase()
    return stock.includes(q) || v6.includes(q)
  })
}
