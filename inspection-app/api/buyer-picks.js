// Recompute the marketplace's "Text best buyer" picks.
//
// Buyer Match only saved its picks when someone opened that page, so a car that
// arrived since had none — 46 of 103 marketplace cars on 2026-09-15. This runs
// hourly instead, and replaces marketplace_buyer_picks in one statement.
//
//   GET /api/buyer-picks          recompute and save
//   GET /api/buyer-picks?dry=1    recompute, save nothing, return the rows
//
// Two ways in, the same as photo-sort: CRON_SECRET (what the cron sends), or a
// signed-in admin's token for a manual re-run.
//
// Env (Vercel): SUPABASE_URL, SUPABASE_SERVICE_KEY, CRON_SECRET

import { createClient } from '@supabase/supabase-js'
import { fetchTraining, textablePicks } from './_lib/buyerPicks.js'

export const config = { maxDuration: 120 }

async function isAdmin(db, token) {
  if (!token) return false
  const { data } = await db.auth.getUser(token)
  if (!data?.user?.id) return false
  const { data: profile } = await db.from('profiles').select('role').eq('id', data.user.id).maybeSingle()
  return profile?.role === 'admin'
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'server not configured' })
  }
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })

  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const secret = process.env.CRON_SECRET
  const viaCron = !!secret && (bearer === secret || req.query?.secret === secret)
  if (!viaCron && !(await isAdmin(db, bearer))) return res.status(401).json({ error: 'unauthorized' })

  try {
    const started = Date.now()
    const [carsRes, training, demandRes, optRes] = await Promise.all([
      db.rpc('buyer_match_cars'),
      fetchTraining(db),
      db.rpc('buyer_demand_signals', { p_days: 60 }),
      db.rpc('opted_out_phones'),
    ])
    if (carsRes.error) throw new Error(`buyer_match_cars: ${carsRes.error.message}`)
    // Unlike demand, this one must not be skipped: picks built without the
    // do-not-text list would offer buyers who told us to stop.
    if (optRes.error) throw new Error(`opted_out_phones: ${optRes.error.message}`)
    const blocked = new Set((optRes.data || []).map((p) => (typeof p === 'string' ? p : Object.values(p)[0])))
    // Demand is a boost, not a requirement — score without it rather than fail.
    const demand = demandRes.error ? [] : (demandRes.data || [])

    const num = (x) => (x == null ? null : Number(x))
    const cars = (carsRes.data || []).map((c) => ({
      ...c, buy_now: num(c.buy_now), opening_price: num(c.opening_price),
    }))
    // An empty car list or training set means an upstream read went wrong, not
    // that nobody should be texted. Keep the last good picks.
    if (!cars.length || !training.length) {
      return res.status(200).json({ saved: 0, skipped: 'no cars or no training data', cars: cars.length, training: training.length })
    }

    const rows = textablePicks(cars, training, demand, blocked)
    // Same reasoning: zero picks for a hundred cars is a broken read (no phones
    // came back), not an answer. Replacing with nothing would blank every button.
    if (!rows.length) {
      return res.status(200).json({ saved: 0, skipped: 'no textable picks', cars: cars.length, training: training.length })
    }
    if (req.query?.dry === '1') {
      return res.status(200).json({ dry: true, cars: cars.length, training: training.length, picks: rows.length, rows })
    }

    const { data: saved, error } = await db.rpc('replace_marketplace_buyer_picks', { p_rows: rows })
    if (error) throw new Error(`replace_marketplace_buyer_picks: ${error.message}`)
    return res.status(200).json({
      saved, cars: cars.length, training: training.length,
      buyers: new Set(rows.map((r) => r.buyer_key)).size, ms: Date.now() - started,
    })
  } catch (e) {
    console.error('buyer-picks failed:', e?.message || e)
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
