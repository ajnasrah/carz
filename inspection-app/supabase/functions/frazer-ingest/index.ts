// deno-lint-ignore-file no-explicit-any
// Supabase Edge Function: frazer-ingest
// Receives CSV POST from Power Automate (SharePoint "when file is modified" trigger),
// parses it, truncates the target table, and reloads the rows.
//
// Usage:
//   POST /functions/v1/frazer-ingest?target=inventory
//   POST /functions/v1/frazer-ingest?target=sold
//   Headers:
//     Content-Type: text/csv
//     x-frazer-secret: <shared secret stored as Supabase edge secret FRAZER_INGEST_SECRET>
//   Body: the raw CSV content

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const SHARED_SECRET = Deno.env.get('FRAZER_INGEST_SECRET') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// Map CSV header → Postgres column. Lowercase, strip non-alphanumeric, collapse to single underscores.
// The target's columns, fetched once per warm instance. One round trip on a cold
// start, none afterwards — the load should do as little as it possibly can.
const COLUMN_CACHE = new Map<string, any>()
async function columnsFor(supabase: any, target: string) {
  if (COLUMN_CACHE.has(target)) return { data: COLUMN_CACHE.get(target), error: null }
  const r = await supabase.rpc('frazer_target_columns', { p_target: target })
  if (!r.error && Array.isArray(r.data)) COLUMN_CACHE.set(target, r.data)
  return r
}

function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/#/g, 'number')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

// Aliases: CSV column name → canonical Postgres column.
// Fixes common naming drift in Frazer exports.
const COLUMN_ALIASES: Record<string, string> = {
  stock_number: 'stock_number',
  last_6_vin: 'last_6_vin',
  last_six_vin: 'last_6_vin',
  // The sold export writes some headers without separators, which normalise to
  // one run-on word and match no column. An unknown column fails the entire
  // batch, so these are the difference between the first sold sync landing and
  // 500 rows bouncing off a message nobody is watching for.
  daysonlot: 'days_on_lot',
  days_on_lot: 'days_on_lot',
  salesprice: 'sales_price',
  sales_price: 'sales_price',
  netprofit: 'net_profit',
  net_profit: 'net_profit',
  totalcost: 'total_cost',
  addedcosts: 'added_costs',
  saledate: 'sale_date',
  titlein: 'title_in',
  vehiclevin: 'vehicle_vin',
  vehicleyear: 'vehicle_year',
  vehiclemake: 'vehicle_make',
  vehiclemodel: 'vehicle_model',
  vehiclenotes: 'vehicle_notes',
  locationcode: 'location_code',
}

// Simple RFC 4180-ish CSV parser. Handles quoted fields with embedded commas and escaped quotes.
function parseCSV(input: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = []
  let current: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const n = input.length

  while (i < n) {
    const c = input[i]
    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += c
      i++
      continue
    } else {
      if (c === '"') {
        inQuotes = true
        i++
        continue
      }
      if (c === ',') {
        current.push(field)
        field = ''
        i++
        continue
      }
      if (c === '\r') {
        i++
        continue
      }
      if (c === '\n') {
        current.push(field)
        rows.push(current)
        current = []
        field = ''
        i++
        continue
      }
      field += c
      i++
    }
  }
  // Last field / row
  if (field !== '' || current.length > 0) {
    current.push(field)
    rows.push(current)
  }

  if (rows.length === 0) return { headers: [], rows: [] }
  const [headers, ...data] = rows
  return { headers, rows: data.filter((r) => r.some((v) => v && v.length > 0)) }
}

function corsHeaders() {
  const allowed = Deno.env.get('ALLOWED_ORIGIN') || 'https://carz-inspect.vercel.app'
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, x-frazer-secret, authorization',
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() })
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders() })
  }

  const providedSecret = req.headers.get('x-frazer-secret') ?? ''
  if (!SHARED_SECRET || providedSecret !== SHARED_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json', ...corsHeaders() },
    })
  }

  const url = new URL(req.url)
  const target = url.searchParams.get('target') ?? ''
  if (target !== 'inventory' && target !== 'sold') {
    return new Response(
      JSON.stringify({ error: 'target query param must be "inventory" or "sold"' }),
      { status: 400, headers: { 'content-type': 'application/json', ...corsHeaders() } },
    )
  }

  const bodyText = await req.text()
  if (!bodyText.trim()) {
    return new Response(JSON.stringify({ error: 'empty body' }), {
      status: 400,
      headers: { 'content-type': 'application/json', ...corsHeaders() },
    })
  }

  let parsed: { headers: string[]; rows: string[][] }
  try {
    parsed = parseCSV(bodyText)
  } catch (err) {
    return new Response(JSON.stringify({ error: 'csv parse failed', detail: String(err) }), {
      status: 400,
      headers: { 'content-type': 'application/json', ...corsHeaders() },
    })
  }

  if (parsed.headers.length === 0 || parsed.rows.length === 0) {
    return new Response(JSON.stringify({ error: 'no data rows' }), {
      status: 400,
      headers: { 'content-type': 'application/json', ...corsHeaders() },
    })
  }

  // Map headers → Postgres columns
  const cols: string[] = parsed.headers.map((h) => {
    const normalized = normalizeHeader(h)
    return COLUMN_ALIASES[normalized] ?? normalized
  })

  // Build row objects
  const rowObjects = parsed.rows.map((row) => {
    const obj: Record<string, any> = {}
    cols.forEach((col, idx) => {
      if (!col) return                      // header the target has no column for
      const v = row[idx] ?? ''
      obj[col] = v === '' ? null : v
    })
    return obj
  })

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  // Drop headers the target cannot store, rather than failing the whole load.
  //
  // Every header became a key on the row object and one unknown column rejects
  // the entire 500-row batch — so Frazer adding a column to its export silently
  // stopped the sync, with nothing anywhere saying why. Skipped headers come back
  // in the response so a genuinely new column gets noticed instead of guessed at.
  const skipped: string[] = []
  const { data: colRows, error: colErr } = await columnsFor(supabase, target)
  if (!colErr && Array.isArray(colRows) && colRows.length) {
    const known = new Set(colRows.map((r: any) => r.column_name))
    cols.forEach((c, i) => {
      if (!known.has(c)) {
        skipped.push(`${parsed.headers[i]} -> ${c}`)
        cols[i] = ''            // '' is dropped when the row object is built
      }
    })
  }

  // Truncate via RPC (bypasses RLS via service role anyway)
  const { error: truncErr } = await supabase.rpc('frazer_truncate', { target })
  if (truncErr) {
    return new Response(
      JSON.stringify({ error: 'truncate failed', detail: truncErr.message }),
      { status: 500, headers: { 'content-type': 'application/json', ...corsHeaders() } },
    )
  }

  // Insert in chunks of 500 to avoid payload limits
  const CHUNK = 500
  let inserted = 0
  for (let i = 0; i < rowObjects.length; i += CHUNK) {
    const batch = rowObjects.slice(i, i + CHUNK)
    const { error: insErr } = await supabase.from(target).insert(batch)
    if (insErr) {
      return new Response(
        JSON.stringify({
          error: 'insert failed',
          detail: insErr.message,
          inserted_before_error: inserted,
          sample_row: batch[0],
        }),
        { status: 500, headers: { 'content-type': 'application/json', ...corsHeaders() } },
      )
    }
    inserted += batch.length
  }

  return new Response(
    JSON.stringify({
      success: true, target, rows: inserted,
      headers_mapped: cols.filter(Boolean),
      skipped_headers: skipped,
    }),
    { status: 200, headers: { 'content-type': 'application/json', ...corsHeaders() } },
  )
})
