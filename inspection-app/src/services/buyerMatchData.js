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
export const fetchSoldSales = () =>
  fetchAll('sa_sold_sales', 'vin,year,make,model,odometer,segment,sale_date,sale_price,buyer_name,buyer_email,buyer_phone,buyer_state', 'sale_date')

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

// Persist computed recommendations (cache). Optional — the page also computes live.
export async function saveRecommendations(results) {
  await supabase.from('sa_recommendations').delete().neq('active_vin', '')
  const rows = results.flatMap((res) =>
    res.recommendations.map((rec) => ({
      active_vin: res.vin, rank: rec.rank, buyer_name: rec.buyer_name,
      buyer_email: rec.buyer_email, buyer_phone: rec.buyer_phone, buyer_state: rec.buyer_state,
      predicted_price: rec.predicted_price, score: rec.score, confidence: rec.confidence, reason: rec.reason,
    }))
  )
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('sa_recommendations').upsert(rows.slice(i, i + 500))
    if (error) throw error
  }
  return rows.length
}
