// "Text best buyer" — the buyers we can text about a car, and the text itself.
//
// The picks are computed hourly by /api/buyer-picks: the Buyer Match engine,
// restricted to buyers with a phone on file. Reading them is one staff-only call,
// so the marketplace never downloads the 2.5 MB training set Buyer Match needs.
import { supabase } from './supabase'
import { carLines } from './marketplaceShare'
import { DEALER } from '../config/dealer'

// VIN (upper case) -> picks, best first.
export async function fetchBuyerPicks() {
  const { data, error } = await supabase.rpc('marketplace_buyer_picks')
  if (error) throw new Error(error.message)
  const rows = data || []
  // Three per car keeps this near 300 rows. PostgREST truncates at 1,000
  // without saying so, which would quietly drop the newest cars' picks.
  if (rows.length >= 1000) console.warn('marketplace_buyer_picks hit the 1,000-row cap; page it')
  const byVin = new Map()
  for (const r of rows) {
    const list = byVin.get(r.vin) || []
    list.push(r)
    byVin.set(r.vin, list)
  }
  for (const list of byVin.values()) list.sort((a, b) => a.rank - b.rank)
  return byVin
}

export const picksFor = (byVin, car) =>
  byVin?.get(String(car?.full_vin || car?.vin || '').toUpperCase()) || []

// Past this many cars texted today, a buyer stops being the one-tap target —
// the outreach queue's own daily limit. He is still in Top 3.
export const DAILY_CARS_PER_BUYER = 5

// Who the one-tap button texts: the best buyer not already texted about THIS
// car and not already at today's limit. Falls back to #1 when everyone is.
export function pickTarget(picks) {
  return picks?.find((p) => !p.last_pitched_at && (p.texted_today || 0) < DAILY_CARS_PER_BUYER) || picks?.[0] || null
}

// A record that this buyer was pitched this car. The text goes from the
// salesman's own phone, so nothing else knows it happened.
export async function logBuyerPitch(car, pick) {
  const { error } = await supabase.rpc('log_buyer_pitch', {
    p_vin: String(car.full_vin || car.vin || '').toUpperCase(),
    p_buyer_key: pick.buyer_key,
    p_stock_number: car.stock_number ?? null,
    p_buyer_name: pick.buyer_name,
    p_buyer_phone: pick.buyer_phone,
  })
  if (error) throw new Error(error.message)
}

// SmartAuction names are legal entities: "RUSTY ECK FORD, INC",
// "Javelina Investments of Oklahoma, LLC dba SW Customz Auto Sales". Say the
// name a person would say — the dba if there is one, no ", INC", and not in
// capitals.
export function buyerShortName(name) {
  let n = String(name || '').replace(/\s+/g, ' ').trim()
  const dba = n.split(/\bd\/?b\/?a\b/i)
  if (dba.length > 1 && dba[1].trim()) n = dba[1].trim()
  n = n.split(',')[0]
    .replace(/\s+-\s+.*$/, '')            // "City Auto Sales LLC - Mem"
    .replace(/\s+(LLC|L\.L\.C\.|INC\.?|INCORPORATED|CORP\.?|CO\.)$/i, '')
    .trim()
  if (n && n === n.toUpperCase()) {
    n = n.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase())
      // Keep dealer-group initials in capitals: CDJR, GMC, BMW.
      .replace(/\b(Cdjr|Gmc|Bmw|Kia|Rv|Usa|Ii|Iii)\b/g, (m) => m.toUpperCase())
      // No lookbehind here: the iOS app supports iOS 15, whose Safari cannot
      // parse one — and a regex it cannot parse fails the whole bundle.
      .replace(/ (Of|The|And)\b/g, (m) => m.toLowerCase())
  }
  return n || 'there'
}

export function buildPitchMessage(car, pick) {
  return [
    `Hi ${buyerShortName(pick?.buyer_name)}, this is ${DEALER.name} ${DEALER.department}. I think this one fits your lot:`,
    '',
    carLines(car),
  ].join('\n')
}

// "today", "yesterday", "3d ago", "5w ago"
export function agoLabel(ts) {
  if (!ts) return null
  const days = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days}d ago`
  return `${Math.floor(days / 7)}w ago`
}
