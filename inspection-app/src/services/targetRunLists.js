// Saved target buy lists — the same run list, on whichever screen you're at.
//
// Scoring a run list is a minute of work: read the CSV, pull six thousand sold
// cars, match every one of them. Losing that to a closed popup or a walk away
// from the laptop meant doing it again in the lane. So the scored list is saved
// the moment it's built, by whichever surface built it, and both the extension
// popup and this app read the same rows back.
//
// One row per list, cars in a jsonb array — see
// supabase/migrations/20260813000022_target_run_lists.sql for why it isn't a
// row per car.
//
// The extension writes the identical shape over raw REST from
// scrapers/smartauction-extension/lib/target-buy-list.js. Change a column here,
// change it there.

import { supabase } from './supabase'

const TABLE = 'target_run_lists'

// Everything except `cars` and `opened`. The picker needs to name a dozen lists
// without dragging a dozen scored run lists across the wire.
const SUMMARY = 'id,source_id,source_label,file_name,sale_date,car_count,'
  + 'target_count,watch_count,book_size,built_by,created_at,updated_at'

// The sale date the list is for, taken from the cars rather than the file name,
// which is whatever the auction site happened to call the download. Most common
// wins, because a single export can straddle two sale days.
function saleDateOf(cars) {
  const tally = new Map()
  for (const c of cars) {
    const d = String(c.saleDate || '').trim()
    if (d) tally.set(d, (tally.get(d) || 0) + 1)
  }
  let best = null, bestN = 0
  for (const [d, n] of tally) if (n > bestN) { best = d; bestN = n }
  return best
}

export async function saveRunList({ scored, fmt, fileName, bookSize, builtBy = 'web' }) {
  const row = {
    source_id: fmt.id,
    source_label: fmt.label,
    file_name: fileName || null,
    sale_date: saleDateOf(scored),
    car_count: scored.length,
    target_count: scored.filter((c) => c.verdict === 'TARGET').length,
    watch_count: scored.filter((c) => c.verdict === 'WATCH').length,
    book_size: bookSize ?? null,
    cars: scored,
    opened: [],
    built_by: builtBy,
  }
  const { data, error } = await supabase.from(TABLE).insert(row).select('id').single()
  if (error) throw new Error(`saving the run list failed: ${error.message}`)
  // Old lists are a few hundred KB each and nobody re-works a sale from last
  // month. Trimming on write keeps this off a scheduler.
  supabase.rpc('prune_target_run_lists').then(() => {}, () => {})
  // The condition record outlives the list itself — see recordObservations.
  recordObservations({ scored, fmt }).catch((e) =>
    console.error('could not record run-list observations', e))
  return data.id
}

// Keep the condition of every car we look at, forever.
//
// The scored list above is pruned after 30 days, and it carries the only
// buy-time condition data we ever get: CR grade, announcements, and the
// auction's own valuation. `sold` records what a car cost to recondition but
// never what shape it was in when we bid, so without this there is no way to
// ever learn what a grade is worth. Buying low-grade cars and reconditioning
// them up is the business — the question worth answering is which nameplate and
// grade combinations recondition profitably, and that needs years of rows.
//
// EVERY car goes in, not just TARGET and WATCH. The cars we passed on and bought
// anyway are the only evidence that a PASS was ever wrong, and a table of
// winners alone can't tell you what your criteria are missing.
//
// Best-effort by design: this is a study record, not part of the sale day. It
// never blocks or fails the save, and the caller ignores its result.
export async function recordObservations({ scored, fmt }) {
  if (!scored?.length || !fmt) return 0

  const gradeNum = (g) => {
    // '2.4', '3.5 ', 'Grade 4.1', 'AS-IS' -> a number or null. Stored raw as
    // well, because a feed that starts grading differently should be visible
    // rather than silently parsed into nonsense.
    const m = String(g ?? '').match(/\d+(\.\d+)?/)
    if (!m) return null
    const n = Number(m[0])
    return Number.isFinite(n) && n >= 0 && n <= 5.1 ? n : null
  }
  const txt = (v) => {
    const s = String(v ?? '').trim()
    return s ? s.slice(0, 2000) : null
  }
  const int = (v) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Math.round(Number(v)) : null)

  const rows = scored
    .filter((c) => String(c.vin || '').length === 17)
    .map((c) => ({
      vin: String(c.vin).toUpperCase(),
      // '' not null — the unique index spans this column, and NULLs never
      // collide, so an undated list would re-insert in full on every upload.
      sale_date: txt(c.saleDate) || '',
      source_id: fmt.id,
      source_label: fmt.label,
      year: int(c.year),
      make: txt(c.make),
      model: txt(c.model),
      trim: txt(c.style),
      odometer: int(c.odo),
      cr_grade: gradeNum(c.grade),
      cr_grade_raw: txt(c.grade),
      has_cr: c.hasCR ?? null,
      announcements: txt(c.announcements),
      title_status: txt(c.titleStatus),
      auction_value: Number.isFinite(Number(c.auctionValue)) ? Number(c.auctionValue) : null,
      seller: txt(c.seller),
      location: txt(c.location),
      lane: txt(c.lane),
      lot: txt(c.lot),
      run: txt(c.run),
      channel: txt(c.channel),
      drivetrain: txt(c.drivetrain),
      engine: txt(c.engine),
      transmission: txt(c.transmission),
      fuel: txt(c.fuel),
      color: txt(c.color),
      verdict: txt(c.verdict),
      confidence: txt(c.confidence),
      exact_n: int(c.exactN),
      exact_profit: Number.isFinite(Number(c.exactProfit)) ? Number(c.exactProfit) : null,
      exact_days: Number.isFinite(Number(c.exactDays)) ? Number(c.exactDays) : null,
    }))
  if (!rows.length) return 0

  // Re-uploading the same list, or a car running at the same sale twice, must
  // not double the rows — the unique index is (vin, sale_date, source_id) and
  // ignoreDuplicates keeps the FIRST sighting, which is the decision point.
  // Chunked because a 1,200-car ADESA list in one request is a large body.
  let written = 0
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    const { error } = await supabase
      .from('run_list_observations')
      .upsert(chunk, { onConflict: 'vin,sale_date,source_id', ignoreDuplicates: true })
    if (error) throw new Error(error.message)
    written += chunk.length
  }
  return written
}

export async function listSavedRunLists(limit = 12) {
  const { data, error } = await supabase.from(TABLE)
    .select(SUMMARY).order('created_at', { ascending: false }).limit(limit)
  if (error) throw new Error(`reading saved run lists failed: ${error.message}`)
  return data || []
}

// Returns the shape ListBuilder holds in `result`, so a restored list and a
// freshly uploaded one are the same thing to every caller downstream. `fmt` is
// rebuilt as id + label only: the parser attached to it did its job at upload
// and doesn't survive a round trip through JSON.
export async function loadRunList(id) {
  const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(`loading that run list failed: ${error.message}`)
  if (!data) return null
  return {
    id: data.id,
    scored: data.cars || [],
    fmt: { id: data.source_id, label: data.source_label || data.source_id },
    fileName: data.file_name,
    savedAt: data.created_at,
    builtBy: data.built_by,
    opened: new Set(data.opened || []),
  }
}

export async function loadLatestRunList() {
  const { data, error } = await supabase.from(TABLE)
    .select('id').order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error || !data) return null
  return loadRunList(data.id)
}

// Which cars have already been sent to a tab. Written on every batch so the
// count is right on the next machine that opens the list; failure is silent
// because losing the progress marker must never cost you the list itself.
export async function saveOpened(id, vins) {
  if (!id) return
  const { error } = await supabase.from(TABLE)
    .update({ opened: [...vins], updated_at: new Date().toISOString() }).eq('id', id)
  if (error) console.error('saving open progress failed', error)
}

export async function deleteRunList(id) {
  const { error } = await supabase.from(TABLE).delete().eq('id', id)
  if (error) throw new Error(`deleting that run list failed: ${error.message}`)
}
