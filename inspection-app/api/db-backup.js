// Nightly snapshot of the tables that cannot be rebuilt from anywhere else.
//
// WHY THIS EXISTS
// PITR is a paid add-on and is currently off, so this project has no
// point-in-time recovery at all. On 2026-08-19 a wrong inference dropped the
// live `sold` table and the only reason nothing was permanently lost is that a
// CSV of it happened to be sitting in Downloads. That was luck, and luck is not
// a backup.
//
// Deliberately narrow. `inventory` and `sold` are replaced wholesale by the
// Frazer sync and could be re-pulled, but a sync that has broken is exactly when
// you need yesterday's copy — so they are in. The tables that exist ONLY here,
// with no upstream to re-pull from, are the ones that would actually be gone:
// sold_book (history past any single export window), run_list_observations
// (every car we ever looked at), vehicle_purchase_source, sa_sold_sales,
// vehicle_locations, buyer_share_lists, car_reservations.
//
// GET /api/db-backup[?secret=...]
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, CRON_SECRET (optional)

import { createClient } from '@supabase/supabase-js'
import { gzipSync } from 'node:zlib'

const BUCKET = 'db-backups'
const KEEP_DAYS = 30
const PAGE = 1000

// Ordered by how unrecoverable they are, so a partial run saves the worst losses
// first if it ever times out.
const TABLES = [
  'sold_book',
  'run_list_observations',
  'vehicle_purchase_source',
  'sa_sold_sales',
  'vehicle_locations',
  'car_reservations',
  'buyer_share_lists',
  'vendor_locations',
  'sold',
  'inventory',
]

async function fetchAll(db, table) {
  const out = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select('*').range(from, from + PAGE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...data)
    if (data.length < PAGE) break
  }
  return out
}

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

  const stamp = new Date().toISOString().slice(0, 10)
  const report = []
  for (const t of TABLES) {
    try {
      const rows = await fetchAll(db, t)
      // Gzipped JSON: a full table restores with an insert, and a 6,500-row table
      // compresses to a few hundred KB rather than a few megabytes.
      const body = gzipSync(Buffer.from(JSON.stringify(rows)))
      const { error } = await db.storage.from(BUCKET)
        .upload(`${stamp}/${t}.json.gz`, body, {
          contentType: 'application/gzip', upsert: true,
        })
      if (error) throw new Error(error.message)
      report.push({ table: t, rows: rows.length, bytes: body.length })
    } catch (e) {
      // One bad table must not cost the rest of the snapshot.
      console.error('backup failed for', t, e?.message || e)
      report.push({ table: t, error: String(e?.message || e) })
    }
  }

  // Retention. Folders are date-named, so anything older than KEEP_DAYS goes.
  let pruned = 0
  try {
    const cutoff = new Date(Date.now() - KEEP_DAYS * 86400_000).toISOString().slice(0, 10)
    const { data: folders } = await db.storage.from(BUCKET).list('', { limit: 1000 })
    for (const f of folders || []) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.name) || f.name >= cutoff) continue
      const { data: files } = await db.storage.from(BUCKET).list(f.name, { limit: 100 })
      const paths = (files || []).map((x) => `${f.name}/${x.name}`)
      if (paths.length) {
        await db.storage.from(BUCKET).remove(paths)
        pruned += paths.length
      }
    }
  } catch (e) {
    console.error('retention sweep failed:', e?.message || e)
  }

  const failed = report.filter((r) => r.error)
  return res.status(failed.length ? 207 : 200).json({
    date: stamp,
    tables: report.length,
    rows: report.reduce((s, r) => s + (r.rows || 0), 0),
    failed: failed.length,
    pruned,
    report,
  })
}
