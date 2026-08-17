// Scheduled backstop for the Telegram photo pipeline.
//
// WHY THIS EXISTS
// The webhook sweeps parked photos inline on every update, which covers the
// pipeline whenever the group is busy. It cannot cover the one case that strands
// photos most reliably: a burst of pictures that is the LAST thing said. With
// nothing arriving after it there is no update to carry the sweep, so those
// photos sit parked until somebody happens to post again — which on a Friday
// evening means Monday. This runs the same sweep on a clock instead.
//
// It is the same code the webhook runs (api/_lib/intake.js), not a second
// implementation, so the binding rules cannot drift between the two.
//
// GET /api/intake-sweep[?secret=...][&limit=100]
// Env (Vercel): SUPABASE_URL, SUPABASE_SERVICE_KEY, TELEGRAM_BOT_TOKEN
//               CRON_SECRET (optional — when set it is required)

import { createClient } from '@supabase/supabase-js'
import { sweepParkedPhotos, rebindGuessedPhotos } from './_lib/intake.js'

// Each photo is a Telegram download plus a Supabase upload, so the batch is
// capped to stay well inside the function timeout. A backlog drains over
// successive runs rather than dying half way through one.
const MAX_BATCH = 100

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')

  // Vercel cron sends the project's CRON_SECRET as a bearer token; a manual run
  // can pass ?secret= instead. Same shape as api/sms-nudge.js.
  const secret = process.env.CRON_SECRET
  const auth = req.headers.authorization || ''
  const ok = !secret || auth === `Bearer ${secret}` || req.query?.secret === secret
  if (!ok) return res.status(401).json({ error: 'unauthorized' })

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'server not configured' })
  }
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    // Without the bot token every download fails and the only thing the sweep
    // would accomplish is burning through pending_attempts on good photos.
    return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN missing' })
  }

  const limit = Math.min(parseInt(req.query?.limit || '50', 10) || 50, MAX_BATCH)
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })

  try {
    const { detail, ...swept } = await sweepParkedPhotos(db, limit)
    const rebound = await rebindGuessedPhotos(db, 50)
    // Per-row outcomes only on request — the daily cron wants counts, but when
    // the sweep is filing nothing this is the only thing that says why.
    return res.status(200).json(
      req.query?.debug === '1' ? { ...swept, rebound, detail } : { ...swept, rebound },
    )
  } catch (e) {
    console.error('intake sweep failed:', e?.message || e)
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
