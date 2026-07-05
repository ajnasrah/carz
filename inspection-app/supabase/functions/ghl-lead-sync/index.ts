// deno-lint-ignore-file no-explicit-any
// Supabase Edge Function: ghl-lead-sync
// Aggregates every distinct buyer out of sa_sold_sales, upserts them into the
// sa_buyers registry, then POSTs each brand-new (never-contacted) buyer to a
// GoHighLevel inbound webhook so GHL creates the Contact + Opportunity.
//
// Idempotent: a buyer already synced (ghl_synced_at set) or seeded from an
// existing GHL opportunity (contacted=true) is never pushed again. Safe to call
// after every upload AND on a cron sweep.
//
// Trigger:
//   POST /functions/v1/ghl-lead-sync        (body ignored; empty {} is fine)
//   Authorization: Bearer <anon or service-role key>
//
// Secrets (supabase secrets set ...):
//   GHL_WEBHOOK_URL           — the GHL inbound-webhook trigger URL (required)
//   SUPABASE_URL              — provided by the platform
//   SUPABASE_SERVICE_ROLE_KEY — provided by the platform
//   GHL_PIPELINE / GHL_STAGE  — optional; echoed in payload for the GHL workflow

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const GHL_WEBHOOK_URL = Deno.env.get('GHL_WEBHOOK_URL') ?? ''
const GHL_PIPELINE = Deno.env.get('GHL_PIPELINE') ?? ''
const GHL_STAGE = Deno.env.get('GHL_STAGE') ?? ''
const SOURCE_TAG = 'SmartAuction Buyer Match'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// ── Identity normalization — MUST match src/services/ghlSync.js (seed importer) ──
function normPhone(p: any): string | null {
  const d = String(p ?? '').replace(/\D/g, '')
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d
  return ten.length === 10 ? ten : null
}
function normEmail(e: any): string | null {
  const s = String(e ?? '').trim().toLowerCase()
  return s.includes('@') && s.length > 3 ? s : null
}
function normName(n: any): string | null {
  const s = String(n ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  return s.length ? s : null
}
// Priority: phone → email → name. Prefix keeps the identity spaces disjoint.
function buyerKey(phone: string | null, email: string | null, name: string | null): string | null {
  if (phone) return `p:${phone}`
  if (email) return `e:${email}`
  if (name) return `n:${name}`
  return null
}

// ── Load every sold row (paginate past PostgREST's 1000-row cap) ──
async function fetchAllSold(sb: any): Promise<any[]> {
  const PAGE = 1000
  const all: any[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('sa_sold_sales')
      .select('vin,year,make,model,segment,sale_date,sale_price,buyer_name,buyer_email,buyer_phone,buyer_city,buyer_state,buyer_zip')
      .order('sale_date', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`fetch sold: ${error.message}`)
    if (!data?.length) break
    all.push(...data)
    if (data.length < PAGE) break
  }
  return all
}

// ── Aggregate sold rows → one profile per unique buyer ──
function aggregateBuyers(rows: any[]) {
  const map = new Map<string, any>()
  for (const r of rows) {
    const phone = normPhone(r.buyer_phone)
    const email = normEmail(r.buyer_email)
    const name = normName(r.buyer_name)
    const key = buyerKey(phone, email, name)
    if (!key) continue

    let b = map.get(key)
    if (!b) {
      b = {
        buyer_key: key, buyer_name: (r.buyer_name || '').trim(),
        phone: r.buyer_phone || null, email: r.buyer_email || null,
        city: r.buyer_city || null, state: r.buyer_state || null, zip: r.buyer_zip || null,
        _vins: new Set<string>(), _priceSum: 0, _priceN: 0,
        last_sale_date: null as string | null, last_vehicle: null as string | null,
        _seg: new Map<string, number>(),
      }
      map.set(key, b)
    }
    // Fill missing contact fields as we see them.
    if (!b.phone && r.buyer_phone) b.phone = r.buyer_phone
    if (!b.email && r.buyer_email) b.email = r.buyer_email
    if (!b.city && r.buyer_city) b.city = r.buyer_city
    if (!b.state && r.buyer_state) b.state = r.buyer_state
    if (!b.zip && r.buyer_zip) b.zip = r.buyer_zip

    if (r.vin) b._vins.add(r.vin)
    const price = Number(r.sale_price)
    if (Number.isFinite(price) && price > 0) { b._priceSum += price; b._priceN++ }
    if (r.segment) b._seg.set(r.segment, (b._seg.get(r.segment) || 0) + 1)
    // rows are sorted asc, so the last one we touch is the newest sale
    if (r.sale_date) {
      b.last_sale_date = r.sale_date
      b.last_vehicle = [r.year, r.make, r.model].filter(Boolean).join(' ') || b.last_vehicle
    }
  }

  return [...map.values()].map((b) => {
    let topSeg: string | null = null, topN = 0
    for (const [seg, n] of b._seg) if (n > topN) { topN = n; topSeg = seg }
    return {
      buyer_key: b.buyer_key, buyer_name: b.buyer_name,
      phone: b.phone, email: b.email, city: b.city, state: b.state, zip: b.zip,
      cars_bought: b._vins.size,
      avg_price: b._priceN ? Math.round(b._priceSum / b._priceN) : null,
      last_sale_date: b.last_sale_date, last_vehicle: b.last_vehicle, top_segment: topSeg,
    }
  })
}

// ── Build the GHL webhook payload for one buyer (phone prioritized) ──
function ghlPayload(b: any) {
  const parts = (b.buyer_name || '').trim().split(/\s+/)
  const payload: Record<string, any> = {
    name: b.buyer_name || undefined,
    first_name: parts[0] || undefined,
    last_name: parts.length > 1 ? parts.slice(1).join(' ') : undefined,
    phone: b.phone || undefined,       // priority channel
    email: b.email || undefined,
    city: b.city || undefined,
    state: b.state || undefined,
    postal_code: b.zip || undefined,
    source: SOURCE_TAG,
    tags: ['auction-buyer', 'smartauction'],
    // rich context for the GHL workflow / opportunity
    cars_bought: b.cars_bought,
    avg_price: b.avg_price,
    last_sale_date: b.last_sale_date,
    last_vehicle: b.last_vehicle,
    top_segment: b.top_segment,
  }
  if (GHL_PIPELINE) payload.pipeline = GHL_PIPELINE
  if (GHL_STAGE) payload.stage = GHL_STAGE
  // strip undefined so GHL field mapping stays clean
  for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k]
  return payload
}

async function postToGHL(b: any): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const res = await fetch(GHL_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ghlPayload(b)),
    })
    if (!res.ok) return { ok: false, error: `${res.status} ${(await res.text()).slice(0, 200)}` }
    // GHL inbound webhooks usually return {} or the contact; capture an id if present.
    let id: string | undefined
    try { const j = await res.json(); id = j?.contact?.id || j?.id || j?.contactId } catch { /* non-JSON ok */ }
    return { ok: true, id }
  } catch (e) {
    return { ok: false, error: String((e as Error).message || e) }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  if (!GHL_WEBHOOK_URL) return json({ error: 'GHL_WEBHOOK_URL not configured' }, 500)

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  try {
    // 1. Aggregate buyers from sold history.
    const sold = await fetchAllSold(sb)
    const buyers = aggregateBuyers(sold)

    // 2. Refresh profile columns for every buyer WITHOUT clobbering sync state.
    //    (contacted / ghl_synced_at / ghl_contact_id are omitted, so on-conflict
    //     leaves them untouched; new rows get the table defaults.)
    for (let i = 0; i < buyers.length; i += 500) {
      const batch = buyers.slice(i, i + 500).map((b) => ({ ...b, updated_at: new Date().toISOString() }))
      const { error } = await sb.from('sa_buyers').upsert(batch, { onConflict: 'buyer_key' })
      if (error) throw new Error(`upsert buyers: ${error.message}`)
    }

    // 3. Candidates: never contacted, never synced, reachable by phone or email.
    const { data: candidates, error: cErr } = await sb
      .from('sa_buyers')
      .select('*')
      .is('ghl_synced_at', null)
      .eq('contacted', false)
      .or('phone.not.is.null,email.not.is.null')
    if (cErr) throw new Error(`load candidates: ${cErr.message}`)

    // 4. Push each to GHL, record the outcome.
    let pushed = 0, failed = 0
    for (const b of candidates ?? []) {
      const r = await postToGHL(b)
      if (r.ok) {
        pushed++
        await sb.from('sa_buyers').update({
          contacted: true, ghl_synced_at: new Date().toISOString(),
          ghl_source: 'sync', ghl_contact_id: r.id ?? null, sync_error: null,
        }).eq('buyer_key', b.buyer_key)
      } else {
        failed++
        await sb.from('sa_buyers').update({ sync_error: r.error ?? 'unknown' }).eq('buyer_key', b.buyer_key)
      }
    }

    return json({
      ok: true, buyers_total: buyers.length,
      candidates: candidates?.length ?? 0, pushed, failed,
    })
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message || e) }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
