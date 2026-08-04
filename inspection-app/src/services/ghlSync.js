// GHL lead sync — client side.
//   • triggerGhlSync()  fires the ghl-lead-sync edge function (after each upload).
//   • seedGhlBuyers()   imports your existing OPEN GHL opportunities into sa_buyers
//                       marked contacted=true, so they are never re-pushed.
//
// Identity normalization MUST match supabase/functions/ghl-lead-sync/index.ts.
import { supabase } from './supabase'
import { parseCSV } from './buyerMatchData'

// .trim() both — Vercel-sourced env values carry a trailing carriage return that
// gets baked into the bundle, breaking the URL path and the auth header. Same
// reason as services/supabase.js; see the note there.
const FN_URL = `${import.meta.env.VITE_SUPABASE_URL?.trim()}/functions/v1/ghl-lead-sync`
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

// ── Identity normalization (keep in lock-step with the edge function) ──
export function normPhone(p) {
  const d = String(p ?? '').replace(/\D/g, '')
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d
  return ten.length === 10 ? ten : null
}
export function normEmail(e) {
  const s = String(e ?? '').trim().toLowerCase()
  return s.includes('@') && s.length > 3 ? s : null
}
export function normName(n) {
  const s = String(n ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  return s.length ? s : null
}
export function buyerKey(phone, email, name) {
  if (phone) return `p:${phone}`
  if (email) return `e:${email}`
  if (name) return `n:${name}`
  return null
}

// Fire-and-report the edge function. Never throws — sync is best-effort.
export async function triggerGhlSync() {
  try {
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON}`, apikey: ANON },
      body: '{}',
    })
    const out = await res.json().catch(() => ({}))
    return res.ok ? out : { ok: false, error: out.error || `${res.status}`, ...out }
  } catch (e) {
    return { ok: false, error: String(e.message || e) }
  }
}

// Pull the first present value across candidate header names (case-insensitive).
function pick(row, names) {
  const lower = {}
  for (const k of Object.keys(row)) lower[k.trim().toLowerCase()] = row[k]
  for (const n of names) { const v = lower[n.toLowerCase()]; if (v != null && String(v).trim() !== '') return String(v).trim() }
  return null
}

// Map one GHL export row → an sa_buyers seed record (contacted=true).
function mapGhlRow(row) {
  const rawPhone = pick(row, ['phone', 'phone number', 'contact phone'])
  const rawEmail = pick(row, ['email', 'contact email'])
  const first = pick(row, ['first name', 'firstname'])
  const last = pick(row, ['last name', 'lastname'])
  const full = pick(row, ['contact name', 'name', 'full name', 'opportunity name']) || [first, last].filter(Boolean).join(' ')

  const phone = normPhone(rawPhone)
  const email = normEmail(rawEmail)
  const name = normName(full)
  const key = buyerKey(phone, email, name)
  if (!key) return null

  return {
    buyer_key: key,
    buyer_name: full || null,
    phone: rawPhone || null,
    email: rawEmail || null,
    city: pick(row, ['city']),
    state: pick(row, ['state']),
    zip: pick(row, ['postal code', 'zip', 'zipcode']),
    contacted: true,
    ghl_synced_at: new Date().toISOString(),
    ghl_source: 'seed',
    ghl_contact_id: pick(row, ['contact id', 'id']),
  }
}

// Import a GHL opportunities/contacts CSV export as already-contacted seed rows.
// Returns { seeded, skipped }. Existing keys are updated (marked contacted).
export async function seedGhlBuyers(csvText) {
  const raw = parseCSV(csvText)
  const rows = raw.map(mapGhlRow).filter(Boolean)
  // dedupe within the file (last wins)
  const byKey = new Map()
  for (const r of rows) byKey.set(r.buyer_key, r)
  const seed = [...byKey.values()]

  let seeded = 0
  for (let i = 0; i < seed.length; i += 500) {
    const { error } = await supabase.from('sa_buyers').upsert(seed.slice(i, i + 500), { onConflict: 'buyer_key' })
    if (error) throw error
    seeded += Math.min(500, seed.length - i)
  }
  return { seeded, skipped: raw.length - seed.length }
}
