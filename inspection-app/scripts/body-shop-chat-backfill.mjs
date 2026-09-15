#!/usr/bin/env node
// Replay the body shop Telegram groups through api/_lib/bodyShopChat.js.
//
// Everything the team typed before the webhook learned to read it — ~100 parts
// posts by model, the "ordered arrive 9/11" lines, "as is no parts", "still
// missing the fender liner" — is still sitting in wa_inbound_messages. This
// reads it back in time order and prints what the webhook would have written.
//
// DRY RUN BY DEFAULT. Nothing is written without --apply.
//
//   node scripts/body-shop-chat-backfill.mjs                 # dry run, live data
//   node scripts/body-shop-chat-backfill.mjs --verbose       # …with every message
//   node scripts/body-shop-chat-backfill.mjs --from <dir>    # dry run on a JSON export
//   node scripts/body-shop-chat-backfill.mjs --apply         # write (needs service key)
//
// Live data needs SUPABASE_URL and SUPABASE_SERVICE_KEY. --from reads
// messages.json, jobs.json, parts.json, keywords.json, locations.json from a
// directory instead (see the export queries at the bottom of this file), and
// can never --apply.
//
// What it replays onto TODAY'S jobs, deliberately:
//   * notes (body_shop_job_events) for every message it can bind, done jobs too —
//     that is the record of what was said;
//   * parts, ordered/received, chat ETAs and holds ONLY onto jobs still open,
//     and only from the last --recent-days (default 14) — a done car does not
//     need a bumper ordered in July added to its card, and neither does an open
//     one whose July bumper has long since arrived;
//   * "still missing" lines from body_shop_out as notes;
//   * the hold release for a car posted "good to go" while held (152102).
// It never moves a car. Location is newest-event-wins, and a two-month-old chat
// message is not the newest thing anybody knows about where a car is.
//
// Idempotent: every write carries its message key (source_ref), so running
// --apply twice writes nothing the second time.

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { extractAllVin6 } from '../api/_lib/parse.js'
import {
  captureBodyShopMessage, sweepUnboundBodyShopChat, applyActions, planFinish, carForVin,
  openAt, recordFinishBlocked, samePart,
} from '../api/_lib/bodyShopChat.js'
import { finishBodyShopJob } from '../api/_lib/finish.js'
import { matchDestination } from '../api/telegram.js'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const VERBOSE = args.includes('--verbose')
const FROM = args.includes('--from') ? args[args.indexOf('--from') + 1] : null
const SINCE = args.includes('--since') ? args[args.indexOf('--since') + 1] : null
// Parts, ETAs, ordered/received and holds only from messages this recent. A
// "Tail light - Tuesday Amazon" from July replayed onto a car still open today
// would put a two-month-overdue delivery at the top of Parts Ordered for a part
// that almost certainly came. Older messages still leave their note.
const RECENT_DAYS = Number(args.includes('--recent-days') ? args[args.indexOf('--recent-days') + 1] : 14)

if (APPLY && FROM) {
  console.error('--apply writes to the live database; it cannot be combined with --from.')
  process.exit(1)
}

// ------------------------------------------------------------------ data

async function selectAll(db, table, columns, filter = (q) => q) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await filter(db.from(table).select(columns)).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

async function loadLive(db) {
  const messages = await selectAll(db, 'wa_inbound_messages',
    'message_id, wa_from, station, msg_type, body, vin6, received_at',
    (q) => q.in('station', ['body_shop', 'body_shop_out']).order('received_at', { ascending: true }))
  const jobRows = await selectAll(db, 'body_shop_jobs',
    'id, stock_number, vin6, status, entered_at, completed_at, held_at, parts_eta, parts_eta_text, notes')
  const stocks = [...new Set(jobRows.map((j) => j.stock_number).filter(Boolean))]
  const inv = new Map()
  for (let i = 0; i < stocks.length; i += 200) {
    // Named, non-cost columns only.
    const { data } = await db.from('inventory')
      .select('stock_number, vehicle_year, vehicle_make, vehicle_model, vehicle_color')
      .in('stock_number', stocks.slice(i, i + 200))
    for (const r of data || []) inv.set(r.stock_number, r)
  }
  const jobs = jobRows.map((j) => ({ ...(inv.get(j.stock_number) || {}), ...j }))
  const parts = await selectAll(db, 'body_shop_parts', 'id, job_id, name, status')
  const keywords = await selectAll(db, 'location_keywords', 'keyword, location_code, priority')
  return { messages, jobs, parts, keywords }
}

function loadDir(dir) {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
  return {
    messages: read('messages.json'),
    jobs: read('jobs.json'),
    parts: read('parts.json'),
    keywords: read('keywords.json'),
  }
}

// A stand-in client for the dry run: answers only the reads the planner makes,
// and fails loudly on anything else so a dry run can never write by accident.
function readOnlyDb(data) {
  return {
    from(table) {
      if (table !== 'location_keywords') throw new Error(`dry run tried to touch ${table}`)
      return { select: async () => ({ data: data.keywords, error: null }) }
    },
    rpc(name) { throw new Error(`dry run tried to call ${name}`) },
  }
}

const iso = (t) => new Date(String(t).replace(' ', 'T').replace(/\+00(:00)?$/, 'Z')).toISOString()

// ------------------------------------------------------------------ replay

async function main() {
  let live = null
  let data
  if (FROM) {
    data = loadDir(FROM)
  } else {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY, or pass --from <export dir>.')
      process.exit(1)
    }
    live = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
    data = await loadLive(live)
  }
  const planDb = readOnlyDb(data)
  const match = (_db, text) => matchDestination(planDb, text)

  const messages = data.messages
    .map((m) => ({ ...m, at: iso(m.received_at) }))
    .filter((m) => !SINCE || m.at >= new Date(SINCE).toISOString())
    .sort((a, b) => a.at.localeCompare(b.at))
  const cars = data.jobs
  const jobById = new Map(cars.map((c) => [c.id, c]))
  const partsByJob = new Map()
  for (const p of data.parts) {
    if (!partsByJob.has(p.job_id)) partsByJob.set(p.job_id, [])
    partsByJob.get(p.job_id).push({ ...p })
  }

  // The last car each sender TYPED, for "Back to George"-style messages.
  const typed = messages.filter((m) => m.station === 'body_shop' && m.body && extractAllVin6(m.body).length)
  const resolveSender = async (fromId, at) => {
    const t = new Date(at).getTime()
    let best = null
    for (const m of typed) {
      const mt = new Date(m.at).getTime()
      if (m.wa_from !== fromId || mt > t || mt < t - 15 * 60 * 1000) continue
      best = extractAllVin6(m.body)[0]
    }
    return best
  }

  const handTriaged = new Set(data.parts.map((p) => p.job_id))
  const bound = new Set()
  const stats = {
    scanned: 0, withText: 0, vinNotes: 0, vinActionable: 0,
    vinless: 0, vinlessActionable: 0, bindings: {}, unbound: 0,
    acts: {}, noteOnlyDone: 0, noCar: 0, blocked: 0, holdReleases: 0, skippedTriaged: 0,
  }
  const count = (o, k, n = 1) => { o[k] = (o[k] || 0) + n }
  const lines = []

  // What a write would do to TODAY's job. Mirrors applyActions' guards, so the
  // printed counts are what --apply would write.
  const recentFrom = Date.now() - RECENT_DAYS * 86400000
  const effective = (car, acts, at) => acts.filter((a) => {
    if (a.type === 'note') return true
    if (a.type === 'move') return false
    if (!car?.id) return false
    if (new Date(at).getTime() < recentFrom) return false
    const now = jobById.get(car.id) || car
    if (now.status === 'done') return false
    if (a.type === 'hold') return now.status !== 'on_hold'
    if (a.type === 'job_eta') return !(now.parts_eta && !String(now.parts_eta_text || '').startsWith('Telegram'))
    if (a.type === 'part') {
      const list = partsByJob.get(car.id) || []
      const same = list.find((x) => samePart(x.name, a.part.name))
      const rank = { needed: 0, ordered: 1, received: 2 }
      if (same && rank[a.part.status] <= rank[same.status]) return false
      // A job the manager has already written parts on has been triaged: its
      // list is his, and a replayed coordinator post may only move a matching
      // part forward, never add a row (a stale "needed" would drag the car back
      // to Need Parts). A job with no parts at all gets the list it never had.
      if (!same && handTriaged.has(car.id)) { stats.skippedTriaged++; return false }
      if (same) same.status = a.part.status
      else { list.push({ name: a.part.name, status: a.part.status }); partsByJob.set(car.id, list) }
    }
    return true
  })

  const handle = async (res, m, tag) => {
    for (const s of res.segments) {
      if (!s.actions?.length) continue
      const eff = effective(s.car, s.actions, m.at)
      if (!s.car) stats.noCar++
      else if ((jobById.get(s.car.id) || s.car).status === 'done') stats.noteOnlyDone++
      if (s.binding) count(stats.bindings, s.binding)
      for (const a of eff) count(stats.acts, a.type === 'part' ? `part:${a.part.status}` : a.type)
      if (VERBOSE) {
        lines.push(`${m.at.slice(0, 16)} ${tag} ${m.message_id} → ${s.car ? `${s.car.vin6} ${s.car.vehicle_model || ''} [${(jobById.get(s.car.id) || s.car).status}]` : `${s.vin6 || '?'} (no job)`} via ${s.binding || '-'}`)
        lines.push(`    “${String(m.body).replace(/\n/g, ' / ').slice(0, 140)}”`)
        for (const a of eff) {
          if (a.type === 'note') continue
          lines.push(`    ${a.type}${a.part ? `: ${a.part.name} [${a.part.status}${a.part.vendor ? `, ${a.part.vendor}` : ''}${a.part.eta ? `, eta ${a.part.eta}` : ''}]` : ''}${a.eta ? ` eta ${a.eta}` : ''}${a.soonest ? ` ${a.soonest}${a.latest !== a.soonest ? `–${a.latest}` : ''}` : ''}`)
        }
      }
      if (APPLY && live) await applyActions(live, s.car, eff, { messageId: m.message_id, at: m.at, vin6: s.vin6, fromId: m.wa_from })
    }
  }

  for (const m of messages) {
    stats.scanned++
    if (!m.body || !String(m.body).trim()) continue
    stats.withText++
    const vins = extractAllVin6(m.body)

    if (m.station === 'body_shop_out') {
      if (!vins.length) continue
      const { finish, blocked } = planFinish(m.body, vins)
      const open = openAt(cars, m.at)
      for (const b of blocked) {
        stats.blocked++
        const car = carForVin(b.vin6, open, m.body)
        lines.push(`${m.at.slice(0, 16)} OUT ${m.message_id} NOT finished: ${b.vin6}${car ? ` → job ${car.vin6}` : ' (no open job)'} “${b.text.replace(/\n/g, ' / ')}”`)
        if (APPLY && live) await recordFinishBlocked(live, { vin6: car?.vin6 || b.vin6, text: m.body, messageId: m.message_id, at: m.at, fromId: m.wa_from, cars })
      }
      for (const v of finish) {
        const held = cars.find((c) => String(c.vin6 || '').toUpperCase() === v && c.status === 'on_hold'
          && c.held_at && iso(c.held_at) <= m.at)
        if (!held) continue
        stats.holdReleases++
        lines.push(`${m.at.slice(0, 16)} OUT ${m.message_id} "good to go" on a HELD job: ${v} ${held.vehicle_model || ''} (held ${String(held.held_at).slice(0, 10)}) → release hold + close`)
        if (APPLY && live) await finishBodyShopJob(live, v, m.at, `bso:${m.message_id}:${v}`)
      }
      continue
    }
    if (m.station !== 'body_shop') continue

    const res = await captureBodyShopMessage(planDb, {
      text: m.body, messageId: m.message_id, fromId: m.wa_from, at: m.at, vins,
      locationCode: 'body_shop', matchDestination: match, cars, keywords: data.keywords,
      dryRun: true, resolveSender, laterJobMs: 14 * 86400000,
    })
    if (vins.length) {
      if (res.plan.segments.some((s) => s.vin6 && s.signals.note)) stats.vinNotes++
      if (res.actionable) stats.vinActionable++
    } else {
      stats.vinless++
      if (res.actionable) stats.vinlessActionable++
      if (res.unbound) stats.unbound++
    }
    if (res.actionable && !res.unbound) bound.add(m.message_id)
    await handle(res, m, 'BS ')

    if (vins.length) {
      const since = new Date(m.at).getTime() - 120 * 60 * 1000
      const backlog = messages.filter((r) => r.station === 'body_shop' && r.body
        && new Date(r.at).getTime() >= since && r.at < m.at && !extractAllVin6(r.body).length)
        .map((r) => ({ message_id: r.message_id, body: r.body, wa_from: r.wa_from, received_at: r.at }))
      const swept = await sweepUnboundBodyShopChat(planDb, {
        vin6: vins[0], fromId: m.wa_from, at: m.at, matchDestination: match, dryRun: true,
        rows: backlog, cars, keywords: data.keywords, reads: bound, excludeId: m.message_id,
      })
      for (const r of swept) {
        const orig = messages.find((x) => x.message_id === r.messageId)
        if (!orig || bound.has(orig.message_id)) continue
        bound.add(orig.message_id)
        stats.unbound--
        await handle(r, orig, 'SWP')
      }
    }
  }

  if (VERBOSE || lines.length < 400) console.log(lines.join('\n'))
  else console.log(lines.filter((l) => /OUT/.test(l)).join('\n'))
  console.log('\n' + (APPLY ? 'APPLIED' : 'DRY RUN — nothing written'))
  console.log(JSON.stringify(stats, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })

// Export queries for --from (run with `supabase db query --linked -o json`):
//   messages.json  select message_id, wa_from, station, msg_type, body, vin6, received_at
//                  from wa_inbound_messages where station in ('body_shop','body_shop_out')
//   jobs.json      select j.id, j.stock_number, j.vin6, j.status, j.entered_at, j.completed_at,
//                  j.held_at, j.parts_eta, j.parts_eta_text, j.notes, i.vehicle_year,
//                  i.vehicle_make, i.vehicle_model, i.vehicle_color
//                  from body_shop_jobs j left join inventory i using (stock_number)
//   parts.json     select id, job_id, name, status from body_shop_parts
//   keywords.json  select keyword, location_code, priority from location_keywords
