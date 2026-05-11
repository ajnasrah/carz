// Standalone test for soldReports.js date helpers — verifies the timezone fixes.
// Copies the pure functions inline so we don't need to import supabase.

function dateOnlyKey(s) {
  if (!s) return ''
  return s.slice(0, 10)
}

function ymdMinusDays(days) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const PERIODS = [
  { key: '30',  label: 'Last 30d',  days: 30 },
  { key: '90',  label: 'Last 90d',  days: 90 },
  { key: '180', label: 'Last 180d', days: 180 },
  { key: 'ytd', label: 'YTD',       days: null },
  { key: '12m', label: 'Last 12m',  days: 365 },
  { key: 'all', label: 'All',       days: null },
]

function filterByPeriod(rows, periodKey) {
  if (periodKey === 'all') return rows
  if (periodKey === 'ytd') {
    const startOfYear = `${new Date().getFullYear()}-01-01`
    return rows.filter((r) => {
      const k = dateOnlyKey(r.sale_date)
      return k && k >= startOfYear
    })
  }
  const period = PERIODS.find((p) => p.key === periodKey)
  if (!period?.days) return rows
  const cutoff = ymdMinusDays(period.days)
  return rows.filter((r) => {
    const k = dateOnlyKey(r.sale_date)
    return k && k >= cutoff
  })
}

function groupByMonth(rows) {
  const map = new Map()
  for (const r of rows) {
    const k = dateOnlyKey(r.sale_date)
    if (!k) continue
    const key = k.slice(0, 7)
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(r)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, items]) => ({ month, count: items.length }))
}

function summarize(rows) {
  if (rows.length === 0) {
    return { count: 0, totalProfit: 0, avgProfit: 0 }
  }
  const profits = rows.map((r) => r.profit).filter((p) => p != null)
  const total = profits.reduce((s, p) => s + p, 0)
  return {
    count: rows.length,
    totalProfit: total,
    avgProfit: profits.length ? total / profits.length : 0,
  }
}

let passed = 0, failed = 0
function assert(name, cond, detail) {
  if (cond) { console.log(`  ✅ ${name}`); passed++ }
  else      { console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); failed++ }
}

// ─── 1. dateOnlyKey ───
console.log('\n━━━ 1. dateOnlyKey ━━━')
assert('YYYY-MM-DD passes through', dateOnlyKey('2026-04-11') === '2026-04-11')
assert('ISO datetime → date only', dateOnlyKey('2026-04-11T15:30:00Z') === '2026-04-11')
assert('null → empty', dateOnlyKey(null) === '')
assert('undefined → empty', dateOnlyKey(undefined) === '')
assert('empty → empty', dateOnlyKey('') === '')

// ─── 2. ymdMinusDays produces local-timezone YYYY-MM-DD ───
console.log('\n━━━ 2. ymdMinusDays ━━━')
const today = ymdMinusDays(0)
assert('today format YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(today), `got "${today}"`)
const t30 = ymdMinusDays(30)
console.log(`  today: ${today}, 30 days ago: ${t30}`)
assert('30 days ago < today', t30 < today)
const t365 = ymdMinusDays(365)
assert('1 year ago < today by ~365 days', t365 < today)
// Month rollover: 30 days back from any day should land in the previous month or earlier
const todayDate = new Date(today)
const t30Date = new Date(t30)
const diffDays = Math.round((todayDate - t30Date) / (1000 * 60 * 60 * 24))
assert('30 days ago is exactly 30 days back', diffDays === 30, `got ${diffDays}`)

// ─── 3. filterByPeriod — YTD critical bug ───
console.log('\n━━━ 3. filterByPeriod — YTD year boundary ━━━')
const currentYear = new Date().getFullYear()
const rows = [
  { sale_date: `${currentYear - 1}-12-31`, profit: 100 },
  { sale_date: `${currentYear}-01-01`,     profit: 200 },  // ← THIS was excluded by old buggy logic in PST
  { sale_date: `${currentYear}-01-15`,     profit: 300 },
  { sale_date: `${currentYear}-06-15`,     profit: 400 },
  { sale_date: `${currentYear}-12-31`,     profit: 500 },
]
const ytd = filterByPeriod(rows, 'ytd')
console.log(`  YTD returned ${ytd.length} rows out of 5`)
assert('Jan 1 of current year IS included in YTD', ytd.some((r) => r.sale_date === `${currentYear}-01-01`))
assert('Dec 31 of LAST year is NOT in YTD', !ytd.some((r) => r.sale_date === `${currentYear - 1}-12-31`))
assert('Jun 15 of current year IS in YTD', ytd.some((r) => r.sale_date === `${currentYear}-06-15`))

// ─── 4. filterByPeriod — Last N days ───
console.log('\n━━━ 4. filterByPeriod — Last 30 days ━━━')
// Build a row that's exactly 30 days old vs 31 days old
function nDaysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const periodRows = [
  { sale_date: nDaysAgo(0),  profit: 1, label: 'today' },
  { sale_date: nDaysAgo(15), profit: 2, label: '15 ago' },
  { sale_date: nDaysAgo(29), profit: 3, label: '29 ago' },
  { sale_date: nDaysAgo(30), profit: 4, label: '30 ago' },  // boundary — should be INCLUDED
  { sale_date: nDaysAgo(31), profit: 5, label: '31 ago' },  // should be EXCLUDED
  { sale_date: nDaysAgo(90), profit: 6, label: '90 ago' },
]
const last30 = filterByPeriod(periodRows, '30')
console.log(`  Last 30d returned ${last30.length} rows out of 6`)
assert('today is included',     last30.some((r) => r.label === 'today'))
assert('15 days ago included',  last30.some((r) => r.label === '15 ago'))
assert('30 days ago INCLUDED',  last30.some((r) => r.label === '30 ago'))
assert('31 days ago EXCLUDED',  !last30.some((r) => r.label === '31 ago'))
assert('90 days ago EXCLUDED',  !last30.some((r) => r.label === '90 ago'))

// ─── 5. groupByMonth — month boundary ───
console.log('\n━━━ 5. groupByMonth — month boundary ━━━')
const boundaryRows = [
  { sale_date: '2026-03-31', profit: 100 },  // last day of march
  { sale_date: '2026-04-01', profit: 200 },  // first day of april
  { sale_date: '2026-04-30', profit: 300 },  // last day of april — was buggy in PST
  { sale_date: '2026-05-01', profit: 400 },  // first day of may
]
const months = groupByMonth(boundaryRows)
console.log(`  Months found:`, months.map((m) => `${m.month}(${m.count})`).join(' '))
assert('March bucket exists with 1 row',  months.find((m) => m.month === '2026-03')?.count === 1)
assert('April bucket exists with 2 rows', months.find((m) => m.month === '2026-04')?.count === 2)
assert('May bucket exists with 1 row',    months.find((m) => m.month === '2026-05')?.count === 1)
assert('months sorted ASC', months.map((m) => m.month).join(',') === '2026-03,2026-04,2026-05')

// ─── 6. summarize — divide by profits not rows ───
console.log('\n━━━ 6. summarize — null profit handling ━━━')
const mixedRows = [
  { profit: 100 },
  { profit: 200 },
  { profit: null },  // null — should be excluded from avg calc
  { profit: 300 },
]
const stats = summarize(mixedRows)
assert('count is total rows (4)', stats.count === 4)
assert('totalProfit is sum of non-null (600)', stats.totalProfit === 600)
assert('avgProfit divides by non-null count (200, not 150)', stats.avgProfit === 200,
  `got ${stats.avgProfit}`)

// ─── 7. all empty edge cases ───
console.log('\n━━━ 7. Empty inputs ━━━')
const empty = summarize([])
assert('empty rows: count=0',         empty.count === 0)
assert('empty rows: totalProfit=0',   empty.totalProfit === 0)
assert('empty rows: avgProfit=0',     empty.avgProfit === 0)
const emptyMonths = groupByMonth([])
assert('empty groupByMonth returns []', emptyMonths.length === 0)
const emptyFilter = filterByPeriod([], 'ytd')
assert('empty filterByPeriod returns []', emptyFilter.length === 0)

// ─── 8. NUMERIC-as-string coercion (the PostgREST bug) ───
console.log('\n━━━ 8. Postgres NUMERIC → JS string coercion ━━━')
function toNumOrNull(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
function coerce(rows) {
  return rows.map((r) => ({
    ...r,
    profit: toNumOrNull(r.profit),
  }))
}
// Simulate what Supabase ACTUALLY returns: numeric as string
const stringProfits = [
  { profit: '1456' },
  { profit: '1858' },
  { profit: '-680' },
  { profit: '500' },
  { profit: '300' },
]
// WITHOUT coercion — broken behavior
const broken = stringProfits.reduce((s, r) => s + r.profit, 0)
console.log(`  WITHOUT coerce: reduce sum = ${JSON.stringify(broken)} (should be 3434)`)
assert('broken sum is string concat', typeof broken === 'string' && broken === '014561858-680500300')
// WITH coercion — correct behavior
const fixed = coerce(stringProfits)
const correct = fixed.reduce((s, r) => s + r.profit, 0)
console.log(`  WITH coerce: reduce sum = ${correct}`)
assert('coerced sum = 3434 (number)', correct === 3434 && typeof correct === 'number')

// Avg profit: same issue
const brokenAvg = broken / 5  // string / number → NaN
assert('broken avg is NaN', Number.isNaN(brokenAvg))
const correctAvg = correct / 5
assert('correct avg = 686.8', correctAvg === 686.8)

// Run the full summarize with string-input rows to confirm coerce-then-summarize works
const rowsViaCoerce = coerce(stringProfits)
const fullStats = summarize(rowsViaCoerce)
assert('summarize after coerce: count=5',           fullStats.count === 5)
assert('summarize after coerce: totalProfit=3434',  fullStats.totalProfit === 3434)
assert('summarize after coerce: avgProfit=686.8',   fullStats.avgProfit === 686.8)

// Edge cases for toNumOrNull
assert('toNumOrNull("1456") = 1456',     toNumOrNull('1456') === 1456)
assert('toNumOrNull("-680") = -680',     toNumOrNull('-680') === -680)
assert('toNumOrNull("0") = 0',           toNumOrNull('0') === 0)
assert('toNumOrNull("1456.50") = 1456.5',toNumOrNull('1456.50') === 1456.5)
assert('toNumOrNull(null) = null',       toNumOrNull(null) === null)
assert('toNumOrNull(undefined) = null',  toNumOrNull(undefined) === null)
assert('toNumOrNull("") = null',         toNumOrNull('') === null)
assert('toNumOrNull("abc") = null',      toNumOrNull('abc') === null)
assert('toNumOrNull(0) = 0',             toNumOrNull(0) === 0)  // already a number

// ─── SUMMARY ───
console.log('\n' + '═'.repeat(60))
console.log(`  ${passed} passed · ${failed} failed`)
console.log('═'.repeat(60))
process.exit(failed > 0 ? 1 : 0)
