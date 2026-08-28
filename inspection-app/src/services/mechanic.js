// Mechanic shop — jobs, repair lines, parts.
//
// The body shop's twin with one structural difference: a mechanic job is a LIST
// OF PROBLEMS, not a single price. Jorge quotes one number per car and gets paid
// it; the mechanics are hourly, so there is no per-job money here at all and no
// payout pipeline. What replaces it is mechanic_lines — one row per repair, each
// with its own status and its own parts, so "at the mechanic" stops being the
// answer to "what is this car waiting on".
//
// A job is opened automatically by the Telegram webhook when a VIN's last 6 is
// posted in the mechanic group (api/telegram.js → ensure_mechanic_job), and by
// the work order router when an inbound inspection finds mechanical problems.
//
// Photos live in ./vehiclePhotos — they belong to the CAR, not the job, exactly
// as they do for the body shop.

import { supabase, selectAll } from './supabase'

// The four display helpers below are shared with the body shop rather than
// copied. They're pure functions over the columns both boards expose
// (days_owned, days_in_shop, vin6, vehicle_year/make/model), and the two boards
// must age and label a car identically or the same car reads differently
// depending on which shop you found it in.
export { ageStyle, ownedStyle, jobAge, lastSix, vehicleLabel } from './bodyShop'

// ---------------------------------------------------------------- constants

// The pipeline in the order a car actually moves through the shop. Diagnosing
// comes first and is its own stage because it is genuinely most of the work on a
// used car — nobody can price or schedule anything until someone has found out
// what's wrong, and a car sitting undiagnosed is a different problem from a car
// sitting waiting for a water pump.
//
// Order matters beyond the labels: the board's filter chips, the status buttons,
// and the swipe-through order all read this array.
export const JOB_STATUSES = [
  { key: 'intake',        label: 'Intake',      emoji: '📥', color: 'slate',
    hint: 'Just arrived — nobody has looked yet' },
  { key: 'diagnosing',    label: 'Diagnosing',  emoji: '🔍', color: 'cyan',
    hint: 'Finding out what is actually wrong' },
  { key: 'waiting_parts', label: 'Waiting Parts', emoji: '📦', color: 'orange',
    hint: 'Blocked until parts land' },
  { key: 'in_progress',   label: 'In Progress', emoji: '🔧', color: 'emerald',
    hint: 'On the lift' },
  { key: 'done',          label: 'Done',        emoji: '✅', color: 'sky',
    hint: 'Finished — off to the next station' },
]

// On hold is NOT a stage, which is why it isn't in the array above. Same lane
// the body shop board has, for the same reason: a car nobody is going to fix
// this month drags the oldest-car number and the intake count with it, so the
// figures that should shame the shop into moving stop meaning anything.
export const HOLD_STATUS = { key: 'on_hold', label: 'On Hold', emoji: '⛔',
  hint: 'Parked — not being worked' }

export const JOB_STATUS_STYLES = {
  intake:        'bg-slate-700 text-slate-200',
  diagnosing:    'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40',
  waiting_parts: 'bg-orange-500/20 text-orange-300 border border-orange-500/40',
  in_progress:   'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40',
  done:          'bg-sky-500/20 text-sky-300 border border-sky-500/40',
  on_hold:       'bg-red-500/20 text-red-300 border border-red-500/40',
}

// A line's own lifecycle. 'declined' is a real outcome and not a failure — on a
// wholesale car plenty of findings are correctly left alone — and it is kept
// apart from 'done' so "what did we fix" and "what did we knowingly ship" stay
// different questions.
export const LINE_STATUSES = [
  { key: 'open',          label: 'Open',          emoji: '☐' },
  { key: 'in_progress',   label: 'Working',       emoji: '🔧' },
  { key: 'waiting_parts', label: 'Waiting Parts', emoji: '📦' },
  { key: 'done',          label: 'Fixed',         emoji: '✅' },
  { key: 'declined',      label: 'Not Fixing',    emoji: '🚫' },
]

export const LINE_STATUS_STYLES = {
  open:          'bg-slate-700 text-slate-300',
  in_progress:   'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40',
  waiting_parts: 'bg-orange-500/20 text-orange-300 border border-orange-500/40',
  done:          'bg-sky-500/20 text-sky-300 border border-sky-500/40',
  declined:      'bg-slate-800 text-slate-500 border border-slate-700',
}

// A line is finished either way — fixed or deliberately not. Both stop the
// clock, both count against lines_open, and the job closes when none are left.
export const CLOSED_LINE_STATUSES = ['done', 'declined']

export function isLineClosed(line) {
  return CLOSED_LINE_STATUSES.includes(line?.status)
}

// Matches the CHECK on mechanic_lines.system, which in turn matches the
// vocabulary the inbound inspection was designed around — so a finding becomes
// a line by copying values, never by translating them.
export const SYSTEMS = [
  { key: 'engine',       label: 'Engine',       emoji: '⚙️' },
  { key: 'transmission', label: 'Transmission', emoji: '🔩' },
  { key: 'brakes',       label: 'Brakes',       emoji: '🛑' },
  { key: 'suspension',   label: 'Suspension',   emoji: '🪛' },
  { key: 'electrical',   label: 'Electrical',   emoji: '⚡' },
  { key: 'cooling',      label: 'Cooling',      emoji: '❄️' },
  { key: 'hvac',         label: 'A/C & Heat',   emoji: '🌡️' },
  { key: 'exhaust',      label: 'Exhaust',      emoji: '💨' },
  { key: 'fuel',         label: 'Fuel',         emoji: '⛽' },
  { key: 'other',        label: 'Other',        emoji: '🔧' },
]

export function systemLabel(key) {
  return SYSTEMS.find((s) => s.key === key)?.label || 'Other'
}

// Worst first, because that is the order the board and the card read them in.
export const SEVERITIES = [
  { key: 'critical', label: 'Critical', rank: 0, hint: 'Unsafe or undriveable' },
  { key: 'severe',   label: 'Severe',   rank: 1, hint: 'Must be fixed before it sells' },
  { key: 'moderate', label: 'Moderate', rank: 2, hint: 'Should be fixed' },
  { key: 'minor',    label: 'Minor',    rank: 3, hint: 'Note it and move on' },
]

export const SEVERITY_STYLES = {
  critical: 'bg-red-500/20 text-red-300 border border-red-500/40',
  severe:   'bg-orange-500/20 text-orange-300 border border-orange-500/40',
  moderate: 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/40',
  minor:    'bg-slate-700 text-slate-300',
}

export function severityRank(key) {
  const hit = SEVERITIES.find((s) => s.key === key)
  return hit ? hit.rank : 99
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

// ---------------------------------------------------------------- jobs

// Longest-OWNED first, same rule and the same reason as the body shop board:
// what a car costs us runs from the day we bought it, not from the day it was
// dropped at the mechanic, so a car we've had since June belongs at the top the
// morning it goes on the lift.
//
// Cars with no purchase date (fresh buys Frazer hasn't seen) sort last — they're
// genuinely age-unknown and every one of them is days old, not months.
// entered_at breaks ties, then id so paging can't shuffle a tie across a page
// boundary. `selectAll` because this table has no natural ceiling and PostgREST
// silently caps an unbounded select at 1000.
export async function fetchBoard({ includeDone = false } = {}) {
  return selectAll(() => {
    let q = supabase.from('mechanic_board').select('*')
    if (!includeDone) q = q.neq('status', 'done')
    return q
      .order('days_owned', { ascending: false, nullsFirst: false })
      .order('entered_at', { ascending: true })
      .order('id', { ascending: true })
  })
}

// Recently finished cars, newest completion first — a separate, capped read so
// the live board never carries months of history.
export async function fetchRecentlyDone(limit = 50) {
  const { data, error } = await supabase
    .from('mechanic_board').select('*')
    .eq('status', 'done')
    .order('completed_at', { ascending: false, nullsFirst: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

export async function fetchJob(id) {
  const { data, error } = await supabase
    .from('mechanic_board').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data
}

export async function updateJob(id, patch) {
  const { data, error } = await supabase
    .from('mechanic_jobs').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export function isOnHold(job) {
  return job?.status === HOLD_STATUS.key
}

export async function deleteJob(id) {
  const { error } = await supabase.from('mechanic_jobs').delete().eq('id', id)
  if (error) throw error
}

// Add a car by hand — a car pushed straight into the shop without anyone posting
// it in the group. Resolves the last 6 the way the bot does so the job lines up
// with the same car, and returns the existing open job rather than erroring if
// there already is one.
export async function createJobFromVin6(vin6) {
  const clean = String(vin6 || '').trim().toUpperCase().slice(-6)
  if (clean.length < 6) throw new Error('Enter the last 6 of the VIN')

  const { data: rows, error: lookupErr } = await supabase
    .rpc('lookup_vin_by_last6', { last6: clean })
  if (lookupErr) throw lookupErr
  const v = Array.isArray(rows) ? rows[0] : rows

  if (!v?.stock_number) {
    // Unlike the body shop, there is no pending-job path here: mechanic_jobs
    // requires a stock number, because a car reaches the mechanic through the
    // lot rather than off a trailer, so it is always already in inventory.
    throw new Error(`No car in inventory with last 6 “${clean}”`)
  }

  const existing = await findOpenJob(v.stock_number)
  if (existing) return existing

  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('mechanic_jobs').insert({
    stock_number: v.stock_number,
    vin: v.vehicle_vin || null,
    vin6: clean,
    status: 'intake',
    source: 'manual',
    created_by: user?.id || null,
  }).select().single()

  // Unique partial index — a concurrent add (or the bot) beat us to it.
  if (error?.code === '23505') {
    const raced = await findOpenJob(v.stock_number)
    if (raced) return raced
  }
  if (error) throw error
  return data
}

async function findOpenJob(stockNumber) {
  const { data, error } = await supabase
    .from('mechanic_jobs').select('*')
    .eq('stock_number', stockNumber).neq('status', 'done')
    .maybeSingle()
  if (error) throw error
  return data
}

// ---------------------------------------------------------------- lines

// Worst problem first, then oldest — a tech opening a card should read the thing
// that could hurt somebody before the thing that rattles. Closed lines drop to
// the bottom whatever their severity; they're history, not work.
export async function fetchLines(jobId) {
  const { data, error } = await supabase
    .from('mechanic_lines').select('*')
    .eq('job_id', jobId)
    .order('opened_at', { ascending: true })
  if (error) throw error
  return sortLines(data || [])
}

export function sortLines(lines) {
  return [...lines].sort((a, b) => {
    const closed = Number(isLineClosed(a)) - Number(isLineClosed(b))
    if (closed) return closed
    const sev = severityRank(a.severity) - severityRank(b.severity)
    if (sev) return sev
    return new Date(a.opened_at) - new Date(b.opened_at)
  })
}

export async function addLine(jobId, { description, system, severity, est_cost, notes } = {}) {
  const text = String(description || '').trim()
  if (!text) throw new Error('Say what is wrong with it')

  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('mechanic_lines').insert({
    job_id: jobId,
    description: text,
    system: system || 'other',
    severity: severity || 'moderate',
    est_cost: est_cost ?? null,
    notes: notes || null,
    created_by: user?.id || null,
  }).select().single()
  if (error) throw error
  return data
}

export async function updateLine(id, patch) {
  const { data, error } = await supabase
    .from('mechanic_lines').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

// Closing the last open line closes the JOB too — a database trigger does it, so
// a tech who finishes the work never has to also remember to finish the card.
// Callers should refetch the job after this, not assume its status is unchanged.
export async function setLineStatus(id, status) {
  return updateLine(id, { status })
}

export async function deleteLine(id) {
  const { error } = await supabase.from('mechanic_lines').delete().eq('id', id)
  if (error) throw error
}

// ---------------------------------------------------------------- parts

export async function fetchParts(jobId) {
  const { data, error } = await supabase
    .from('mechanic_parts').select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

// line_id is optional on purpose: a water pump belongs to the water pump line,
// a box of rags belongs to the car. Requiring a line would push people to invent
// lines for consumables.
export async function addPart(jobId, { name, cost, vendor, eta, lineId, partNumber, sourceUrl } = {}) {
  const text = String(name || '').trim()
  if (!text) throw new Error('Name the part')

  const { data, error } = await supabase.from('mechanic_parts').insert({
    job_id: jobId,
    line_id: lineId || null,
    name: text,
    cost: cost ?? null,
    vendor: vendor || null,
    part_number: partNumber || null,
    source_url: sourceUrl || null,
    eta: eta || null,
  }).select().single()
  if (error) throw error
  return data
}

export async function updatePart(id, patch) {
  const { data, error } = await supabase
    .from('mechanic_parts').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deletePart(id) {
  const { error } = await supabase.from('mechanic_parts').delete().eq('id', id)
  if (error) throw error
}

export async function markPartOrdered(id, { vendor, cost, sourceUrl } = {}) {
  const { data: { user } } = await supabase.auth.getUser()
  const patch = { status: 'ordered', ordered_by: user?.id || null }
  if (vendor) patch.vendor = vendor
  if (cost != null) patch.cost = cost
  if (sourceUrl) patch.source_url = sourceUrl
  return updatePart(id, patch)
}

export async function markPartNeeded(id) {
  return updatePart(id, { status: 'needed', ordered_at: null, received_at: null })
}

// ---------------------------------------------------------------- techs

// Anyone set up as a mechanic or shop manager. `roles[]` is the granular role
// array — the legacy `role` column only ever holds admin|inspector.
export async function fetchMechanics() {
  const { data, error } = await supabase
    .from('profiles').select('id, name, roles')
    .overlaps('roles', ['mechanic', 'mechanic_manager'])
    .eq('approval_status', 'approved')
    .order('name', { ascending: true })
  if (error) throw error
  return data || []
}

export function isMechanicManager(profile) {
  if (!profile) return false
  if (profile.role === 'admin') return true
  const roles = profile.roles || []
  return roles.includes('mechanic_manager') || roles.includes('owner_admin')
}

export function isMechanic(profile) {
  return (profile?.roles || []).includes('mechanic')
}

// Parts cost is the only money on a mechanic job — labour is hourly and stays
// overhead, deliberately not tracked per car. It's still the manager's number,
// so a tech sees what to fix and what to fit, not what it cost.
//
// A UI gate, not a security boundary: a tech's token can still read the rows.
// Making it real means tightening RLS on mechanic_parts.
export function canSeeMechanicMoney(profile) {
  return isMechanicManager(profile)
}

// ---------------------------------------------------------------- one car

// Everything a car is waiting on, across both shops, in one read.
//
// The failure this exists to stop: a tech fixes what is on the mechanic board,
// the car goes back on the lot, and the dent nobody mentioned to him is still
// there — so it comes back. A car is ready when BOTH shops are finished with
// it, and until now nothing on one screen could say whether that was true.
//
// Newest open job wins; if both shops are finished we still show the last one,
// because "what did we do to this car" is the other question this answers.
export async function fetchCarWorkOrder(vin6) {
  const six = String(vin6 || '').trim().toUpperCase().slice(-6)
  if (six.length < 6) throw new Error('Enter the last 6 of the VIN')

  const pickCurrent = (rows) => {
    const open = (rows || []).filter((r) => r.status !== 'done')
    const pool = open.length ? open : (rows || [])
    return pool.sort((a, b) => new Date(b.entered_at) - new Date(a.entered_at))[0] || null
  }

  const [mechRes, bsRes] = await Promise.all([
    supabase.from('mechanic_board').select('*').eq('vin6', six),
    supabase.from('body_shop_board').select('*').eq('vin6', six),
  ])
  if (mechRes.error) throw mechRes.error
  // The body shop board is gated the same way but a missing row is normal —
  // most cars never go there.
  const mech = pickCurrent(mechRes.data)
  const body = bsRes.error ? null : pickCurrent(bsRes.data)

  const [lines, mechParts, bodyParts, miss] = await Promise.all([
    mech ? fetchLines(mech.id) : Promise.resolve([]),
    mech ? fetchParts(mech.id) : Promise.resolve([]),
    body
      ? supabase.from('body_shop_parts').select('*').eq('job_id', body.id)
          .then(({ data }) => data || [])
      : Promise.resolve([]),
    mech
      ? supabase.from('mechanic_job_miss_rate').select('*').eq('job_id', mech.id).maybeSingle()
          .then(({ data }) => data)
      : Promise.resolve(null),
  ])

  return { vin6: six, mech, body, lines, mechParts, bodyParts, miss }
}

// "That's everything I found." Recorded as a statement by a person, separate
// from the car physically leaving — close_mechanic_job() deliberately does not
// set this, because a car being moved is an event, not a judgement.
export async function signOffJob(jobId) {
  const { data: { user } } = await supabase.auth.getUser()
  return updateJob(jobId, {
    signed_off_at: new Date().toISOString(),
    signed_off_by: user?.id || null,
  })
}
