// Read API: every car we'd recommend to a given buyer.
//
// Buyer Match runs one direction in the app — for THIS car, the three likeliest
// buyers. This is the inverse, which is the direction you sell in: for THIS
// buyer, every active car that fits him, ranked.
//
// It recomputes rather than reading sa_recommendations, because that cache table
// is empty in practice (nothing has ever successfully written it) and because the
// numbers move every time a sold report lands. The input is ~40 active cars
// against ~1,200 sold rows, so a full recompute is a few milliseconds.
//
//   GET /api/buyer-recommendations?key=...                → every buyer + counts
//   GET /api/buyer-recommendations?key=...&buyer=rusty    → that buyer's cars
//   GET /api/buyer-recommendations?key=...&buyer=x&rank=1 → only where he's top pick
//   &spread=0   turn off the fair-share pass (raw top-dollar ranking)
//
// Auth is a shared key, hashed in the api_keys table — this is an operator tool
// meant to be curl-able, not a signed-in app screen.

import { createClient } from '@supabase/supabase-js'
import { recommendAll } from '../src/services/buyerMatch.js'

// PostgREST caps an unbounded select at 1000 rows, and sa_sold_sales passed that
// months ago — paging is not optional here, it is the difference between training
// on all the history and silently training on the newest 1000 rows.
const PAGE = 1000

async function fetchAll(db, table, columns) {
  const out = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select(columns).range(from, from + PAGE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...data)
    if (data.length < PAGE) break
  }
  return out
}

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// buyerKey mirrors the GHL edge function and BuyerAnalytics: phone, then email,
// then name. Two salespeople at one store share a key; the same store typed two
// different ways does not fragment into two buyers.
const buyerKey = (r) =>
  (r.buyer_phone && String(r.buyer_phone).replace(/\D/g, ''))
  || (r.buyer_email && String(r.buyer_email).toLowerCase())
  || (r.buyer_name || '').trim().toLowerCase()

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' })

  const given = req.query?.key || (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!given) return res.status(401).json({ error: 'key required' })
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'server not configured' })
  }

  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })

  const { data: keyRow } = await db.from('api_keys')
    .select('name, key_sha256').eq('name', 'buyer_recommendations').maybeSingle()
  if (!keyRow || (await sha256Hex(given)) !== keyRow.key_sha256) {
    return res.status(401).json({ error: 'bad key' })
  }
  // Best-effort: tells you whether the key is actually in use, without adding a
  // request log. Never fails the call.
  db.from('api_keys').update({ last_used_at: new Date().toISOString() })
    .eq('name', 'buyer_recommendations').then(() => {}, () => {})

  try {
    const [active, sold] = await Promise.all([
      fetchAll(db, 'sa_active_cars', '*'),
      fetchAll(db, 'sa_sold_sales', '*'),
    ])
    if (!active.length || !sold.length) {
      return res.status(200).json({ active: active.length, sold: sold.length, buyers: 0, results: [] })
    }

    // sa_active_cars is a snapshot of the last SmartAuction upload, so cars sold
    // since then are still in it. sa_sold_sales is the newer fact — drop the
    // overlap so the API never recommends a car we no longer own.
    const soldVins = new Set(sold.map((r) => (r.vin || '').toUpperCase()).filter(Boolean))
    const sellable = active.filter((c) => !soldVins.has((c.vin || '').toUpperCase()))

    const spread = req.query?.spread !== '0'
    const results = recommendAll(sellable, sold, { spread: { enabled: spread } })
    const byVin = new Map(sellable.map((c) => [c.vin, c]))
    const maxRank = parseInt(req.query?.rank || '3', 10) || 3

    // Invert: one entry per (buyer, car) pair, grouped by buyer.
    const buyers = new Map()
    for (const r of results) {
      for (const rec of r.recommendations) {
        if (rec.rank > maxRank) continue
        const key = buyerKey(rec)
        if (!buyers.has(key)) {
          buyers.set(key, {
            buyer_key: key,
            buyer_name: rec.buyer_name,
            buyer_email: rec.buyer_email || null,
            buyer_phone: rec.buyer_phone || null,
            buyer_state: rec.buyer_state || null,
            cars: [],
          })
        }
        const car = byVin.get(r.vin) || {}
        buyers.get(key).cars.push({
          vin: r.vin,
          year: car.year, make: car.make, model: car.model, trim: car.trim || null,
          odometer: car.odometer ?? null,
          // SmartAuction leaves Buy Now empty and fills Opening Price; the ask is
          // whichever we actually have.
          buy_now: car.buy_now == null ? (car.opening_price == null ? null : Number(car.opening_price))
                                       : Number(car.buy_now),
          detail_url: car.detail_url || null,
          segment: r.segment, tier: r.tier,
          est_value: r.value == null ? null : Math.round(r.value),
          predicted_price: rec.predicted_price == null ? null : Math.round(rec.predicted_price),
          rank: rec.rank,
          confidence: rec.confidence,
          reason: rec.reason,
        })
      }
    }

    for (const b of buyers.values()) {
      // Best fit first — that is the order you would pitch them in.
      b.cars.sort((x, y) => x.rank - y.rank || (y.predicted_price || 0) - (x.predicted_price || 0))
      b.count = b.cars.length
      b.total_predicted = b.cars.reduce((s, c) => s + (c.predicted_price || 0), 0)
    }

    const q = (req.query?.buyer || '').trim().toLowerCase()
    if (!q) {
      // Roster view: who is worth calling, biggest book first.
      const list = [...buyers.values()]
        .map(({ cars, ...rest }) => { void cars; return rest })
        .sort((a, b) => b.count - a.count || b.total_predicted - a.total_predicted)
      return res.status(200).json({
        active: sellable.length, sold_out: active.length - sellable.length,
        sold: sold.length, spread,
        buyers: list.length, results: list,
      })
    }

    const digits = q.replace(/\D/g, '')
    const hits = [...buyers.values()].filter(
      (b) => b.buyer_name.toLowerCase().includes(q)
        || (b.buyer_email || '').toLowerCase().includes(q)
        || (digits && (b.buyer_phone || '').replace(/\D/g, '').includes(digits)),
    )
    if (!hits.length) return res.status(404).json({ error: `no buyer matching "${req.query.buyer}"` })
    // Several stores can match a loose search ("ford"), so return them all rather
    // than silently picking one.
    return res.status(200).json({ spread, matched: hits.length, results: hits })
  } catch (e) {
    console.error('buyer-recommendations failed:', e?.message || e)
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
