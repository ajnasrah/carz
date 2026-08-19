// Stamp every car we own with the consignor who sold it to us.
//
// The seller is visible exactly once — on the run list, before the bid. Once a
// car is bought, inventory and the sold book only record `vendor`, which is the
// auction, not the consignor. link_purchase_sources() joins the two by VIN and
// keeps vehicle_purchase_source current, which is what makes "is this seller
// good" answerable from realised profit instead of from comps on similar cars.
//
// Runs on a schedule rather than at upload time because both halves move: a list
// is scored days before the sale, and the car appears in inventory days after
// it. Neither event is the moment the pair exists.
//
// GET /api/link-sources[?secret=...]   (same auth shape as the other crons)
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')
  const secret = process.env.CRON_SECRET
  const auth = req.headers.authorization || ''
  const ok = !secret || auth === `Bearer ${secret}` || req.query?.secret === secret
  if (!ok) return res.status(401).json({ error: 'unauthorized' })
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'server not configured' })
  }
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })
  // Ledger first: sold is truncate-and-reload, so anything that fell outside the
  // latest export only survives in sold_book. This used to be a trigger on the
  // load itself, which made the daily Frazer sync measurably slower — it has no
  // business costing that run anything, so it happens here instead.
  const merged = await db.rpc('merge_sold_to_book')
  if (merged.error) console.error('merge_sold_to_book failed:', merged.error.message)

  const { data, error } = await db.rpc('link_purchase_sources')
  if (error) {
    console.error('link_purchase_sources failed:', error.message)
    return res.status(502).json({ error: error.message, merged: merged.data ?? 0 })
  }
  return res.status(200).json({ merged: merged.data ?? 0, linked: data ?? 0 })
}
