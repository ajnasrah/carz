// Target Buy List engine — cross-check an auction run list against cars we've sold.
//
// A run-list car is a TARGET when the cars we've actually sold like it (matched
// on year / make / model / odometer) averaged more than $800 net profit and moved
// in under 30 days.
//
// This is the ESM mirror of the extension's lib/target-buy-list.js. The scoring
// constants, cohort tiers and cleaning rules are deliberately identical — change
// one, change the other, or the sale-day list and the dashboard will disagree.
//
// Sold book source:
//   sold — the full wholesale book, ~6,200 sales over 19 months, fed by the
//          frazer-ingest edge function. Read via the list_all_sold() RPC because
//          the table itself is RLS-protected against the anon key.

import { supabase, selectAll } from './supabase'

// ── Buy criteria ─────────────────────────────────────────────────────────────
export const TARGET_PROFIT = 800
export const TARGET_DAYS = 30
const TARGET_MEDIAN_FLOOR = 500 // one lucky car must not carry a cohort
const WATCH_PROFIT = 400
const WATCH_DAYS = 40

// THE definition of "the same car": same make, same model, same model year, and
// an odometer within this band. Only this cohort can make something a TARGET —
// how that exact car has performed for us is the whole point of the tool.
export const EXACT = { years: 0, miles: 15000, min: 2 }

// Looser cohorts exist only for context when there's no exact match. They are
// always capped at WATCH and always labelled, because a loose match is not
// evidence about this car.
//
// An earlier model-name-only tier matched on nameplate alone, with no mileage
// limit at all: a 200k-mile 2011 Acadia inherited the numbers of 80k-mile 2022
// Acadias, and three completely different cars all reported the same n=8,
// $2,260 avg. Every tier now constrains both year and mileage.
const TIERS = [
  { id: 'exact', label: 'exact', years: EXACT.years, miles: EXACT.miles, min: EXACT.min },
  { id: 'close', label: 'close', years: 1, miles: 20000, min: 3, cap: 'WATCH' },
  { id: 'broad', label: 'broad', years: 3, miles: 40000, min: 5, cap: 'WATCH' },
]

const SAME_YEAR_VETO_N = 5 // model-years with this many sales can veto a target
const MIN_VALID_ODO = 100 // below this the run list's mileage is a data error
const OUTLIER_GAP = 500 // median consecutive profit gap is ~$5; $500 is a real break

// ── CSV parsing ──────────────────────────────────────────────────────────────
export function parseCSV(text) {
  const rows = []
  let i = 0, f = '', row = [], q = false
  const pushF = () => { row.push(f); f = '' }
  const pushR = () => { rows.push(row); row = [] }
  while (i < text.length) {
    const c = text[i]
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++ } else q = false }
      else f += c
    } else {
      if (c === '"') q = true
      else if (c === ',') pushF()
      else if (c === '\n') { pushF(); pushR() }
      // Manheim exports terminate rows with a bare CR. Treat a lone CR as a row
      // break; in CRLF the following LF closes the row instead.
      else if (c === '\r') { if (text[i + 1] !== '\n') { pushF(); pushR() } }
      else f += c
    }
    i++
  }
  if (f.length || row.length) { pushF(); pushR() }
  // ADESA exports lead with a UTF-8 BOM, which would corrupt the first header.
  const header = (rows.shift() || []).map((h) => h.replace(/^﻿/, '').trim())
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, j) => [h, r[j]])))
}

const int = (x) => { const n = parseInt(String(x ?? '').replace(/[^0-9-]/g, ''), 10); return Number.isFinite(n) ? n : null }
const dec = (x) => { const n = parseFloat(String(x ?? '').replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? n : null }

function toISODate(v) {
  if (!v) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  const s = String(v).trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (m) {
    const yy = m[3].length === 2 ? `20${m[3]}` : m[3]
    return `${yy}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`
  }
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

// ── Run-list formats ─────────────────────────────────────────────────────────
export const FORMATS = [
  {
    id: 'edge_pipeline',
    label: 'Edge Pipeline',
    detect: (r) => 'Vin' in r && 'Run Number' in r && 'Lane' in r,
    map: (r) => ({
      vin: (r['Vin'] || '').trim().toUpperCase(),
      stock: (r['Stock Number'] || '').trim(),
      run: (r['Run Number'] || '').trim(),
      lane: (r['Lane'] || '').trim(),
      lot: (r['Lot'] || '').trim(),
      saleDate: (r['Sale Date'] || '').trim(),
      year: int(r['Year']),
      make: (r['Make'] || '').trim(),
      model: (r['Model'] || '').trim(),
      style: (r['Style'] || '').trim(),
      color: (r['Exterior Color'] || '').trim(),
      odo: int(r['Mileage']),
      grade: (r['Grade'] || '').trim(),
      hasCR: String(r['Has Condition Report'] || '').toLowerCase() === 'true',
      pics: int(r['Picture Count']),
    }),
  },
  {
    id: 'adesa',
    label: 'ADESA',
    detect: (r) => 'VIN' in r && 'Lane / Run' in r,
    map: (r) => {
      const lr = String(r['Lane / Run'] || '').trim()
      const m = lr.match(/^([A-Za-z]*)\s*[-/]?\s*(\d+)$/)
      return {
        vin: (r['VIN'] || '').trim().toUpperCase(),
        stock: '',
        run: lr,
        lane: m ? m[1] : '',
        lot: m ? m[2] : '',
        // "Starts 08/04/2026 12:00 PM EDT" -> 2026-08-04
        saleDate: toISODate((String(r['Date'] || '').match(/(\d{1,2}\/\d{1,2}\/\d{4})/) || [])[1]) || '',
        year: int(r['Year']),
        make: (r['Make'] || '').trim(),
        model: (r['Model'] || '').trim(),
        style: (r['Trim'] || '').trim(),
        color: (r['Exterior Color'] || '').trim(),
        odo: int(r['Odometer']),
        grade: (r['Grade'] || '').trim(),
        hasCR: !!String(r['Grade'] || '').trim(),
        pics: null,
        drivetrain: (r['Drivetrain'] || '').trim(),
        engine: (r['Engine'] || '').trim(),
        transmission: (r['Transmission'] || '').trim(),
        fuel: (r['Fuel'] || '').trim(),
        seller: (r['Seller'] || '').trim(),
        announcements: [r['Announcements'], r['Notes'], r['Driveability'], r['Condition Guarantee']]
          .map((x) => (x || '').trim()).filter(Boolean).join(' | '),
        titleStatus: (r['Title Status'] || '').trim(),
        auctionValue: dec(r['CarValue']),
        location: (r['Location'] || '').trim(),
        channel: (r['Sale Channel'] || '').trim(),
      }
    },
  },
  {
    id: 'manheim',
    label: 'Manheim',
    detect: (r) => 'Vin' in r && 'MMR' in r && 'Auction House' in r,
    map: (r) => ({
      vin: (r['Vin'] || '').trim().toUpperCase(),
      stock: '',
      run: (r['Run'] || '').trim(),
      lane: (r['Lane'] || '').trim(),
      lot: '',
      saleDate: toISODate((String(r['Starts At'] || '').match(/^(\d{4}-\d{2}-\d{2})/) || [])[1]) || '',
      year: int(r['Year']),
      make: (r['Make'] || '').trim(),
      model: (r['Model'] || '').trim(),
      style: (r['Trim'] || '').trim(),
      color: (r['Exterior Color'] || '').trim(),
      odo: int(r['Odometer Value']),
      grade: (r['Condition Report Grade'] || '').trim(),
      hasCR: !!String(r['Condition Report Grade'] || '').trim(),
      pics: null,
      drivetrain: (r['Drivetrain'] || '').trim(),
      engine: (r['Engine Type'] || '').trim(),
      transmission: (r['Transmission Type'] || '').trim(),
      fuel: '',
      seller: (r['Seller Name'] || '').trim(),
      // Manheim's "Status" is the listing state (Live/Sold), not a title status.
      announcements: [r['Status'], r['Seller Comments'], r['Notes']]
        .map((x) => (x || '').trim()).filter(Boolean).join(' | '),
      titleStatus: '',
      auctionValue: dec(r['MMR']), // the one feed carrying a market benchmark
      location: (r['Pickup Location'] || '').trim(),
      channel: (r['Inventory'] || '').trim(),
    }),
  },
]

export const detectFormat = (rows) => (rows.length ? FORMATS.find((f) => f.detect(rows[0])) || null : null)

// ── Normalisation ────────────────────────────────────────────────────────────
const normMake = (m) => String(m || '').toUpperCase().replace(/[^A-Z]/g, '')

function normModel(model, make) {
  let s = String(model || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const mk = normMake(make)
  if (mk && s.startsWith(mk) && s.length > mk.length) s = s.slice(mk.length)
  for (const p of ['CHEVROLET', 'FORD', 'RAM', 'GMC', 'JEEP', 'NISSAN', 'TOYOTA']) {
    if (s.startsWith(p) && s.length > p.length) { s = s.slice(p.length); break }
  }
  return s
}

// Tonnage is part of a vehicle's identity; trim and body style are not. A bare
// prefix match let a Sierra 3500HD draw the same 20 half-tons as a Sierra 1500 —
// a one-ton dually priced off half-tons is a different truck, different buyer,
// different market. Trim variants (Unlimited, Sport) DO comp against each other:
// all Wranglers are Wranglers.
const SERIES_RE = /(1500|2500|3500)/
const TRIM_RE = /UNLIMITED|UNLIMI|SPORT/

function modelParts(norm) {
  // The sold export truncates at 15 chars, so "WRANGLER UNLIMI" has to reduce to
  // the same nameplate as "WRANGLER".
  let base = norm.replace(TRIM_RE, '')

  let series = ''
  const stem = (base.match(/^[A-Z]+/) || [''])[0]
  // Only read digits as a series when the alphabetic stem is itself the
  // nameplate (SILVERADO 1500). For F150 / F250 the digits ARE the nameplate.
  if (stem.length >= 4) {
    const m = base.match(SERIES_RE)
    if (m) { series = m[1]; base = base.replace(SERIES_RE, '') }
  }
  return { base: base.replace(/HD$/, ''), series }
}

function modelMatch(a, b) {
  if (!a || !b) return false
  const A = modelParts(a), B = modelParts(b)
  // A heavy-duty truck must never borrow half-ton history. Where a side is
  // silent on series — the sold export usually is — treat it as a half-ton,
  // which is the dominant case: 1500 still matches, 2500 and 3500 cannot.
  if ((A.series || '1500') !== (B.series || '1500')) return false
  if (A.base === B.base) return true
  const [s, l] = A.base.length < B.base.length ? [A.base, B.base] : [B.base, A.base]
  return s.length >= 4 && l.startsWith(s)
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)
function median(a) {
  if (!a.length) return null
  const s = [...a].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// ── Sold book ────────────────────────────────────────────────────────────────
// The sold book: every wholesale sale we've made, with its economics.
//
// Read through the list_all_sold() RPC rather than the table directly — `sold`
// is RLS-protected, so an anon SELECT silently returns zero rows. The RPC is
// SECURITY DEFINER and granted to anon for exactly this reason. Reading the
// table straight was why this engine was previously scoring against a 57-day
// spreadsheet import instead of the full 19-month book.
//
// Frazer stores these columns as text, so dates and money need coercing.
const rpcNum = (x) => {
  if (x === null || x === undefined || x === '') return null
  const n = parseFloat(String(x).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

// Frazer writes sale_date as MM/DD/YY.
function frazerDate(v) {
  if (!v) return null
  const m = String(v).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (!m) return toISODate(v)
  const yy = m[3].length === 2 ? `20${m[3]}` : m[3]
  return `${yy}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
}

export async function fetchSoldBook() {
  const rows = []
  const PAGE = 1000
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.rpc('list_all_sold').range(offset, offset + PAGE - 1)
    if (error) throw new Error(`list_all_sold failed: ${error.message}`)
    if (!data || !data.length) break
    rows.push(...data)
    if (data.length < PAGE) break
    if (offset > 100000) break // safety stop
  }

  const mapped = rows.map((r) => ({
    vin: String(r.vehicle_vin || '').trim().toUpperCase(),
    year: rpcNum(r.vehicle_year),
    make: r.vehicle_make,
    model: r.vehicle_model,
    odometer: rpcNum(r.mileage),
    sale_date: frazerDate(r.sale_date),
    sale_price: rpcNum(r.sales_price),
    total_cost: rpcNum(r.total_cost),
    added_costs: rpcNum(r.added_costs),
    net_profit: rpcNum(r.profit_on_sale),
    days_on_lot: rpcNum(r.days_on_lot),
    vendor: r.vendor,
    buyer: r.buyer,
  }))

  const dates = mapped.map((r) => r.sale_date).filter(Boolean).sort()
  return {
    rows: mapped,
    total: mapped.length,
    from: dates[0] || null,
    to: dates[dates.length - 1] || null,
  }
}

// ── Clean the book ───────────────────────────────────────────────────────────
// Buy-backs are deliberately KEPT. When we buy a car back and eat $2-3k
// disposing of it, that loss is part of what that year/make/model/odometer
// actually costs us — excluding it makes a cohort look better than it is. So
// no VIN de-duplication and no arbitration-vendor filter: the same car sold
// twice contributes both outcomes.
//
// Only two kinds of row are dropped:
//   1. Pass-through title transfers ($0 profit, $0 recon) — not wholesale deals.
//   2. Extreme outliers at either tail — the car that lost $8k because it was a
//      disaster, or made $7k because we got lucky. Neither repeats. A routine
//      $2-3k buy-back loss sits well inside the distribution and is retained.
export function cleanBook(rows) {
  const usable = rows.filter((r) => r.net_profit !== null && r.net_profit !== undefined)

  const removedPassthrough = usable.filter(
    (r) => Number(r.net_profit) === 0 && Number(r.added_costs || 0) === 0)
  const ptSet = new Set(removedPassthrough)
  let book = usable.filter((r) => !ptSet.has(r))

  book.sort((a, b) => Number(a.net_profit) - Number(b.net_profit))
  const p = book.map((r) => Number(r.net_profit))

  // Never let the walk eat the book: on a small or very spread-out set every gap
  // can exceed the threshold, which would trim everything to nothing.
  const maxTrim = Math.floor(p.length * 0.05)
  let lo = 0
  while (lo < maxTrim && p[lo + 1] - p[lo] > OUTLIER_GAP) lo++
  let hi = p.length - 1
  while (hi > p.length - 1 - maxTrim && p[hi] - p[hi - 1] > OUTLIER_GAP) hi--
  if (lo > hi) { lo = 0; hi = p.length - 1 }

  // Reported for visibility only — these rows stay in the book.
  const vinCounts = new Map()
  for (const r of book) if (r.vin) vinCounts.set(r.vin, (vinCounts.get(r.vin) || 0) + 1)
  const buyBacks = book.filter((r) => r.vin && vinCounts.get(r.vin) > 1)

  const removedOutliers = [...book.slice(0, lo), ...book.slice(hi + 1)]
  book = book.slice(lo, hi + 1)

  return { book, removedOutliers, removedPassthrough, buyBacks }
}

export function indexBook(book) {
  const byMake = new Map()
  for (const r of book) {
    const nmk = normMake(r.make)
    if (!nmk) continue
    if (!byMake.has(nmk)) byMake.set(nmk, [])
    byMake.get(nmk).push({
      year: r.year,
      odo: r.odometer,
      profit: Number(r.net_profit),
      days: r.days_on_lot == null ? null : Number(r.days_on_lot),
      price: r.sale_price == null ? null : Number(r.sale_price),
      nmodel: normModel(r.model, r.make),
      vin: r.vin,
      saleDate: r.sale_date,
    })
  }
  return byMake
}

// ── Scoring ──────────────────────────────────────────────────────────────────
function cohortStats(cohort) {
  if (!cohort.length) return { n: 0, meanProfit: null, medProfit: null, meanDays: null, hitRate: null, lossRate: null, medResale: null }
  const profits = cohort.map((s) => s.profit)
  const days = cohort.map((s) => s.days).filter((d) => d != null)
  const prices = cohort.map((s) => s.price).filter((v) => v != null)
  return {
    n: cohort.length,
    meanProfit: mean(profits),
    medProfit: median(profits),
    meanDays: days.length ? mean(days) : null,
    hitRate: (profits.filter((v) => v > 1000).length / profits.length) * 100,
    lossRate: (profits.filter((v) => v <= 0).length / profits.length) * 100,
    medResale: median(prices),
  }
}

// Cars of the same model within a tier's year and mileage band.
const inTier = (pool, car, tier) => pool.filter((s) =>
  s.year != null && Math.abs(s.year - car.year) <= tier.years &&
  s.odo != null && Math.abs(s.odo - car.odo) <= tier.miles)

const fmtMoney = (v) => (v == null ? '—' : `$${Math.round(v).toLocaleString()}`)

export function evaluateCar(car, byMake) {
  const nmk = normMake(car.make)
  const nmd = normModel(car.model, car.make)
  const pool = (byMake.get(nmk) || []).filter((s) => modelMatch(s.nmodel, nmd))

  const badOdo = car.odo == null || car.odo < MIN_VALID_ODO
  const base = {
    ...car, badOdo, tier: null, n: 0, meanProfit: null, medProfit: null,
    meanDays: null, hitRate: null, confidence: 'NONE', medResale: null,
    exactN: 0, exactProfit: null, exactMedProfit: null, exactDays: null,
    exactHit: null, exactLoss: null, sameYearN: 0, sameYearProfit: null,
    compPool: '', compShared: 1,
  }

  if (!pool.length) return { ...base, verdict: 'NO DATA', why: 'No record of us selling this model' }
  if (car.year == null) {
    return { ...base, n: pool.length, verdict: 'NO DATA', why: 'Run list has no year — cannot match on age' }
  }
  if (badOdo) {
    return {
      ...base, n: pool.length, verdict: 'NO DATA',
      why: `Run-list mileage looks wrong (${car.odo == null ? 'blank' : car.odo}) — can't match on miles`,
    }
  }

  // The exact car: same year, same model, odometer in range. This is the only
  // cohort allowed to produce a verdict.
  const exactCohort = inTier(pool, car, EXACT)
  const exact = cohortStats(exactCohort)
  // Two run-list cars close enough to draw the same sold cars are one bet, not
  // two. Stamp the cohort so shared evidence is visible instead of implied.
  const compPool = exactCohort.length
    ? exactCohort.map((s) => `${s.vin}|${s.saleDate}`).sort().join(',')
    : ''

  // Same year, any mileage. Used ONLY to veto — never to promote. It catches
  // model-years that are broadly bad (2022 F150: 7 sold, -$1,776 avg) which a
  // narrow mileage band can miss.
  const sameYearCohort = pool.filter((s) => s.year === car.year)
  const sameYear = cohortStats(sameYearCohort)

  // Looser cohorts are computed for context and shown in their own columns.
  // They never set the verdict and never drive the ranking.
  let context = null
  for (const tier of TIERS) {
    if (tier.id === 'exact') continue
    const cohort = inTier(pool, car, tier)
    if (cohort.length < tier.min) continue
    context = { tier, st: cohortStats(cohort) }
    break
  }

  const withStats = {
    ...base,
    compPool,
    exactN: exact.n, exactProfit: exact.meanProfit, exactMedProfit: exact.medProfit,
    exactDays: exact.meanDays, exactHit: exact.hitRate, exactLoss: exact.lossRate,
    sameYearN: sameYear.n, sameYearProfit: sameYear.meanProfit,
    tier: context ? context.tier.label : null,
    n: context ? context.st.n : 0,
    meanProfit: context ? context.st.meanProfit : null,
    medProfit: context ? context.st.medProfit : null,
    meanDays: context ? context.st.meanDays : null,
    hitRate: context ? context.st.hitRate : null,
    medResale: context ? context.st.medResale : exact.medResale,
  }

  const contextNote = context
    ? ` Context only: ${context.st.n} within ±${context.tier.years}yr/±${context.tier.miles / 1000}k, avg ${fmtMoney(context.st.meanProfit)}.`
    : ''

  if (exact.n < EXACT.min) {
    return {
      ...withStats, verdict: 'NO DATA', confidence: 'NONE',
      why: `Only ${exact.n} exact match${exact.n === 1 ? '' : 'es'} (same year, ±${EXACT.miles / 1000}k mi) — not enough to judge.${contextNote}`,
    }
  }

  let verdict = 'PASS'
  if (exact.meanDays != null && exact.meanProfit > TARGET_PROFIT &&
      exact.meanDays < TARGET_DAYS && exact.medProfit > TARGET_MEDIAN_FLOOR) {
    verdict = 'TARGET'
  } else if (exact.meanDays != null && exact.meanProfit > WATCH_PROFIT && exact.meanDays < WATCH_DAYS) {
    verdict = 'WATCH'
  }

  // Veto: this model-year loses money across the board, whatever the mileage.
  let veto = ''
  if (verdict !== 'PASS' && sameYear.n >= SAME_YEAR_VETO_N && sameYear.meanProfit < 0) {
    veto = ` VETO: all ${sameYear.n} ${car.year} ${car.model}s we sold average ${fmtMoney(sameYear.meanProfit)}.`
    verdict = 'PASS'
  }

  return {
    ...withStats, verdict,
    confidence: exact.n >= 5 ? 'HIGH' : exact.n >= 3 ? 'MEDIUM' : 'LOW',
    why: `${exact.n} sold same year, ±${EXACT.miles / 1000}k mi · avg ${fmtMoney(exact.meanProfit)}, ` +
         `median ${fmtMoney(exact.medProfit)} · ${exact.meanDays == null ? '—' : Math.round(exact.meanDays)}d on lot · ` +
         `${Math.round(exact.hitRate)}% cleared $1k, ${Math.round(exact.lossRate)}% lost money.${veto}${contextNote}`,
  }
}

// ── Whole-list run ───────────────────────────────────────────────────────────
export function scoreRunList(rawRows, fmt, byMake) {
  // ADESA exports repeat rows (~20 in a 134-row list), so collapse on VIN.
  const mapped = rawRows.map(fmt.map).filter((c) => c.vin || (c.year && c.make))
  const seen = new Set()
  const cars = mapped.filter((c) => {
    if (!c.vin) return true
    if (seen.has(c.vin)) return false
    seen.add(c.vin)
    return true
  })

  const scored = cars.map((c) => evaluateCar(c, byMake))
  // Rank on the exact-car number only. Sorting by a context-tier average would
  // let cars with no real history outrank ones that have it.
  const rank = { TARGET: 0, WATCH: 1, 'NO DATA': 2, PASS: 3 }
  scored.sort((a, b) => rank[a.verdict] - rank[b.verdict] || (b.exactProfit ?? -1e9) - (a.exactProfit ?? -1e9))
  scored.forEach((c, i) => { c.rank = i + 1 })

  // Flag rows whose verdict rests on the exact same sold cars.
  const poolCounts = new Map()
  for (const c of scored) if (c.compPool) poolCounts.set(c.compPool, (poolCounts.get(c.compPool) || 0) + 1)
  for (const c of scored) c.compShared = c.compPool ? poolCounts.get(c.compPool) : 1

  return { scored, duplicatesDropped: mapped.length - cars.length }
}
