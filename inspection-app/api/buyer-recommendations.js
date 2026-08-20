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

// PostgREST caps an unbounded result at 1,000 rows. Every read here goes through
// a function now, but the cap applies to those too — see fetchTraining below.
const PAGE = 1000

// buyer_training_rows() must be paged for exactly the reason the table reads
// above are: PostgREST stops at 1,000 rows, RPCs included, and the union returns
// SmartAuction first — so an unpaged call silently trained this endpoint on one
// channel out of fourteen. p_limit/p_offset are the function's own arguments
// because the Range header is ignored on an RPC POST.
async function fetchTraining(db) {
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
    // buyer_match_cars() is the single definition of what is still for sale:
    // the marketplace plus the SmartAuction snapshot, minus anything whose last
    // sale is more recent than its last purchase. This endpoint and the app used
    // to each assemble that themselves, and both got re-purchased cars wrong.
    const [carsRes, training] = await Promise.all([
      db.rpc('buyer_match_cars'),
      fetchTraining(db),
    ])
    if (carsRes.error) throw new Error(`buyer_match_cars: ${carsRes.error.message}`)

    const sold = training
    const sellable = (carsRes.data || []).map((c) => ({
      ...c,
      buy_now: c.buy_now == null ? null : Number(c.buy_now),
      opening_price: c.opening_price == null ? null : Number(c.opening_price),
    }))

    if (!sellable.length || !sold.length) {
      return res.status(200).json({ active: sellable.length, sold: sold.length, buyers: 0, results: [] })
    }

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
        active: sellable.length,
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
