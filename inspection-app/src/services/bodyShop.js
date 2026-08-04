// Body Shop — jobs, parts, techs.
//
// A job is opened automatically by the Telegram webhook when someone posts a
// VIN's last 6 in the body_shop group (see api/telegram.js → ensure_body_shop_job).
// The manager prices it, lists parts, and assigns a tech from here.
//
// Photos live in ./vehiclePhotos — they belong to the CAR, not to the job, so
// the body shop is just one caller alongside the car history screen.

import { supabase, selectAll } from './supabase'

// ---------------------------------------------------------------- constants

export const JOB_STATUSES = [
  { key: 'intake',        label: 'Intake',        emoji: '📥', color: 'slate',
    hint: 'Just arrived — needs a price' },
  { key: 'in_progress',   label: 'In Progress',   emoji: '🔨', color: 'emerald',
    hint: 'Tech is working it' },
  { key: 'waiting_parts', label: 'Waiting Parts', emoji: '📦', color: 'orange',
    hint: 'Blocked until parts land' },
  { key: 'done',          label: 'Done',          emoji: '✅', color: 'sky',
    hint: 'Finished' },
]

export const JOB_STATUS_STYLES = {
  intake:        'bg-slate-700 text-slate-200',
  in_progress:   'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40',
  waiting_parts: 'bg-orange-500/20 text-orange-300 border border-orange-500/40',
  done:          'bg-sky-500/20 text-sky-300 border border-sky-500/40',
}

export const PART_STATUSES = [
  { key: 'needed',   label: 'Needed',   emoji: '☐' },
  { key: 'ordered',  label: 'Ordered',  emoji: '⏳' },
  { key: 'received', label: 'Received', emoji: '✅' },
]

export const PART_STATUS_STYLES = {
  needed:   'bg-slate-700 text-slate-300',
  ordered:  'bg-yellow-500/20 text-yellow-300 border border-yellow-500/40',
  received: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40',
}

// Age escalation. The board is sorted oldest-first, and the day counter turns
// from grey to red as a car sits, so nothing quietly rots at the bottom.
export function ageStyle(days) {
  if (days == null) return 'text-slate-400'
  if (days >= 21) return 'text-red-400'
  if (days >= 14) return 'text-orange-400'
  if (days >= 7)  return 'text-yellow-400'
  return 'text-slate-300'
}

export function vehicleLabel(job) {
  const parts = [job?.vehicle_year, job?.vehicle_make, job?.vehicle_model].filter(Boolean)
  if (parts.length) return parts.join(' ')
  // A fresh buy the shop already has, before Frazer does. We know nothing about
  // it but the last 6 — show that rather than a useless "Unknown vehicle".
  if (job?.vin6) return `VIN …${job.vin6}`
  return 'Unknown vehicle'
}

// ---------------------------------------------------------------- jobs

// Oldest first — the whole point of the board. `selectAll` because this table
// has no natural ceiling and PostgREST silently caps an unbounded select at 1000.
//
// Housekeeping runs first: fresh-buy jobs whose car has since landed in Frazer
// adopt their stock number, and untouched ones that never showed up after 7 days
// are dropped. Done inline on load rather than on a cron, the same way the
// Telegram photo handshake avoids a background job.
export async function fetchBoard({ includeDone = false } = {}) {
  const { error: hkErr } = await supabase.rpc('body_shop_housekeeping')
  // Never block the board on housekeeping — a failure here just means a fresh
  // buy shows as "awaiting inventory" for one more load.
  if (hkErr) console.error('body shop housekeeping:', hkErr.message)

  const rows = await selectAll(() => {
    let q = supabase.from('body_shop_board').select('*')
    if (!includeDone) q = q.neq('status', 'done')
    return q.order('entered_at', { ascending: true })
  })
  return rows
}

// Recently finished cars, newest completion first — a separate, capped read so
// the live board never carries months of history.
export async function fetchRecentlyDone(limit = 50) {
  const { data, error } = await supabase
    .from('body_shop_board').select('*')
    .eq('status', 'done')
    .order('completed_at', { ascending: false, nullsFirst: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

export async function fetchJob(id) {
  const { data, error } = await supabase
    .from('body_shop_board').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data
}

export async function updateJob(id, patch) {
  const { data, error } = await supabase
    .from('body_shop_jobs').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function setJobStatus(id, status) {
  return updateJob(id, { status })
}

export async function assignTech(id, techId) {
  return updateJob(id, { assigned_tech: techId || null })
}

// Add a car by hand (a walk-in, or a fresh buy the shop has before Frazer does).
// Resolves the last 6 the same way the bot does, so the job lines up with the
// same car. A VIN that isn't in inventory yet is NOT an error — it opens a
// pending job that adopts its stock number once the car lands.
export async function createJobFromVin6(vin6) {
  const clean = String(vin6 || '').trim().toUpperCase().slice(-6)
  if (clean.length < 6) throw new Error('Enter the last 6 of the VIN')

  const { data: rows, error: lookupErr } = await supabase
    .rpc('lookup_vin_by_last6', { last6: clean })
  if (lookupErr) throw lookupErr
  const v = Array.isArray(rows) ? rows[0] : rows

  const existing = v?.stock_number
    ? await findOpenJob({ stockNumber: v.stock_number })
    : await findOpenJob({ vin6: clean })
  if (existing) return existing

  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('body_shop_jobs').insert({
    stock_number: v?.stock_number || null,
    vin: v?.vehicle_vin || null,
    vin6: clean,
    status: 'intake',
    source: 'manual',
    created_by: user?.id || null,
  }).select().single()

  // Unique partial index — a concurrent add (or the bot) beat us to it.
  if (error?.code === '23505') {
    const raced = v?.stock_number
      ? await findOpenJob({ stockNumber: v.stock_number })
      : await findOpenJob({ vin6: clean })
    if (raced) return raced
  }
  if (error) throw error
  return data
}

// A pending job is keyed by vin6 with a null stock number; a linked one by stock.
async function findOpenJob({ stockNumber, vin6 }) {
  let q = supabase.from('body_shop_jobs').select('*').neq('status', 'done')
  q = stockNumber ? q.eq('stock_number', stockNumber) : q.eq('vin6', vin6).is('stock_number', null)
  const { data, error } = await q.maybeSingle()
  if (error) throw error
  return data
}

export async function deleteJob(id) {
  const { error } = await supabase.from('body_shop_jobs').delete().eq('id', id)
  if (error) throw error
}

// ---------------------------------------------------------------- techs

// Anyone set up as a body shop tech or manager. `roles[]` is the granular role
// array — the legacy `role` column only ever holds admin|inspector.
export async function fetchTechs() {
  const { data, error } = await supabase
    .from('profiles').select('id, name, roles')
    .overlaps('roles', ['body_shop_tech', 'body_shop_manager'])
    .eq('approval_status', 'approved')
    .order('name', { ascending: true })
  if (error) throw error
  return data || []
}

export function isBodyShopManager(profile) {
  if (!profile) return false
  if (profile.role === 'admin') return true
  const roles = profile.roles || []
  return roles.includes('body_shop_manager') || roles.includes('owner_admin')
}

export function isBodyShopTech(profile) {
  return (profile?.roles || []).includes('body_shop_tech')
}

// ---------------------------------------------------------------- parts

export async function fetchParts(jobId) {
  const { data, error } = await supabase
    .from('body_shop_parts').select('*').eq('job_id', jobId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

export async function addPart(jobId, { name, cost, vendor, eta }) {
  const trimmed = String(name || '').trim()
  if (!trimmed) throw new Error('Part name is required')
  const { data, error } = await supabase.from('body_shop_parts').insert({
    job_id: jobId,
    name: trimmed,
    cost: cost === '' || cost == null ? null : Number(cost),
    vendor: vendor?.trim() || null,
    eta: eta || null,
  }).select().single()
  if (error) throw error
  return data
}

export async function updatePart(id, patch) {
  const { data, error } = await supabase
    .from('body_shop_parts').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deletePart(id) {
  const { error } = await supabase.from('body_shop_parts').delete().eq('id', id)
  if (error) throw error
}

// ---------------------------------------------------------------- charges
// The charge is negotiated: Jorge proposes, an owner approves or counters,
// Jorge accepts. Only an AGREED charge is payable. Every transition is a
// SECURITY DEFINER RPC that re-checks the caller's role server-side — these
// client-side helpers only decide what buttons to draw.

export const CHARGE_STATUS_LABELS = {
  draft:     'Not priced',
  proposed:  'Awaiting approval',
  countered: 'Countered',
  agreed:    'Agreed',
}

export const CHARGE_STATUS_STYLES = {
  draft:     'bg-slate-700 text-slate-300',
  proposed:  'bg-yellow-500/20 text-yellow-300 border border-yellow-500/40',
  countered: 'bg-orange-500/20 text-orange-300 border border-orange-500/40',
  agreed:    'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40',
}

// You and Omar. Admin covers you; Omar needs `owner_admin` or `accounting`.
export function isChargeApprover(profile) {
  if (!profile) return false
  if (profile.role === 'admin') return true
  const roles = profile.roles || []
  return roles.includes('owner_admin') || roles.includes('accounting')
}

export function isAccounting(profile) {
  return isChargeApprover(profile)
}

export function isShopManager(profile) {
  if (!profile) return false
  if (profile.role === 'admin') return true
  return (profile.roles || []).includes('body_shop_manager')
}

export async function proposeCharge(jobId, amount) {
  const { error } = await supabase.rpc('propose_body_shop_charge',
    { p_job_id: jobId, p_amount: Number(amount) })
  if (error) throw error
}

export async function approveCharge(jobId) {
  const { error } = await supabase.rpc('approve_body_shop_charge', { p_job_id: jobId })
  if (error) throw error
}

export async function counterCharge(jobId, amount, note) {
  const { error } = await supabase.rpc('counter_body_shop_charge',
    { p_job_id: jobId, p_amount: Number(amount), p_note: note?.trim() || null })
  if (error) throw error
}

export async function acceptCounter(jobId) {
  const { error } = await supabase.rpc('accept_body_shop_counter', { p_job_id: jobId })
  if (error) throw error
}

// ---------------------------------------------------------------- payouts
// Jorge collects every Saturday. He's owed the AGREED charge minus what the
// parts cost. Unpaid work rolls over, so a car finished three weeks ago and
// never collected still shows up.

export async function fetchPayoutSummary() {
  const { data, error } = await supabase.rpc('body_shop_payout_summary')
  if (error) throw error
  return (Array.isArray(data) ? data[0] : data) || null
}

// Everything finished and not yet collected, oldest first — the rollover sits
// at the top where it can't be missed.
export async function fetchPayoutLines() {
  const { data, error } = await supabase
    .from('body_shop_payout_lines').select('*')
    .is('payout_id', null)
    .order('completed_at', { ascending: true })
  if (error) throw error
  return data || []
}

export async function fetchPayoutHistory(limit = 20) {
  const { data, error } = await supabase
    .from('body_shop_payouts').select('*')
    .order('paid_at', { ascending: false }).limit(limit)
  if (error) throw error
  return data || []
}

// Accounting ticking off a car as verified. Deliberately a different person
// from the one who approved the charge amount.
export async function confirmForPayment(jobId, approved = true) {
  const { error } = await supabase.rpc('approve_body_shop_job',
    { p_job_id: jobId, p_approved: approved })
  if (error) throw error
}

export async function collectPayout(notes) {
  const { data, error } = await supabase.rpc('collect_body_shop_payout',
    { p_notes: notes?.trim() || null })
  if (error) throw error
  return (Array.isArray(data) ? data[0] : data) || null
}
