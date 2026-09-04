// deno-lint-ignore-file no-explicit-any
// Supabase Edge Function: partner-sold-ingest
//
// The endpoint a partner rooftop's puller POSTs its sold book to. Unlike
// frazer-ingest (which takes Frazer's CSV verbatim from Power Automate and
// truncates the table), this takes NORMALISED JSON and upserts — because the
// caller here is a cloud function we control, and a run that dies halfway
// should leave the previous book intact rather than empty.
//
//   POST /functions/v1/partner-sold-ingest
//   Headers:
//     content-type: application/json
//     x-partner-secret: <edge secret PARTNER_INGEST_SECRET>
//   Body:
//     { "dealership": "sycamore",
//       "replace": false,            // true = this payload IS the whole book
//       "rows": [ { ...see FIELDS... } ] }
//
// Send it in pages. `replace: true` on the FIRST page only, then false for the
// rest — that clears the old book once and appends the rest of a multi-page run.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const SHARED_SECRET = Deno.env.get('PARTNER_INGEST_SECRET') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// 'carz' is loaded by frazer-ingest into `sold`. Accepting it here would put our
// own cars in the partner table and double-count every cohort in the list
// builder, which reads both.
const RESERVED = new Set(['carz', 'carzinc', 'carz_inc'])

function corsHeaders() {
  const allowed = Deno.env.get('ALLOWED_ORIGIN') || '*'
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, x-partner-secret, authorization',
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders() },
  })

// ── Coercion ────────────────────────────────────────────────────────────────
// The puller normalises names; this normalises TYPES, because a DMS export will
// hand you "$12,450.00", "12450", 12450 and "" for the same field and Postgres
// rejects three of them.
const num = (x: any): number | null => {
  if (x === null || x === undefined || x === '') return null
  const n = typeof x === 'number' ? x : parseFloat(String(x).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}
const int = (x: any): number | null => {
  const n = num(x)
  return n === null ? null : Math.round(n)
}
const str = (x: any): string | null => {
  const s = String(x ?? '').trim()
  return s === '' ? null : s
}

// Dates arrive as ISO, M/D/YY, or an Excel-ish serial. Anything unparseable
// becomes null rather than throwing — a sale with no date still carries a
// profit, and the scoring only uses the date for the book's range display.
function isoDate(v: any): string | null {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  const s = String(v).trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (m) {
    const yy = m[3].length === 2 ? `20${m[3]}` : m[3]
    return `${yy}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  }
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

// The VIN is the join key into the run list, so a malformed one is worse than a
// missing one — a 16-char typo matches nothing but still looks like evidence.
const vin17 = (x: any): string | null => {
  const v = String(x ?? '').trim().toUpperCase().replace(/[^0-9A-Z]/g, '')
  return v.length === 17 ? v : null
}

function mapRow(dealership: string, r: any) {
  const vin = vin17(r.vin ?? r.vehicle_vin ?? r.VIN)
  const saleDate = isoDate(r.sale_date ?? r.saleDate ?? r.sold_date)

  // Every row needs a stable identity or the upsert turns into an append and the
  // book grows by its own size every run. Prefer the DMS's own id; fall back to
  // the only other thing that is unique per deal.
  const sourceId = str(r.source_id ?? r.deal_id ?? r.dealId ?? r.id)
    ?? (vin ? `${vin}:${saleDate ?? ''}` : null)

  if (!sourceId) return null

  return {
    dealership,
    source_id: sourceId,
    stock_number: str(r.stock_number ?? r.stockNumber ?? r.stock),
    vin,
    year: int(r.year ?? r.vehicle_year),
    make: str(r.make ?? r.vehicle_make),
    model: str(r.model ?? r.vehicle_model),
    trim_level: str(r.trim_level ?? r.trim ?? r.style),
    odometer: int(r.odometer ?? r.mileage ?? r.miles),
    sale_date: saleDate,
    purchase_date: isoDate(r.purchase_date ?? r.purchaseDate),
    sale_price: num(r.sale_price ?? r.sales_price ?? r.price),
    total_cost: num(r.total_cost ?? r.totalCost),
    added_costs: num(r.added_costs ?? r.addedCosts ?? r.recon),
    net_profit: num(r.net_profit ?? r.netProfit ?? r.profit ?? r.profit_on_sale),
    days_on_lot: int(r.days_on_lot ?? r.daysOnLot ?? r.dol),
    type_of_sale: str(r.type_of_sale ?? r.typeOfSale ?? r.sale_type),
    buyer: str(r.buyer ?? r.customer),
    vendor: str(r.vendor ?? r.source),
    raw: r,
    // Refreshed on every upsert. Without it a row keeps its first-seen time
    // and "when did this book last update" has no answer.
    synced_at: new Date().toISOString(),
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const provided = req.headers.get('x-partner-secret') ?? ''
  if (!SHARED_SECRET || provided !== SHARED_SECRET) {
    // Drain first. Answering without consuming leaves the caller still sending,
    // and on a multi-MB body a wrong secret reads as a hang rather than a 401.
    try { await req.arrayBuffer() } catch { /* caller already gone */ }
    return json({ error: 'Unauthorized' }, 401)
  }

  let body: any
  try {
    body = await req.json()
  } catch (err) {
    return json({ error: 'body must be JSON', detail: String(err) }, 400)
  }

  const dealership = String(body?.dealership ?? '').trim().toLowerCase()
  if (!dealership) return json({ error: 'dealership is required' }, 400)
  if (RESERVED.has(dealership)) {
    return json({ error: `"${dealership}" is our own book — it loads through frazer-ingest into \`sold\`` }, 400)
  }
  if (!/^[a-z0-9_-]{2,40}$/.test(dealership)) {
    return json({ error: 'dealership must be a short slug: a-z, 0-9, _ and -' }, 400)
  }

  const rows = body?.rows
  if (!Array.isArray(rows) || rows.length === 0) return json({ error: 'rows must be a non-empty array' }, 400)

  const mapped: any[] = []
  let skippedNoId = 0
  for (const r of rows) {
    const m = mapRow(dealership, r)
    if (m) mapped.push(m); else skippedNoId++
  }
  if (!mapped.length) {
    return json({ error: 'no usable rows — every row lacked both a source id and a valid 17-char VIN' }, 400)
  }

  // A page can repeat a key within itself (two rows for the same deal). Postgres
  // rejects the WHOLE batch with "cannot affect row a second time" if it does,
  // so collapse to the last occurrence before sending. Last wins: a corrected
  // row is expected to come after the one it corrects.
  const byKey = new Map<string, any>()
  for (const m of mapped) byKey.set(m.source_id, m)
  const deduped = [...byKey.values()]
  const dupesInPayload = mapped.length - deduped.length

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  let cleared: number | null = null
  if (body?.replace === true) {
    const { data, error } = await supabase.rpc('partner_sold_truncate', { p_dealership: dealership })
    if (error) return json({ error: 'clear failed', detail: error.message }, 500)
    cleared = typeof data === 'number' ? data : null
  }

  const CHUNK = 500
  let written = 0
  for (let i = 0; i < deduped.length; i += CHUNK) {
    const batch = deduped.slice(i, i + CHUNK)
    const { error } = await supabase
      .from('partner_sold')
      .upsert(batch, { onConflict: 'dealership,source_id' })
    if (error) {
      return json({
        error: 'upsert failed',
        detail: error.message,
        written_before_error: written,
        sample_row: batch[0],
      }, 500)
    }
    written += batch.length
  }

  return json({
    success: true,
    dealership,
    received: rows.length,
    written,
    cleared,
    skipped_no_id: skippedNoId,
    duplicate_keys_in_payload: dupesInPayload,
  })
})
