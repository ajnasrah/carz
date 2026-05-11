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
  const cols = parsed.headers.map((h) => {
    const normalized = normalizeHeader(h)
    return COLUMN_ALIASES[normalized] ?? normalized
  })

  // Build row objects
  const rowObjects = parsed.rows.map((row) => {
    const obj: Record<string, any> = {}
    cols.forEach((col, idx) => {
      const v = row[idx] ?? ''
      obj[col] = v === '' ? null : v
    })
    return obj
  })

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

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
    JSON.stringify({ success: true, target, rows: inserted, headers_mapped: cols }),
    { status: 200, headers: { 'content-type': 'application/json', ...corsHeaders() } },
  )
})
