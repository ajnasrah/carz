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
  return data.id
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
