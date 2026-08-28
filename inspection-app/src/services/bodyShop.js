// Body Shop — jobs, parts, techs.
//
// A job is opened automatically by the Telegram webhook when someone posts a
// VIN's last 6 in the body_shop group (see api/telegram.js → ensure_body_shop_job).
// The manager prices it, lists parts, and assigns a tech from here.
//
// Photos live in ./vehiclePhotos — they belong to the CAR, not to the job, so
// the body shop is just one caller alongside the car history screen.

import { supabase, selectAll } from './supabase'
import { isPrimaryAdmin } from './adminSetup'

// ---------------------------------------------------------------- constants

// The pipeline in the order the car actually moves through the shop. Parts come
// BEFORE the work — a car waits on a bumper, the bumper lands, then a tech picks
// it up — and final check (buffing, sanding a run back, colour under the lights)
// is its own stage, because a car on the buffer is not a finished car and must
// not be payable yet.
//
// The parts run is THREE stages, not one, because "waiting on parts" was hiding
// the only one of them we can do anything about. A car nobody has ordered for is
// our delay; a car whose bumper is on a truck is the vendor's. Lumping them
// together made 26 cars look like one problem that was somebody else's.
//
// Those three are driven by the parts checklist, not by tapping — see
// sync_body_shop_job_parts_stage in the migration. The buttons still exist for
// the odd car the list doesn't describe, but nobody should need them.
//
// Order matters beyond the labels: the board's filter chips, the status buttons,
// and the swipe-through order all read this array.
export const JOB_STATUSES = [
  { key: 'intake',        label: 'Intake',        emoji: '📥', color: 'slate',
    hint: 'Just arrived — needs a price' },
  { key: 'need_parts',    label: 'Need Parts',    emoji: '🛒', color: 'rose',
    hint: 'Nothing ordered yet — on us' },
  { key: 'waiting_parts', label: 'Parts Ordered', emoji: '📦', color: 'orange',
    hint: 'Bought — waiting on the vendor' },
  { key: 'parts_in',      label: 'Parts In',      emoji: '📬', color: 'yellow',
    hint: 'Parts delivered — waiting to start' },
  { key: 'in_progress',   label: 'In Progress',   emoji: '🔨', color: 'emerald',
    hint: 'Tech is working it' },
  { key: 'final_check',   label: 'Final Check',   emoji: '✨', color: 'violet',
    hint: 'Buffing, touch-up, last look' },
  { key: 'done',          label: 'Done',          emoji: '✅', color: 'sky',
    hint: 'Finished — goes on the payout' },
]

// On hold is NOT a stage, which is why it isn't in the array above — a car
// parked here has left the pipeline. It's the junk lane: a rotted rocker, a hit
// that isn't worth the panels, a car waiting on a decision nobody is making
// this month. Off the stage tiles, out of the "in shop" count, and out of the
// oldest-car figure, so the numbers that are supposed to shame the shop into
// moving are about cars the shop can actually move.
//
// Never 'done': done is what puts a job on Jorge's payout.
export const HOLD_STATUS = { key: 'on_hold', label: 'On Hold', emoji: '⛔',
  hint: 'Junk / parked — not being worked' }

export const JOB_STATUS_STYLES = {
  intake:        'bg-slate-700 text-slate-200',
  need_parts:    'bg-rose-500/20 text-rose-300 border border-rose-500/40',
  waiting_parts: 'bg-orange-500/20 text-orange-300 border border-orange-500/40',
  parts_in:      'bg-yellow-500/20 text-yellow-300 border border-yellow-500/40',
  in_progress:   'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40',
  final_check:   'bg-violet-500/20 text-violet-300 border border-violet-500/40',
  done:          'bg-sky-500/20 text-sky-300 border border-sky-500/40',
  on_hold:       'bg-red-500/20 text-red-300 border border-red-500/40',
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

// Age escalation for the SHOP's own clock — how long this car has been at
// Jorge's. A fortnight in the shop is already bad; three weeks is red.
export function ageStyle(days) {
  if (days == null) return 'text-slate-400'
  if (days >= 21) return 'text-red-400'
  if (days >= 14) return 'text-orange-400'
  if (days >= 7)  return 'text-yellow-400'
  return 'text-slate-300'
}

// Age escalation for how long we've OWNED the car, which is the board's
// headline number and its sort. Different scale entirely: a month of ownership
// is ordinary, two months is money burning. Matches the front-lot aging bands.
export function ownedStyle(days) {
  if (days == null) return 'text-slate-400'
  if (days >= 60) return 'text-red-400'
  if (days >= 45) return 'text-orange-400'
  if (days >= 30) return 'text-yellow-400'
  return 'text-slate-300'
}

// The number on the card. Days owned when we know it; for a fresh buy Frazer
// has never seen there is no purchase date to subtract, so the shop's own clock
// stands in — flagged, so nobody reads 3 days owned off a car we bought in May.
export function jobAge(job) {
  if (job?.days_owned != null) return { days: job.days_owned, owned: true }
  return { days: job?.days_in_shop ?? null, owned: false }
}

// The last 6 is what a car is CALLED around here — it's what gets posted in the
// Telegram group, what's written on the key tag, and what someone standing in
// front of the car reads off the windscreen. Every job has one. The full VIN
// only exists once the car is in inventory, so a fresh buy has the six and
// nothing else.
export function lastSix(job) {
  const six = job?.vin6 || (job?.vin ? String(job.vin).slice(-6) : '')
  return six ? six.toUpperCase() : null
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

// Longest-owned first — the whole point of the board. Not longest-in-the-shop:
// what a car costs us runs from the day we bought it, so a car we've had since
// June belongs at the top the morning it's dropped off, not at the bottom.
//
// Cars with no purchase date (fresh buys inventory hasn't seen) sort last —
// they're genuinely age-unknown, and every one of them is days old, not months.
// entered_at breaks ties, and the id after it so paging can't shuffle a tie
// across page boundaries. `selectAll` because this table has no natural ceiling
// and PostgREST silently caps an unbounded select at 1000.
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
    return q
      .order('days_owned', { ascending: false, nullsFirst: false })
      .order('entered_at', { ascending: true })
      .order('id', { ascending: true })
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

// A held car is open, not finished — it keeps its photos, parts and price, and
// it is skipped by the location trigger that closes a job when the car leaves
// the shop, so pushing the junk round the back doesn't stamp it Done and put it
// on the payout. Coming off hold sends it back to intake to be re-triaged.
export function isOnHold(job) {
  return job?.status === HOLD_STATUS.key
}

// A car goes to EITHER a real account (assigned_tech) or a roster name that has
// never signed in (assigned_tech_invite) — the DB enforces one or the other. One
// dropdown covers both, so the value carries which table the id belongs to:
// 'p:<uuid>' for a profile, 'i:<uuid>' for a roster entry, '' for unassigned.
export const TECH_ACCOUNT = 'p'
export const TECH_ROSTER = 'i'

export function techValue(job) {
  if (job?.assigned_tech) return `${TECH_ACCOUNT}:${job.assigned_tech}`
  if (job?.assigned_tech_invite) return `${TECH_ROSTER}:${job.assigned_tech_invite}`
  return ''
}

// Accounts first, then the roster, each by name — Jorge scans for a person, not
// for whether that person owns a phone.
export function techOptions(techs = [], invites = []) {
  const byName = (a, b) => a.label.localeCompare(b.label)
  return [
    ...techs.map((t) => ({ value: `${TECH_ACCOUNT}:${t.id}`, label: t.name || 'Unnamed' })).sort(byName),
    ...invites.map((i) => ({ value: `${TECH_ROSTER}:${i.id}`, label: i.name, pending: true })).sort(byName),
  ]
}

export async function assignTech(id, value) {
  const [kind, ref] = String(value || '').split(':')
  return updateJob(id, {
    assigned_tech:        kind === TECH_ACCOUNT ? ref : null,
    assigned_tech_invite: kind === TECH_ROSTER ? ref : null,
  })
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

// Techs Jorge has added who haven't signed in yet — a name, and a phone number
// if he had one. They're assignable straight away; one with a number becomes a
// real profile when it logs in (claim_body_shop_tech_invite, called from
// AuthContext), and the cars already on his name move across with him.
export async function fetchTechInvites() {
  const { data, error } = await supabase
    .from('body_shop_tech_invites').select('*')
    .is('claimed_at', null)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

// The phone number is optional. Outcomes:
//   'linked'  the number already had an account — the role is granted now
//   'invited' a number nobody has signed in with yet
//   'added'   a name with no number — on the roster, assignable, that's all
export async function addTech(name, phone) {
  const { data, error } = await supabase.rpc('add_body_shop_tech',
    { p_name: name?.trim(), p_phone: phone || null })
  if (error) throw error
  return data
}

export async function removeTechInvite(id) {
  const { error } = await supabase.rpc('remove_body_shop_tech_invite', { p_id: id })
  if (error) throw error
}

// Display only — the server matches on the last 10 digits, never on this.
export function formatPhone(value) {
  const d = String(value || '').replace(/\D/g, '').slice(-10)
  if (d.length <= 3) return d
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 10)}`
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

// The body shop crew — techs and the shop manager — are hired for the shop and
// nothing else, so the rest of the app (inventory, sold reports, buyer match,
// inspections) is closed to them: they see the Body Shop section only. Enforced
// in ProtectedRoute; BottomNav shows them body shop tabs instead of the usual four.
//
// "Only" is literal: someone who is a tech AND a lot manager is not shop-scoped —
// the extra role is the whole reason he has the rest of the app. Same for admins.
// A buyer never reaches this, ProtectedRoute sends them to /listings first.
export const BODY_SHOP_ROLES = ['body_shop_tech', 'body_shop_manager']

// Money in the shop is the manager's business. Jorge prices the work, argues the
// charge and collects it; his techs are paid by him per job, not by us — so every
// number on a job (charge, parts, payout) is hidden from them. isBodyShopManager
// already covers admins and owner_admin, so the owner keeps seeing everything.
//
// A UI gate, not a security boundary: a tech's token can still read the rows.
// Making it real means RLS on body_shop_jobs / body_shop_parts.
export function canSeeShopMoney(profile) {
  return isBodyShopManager(profile)
}

export function isBodyShopOnly(profile) {
  if (!profile) return false
  if (profile.role === 'admin' || isPrimaryAdmin(profile.phone)) return false
  const roles = profile.roles || []
  if (!roles.length) return false
  return roles.every((r) => BODY_SHOP_ROLES.includes(r))
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

// ------------------------------------------------- the order list
//
// Buying parts is its own sitting: the manager has the vendor on the phone and
// works ONE list, not twenty car screens. Before this, finding out whether a car
// still needed anything bought meant opening that car's job, and nothing
// recorded that you'd already looked — so the same car got opened again the next
// time, and the time after.
//
// A car is on this list while it has at least one part still marked `needed`,
// and it leaves the moment the last one is marked Ordered. That is the whole
// rule: the list empties as it's worked, and a car already ordered for is gone
// until somebody adds another part to it.
//
// Held cars are off it for the same reason they're off the board — nobody buys a
// bumper for junk — and so are done cars.
export async function fetchPartsToOrder() {
  const board = await fetchBoard()
  const open = board.filter((j) => j.status !== 'done' && !isOnHold(j))

  // The rollup on the view narrows which jobs we ask about; it is never the
  // source of what's shown. COUNT comes back as a bigint, so compare it as a
  // number rather than trusting it to be truthy.
  const needing = open.filter((j) => Number(j.parts_needed) > 0)

  const rows = []
  const CHUNK = 100        // a few hundred ids in one ?in=(…) makes the URL too long
  const ids = needing.map((j) => j.id)
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabase
      .from('body_shop_parts').select('*')
      .eq('status', 'needed')
      .in('job_id', ids.slice(i, i + CHUNK))
      .order('created_at', { ascending: true })
    if (error) throw error
    rows.push(...(data || []))
  }

  const byJob = new Map()
  for (const part of rows) {
    if (!byJob.has(part.job_id)) byJob.set(part.job_id, [])
    byJob.get(part.job_id).push(part)
  }

  // fetchBoard() already sorted longest-owned first, and this list keeps that
  // order: the car burning the most money gets its parts bought first.
  const cars = needing
    .map((job) => ({ job, parts: byJob.get(job.id) || [] }))
    .filter((c) => c.parts.length > 0)

  // Cars nobody has listed parts for yet. NOT part of the order list — there is
  // nothing to buy on them — but an empty order list means "nothing to order"
  // only if somebody has actually looked at these, so they're counted in the
  // footer instead of being silently absent.
  const untriaged = open.filter((j) => Number(j.parts_total) === 0).length

  return { cars, untriaged }
}

export async function markPartOrdered(id, { vendor, cost } = {}) {
  const patch = { status: 'ordered' }
  if (vendor !== undefined) patch.vendor = String(vendor || '').trim() || null
  if (cost !== undefined && cost !== '' && cost !== null) patch.cost = Number(cost)
  return updatePart(id, patch)
}

// Every part still needed on one car, in one write — the common case, because a
// car's parts are usually bought from the same vendor in the same call.
export async function markJobPartsOrdered(jobId) {
  const { data, error } = await supabase
    .from('body_shop_parts').update({ status: 'ordered' })
    .eq('job_id', jobId).eq('status', 'needed')
    .select()
  if (error) throw error
  return data || []
}

// Undo. ordered_at has to be cleared by hand: the trigger only stamps it on the
// way IN (and only when it's null), so a part put back to needed would otherwise
// keep the timestamp of an order that never happened, and re-ordering it later
// would inherit that stale time.
export async function markPartNeeded(id) {
  return updatePart(id, { status: 'needed', ordered_at: null })
}

// Nothing here moves the car any more. Marking the last part Ordered puts the
// job in Parts Ordered, marking one back to Needed puts it in Need Parts, and
// the last part landing puts it in Parts In — all of it in the database, on the
// parts rows themselves, so the board tells the same story no matter who touched
// the checklist or from which screen. See sync_body_shop_job_parts_stage.

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
