import { supabase } from './supabase'

// The photo overlay for marketplace listings: which photos are hidden, and what
// order the rest appear in. Stored per VIN in listing_photo_edits and addressed
// by photo URL — see the migration for why the edit can't live in the photos'
// own sources.

// One row per VIN, keyed by VIN. Pass the VINs you're about to render.
export async function fetchPhotoEdits(vins) {
  const list = [...new Set((vins || []).filter(Boolean).map((v) => v.toUpperCase()))]
  if (list.length === 0) return new Map()

  const out = new Map()
  // Chunked for the same reason as everywhere else: a few hundred VINs in one
  // ?in=(…) makes a URL long enough to be rejected before it reaches Postgres.
  const CHUNK = 150
  for (let i = 0; i < list.length; i += CHUNK) {
    const { data, error } = await supabase
      .from('listing_photo_edits')
      .select('vin, hidden, ordering')
      .in('vin', list.slice(i, i + CHUNK))
    if (error) {
      // An unreachable overlay must not blank a gallery — fall back to showing
      // every photo in its natural order.
      console.error('photo edits fetch failed', error.message)
      return out
    }
    for (const row of data || []) out.set(row.vin, row)
  }
  return out
}

export async function fetchPhotoEdit(vin) {
  const map = await fetchPhotoEdits([vin])
  return map.get((vin || '').toUpperCase()) || null
}

// Hide the hidden, then sort by the chosen order. Photos the overlay doesn't
// mention keep their natural position BEHIND the ordered ones, so a photo that
// arrives from Telegram after an edit still shows up — it just doesn't jump the
// queue. `ordering[0]` is therefore the cover.
export function applyPhotoEdits(photos, edit) {
  if (!edit) return photos
  const hidden = new Set(edit.hidden || [])
  const rank = new Map((edit.ordering || []).map((url, i) => [url, i]))
  return photos
    .filter((p) => !hidden.has(p.url))
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      const ra = rank.has(a.p.url) ? rank.get(a.p.url) : Number.MAX_SAFE_INTEGER
      const rb = rank.has(b.p.url) ? rank.get(b.p.url) : Number.MAX_SAFE_INTEGER
      return ra - rb || a.i - b.i
    })
    .map((x) => x.p)
}

// Admin-only; the RPC rejects everyone else. An empty overlay clears the row.
export async function savePhotoEdits(vin, { hidden = [], ordering = [] }) {
  const { error } = await supabase.rpc('set_listing_photo_edits', {
    p_vin: vin,
    p_hidden: hidden,
    p_ordering: ordering,
  })
  if (error) throw error
}
