#!/usr/bin/env node
// The buy loop: recommended -> bid -> won or lost -> sold -> what we learned.
//
// Every car the target list recommends gets bid on, so the label is clean in a
// way profit never was: for each recommendation we know whether we WON it, and
// for the ones we won we eventually know what the shop spent, how long it sat
// and what it made. This script closes that loop and says what to change.
//
// Three studies, in the order the money moves:
//   1. WIN     — of the cars we bid on, which did we get, and what separates
//                them from the ones we lost? (seller, auction, city, lane,
//                grade, price band, nameplate)
//   2. PERFORM — of the cars we won, how did they actually do? Days to sell,
//                added costs, profit, by the same cuts.
//   3. ADJUST  — where 1 and 2 disagree with what the target list currently
//                does, say so in plain terms.
//
// Run it whenever; it re-reads everything live and reports on what exists.
// Sections that don't have enough data yet say so instead of guessing — with a
// handful of wins, a breakdown by seller is noise wearing a percentage sign.
//
//   node scripts/buy-loop-study.mjs            # full report
//   node scripts/buy-loop-study.mjs --json     # machine-readable
//
// Reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from inspection-app/.env.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ENV_PATH = path.join(HERE, '..', '.env')

// Below this many wins a breakdown is a coin flip with decimals. Reporting one
// anyway is how a target list gets tuned on noise, which is the exact failure
// the loop exists to stop.
const MIN_WINS_FOR_CUT = 8
const MIN_BIDS_FOR_CUT = 25
const MIN_WINS_FOR_MODEL = 30
const MIN_SOLD_FOR_PERF = 10

const JSON_OUT = process.argv.includes('--json')

function env() {
  const raw = fs.readFileSync(ENV_PATH, 'utf8')
  const out = {}
  for (const line of raw.split('\n')) {
    if (!line.includes('=') || line.trim().startsWith('#')) continue
    const i = line.indexOf('=')
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}
const E = env()
const URL = (E.VITE_SUPABASE_URL || '').trim()
const KEY = (E.VITE_SUPABASE_ANON_KEY || '').trim()
if (!URL || !KEY) { console.error('missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env'); process.exit(1) }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

// PostgREST caps a response at 1000 rows — see services/supabase.js selectAll.
async function page(url) {
  const all = []
  for (let off = 0; ; off += 1000) {
    const r = await fetch(`${url}${url.includes('?') ? '&' : '?'}limit=1000&offset=${off}`, { headers: H })
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
    const d = await r.json()
    all.push(...d)
    if (d.length < 1000) break
  }
  return all
}
async function rpcAll(fn) {
  const all = []
  for (let off = 0; ; off += 1000) {
    const r = await fetch(`${URL}/rest/v1/rpc/${fn}?limit=1000&offset=${off}`, { method: 'POST', headers: H, body: '{}' })
    if (!r.ok) throw new Error(`${fn}: ${r.status}`)
    const d = await r.json()
    all.push(...d)
    if (d.length < 1000) break
  }
  return all
}

const num = (x) => {
  if (x == null || x === '') return null
  const n = parseFloat(String(x).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : null
}
const frazerDate = (v) => {
  const m = String(v || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (!m) return null
  const y = m[3].length === 2 ? `20${m[3]}` : m[3]
  return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
}
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)
const median = (a) => {
  if (!a.length) return null
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const money = (v) => (v == null ? '—' : `$${Math.round(v).toLocaleString()}`)
const pctS = (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`)

// A binomial interval, so a 1-of-3 never gets read as 33%.
function ci95(w, n) {
  if (!n) return [0, 0]
  const p = w / n, se = Math.sqrt((p * (1 - p)) / n)
  return [Math.max(0, p - 1.96 * se), Math.min(1, p + 1.96 * se)]
}

async function load() {
  const [obs, sold, inv] = await Promise.all([
    page(`${URL}/rest/v1/run_list_observations?select=*&order=seen_at.asc`),
    rpcAll('list_all_sold'),
    rpcAll('list_all_inventory'),
  ])
  const ownedSold = new Map(), ownedInv = new Map()
  for (const s of sold) {
    const v = String(s.vehicle_vin || '').toUpperCase()
    if (!v) continue
    const prev = ownedSold.get(v)
    // A car we bought back and resold appears twice; the FIRST sale is the
    // outcome of the purchase decision this observation led to.
    if (!prev || String(s.sale_date) < String(prev.sale_date)) ownedSold.set(v, s)
  }
  for (const i of inv) {
    const v = String(i.vehicle_vin || '').toUpperCase()
    if (v && !ownedInv.has(v)) ownedInv.set(v, i)
  }
  return { obs, ownedSold, ownedInv }
}

// One row per bid: the car as it ran, plus whether we got it and what it did.
function buildBids({ obs, ownedSold, ownedInv }) {
  const bids = []
  let skippedRetro = 0, skippedFresh = 0, notRecommended = 0
  const today = new Date().toISOString().slice(0, 10)
  for (const o of obs) {
    const recommended = o.verdict === 'TARGET' || o.verdict === 'WATCH'
    if (!recommended) { notRecommended++; continue }
    const seenDay = String(o.seen_at || '').slice(0, 10)
    const sale = String(o.sale_date || '')
    // A list uploaded AFTER its sale ran is a record, not a bid list. Counting
    // those cars as losses would teach the model we lose everything at whichever
    // auction we happen to review late.
    if (sale && sale < seenDay) { skippedRetro++; continue }
    // A sale that hasn't run, or ran today, hasn't had time to be stocked in.
    if (!sale || sale >= today) { skippedFresh++; continue }
    const vin = String(o.vin || '').toUpperCase()
    const s = ownedSold.get(vin), i = ownedInv.get(vin)
    const won = !!(s || i)
    bids.push({
      vin, won,
      seller: (o.seller || '(none)').trim() || '(none)',
      location: (o.location || '(none)').trim() || '(none)',
      source: o.source_label || o.source_id,
      lane: (o.lane || '').trim() || '(none)',
      grade: o.cr_grade == null ? null : Number(o.cr_grade),
      auctionValue: o.auction_value == null ? null : Number(o.auction_value),
      nameplate: `${o.make || ''} ${o.model || ''}`.trim().toUpperCase(),
      odo: o.odometer, year: o.year,
      verdict: o.verdict, confidence: o.confidence,
      predicted: o.exact_profit == null ? null : Number(o.exact_profit),
      // outcome, only for cars we won
      paid: won ? num(s ? s.original_cost : i.total_cost) : null,
      recon: won ? num(s ? s.added_costs : i.added_costs) : null,
      price: s ? num(s.sales_price) : null,
      profit: s ? num(s.profit_on_sale) : null,
      days: won ? num(s ? s.days_on_lot : i.days_on_lot) : null,
      soldDate: s ? frazerDate(s.sale_date) : null,
      stillHeld: !!(i && !s),
    })
  }
  return { bids, skippedRetro, skippedFresh, notRecommended }
}

// ── 1. WIN ───────────────────────────────────────────────────────────────────
function winCuts(bids, keyOf, label, out) {
  const m = new Map()
  for (const b of bids) {
    const k = keyOf(b)
    if (k == null) continue
    const e = m.get(k) || { n: 0, w: 0 }
    e.n++; if (b.won) e.w++
    m.set(k, e)
  }
  const rows = [...m.entries()]
    .filter(([, e]) => e.n >= MIN_BIDS_FOR_CUT)
    .map(([k, e]) => ({ k, ...e, rate: e.w / e.n }))
    .sort((a, b) => b.rate - a.rate || b.n - a.n)
  out.cuts[label] = rows
  if (JSON_OUT) return
  if (!rows.length) {
    console.log(`  ${label}: nothing with ${MIN_BIDS_FOR_CUT}+ bids yet`)
    return
  }
  console.log(`\n  by ${label}:`)
  for (const r of rows.slice(0, 12)) {
    const [lo, hi] = ci95(r.w, r.n)
    console.log(`    ${String(r.w).padStart(4)}/${String(r.n).padEnd(5)} ${pctS(r.rate).padStart(6)}  ` +
      `(${pctS(lo)}–${pctS(hi)})  ${String(r.k).slice(0, 46)}`)
  }
}

// ── 2. PERFORM ───────────────────────────────────────────────────────────────
function perfCuts(won, keyOf, label, out) {
  const m = new Map()
  for (const b of won) {
    const k = keyOf(b)
    if (k == null) continue
    ;(m.get(k) || m.set(k, []).get(k)).push(b)
  }
  const rows = [...m.entries()]
    .filter(([, v]) => v.length >= 3)
    .map(([k, v]) => ({
      k, n: v.length,
      recon: median(v.map((b) => b.recon).filter((x) => x != null)),
      days: median(v.map((b) => b.days).filter((x) => x != null)),
      profit: mean(v.map((b) => b.profit).filter((x) => x != null)),
      predicted: mean(v.map((b) => b.predicted).filter((x) => x != null)),
    }))
    .sort((a, b) => (b.profit ?? -1e9) - (a.profit ?? -1e9))
  out.perf[label] = rows
  if (JSON_OUT) return
  if (!rows.length) { console.log(`  ${label}: not enough sold cars yet`); return }
  console.log(`\n  by ${label}:`)
  console.log('       n   med recon   med days   avg profit   we predicted')
  for (const r of rows.slice(0, 12))
    console.log(`    ${String(r.n).padStart(4)}  ${money(r.recon).padStart(9)}  ${String(r.days ?? '—').padStart(8)}d  ` +
      `${money(r.profit).padStart(10)}   ${money(r.predicted).padStart(12)}   ${String(r.k).slice(0, 34)}`)
}

const gradeBand = (g) => (g == null ? null : g < 2 ? 'under 2.0' : g < 3 ? '2.0–2.9' : g < 4 ? '3.0–3.9' : '4.0+')
const priceBand = (v) => (v == null ? null
  : v < 7500 ? 'under $7.5k' : v < 12500 ? '$7.5k–12.5k' : v < 20000 ? '$12.5k–20k' : '$20k+')

async function main() {
  const data = await load()
  const { bids, skippedRetro, skippedFresh, notRecommended } = buildBids(data)
  const won = bids.filter((b) => b.won)
  const soldOut = won.filter((b) => b.profit != null)
  const out = { generatedAt: new Date().toISOString(), cuts: {}, perf: {}, summary: {} }

  const W = won.length, N = bids.length
  const [lo, hi] = ci95(W, N)
  out.summary = { bids: N, wins: W, winRate: N ? W / N : null, ci: [lo, hi],
    sold: soldOut.length, stillHeld: won.filter((b) => b.stillHeld).length,
    excludedRetrospective: skippedRetro, excludedTooFresh: skippedFresh, notRecommended }

  if (JSON_OUT) { console.log(JSON.stringify(out, null, 2)); return }

  console.log('\n════ BUY LOOP STUDY ════')
  console.log(`recommended and bid on (settled sales only): ${N}`)
  console.log(`  won  : ${W}   (${pctS(N ? W / N : null)}, 95% CI ${pctS(lo)}–${pctS(hi)})`)
  console.log(`  of those, ${soldOut.length} already sold, ${won.filter((b) => b.stillHeld).length} still in stock`)
  console.log(`excluded: ${skippedRetro} on lists uploaded AFTER the sale ran (never bid),`)
  console.log(`          ${skippedFresh} on sales not yet run or too fresh to have stocked in`)

  console.log('\n──── 1. WHY WE WON THE ONES WE WON ────')
  if (W < MIN_WINS_FOR_CUT) {
    console.log(`  Only ${W} wins so far — below the ${MIN_WINS_FOR_CUT} needed for any breakdown to mean`)
    console.log('  anything. Every cut below would be one or two cars wearing a percentage.')
    console.log('  This section turns itself on as wins accumulate; nothing else to do.')
  } else {
    winCuts(bids, (b) => b.source, 'auction feed', out)
    winCuts(bids, (b) => b.location, 'auction / city', out)
    winCuts(bids, (b) => b.seller, 'seller', out)
    winCuts(bids, (b) => gradeBand(b.grade), 'CR grade band', out)
    winCuts(bids, (b) => priceBand(b.auctionValue), 'price band', out)
    winCuts(bids, (b) => b.nameplate, 'nameplate', out)
    winCuts(bids, (b) => b.verdict, 'what we called it', out)
  }
  if (W >= MIN_WINS_FOR_MODEL) {
    console.log(`\n  ${W} wins is enough to fit a win model — see --json and feed it to the ranker.`)
  } else {
    console.log(`\n  (a fitted win model needs ${MIN_WINS_FOR_MODEL}+ wins; at ${W} it would overfit)`)
  }

  console.log('\n──── 2. HOW THE ONES WE WON ACTUALLY PERFORMED ────')
  if (soldOut.length < MIN_SOLD_FOR_PERF) {
    console.log(`  ${soldOut.length} of the cars we won have sold. Need ${MIN_SOLD_FOR_PERF} before`)
    console.log('  recon/days/profit cuts say anything. Cars still in stock:')
    for (const b of won.filter((b) => b.stillHeld).slice(0, 12))
      console.log(`    ${b.year} ${b.nameplate.slice(0, 26).padEnd(26)} grade ${String(b.grade ?? '—').padStart(4)}  ` +
        `paid ${money(b.paid).padStart(8)}  ${String(b.days ?? '—').padStart(3)}d on lot`)
  } else {
    perfCuts(soldOut, (b) => gradeBand(b.grade), 'CR grade band', out)
    perfCuts(soldOut, (b) => b.location, 'auction / city', out)
    perfCuts(soldOut, (b) => b.seller, 'seller', out)
    perfCuts(soldOut, (b) => b.nameplate, 'nameplate', out)
  }

  console.log('\n──── 3. WHAT TO CHANGE ────')
  const notes = []
  if (skippedRetro > 0)
    notes.push(`${skippedRetro} recommendations came from lists uploaded after the sale had run. ` +
      `Those are not bids and are excluded here, but they still sit in the table — upload before the sale, not after.`)
  if (W >= MIN_WINS_FOR_CUT) {
    const feeds = out.cuts['auction feed'] || []
    if (feeds.length >= 2) {
      const best = feeds[0], worst = feeds[feeds.length - 1]
      if (best.rate > worst.rate * 2)
        notes.push(`You win ${pctS(best.rate)} of bids at ${best.k} against ${pctS(worst.rate)} at ${worst.k}. ` +
          `Same effort, ${(best.rate / Math.max(worst.rate, 0.0001)).toFixed(1)}x the cars.`)
    }
  }
  if (soldOut.length >= MIN_SOLD_FOR_PERF) {
    const g = out.perf['CR grade band'] || []
    if (g.length >= 2) {
      const byRecon = [...g].sort((a, b) => (a.recon ?? 1e9) - (b.recon ?? 1e9))
      notes.push(`Recon by grade band: ${byRecon.map((r) => `${r.k} ${money(r.recon)}`).join(', ')}. ` +
        `That is the number the buy band should be set from.`)
    }
    const missed = soldOut.filter((b) => b.predicted != null && b.profit != null)
    if (missed.length >= MIN_SOLD_FOR_PERF) {
      const err = mean(missed.map((b) => b.profit - b.predicted))
      notes.push(`On the cars we won and sold, actual profit ran ${money(Math.abs(err))} ` +
        `${err < 0 ? 'BELOW' : 'above'} what the list predicted (n=${missed.length}).`)
    }
  }
  if (!notes.length) notes.push('Not enough settled bids yet to justify changing anything. Keep uploading before each sale.')
  notes.forEach((n, i) => console.log(`  ${i + 1}. ${n}`))
  console.log()
}

main().catch((e) => { console.error('buy-loop-study failed:', e.message); process.exit(1) })
