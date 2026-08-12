import { supabase, selectAll } from './supabase'

// Pull all clean sold rows. ~4500 rows / ~1MB — fine to load once and
// aggregate client-side for instant period switching.
//
// CRITICAL: Postgres NUMERIC columns are serialized as STRINGS by PostgREST
// to preserve arbitrary-precision values (JS number is float64, lossy for big
// decimals). We coerce them to JS numbers at the boundary so all downstream
// reduce/sum/avg math works correctly. Without this, total_profit becomes
// "0145614581...." (string concat) and avg_profit becomes NaN.
// Pull sold rows INCLUDING buyer + vendor + customer (not in the sold_clean view). Paginated.
export async function fetchSoldWithBuyers() {
  const PAGE = 1000
  const all = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('sold')
      .select('stock_number, vehicle_year, vehicle_make, vehicle_model, sale_date, buyer, vendor, first_name, last_name, total_cost, added_costs, sales_price, profit_on_sale, days_on_lot')
      .range(from, from + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
    from += PAGE
    if (from >= 50000) break
  }
  return all.map((r) => ({
    ...r,
    total_cost: toNumOrNull(r.total_cost),
    added_costs: toNumOrNull(r.added_costs),
    sales_price: toNumOrNull(r.sales_price),
    profit_on_sale: toNumOrNull(r.profit_on_sale),
    days_on_lot: toNumOrNull(r.days_on_lot),
    // Normalize MM/DD/YY → YYYY-MM-DD so filterByPeriod's string compare works
    sale_date: mmddyyToIso(r.sale_date),
    customer: [r.first_name, r.last_name].filter(Boolean).join(' ').trim() || 'UNKNOWN',
  }))
}

function mmddyyToIso(s) {
  if (!s) return s
  const parts = String(s).split('/')
  if (parts.length !== 3) return s
  const [m, d, y] = parts
  const yyyy = y.length === 2 ? `20${y}` : y
  return `${yyyy}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

// Generic group-by-dimension helper used by buyer / vendor / customer tabs
export function groupByField(rows, fieldName) {
  const byField = new Map()
  for (const r of rows) {
    const key = (r[fieldName] || 'UNASSIGNED').toString().trim() || 'UNASSIGNED'
    const profit = r.profit_on_sale || 0
    let b = byField.get(key)
    if (!b) {
      b = {
        name: key, count: 0, totalProfit: 0, totalSalesPrice: 0,
        wins: 0, losses: 0, winProfit: 0, lossAmount: 0,
        _daysSum: 0, _daysN: 0,
      }
      byField.set(key, b)
    }
    b.count += 1
    b.totalProfit += profit
    b.totalSalesPrice += r.sales_price || 0
    if (profit > 0) { b.wins += 1; b.winProfit += profit }
    else if (profit < 0) { b.losses += 1; b.lossAmount += profit }
    if (r.days_on_lot != null) { b._daysSum += r.days_on_lot; b._daysN += 1 }
  }
  return [...byField.values()].map((b) => ({
    ...b,
    avgProfit: b.count ? Math.round(b.totalProfit / b.count) : 0,
    avgWinProfit: b.wins ? Math.round(b.winProfit / b.wins) : 0,
    avgLossAmount: b.losses ? Math.round(b.lossAmount / b.losses) : 0,
    pctWinners: b.count ? b.wins / b.count : 0,
    avgDays: b._daysN ? Math.round(b._daysSum / b._daysN) : 0,
  })).sort((a, b) => b.totalProfit - a.totalProfit)
}

// Build a daily profit series per buyer across whatever date range is present
// in `rows` (caller pre-filters by period). Returns { data, buyers }.
export function dailyProfitByBuyer(rows) {
  const buyers = new Set()
  const byDateBuyer = new Map()
  let minDate = null, maxDate = null
  for (const r of rows) {
    if (!r.sale_date) continue
    const d = r.sale_date.slice(0, 10)
    if (!minDate || d < minDate) minDate = d
    if (!maxDate || d > maxDate) maxDate = d
    const buyer = (r.buyer || 'UNASSIGNED').toString().trim() || 'UNASSIGNED'
    buyers.add(buyer)
    if (!byDateBuyer.has(d)) byDateBuyer.set(d, {})
    const row = byDateBuyer.get(d)
    row[buyer] = (row[buyer] || 0) + (r.profit_on_sale || 0)
  }
  if (!minDate || !maxDate) return { data: [], buyers: [...buyers] }
  const out = []
  const cursor = new Date(minDate + 'T00:00:00')
  const end = new Date(maxDate + 'T00:00:00')
  while (cursor <= end) {
    const d = cursor.toISOString().slice(0, 10)
    const entry = { date: d, label: `${cursor.getMonth() + 1}/${cursor.getDate()}` }
    for (const b of buyers) entry[b] = (byDateBuyer.get(d) || {})[b] || 0
    out.push(entry)
    cursor.setDate(cursor.getDate() + 1)
  }
  return { data: out, buyers: [...buyers] }
}

export function groupByBuyer(rows) {
  const byBuyer = new Map()
  for (const r of rows) {
    const buyer = (r.buyer || 'UNASSIGNED').toString().trim() || 'UNASSIGNED'
    const profit = r.profit_on_sale || 0
    let b = byBuyer.get(buyer)
    if (!b) {
      b = {
        buyer, count: 0, totalProfit: 0, totalSalesPrice: 0,
        wins: 0, losses: 0, winProfit: 0, lossAmount: 0,
        avgDays: 0, _daysSum: 0, _daysN: 0,
      }
      byBuyer.set(buyer, b)
    }
    b.count += 1
    b.totalProfit += profit
    b.totalSalesPrice += r.sales_price || 0
    if (profit > 0) { b.wins += 1; b.winProfit += profit }
    else if (profit < 0) { b.losses += 1; b.lossAmount += profit }
    if (r.days_on_lot != null) { b._daysSum += r.days_on_lot; b._daysN += 1 }
  }
  return [...byBuyer.values()].map((b) => ({
    ...b,
    avgProfit: b.count ? Math.round(b.totalProfit / b.count) : 0,
    avgWinProfit: b.wins ? Math.round(b.winProfit / b.wins) : 0,
    avgLossAmount: b.losses ? Math.round(b.lossAmount / b.losses) : 0,
    pctWinners: b.count ? b.wins / b.count : 0,
    avgDays: b._daysN ? Math.round(b._daysSum / b._daysN) : 0,
  })).sort((a, b) => b.totalProfit - a.totalProfit)
}

function toNumOrNull(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export async function fetchSoldClean() {
  // PostgREST has a default db_max_rows cap (1000 in Supabase). Paginate
  // with .range() to get ALL rows. ~4500 rows = 5 round trips of 1000 each.
  const PAGE_SIZE = 1000
  const all = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('sold_clean')
      .select('stock_number, year, make, model, mileage, sale_date, days_on_lot, original_cost, total_cost, sales_price, profit')
      .order('sale_date', { ascending: false })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
    // Safety: cap at 50k rows in case something goes wrong
    if (from >= 50000) break
  }
  return all.map((r) => ({
    ...r,
    // year, mileage, days_on_lot are postgres `integer` → already JS numbers
    // original_cost, total_cost, sales_price, profit are `numeric` → strings
    original_cost: toNumOrNull(r.original_cost),
    total_cost:    toNumOrNull(r.total_cost),
    sales_price:   toNumOrNull(r.sales_price),
    profit:        toNumOrNull(r.profit),
  }))
}

// Just the last N days of sales, small enough for the dashboard to load on
// every open. fetchSoldClean() pulls all ~6k rows (~1MB) — right for the
// Reports page, far too heavy for the home screen.
//
// Two queries because the data is split: sold_clean has a real YYYY-MM-DD
// sale_date (the raw `sold` table stores it as MM/DD/YY text, which no
// server-side range filter can touch), while added_costs only exists on the raw
// table. So filter on the view, then join the recon money back by stock number.
export async function fetchSoldRecent(days) {
  const cutoff = ymdMinusDays(days)
  const rows = await selectAll(() =>
    supabase
      .from('sold_clean')
      .select('stock_number, sale_date, days_on_lot, total_cost, sales_price, profit')
      .gte('sale_date', cutoff),
  )

  const stocks = [...new Set(rows.map((r) => r.stock_number).filter(Boolean))]
  const added = new Map()
  // Chunked: a few hundred stock numbers in one ?in=(…) makes a URL long enough
  // to get rejected before it reaches Postgres.
  const CHUNK = 150
  const chunks = []
  for (let i = 0; i < stocks.length; i += CHUNK) chunks.push(stocks.slice(i, i + CHUNK))
  const results = await Promise.all(
    chunks.map((c) => supabase.from('sold').select('stock_number, added_costs').in('stock_number', c)),
  )
  for (const { data, error } of results) {
    if (error) continue // recon money is a nice-to-have; never fail the whole box over it
    for (const r of data || []) added.set(r.stock_number, toNumOrNull(r.added_costs))
  }

  return rows.map((r) => ({
    ...r,
    total_cost: toNumOrNull(r.total_cost),
    sales_price: toNumOrNull(r.sales_price),
    profit: toNumOrNull(r.profit),
    days_on_lot: toNumOrNull(r.days_on_lot),
    added_costs: added.get(r.stock_number) ?? null,
  }))
}

// ── Period helpers ──
// Calendar-based periods. MTD/last-month/YTD are self-explanatory; "Last Year
// Next Quarter" maps to the 3 months ahead in the prior year (e.g. in Apr we
// look at last year's May/June/July) so Abdullah can compare his upcoming
// season against what actually happened last year at the same time.
const pad = (n) => String(n).padStart(2, '0')
const startOfMonth = (y, m) => `${y}-${pad(m)}-01`
const endOfMonth = (y, m) => `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}`

function todayLocal() {
  const d = new Date()
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()]
}

function periodRange(key) {
  const [y, m] = todayLocal()
  if (key === 'mtd')        return [startOfMonth(y, m), endOfMonth(y, m)]
  if (key === 'last_month') {
    const ly = m === 1 ? y - 1 : y
    const lm = m === 1 ? 12 : m - 1
    return [startOfMonth(ly, lm), endOfMonth(ly, lm)]
  }
  if (key === 'ytd')        return [`${y}-01-01`, endOfMonth(y, m)]
  if (key === 'last_year_quarter') {
    // Next 3 calendar months of last year (e.g. today=Apr 2026 → May/June/July 2025)
    const ly = y - 1
    const nextM = m === 12 ? 1 : m + 1  // month after this one
    const start = nextM === 11 ? [ly + 1, 1] : (nextM >= 11 ? [ly, nextM] : [ly, nextM])
    const endM = ((nextM + 2 - 1) % 12) + 1
    const endY = nextM + 2 > 12 ? ly + 1 : ly
    return [startOfMonth(start[0], start[1]), endOfMonth(endY, endM)]
  }
  if (key === '90')  return [ymdMinusDays(90), endOfMonth(y, m)]
  return null
}

export const PERIODS = [
  { key: 'mtd',               label: 'MTD' },
  { key: 'last_month',        label: 'Last Month' },
  { key: 'ytd',               label: 'YTD' },
  { key: 'last_year_quarter', label: 'LY Next Quarter' },
  { key: '90',                label: 'Last 90d' },
  { key: 'all',               label: 'All' },
]

// Convert a YYYY-MM-DD string into a date that's safe for cutoff comparison.
// Postgres returns dates as bare YYYY-MM-DD strings; new Date(s) parses them
// as UTC midnight which causes off-by-one errors in non-UTC timezones.
function dateOnlyKey(s) {
  if (!s) return ''
  // Already YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS — slice the date portion.
  return s.slice(0, 10)
}

export function ymdMinusDays(days) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function filterByPeriod(rows, periodKey) {
  if (periodKey === 'all') return rows
  const range = periodRange(periodKey)
  if (!range) return rows
  const [start, end] = range
  return rows.filter((r) => {
    const k = dateOnlyKey(r.sale_date)
    return k && k >= start && k <= end
  })
}

// ── Aggregations ──
export function summarize(rows) {
  if (rows.length === 0) {
    return {
      count: 0, totalProfit: 0, avgProfit: 0, medianProfit: 0,
      pctWinners: 0, pctLosers: 0, avgDays: 0,
    }
  }
  const profits = rows.map((r) => r.profit).filter((p) => p != null).sort((a, b) => a - b)
  const total = profits.reduce((s, p) => s + p, 0)
  const median = profits.length === 0
    ? 0
    : profits.length % 2 === 0
    ? (profits[profits.length / 2 - 1] + profits[profits.length / 2]) / 2
    : profits[Math.floor(profits.length / 2)]
  const winners = rows.filter((r) => r.profit >= 1000).length
  const losers = rows.filter((r) => r.profit < 0).length
  const days = rows.map((r) => r.days_on_lot).filter((d) => d != null)
  const avgDays = days.length ? days.reduce((s, d) => s + d, 0) / days.length : 0
  return {
    count: rows.length,
    totalProfit: total,
    // Divide by non-null profit count, not total row count, so rows with
    // missing profit don't drag the average toward zero.
    avgProfit: profits.length ? total / profits.length : 0,
    medianProfit: median,
    pctWinners: (winners / rows.length) * 100,
    pctLosers: (losers / rows.length) * 100,
    avgDays,
  }
}

export function groupByMonth(rows) {
  const map = new Map()
  for (const r of rows) {
    const k = dateOnlyKey(r.sale_date)
    if (!k) continue
    // YYYY-MM directly from the date string — no timezone conversion needed
    const key = k.slice(0, 7)
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(r)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, items]) => ({ month, ...summarize(items) }))
}

export function groupByDaysOnLot(rows) {
  const buckets = [
    { label: '1-7d',   min: 1,  max: 7,    items: [] },
    { label: '8-14d',  min: 8,  max: 14,   items: [] },
    { label: '15-30d', min: 15, max: 30,   items: [] },
    { label: '31-60d', min: 31, max: 60,   items: [] },
    { label: '61-90d', min: 61, max: 90,   items: [] },
    { label: '90+d',   min: 91, max: 9999, items: [] },
  ]
  for (const r of rows) {
    if (r.days_on_lot == null) continue
    const b = buckets.find((x) => r.days_on_lot >= x.min && r.days_on_lot <= x.max)
    if (b) b.items.push(r)
  }
  return buckets.map((b) => ({ label: b.label, ...summarize(b.items) }))
}

export function groupByMake(rows, minVolume = 10) {
  const map = new Map()
  for (const r of rows) {
    if (!r.make) continue
    const key = r.make
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(r)
  }
  return Array.from(map.entries())
    .filter(([, items]) => items.length >= minVolume)
    .map(([make, items]) => ({ make, ...summarize(items) }))
    .sort((a, b) => b.avgProfit - a.avgProfit)
}

// Group by make+model — for the per-model leaderboard
export function groupByModel(rows, minVolume = 10) {
  const map = new Map()
  for (const r of rows) {
    if (!r.make || !r.model) continue
    const key = `${r.make}|${r.model}`
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(r)
  }
  return Array.from(map.entries())
    .filter(([, items]) => items.length >= minVolume)
    .map(([key, items]) => {
      const [make, model] = key.split('|')
      return { make, model, label: `${make} ${model}`, items, ...summarize(items) }
    })
    .sort((a, b) => b.avgProfit - a.avgProfit)
}

// For a single model, find the ideal year-band × mileage-band combo.
// Returns the BEST spec (highest avg profit, min 3 sales) and a few alternatives.
export function findModelSweetSpot(items) {
  function yb(y) {
    if (y == null) return '?'
    if (y >= 2023) return '2023+'
    if (y >= 2020) return '2020-22'
    if (y >= 2017) return '2017-19'
    if (y >= 2014) return '2014-16'
    if (y >= 2010) return '2010-13'
    return '<2010'
  }
  function mb(m) {
    if (m == null) return '?'
    if (m < 30000) return '<30k'
    if (m < 60000) return '30-60k'
    if (m < 90000) return '60-90k'
    if (m < 120000) return '90-120k'
    if (m < 150000) return '120-150k'
    return '150k+'
  }
  const map = new Map()
  for (const r of items) {
    const key = `${yb(r.year)}|${mb(r.mileage)}`
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(r)
  }
  const combos = Array.from(map.entries())
    .filter(([, list]) => list.length >= 3)  // need at least 3 sales to count
    .map(([key, list]) => {
      const [yearBand, mileBand] = key.split('|')
      return { yearBand, mileBand, ...summarize(list) }
    })
    .sort((a, b) => b.avgProfit - a.avgProfit)
  return combos
}

export function groupByYearBand(rows) {
  const buckets = [
    { label: '2023+',     min: 2023, max: 9999, items: [] },
    { label: '2020-22',   min: 2020, max: 2022, items: [] },
    { label: '2017-19',   min: 2017, max: 2019, items: [] },
    { label: '2014-16',   min: 2014, max: 2016, items: [] },
    { label: '2010-13',   min: 2010, max: 2013, items: [] },
    { label: '<2010',     min: 0,    max: 2009, items: [] },
  ]
  for (const r of rows) {
    if (r.year == null) continue
    const b = buckets.find((x) => r.year >= x.min && r.year <= x.max)
    if (b) b.items.push(r)
  }
  return buckets.map((b) => ({ label: b.label, ...summarize(b.items) })).filter((b) => b.count > 0)
}

export function groupByMileageBand(rows) {
  const buckets = [
    { label: '<30k',     min: 0,      max: 29999,  items: [] },
    { label: '30-60k',   min: 30000,  max: 59999,  items: [] },
    { label: '60-90k',   min: 60000,  max: 89999,  items: [] },
    { label: '90-120k',  min: 90000,  max: 119999, items: [] },
    { label: '120-150k', min: 120000, max: 149999, items: [] },
    { label: '150k+',    min: 150000, max: 9999999, items: [] },
  ]
  for (const r of rows) {
    if (r.mileage == null) continue
    const b = buckets.find((x) => r.mileage >= x.min && r.mileage <= x.max)
    if (b) b.items.push(r)
  }
  return buckets.map((b) => ({ label: b.label, ...summarize(b.items) })).filter((b) => b.count > 0)
}

// Sweet-spot finder: rank year-band × mileage-band combinations by avg profit
export function findSweetSpots(rows, minVolume = 15) {
  function yearBand(y) {
    if (y >= 2023) return '2023+'
    if (y >= 2020) return '2020-22'
    if (y >= 2017) return '2017-19'
    if (y >= 2014) return '2014-16'
    if (y >= 2010) return '2010-13'
    return '<2010'
  }
  function mileBand(m) {
    if (m < 30000) return '<30k'
    if (m < 60000) return '30-60k'
    if (m < 90000) return '60-90k'
    if (m < 120000) return '90-120k'
    if (m < 150000) return '120-150k'
    return '150k+'
  }

  const map = new Map()
  for (const r of rows) {
    if (r.year == null || r.mileage == null) continue
    const key = `${yearBand(r.year)}|${mileBand(r.mileage)}`
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(r)
  }

  return Array.from(map.entries())
    .filter(([, items]) => items.length >= minVolume)
    .map(([key, items]) => {
      const [yb, mb] = key.split('|')
      return { yearBand: yb, mileBand: mb, ...summarize(items) }
    })
    .sort((a, b) => b.avgProfit - a.avgProfit)
}

// ── Format helpers ──
export const fmt = {
  money: (n) => n == null ? '—' : (n < 0 ? `-$${Math.abs(Math.round(n)).toLocaleString()}` : `$${Math.round(n).toLocaleString()}`),
  count: (n) => n == null ? '—' : n.toLocaleString(),
  pct: (n) => n == null ? '—' : `${n.toFixed(0)}%`,
  days: (n) => n == null ? '—' : `${Math.round(n)}d`,
}

// Color a profit value (for chart bars)
export function profitColor(p) {
  if (p == null) return '#64748b'  // slate-500 (no data)
  if (p >= 800) return '#10b981'   // emerald-500
  if (p >= 400) return '#84cc16'   // lime-500
  if (p >= 0)   return '#facc15'   // yellow-400
  if (p >= -400) return '#fb923c'  // orange-400
  return '#ef4444'                 // red-500
}
