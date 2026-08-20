// Data layer for the Buyer-Match engine: CSV parsing (SmartAuction "Inventory Results"
// exports), Supabase load/save, and column mapping. Doubles as the manual ingest path
// until the Chrome extension auto-scrape is wired up.
import { supabase } from './supabase'
import { segment } from './buyerMatch'

// ── Robust CSV parser (handles quoted fields, embedded commas/JSON, CRLF) ──
export function parseCSV(text) {
  const rows = []
  let i = 0, field = '', row = [], q = false
  const pushF = () => { row.push(field); field = '' }
  const pushR = () => { rows.push(row); row = [] }
  while (i < text.length) {
    const c = text[i]
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else q = false }
      else field += c
    } else {
      if (c === '"') q = true
      else if (c === ',') pushF()
      else if (c === '\n') { pushF(); pushR() }
      else if (c === '\r') { /* skip */ }
      else field += c
    }
    i++
  }
  if (field.length || row.length) { pushF(); pushR() }
  const header = rows.shift() || []
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, j) => [h.trim(), r[j]])))
}

const int = (x) => { const n = parseInt(String(x ?? '').replace(/[^0-9-]/g, ''), 10); return Number.isFinite(n) ? n : null }
const dec = (x) => { const n = parseFloat(String(x ?? '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? n : null }
// MM/DD/YYYY → ISO; SmartAuction uses MM/DD/YYYY in sold exports
const toIso = (s) => {
  if (!s) return null
  const p = String(s).split('/')
  if (p.length !== 3) return null
  const [m, d, y] = p
  return `${y.length === 2 ? '20' + y : y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

// ── Map SmartAuction CSV rows → our table shapes ──
export function mapActiveRow(r) {
  return {
    vin: r.VIN, year: int(r.Year), make: r.Make, model: r.Model, trim: r.Trim,
    drivetrain: r.Drivetrain, odometer: int(r.Odometer), color: r['Short Color'],
    segment: segment(r.Make, r.Model),
    buy_now: dec(r['Buy Now']), opening_price: dec(r['Opening Price']),
    location: r.Location, detail_url: r['Vehicle Detail Page'],
  }
}

export function mapSoldRow(r) {
  return {
    vin: r.VIN, year: int(r.Year), make: r.Make, model: r.Model, trim: r.Trim,
    drivetrain: r.Drivetrain, odometer: int(r.Odometer), color: r['Short Color'],
    segment: segment(r.Make, r.Model),
    sale_date: toIso(r['Sale Date']), sale_price: dec(r['Sale Price']),
    buyer_name: (r['Buyer Name'] || '').trim(),
    buyer_email: r['Buyer Email'], buyer_phone: r['Buyer Phone'],
    buyer_city: r['Buyer City'], buyer_state: r['Buyer State'], buyer_zip: r['Buyer Zip'],
    seller: r.Seller, source: 'smartauction',
  }
}

// ── Supabase load (paginated) ──
async function fetchAll(table, columns, order) {
  const PAGE = 1000
  const all = []
  let from = 0
  while (true) {
    let qb = supabase.from(table).select(columns).range(from, from + PAGE - 1)
    if (order) qb = qb.order(order, { ascending: false })
    const { data, error } = await qb
    if (error) throw error
    if (!data?.length) break
    all.push(...data)
    if (data.length < PAGE) break
    from += PAGE
    if (from >= 100000) break
  }
  return all
}

export const fetchActiveCars = () =>
  fetchAll('sa_active_cars', 'vin,year,make,model,trim,odometer,color,segment,buy_now,opening_price,location,detail_url,uploaded_at')

// The car universe, decided by the database rather than reassembled here.
//
// This used to merge marketplace_listings() with sa_active_cars in the client and
// then drop any VIN that appeared in the sold history — and the API did the same
// thing in its own slightly different copy. Both were wrong in the same way: a
// car we sold and bought back is not sold, and seven of the cars on the lot had
// been re-acquired since their last sale. buyer_match_cars() applies the real
// test (last sale after last purchase) in one place.
export async function fetchSellableCars() {
  const { data, error } = await supabase.rpc('buyer_match_cars')
  if (error) throw error
  return (data || []).map((c) => ({
    ...c,
    buy_now: c.buy_now == null ? null : Number(c.buy_now),
    opening_price: c.opening_price == null ? null : Number(c.opening_price),
  }))
}

// Why a car is not in the list. Shown on the page so "where did that one go" has
// an answer that is not "read the SQL".
export async function fetchExcludedCars() {
  const { data, error } = await supabase.rpc('buyer_match_excluded')
  if (error) return []
  return data || []
}

// Training data for the engine: every channel we sell through, not just
// SmartAuction. Staff-only at the database, and the caller falls back to the
// SmartAuction-only table when the function is missing or the user is a buyer.
//
// MUST be paged. PostgREST caps an unbounded result at 1,000 rows and applies
// that to RPCs too, and the union returns SmartAuction first — so a single
// unpaged call came back with 1,000 rows that were 100% SmartAuction, no error,
// and the page cheerfully reported "1,000 sales" against a real 6,188. The Range
// header does not help either; PostgREST ignores it on an RPC POST. Paging is
// therefore done with the function's own p_limit / p_offset arguments, which it
// orders deterministically.
const TRAINING_PAGE = 1000

export async function fetchTrainingRows() {
  const all = []
  for (let offset = 0; ; offset += TRAINING_PAGE) {
    const { data, error } = await supabase.rpc('buyer_training_rows', {
      p_include_arbitration: false, p_limit: TRAINING_PAGE, p_offset: offset,
    })
    if (error) throw error
    const rows = data || []
    all.push(...rows)
    if (rows.length < TRAINING_PAGE) break
    // A function that ignored the arguments would loop for ever returning the
    // same page; stop well before that becomes a hung browser tab.
    if (offset > 200000) break
  }

  // Prove we got everything. Training on a truncated set is the failure this
  // whole function exists to prevent, and it is invisible without a check.
  const { data: expected, error: countErr } = await supabase.rpc('buyer_training_count', {
    p_include_arbitration: false,
  })
  if (!countErr && Number(expected) > 0 && all.length < Number(expected)) {
    throw new Error(
      `training data truncated: got ${all.length} of ${expected} sales. ` +
      'The engine would have trained on part of the book.',
    )
  }
  return all
}

export const fetchSoldSales = () =>
  fetchAll('sa_sold_sales', 'vin,year,make,model,odometer,segment,sale_date,sale_price,buyer_name,buyer_email,buyer_phone,buyer_state', 'sale_date')

// What each known buyer has been browsing. Empty (not fatal) before the events
// table has anything in it, or for a user who may not read it.
export async function fetchDemandSignals(days = 60) {
  const { data, error } = await supabase.rpc('buyer_demand_signals', { p_days: days })
  if (error) return []
  // Same 1,000-row cap applies. This is one row per (buyer, make, model) over the
  // window, so it is small today — say so rather than let it silently truncate
  // once the marketplace has real traffic.
  if ((data || []).length >= 1000) {
    console.warn('buyer_demand_signals hit the 1,000-row cap; it needs paging like buyer_training_rows')
  }
  return data || []
}

export async function fetchTrainingStats() {
  const { data, error } = await supabase.rpc('buyer_training_stats')
  if (error) return []
  return data || []
}

// Dedupe by a key — PostgREST upsert can't touch the same conflict key twice in one command,
// and a single SmartAuction export can list the same VIN more than once.
function dedupeByKey(rows, key) {
  const seen = new Map()
  for (const r of rows) seen.set(r[key], r)  // later row wins
  return [...seen.values()]
}

// ── Supabase save ──
// Sold: UPSERT by VIN (training data accumulates). Dedupes within the upload, keeping newest sale.
export async function saveSold(rows) {
  const valid = dedupeByKey(
    rows.filter((r) => r.vin && r.buyer_name)
      .sort((a, b) => String(a.sale_date || '').localeCompare(String(b.sale_date || ''))),  // oldest→newest
    'vin'
  )
  for (let i = 0; i < valid.length; i += 500) {
    const { error } = await supabase.from('sa_sold_sales').upsert(valid.slice(i, i + 500), { onConflict: 'vin' })
    if (error) throw error
  }
  return valid.length
}

// Active: REPLACE the current list (delete-all then insert). Active inventory is a snapshot.
export async function saveActive(rows) {
  const valid = dedupeByKey(rows.filter((r) => r.vin), 'vin')
  const { error: delErr } = await supabase.from('sa_active_cars').delete().neq('vin', '')
  if (delErr) throw delErr
  for (let i = 0; i < valid.length; i += 500) {
    const { error } = await supabase.from('sa_active_cars').upsert(valid.slice(i, i + 500), { onConflict: 'vin' })
    if (error) throw error
  }
  return valid.length
}

// Persist computed recommendations.
//
// Two destinations, on purpose. sa_recommendations is the live cache — current
// picks, replaced each run — and recommendation_history is the append-only
// record, one row per (car, buyer, day), which is the only thing that can ever
// answer "were last month's picks any good". recommendation_scorecard() reads it.
//
// This used to be called behind `.catch(() => {})` in three places, so it had
// been failing silently for months and sa_recommendations held zero rows. It
// throws now, and the caller reports it.
export async function saveRecommendations(results) {
  const rows = results.flatMap((res) =>
    [...res.recommendations, ...(res.channels || [])].map((rec) => ({
      active_vin: res.vin, stock_number: res.stock_number ?? null,
      rank: rec.rank, buyer_key: rec.buyer_key, buyer_name: rec.buyer_name,
      buyer_email: rec.buyer_email, buyer_phone: rec.buyer_phone, buyer_state: rec.buyer_state,
      channel_key: rec.channel_key,
      predicted_price: rec.predicted_price, score: rec.score,
      confidence: rec.confidence, reason: rec.reason,
    }))
  )
  if (!rows.length) return 0

  // The history first: it is the part that cannot be recomputed later.
  const { error: histErr } = await supabase.rpc('save_recommendations', {
    p_rows: rows.map((r) => ({
      vin: r.active_vin, stock_number: r.stock_number, rank: r.rank,
      buyer_key: r.buyer_key, buyer_name: r.buyer_name, channel_key: r.channel_key,
      predicted_price: r.predicted_price, score: r.score, confidence: r.confidence,
    })),
  })
  if (histErr) throw new Error(`recommendation history: ${histErr.message}`)

  await supabase.from('sa_recommendations').delete().neq('active_vin', '')
  for (let i = 0; i < rows.length; i += 500) {
    // (active_vin, rank) is unique, and a car has a rank-1 named buyer AND a
    // rank-1 lane, so the two lists cannot share the cache table's key space.
    const batch = rows.slice(i, i + 500)
      .filter((r) => r.buyer_key && !String(r.buyer_key).startsWith('c:'))
    if (!batch.length) continue
    const { error } = await supabase.from('sa_recommendations')
      .upsert(batch, { onConflict: 'active_vin,rank' })
    if (error) throw error
  }
  return rows.length
}
