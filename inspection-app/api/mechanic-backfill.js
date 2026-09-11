// Re-read the mechanic group's history and put the lost diagnoses on the cards.
//
// WHY THIS EXISTS AS A ONE-SHOT
// The webhook only ever read problems out of a message that also carried a VIN,
// and the mechanics never write that way — the car is named in one message and
// the fault in another. So every diagnosis typed into that group since the
// feature shipped was thrown away: 0 chat-sourced lines, 26 of 28 open jobs
// empty. 20260912000010 fixes it going forward; this walks the backlog.
//
// ONLY CARS STILL OPEN. A fault reported three weeks ago on a car that has since
// been fixed, washed and sold is not work, it is archaeology — and putting it on
// a reopened card would make the board lie about what is in the shop. Messages
// whose car has no open job are marked read and skipped.
//
// Safe to run repeatedly: mechanic_chat_reads records the READ, so a message is
// never paid for twice, and source_ref makes the write idempotent on top of
// that. It is wired to a cron only so that Vercel supplies CRON_SECRET; once the
// backlog is clear, every run is a no-op and the cron entry can come out.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, CRON_SECRET

import { createClient } from '@supabase/supabase-js'
import { extractProblems, looksLikeReport } from './_lib/mechanicChat.js'

// Each message is a model call inside one request. 25 keeps a run well under the
// function timeout; the cron comes back for the rest.
const BATCH = 25

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.authorization || ''
  const ok = !secret || auth === `Bearer ${secret}` || req.query?.secret === secret
  if (!ok) return res.status(401).json({ error: 'unauthorized' })

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' })
  }

  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })

  const dry = req.query?.dry === '1'
  const limit = Math.min(Number(req.query?.limit) || BATCH, 50)

  try {
    const { data: rows, error } = await db.rpc('mechanic_chat_unread', { p_limit: limit })
    if (error) return res.status(500).json({ error: error.message })
    if (!rows?.length) return res.status(200).json({ done: true, read: 0, note: 'backlog clear' })

    const results = []
    for (const r of rows) {
      const out = { message_id: r.message_id, body: String(r.body || '').slice(0, 70) }

      if (!looksLikeReport(r.body)) {
        out.skipped = 'no prose'
        if (!dry) await markRead(db, r.message_id, null, 0)
        results.push(out)
        continue
      }

      // Symmetric window here, unlike the live path: in history the future has
      // already happened, so a fault typed a minute BEFORE its VIN is findable.
      const { data: vin6 } = await db.rpc('mechanic_nearest_vin',
        { p_at: r.received_at, p_back_min: 120, p_fwd_min: 120 })
      if (!vin6) {
        out.skipped = 'no car named near it'
        if (!dry) await markRead(db, r.message_id, null, 0)
        results.push(out)
        continue
      }
      out.vin6 = vin6

      // Still in the shop? Anything else is archaeology.
      const { data: job } = await db.from('mechanic_jobs')
        .select('id, status').eq('vin6', vin6).neq('status', 'done')
        .order('entered_at', { ascending: false }).limit(1).maybeSingle()
      if (!job) {
        out.skipped = 'car is no longer open at the mechanic'
        if (!dry) await markRead(db, r.message_id, vin6, 0)
        results.push(out)
        continue
      }

      let problems = []
      try {
        problems = await extractProblems(r.body, { apiKey: process.env.ANTHROPIC_API_KEY })
      } catch (e) {
        out.error = String(e.message || e).slice(0, 160)
        results.push(out)   // left unread on purpose: a transient model failure
        continue            // should be retried, not swallowed
      }

      out.found = problems.map((p) => p.description)
      if (dry) { results.push(out); continue }

      if (problems.length) {
        const { error: insErr } = await db.from('mechanic_lines').upsert(
          problems.map((p, i) => ({
            job_id: job.id,
            system: p.system,
            description: p.description,
            severity: p.severity,
            status: 'open',
            source_ref: `tgx:${r.message_id}:${i}`,
          })),
          { onConflict: 'source_ref', ignoreDuplicates: true },
        )
        if (insErr) out.error = insErr.message
      }
      await markRead(db, r.message_id, vin6, problems.length)
      results.push(out)
    }

    const added = results.reduce((n, r) => n + (r.found?.length || 0), 0)
    return res.status(200).json({ dry, read: results.length, linesAdded: added, results })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

async function markRead(db, messageId, vin6, found) {
  await db.from('mechanic_chat_reads')
    .upsert({ message_id: String(messageId), vin6, found }, { onConflict: 'message_id' })
}
