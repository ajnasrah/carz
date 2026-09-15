// The marketplace's "Text best buyer" list: for every car, the best buyers we
// can actually text.
//
// Scored by the same engine as Buyer Match, trained on every lane — the model
// is better for knowing what Mt Moriah and UAX buy — but only buyers with a real
// phone number are eligible to be picked. In practice that is SmartAuction's
// buyers; Frazer records dealers by name only.

import { scoreAll } from '../../src/services/buyerMatch.js'

export const PICKS_PER_CAR = 3

// PostgREST caps a response at 1,000 rows, RPCs included, and the Range header
// is ignored on an RPC POST — hence the function's own limit/offset arguments.
const PAGE = 1000

export async function fetchTraining(db) {
  const out = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db.rpc('buyer_training_rows', {
      p_include_arbitration: false, p_limit: PAGE, p_offset: offset,
    })
    if (error) throw new Error(`buyer_training_rows: ${error.message}`)
    const rows = data || []
    out.push(...rows)
    if (rows.length < PAGE) break
    if (offset > 200000) break
  }
  const { data: expected } = await db.rpc('buyer_training_count', { p_include_arbitration: false })
  if (Number(expected) > 0 && out.length < Number(expected)) {
    throw new Error(`training data truncated: ${out.length} of ${expected} sales`)
  }
  return out
}

// 10 digits, US. An 11-digit number starting with 1 is the same number.
//
// Placeholders are not numbers: CarMax's SmartAuction record carries
// 999-999-9999, and it was being offered as a buyer to text. A real US number
// never starts its area code or exchange with 0 or 1, and is never one digit
// repeated.
export function tenDigits(phone) {
  let d = String(phone ?? '').replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1)
  if (d.length !== 10) return null
  if (/^[01]/.test(d) || /^\d{3}[01]/.test(d) || /^(\d)\1{9}$/.test(d)) return null
  return d
}

// `blocked`: numbers on the do-not-text list (outreach_opt_outs). Skipped here so
// the next buyer moves up, not just hidden at read time.
export function textablePicks(cars, training, demand = [], blocked = new Set()) {
  const textable = (cand) => {
    if (cand.is_channel) return false
    const phone = tenDigits(cand.buyer_phone)
    return !!phone && !blocked.has(phone)
  }
  const { cars: scored } = scoreAll(cars, training, { eligible: textable }, demand)
  const stock = new Map(cars.map((c) => [c.vin, c.stock_number ?? null]))
  const rows = []
  for (const c of scored) {
    c.candidates.slice(0, PICKS_PER_CAR).forEach((cand, i) => {
      rows.push({
        vin: String(c.vin).toUpperCase(),
        rank: i + 1,
        stock_number: stock.get(c.vin) ?? null,
        buyer_key: cand.buyer_key,
        buyer_name: cand.buyer_name,
        buyer_phone: tenDigits(cand.buyer_phone),
        buyer_email: cand.buyer_email || null,
        buyer_city: cand.buyer_city || null,
        buyer_state: cand.buyer_state || null,
        predicted_price: cand.predicted_price ?? null,
        confidence: cand.confidence,
        reason: cand.reason,
        total_buys: cand.total_buys ?? null,
        days_since: cand.days_since ?? null,
      })
    })
  }
  return rows
}
