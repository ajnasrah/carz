// deno-lint-ignore-file no-explicit-any
// Supabase Edge Function: sycamore-pull
//
// Pulls the partner rooftop's sold book out of Sycamore and POSTs it to
// partner-sold-ingest. Two functions rather than one on purpose: the endpoint
// stays source-agnostic, so a second rooftop on a different DMS — or a Power
// Automate flow, if direct access ever goes away — plugs into the same receiver
// without touching it.
//
// Trigger:
//   POST /functions/v1/sycamore-pull
//   Authorization: Bearer <anon or service-role key>
//   Body (all optional):
//     { "since": "2025-01-01",   // default: SYCAMORE_LOOKBACK_DAYS back
//       "dryRun": true }         // fetch + map + report, write NOTHING
//
// Run `dryRun` first. It returns the mapped rows and a field-coverage count, so
// the mapping can be checked against real data before a single row lands.
//
// Secrets (supabase secrets set ...):
//   SYCAMORE_BASE_URL         — API root, no trailing slash        (required)
//   SYCAMORE_API_KEY          — token / key                        (required)
//   SYCAMORE_AUTH_STYLE       — bearer | header | query   (default: bearer)
//   SYCAMORE_AUTH_HEADER      — header name when style=header (default X-Api-Key)
//   SYCAMORE_SOLD_PATH        — path to the sold report  (default /api/sales)
//   SYCAMORE_DEALERSHIP       — slug written to partner_sold  (default sycamore)
//   SYCAMORE_LOOKBACK_DAYS    — default 900
//   PARTNER_INGEST_URL        — .../functions/v1/partner-sold-ingest (required)
//   PARTNER_INGEST_SECRET     — must match the receiver's           (required)

const BASE_URL = (Deno.env.get('SYCAMORE_BASE_URL') ?? '').replace(/\/+$/, '')
const API_KEY = Deno.env.get('SYCAMORE_API_KEY') ?? ''
const AUTH_STYLE = (Deno.env.get('SYCAMORE_AUTH_STYLE') ?? 'bearer').toLowerCase()
const AUTH_HEADER = Deno.env.get('SYCAMORE_AUTH_HEADER') ?? 'X-Api-Key'
const SOLD_PATH = Deno.env.get('SYCAMORE_SOLD_PATH') ?? '/api/sales'
const DEALERSHIP = Deno.env.get('SYCAMORE_DEALERSHIP') ?? 'sycamore'
const LOOKBACK_DAYS = Number(Deno.env.get('SYCAMORE_LOOKBACK_DAYS') ?? 900)
const INGEST_URL = Deno.env.get('PARTNER_INGEST_URL') ?? ''
const INGEST_SECRET = Deno.env.get('PARTNER_INGEST_SECRET') ?? ''

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status, headers: { 'content-type': 'application/json', ...CORS },
  })

// ════════════════════════════════════════════════════════════════════════════
// THE ADAPTER — the only part that is specific to Sycamore.
//
// Everything below this block is DMS-agnostic. Point `FIELD_MAP` at whatever
// Sycamore actually calls its columns and the rest of the pipeline works
// unchanged. Left-hand side is ours; right-hand side is a list of candidate
// source keys, tried in order, so a rename upstream is one entry rather than a
// debugging session.
//
// Verify with dryRun BEFORE the first real run: `unmapped_source_fields` in the
// response lists every key Sycamore sent that nothing here claims, which is how
// a field we should be reading gets noticed rather than silently dropped.
// ════════════════════════════════════════════════════════════════════════════
const FIELD_MAP: Record<string, string[]> = {
  source_id:     ['dealId', 'deal_id', 'saleId', 'sale_id', 'id'],
  stock_number:  ['stockNumber', 'stock_number', 'stock', 'stockNo'],
  vin:           ['vin', 'VIN', 'vehicleVin', 'vehicle_vin'],
  year:          ['year', 'vehicleYear', 'vehicle_year', 'modelYear'],
  make:          ['make', 'vehicleMake', 'vehicle_make'],
  model:         ['model', 'vehicleModel', 'vehicle_model'],
  trim_level:    ['trim', 'style', 'series'],
  odometer:      ['odometer', 'mileage', 'miles', 'odometerOut'],
  sale_date:     ['saleDate', 'sale_date', 'soldDate', 'dealDate', 'closedDate'],
  purchase_date: ['purchaseDate', 'purchase_date', 'acquiredDate', 'inDate'],
  sale_price:    ['salePrice', 'sale_price', 'sellingPrice', 'price', 'frontGross'],
  total_cost:    ['totalCost', 'total_cost', 'vehicleCost', 'cost'],
  added_costs:   ['reconCost', 'recon_cost', 'addedCosts', 'added_costs', 'reconditioning'],
  net_profit:    ['netProfit', 'net_profit', 'totalGross', 'total_gross', 'profit'],
  days_on_lot:   ['daysOnLot', 'days_on_lot', 'daysInStock', 'age'],
  type_of_sale:  ['saleType', 'sale_type', 'dealType', 'type'],
  buyer:         ['buyerName', 'customerName', 'customer', 'buyer'],
  vendor:        ['vendor', 'source', 'acquiredFrom', 'purchasedFrom'],
}

// Where the rows live in the response, and how to ask for the next page. Both
// are guesses until a dryRun says otherwise — that is exactly what it is for.
const ROWS_AT: string[] = ['data', 'results', 'items', 'sales', 'records', 'value']
const PAGE_SIZE = 500

function authFor(url: URL): HeadersInit {
  const h: Record<string, string> = { accept: 'application/json' }
  if (AUTH_STYLE === 'bearer') h['authorization'] = `Bearer ${API_KEY}`
  else if (AUTH_STYLE === 'header') h[AUTH_HEADER] = API_KEY
  else if (AUTH_STYLE === 'query') url.searchParams.set('api_key', API_KEY)
  return h
}

// The rows, wherever they are. An API that returns a bare array, one that wraps
// it in {data:[...]}, and one that wraps THAT in {data:{items:[...]}} are all
// common enough that guessing once and failing is not worth the round trip.
function rowsFrom(body: any): any[] | null {
  if (Array.isArray(body)) return body
  if (!body || typeof body !== 'object') return null
  for (const k of ROWS_AT) {
    if (Array.isArray(body[k])) return body[k]
    if (body[k] && typeof body[k] === 'object') {
      for (const k2 of ROWS_AT) if (Array.isArray(body[k][k2])) return body[k][k2]
    }
  }
  return null
}

const pick = (row: any, keys: string[]) => {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && row[k] !== '') return row[k]
    // Case-insensitive second pass — DMS exports are inconsistent about it and
    // an exact-match-only lookup silently maps the field to null.
    const hit = Object.keys(row).find((rk) => rk.toLowerCase() === k.toLowerCase())
    if (hit && row[hit] !== undefined && row[hit] !== null && row[hit] !== '') return row[hit]
  }
  return null
}

function mapRow(row: any) {
  const out: Record<string, any> = {}
  for (const [ours, theirs] of Object.entries(FIELD_MAP)) out[ours] = pick(row, theirs)
  return out
}

// ── Fetch ───────────────────────────────────────────────────────────────────
async function fetchSold(since: string) {
  const all: any[] = []
  const seenKeys = new Set<string>()

  for (let page = 1; page <= 200; page++) {
    const url = new URL(BASE_URL + SOLD_PATH)
    url.searchParams.set('from', since)
    url.searchParams.set('to', new Date().toISOString().slice(0, 10))
    url.searchParams.set('page', String(page))
    url.searchParams.set('pageSize', String(PAGE_SIZE))
    const headers = authFor(url)

    const res = await fetch(url.toString(), { headers })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Sycamore ${res.status} on page ${page}: ${text.slice(0, 400)}`)
    }
    const body = await res.json()
    const rows = rowsFrom(body)
    if (rows === null) {
      throw new Error(
        `Could not find the rows in Sycamore's response. Top-level keys: ${
          Object.keys(body ?? {}).join(', ') || '(none)'
        }. Add the right one to ROWS_AT.`)
    }
    if (!rows.length) break
    for (const r of rows) Object.keys(r).forEach((k) => seenKeys.add(k))
    all.push(...rows)
    if (rows.length < PAGE_SIZE) break
  }
  return { rows: all, seenKeys: [...seenKeys] }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const missing = [
    !BASE_URL && 'SYCAMORE_BASE_URL',
    !API_KEY && 'SYCAMORE_API_KEY',
  ].filter(Boolean)
  if (missing.length) return json({ error: `missing secrets: ${missing.join(', ')}` }, 500)

  let body: any = {}
  try { body = await req.json() } catch { /* empty body is fine */ }
  const dryRun = body?.dryRun === true

  const since = String(body?.since ?? '').match(/^\d{4}-\d{2}-\d{2}$/)
    ? body.since
    : new Date(Date.now() - LOOKBACK_DAYS * 86400_000).toISOString().slice(0, 10)

  let fetched
  try {
    fetched = await fetchSold(since)
  } catch (err) {
    return json({ error: 'sycamore fetch failed', detail: String(err) }, 502)
  }

  const mapped = fetched.rows.map(mapRow)

  // What did we NOT read? A field Sycamore sends that no FIELD_MAP entry claims
  // is either genuinely irrelevant or the profit column under a name nobody
  // guessed — and the second one is invisible without this.
  const claimed = new Set(Object.values(FIELD_MAP).flat().map((k) => k.toLowerCase()))
  const unmapped = fetched.seenKeys.filter((k) => !claimed.has(k.toLowerCase()))

  // Coverage per field. A column that came back null on every row is a mapping
  // miss, not an empty column — net_profit at 0% means the list builder would
  // score nothing at all, because cleanBook drops every row without it.
  const coverage: Record<string, number> = {}
  for (const f of Object.keys(FIELD_MAP)) {
    coverage[f] = mapped.filter((m) => m[f] !== null && m[f] !== undefined && m[f] !== '').length
  }

  if (dryRun) {
    return json({
      dryRun: true, since, dealership: DEALERSHIP,
      fetched: fetched.rows.length,
      coverage,
      unmapped_source_fields: unmapped,
      sample_source_row: fetched.rows[0] ?? null,
      sample_mapped_row: mapped[0] ?? null,
      wrote: 'nothing',
    })
  }

  if (!INGEST_URL || !INGEST_SECRET) {
    return json({ error: 'missing secrets: PARTNER_INGEST_URL and/or PARTNER_INGEST_SECRET' }, 500)
  }
  if (!mapped.length) {
    return json({ error: 'Sycamore returned no rows — refusing to replace the book with nothing' }, 400)
  }
  // Without profit there is nothing to score on, and replacing a good book with
  // a profitless one would quietly turn every partner-backed verdict into NO
  // DATA. Refuse rather than write it.
  if (coverage.net_profit === 0) {
    return json({
      error: 'no row carried a profit — the profit field is mapped wrong, and a book without it scores nothing',
      unmapped_source_fields: unmapped,
      sample_source_row: fetched.rows[0] ?? null,
    }, 400)
  }

  // Paged to the receiver. `replace` on the FIRST page only: it clears the old
  // book once, then the remaining pages append to it.
  const CHUNK = 1000
  const results: any[] = []
  for (let i = 0; i < mapped.length; i += CHUNK) {
    const res = await fetch(INGEST_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-partner-secret': INGEST_SECRET },
      body: JSON.stringify({
        dealership: DEALERSHIP,
        replace: i === 0,
        rows: mapped.slice(i, i + CHUNK),
      }),
    })
    const out = await res.json().catch(() => ({ error: 'non-JSON response' }))
    results.push(out)
    if (!res.ok) {
      return json({ error: 'ingest rejected a page', page: i / CHUNK + 1, detail: out }, 502)
    }
  }

  return json({
    success: true, since, dealership: DEALERSHIP,
    fetched: fetched.rows.length,
    written: results.reduce((n, r) => n + (r.written ?? 0), 0),
    coverage,
    unmapped_source_fields: unmapped,
  })
})
