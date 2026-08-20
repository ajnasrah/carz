// Read API: every car we'd recommend to a given buyer.
//
// Buyer Match runs one direction in the app — for THIS car, the likeliest
// buyers. This is the inverse, which is the direction you sell in: for THIS
// buyer, every active car that fits him, ranked.
//
// It recomputes rather than reading the cache, because the numbers move every
// time a sold report lands and the whole job is a few milliseconds.
//
// Two things changed on 2026-08-20. Training is buyer_training_rows(), which
// covers every channel we sell through (~6,100 sales, ~650 buyers) rather than
// SmartAuction alone (1,236 / 383). And the per-buyer list is ranked over the
// full car x buyer matrix instead of being assembled from each car's top three,
// which is why `rank` used to cap out at 3 no matter what you asked for.
//
//   GET /api/buyer-recommendations?key=...                → every buyer + counts
//   GET /api/buyer-recommendations?key=...&buyer=rusty    → that buyer's cars
//   GET /api/buyer-recommendations?key=...&buyer=x&best=1 → only where he's the best fit
//   &spread=0     turn off the fair-share pass (raw top-dollar ranking)
//   &cars=25      how many cars to return per buyer (default 12)
//   &lanes=1      include UAX / DAA / ADESA and the other lanes, which are one
//                 customer each and are hidden by default because you cannot call them
//
// Auth is a shared key, hashed in the api_keys table — this is an operator tool
// meant to be curl-able, not a signed-in app screen.

import { createClient } from '@supabase/supabase-js'
import { recommendForBuyers } from '../src/services/buyerMatch.js'

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
    // The car list is the marketplace, not the SmartAuction snapshot: that
    // snapshot held 33 of the 58 cars we are trying to sell, so 25 of them could
    // never be offered to anyone.
    const [listings, saActive, training] = await Promise.all([
      db.rpc('marketplace_listings'),
      fetchAll(db, 'sa_active_cars', '*'),
      db.rpc('buyer_training_rows'),
    ])
    if (listings.error) throw new Error(`marketplace_listings: ${listings.error.message}`)
    if (training.error) throw new Error(`buyer_training_rows: ${training.error.message}`)

    const sold = training.data || []
    const saByVin = new Map(saActive.map((c) => [(c.vin || '').toUpperCase(), c]))
    const cars = new Map()
    for (const l of listings.data || []) {
      const vin = String(l.full_vin || l.vin || '').toUpperCase()
      if (!vin || cars.has(vin)) continue
      const x = saByVin.get(vin) || {}
      cars.set(vin, {
        vin, stock_number: l.stock_number || null,
        year: parseInt(l.year, 10) || x.year || null,
        make: l.make || x.make, model: l.model || x.model, trim: x.trim || null,
        odometer: parseInt(String(l.mileage || '').replace(/[^0-9]/g, ''), 10) || x.odometer || null,
        segment: x.segment || null,
        buy_now: l.buy_now != null ? Number(String(l.buy_now).replace(/[^0-9.]/g, '')) : (x.buy_now ?? x.opening_price ?? null),
        location: x.location || null,
        detail_url: l.sa_url || x.detail_url || null,
        on_smartauction: saByVin.has(vin),
      })
    }
    for (const c of saActive) {
      const vin = (c.vin || '').toUpperCase()
      if (vin && !cars.has(vin)) cars.set(vin, { ...c, vin, on_smartauction: true })
    }

    if (!cars.size || !sold.length) {
      return res.status(200).json({ active: cars.size, sold: sold.length, buyers: 0, results: [] })
    }

    // A completed sale in ANY channel means the car is gone, so a stale snapshot
    // can no longer put a sold car in front of a buyer.
    const soldVins = new Set(sold.map((r) => (r.vin || '').toUpperCase()).filter(Boolean))
    const sellable = [...cars.values()].filter((c) => !soldVins.has(c.vin))

    const spread = req.query?.spread !== '0'
    const topCars = Math.max(1, Math.min(100, parseInt(req.query?.cars || '12', 10) || 12))
    const showLanes = req.query?.lanes === '1'
    const bestOnly = req.query?.best === '1'

    const { buyers: ranked } = recommendForBuyers(
      sellable, sold, { spread: { enabled: spread }, topCars },
    )
    const buyers = new Map()
    for (const b of ranked) {
      if (b.is_channel && !showLanes) continue
      const list = bestOnly ? b.cars.filter((c) => c.car_rank === 1) : b.cars
      if (!list.length) continue
      buyers.set(b.buyer_key, {
        buyer_key: b.buyer_key,
        buyer_name: b.buyer_name,
        buyer_email: b.buyer_email || null,
        buyer_phone: b.buyer_phone || null,
        buyer_state: b.buyer_state || null,
        channel: b.channel_label || b.channel_key || null,
        is_lane: !!b.is_channel,
        total_buys: b.total_buys ?? null,
        days_since_last_buy: b.days_since ?? null,
        best_fit_count: b.top_pick_count,
        count: list.length,
        total_predicted: list.reduce((s, c) => s + (c.predicted_price || 0), 0),
        cars: list.map((c) => ({
          vin: c.vin, stock_number: c.stock_number ?? null,
          year: c.year, make: c.make, model: c.model, trim: c.trim ?? null,
          odometer: c.odometer ?? null,
          buy_now: c.buy_now ?? null,
          detail_url: c.detail_url ?? null,
          on_smartauction: c.on_smartauction ?? null,
          segment: c.segment, tier: c.tier,
          est_value: c.est_value == null ? null : Math.round(c.est_value),
          predicted_price: c.predicted_price == null ? null : Math.round(c.predicted_price),
          rank: c.rank,
          buyer_rank_for_car: c.car_rank,
          confidence: c.confidence,
          reason: c.reason,
        })),
      })
    }

    if (!(req.query?.buyer || '').trim()) {
      // Roster view: who is worth calling, biggest book first.
      const list = [...buyers.values()]
        .map(({ cars, ...rest }) => { void cars; return rest })
      return res.status(200).json({
        active: sellable.length, sold_out: cars.size - sellable.length,
        sold: sold.length, spread, lanes: showLanes,
        buyers: list.length, results: list,
      })
    }

    const q = (req.query?.buyer || '').trim().toLowerCase()
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
