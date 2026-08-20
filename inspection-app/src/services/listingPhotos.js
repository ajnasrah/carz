import { supabase } from './supabase'
import { API_BASE_URL } from '../native/platform'

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

// Add photos to a car from the app.
//
// Goes through /api/listing-upload rather than writing to storage from here:
// anon is RLS-blocked from writing, and widening that would let anything holding
// the public bundle's key put pictures on any car. The endpoint checks the
// session belongs to an admin and writes with the service key.
//
// Sent in batches because a Vercel function body caps around 4.5MB and phone
// photos are 3-5MB each; `done` rides on the last batch so the photo sort runs
// once, on the finished set. Files are downscaled first — a 12MP original is
// four times the size of anything the marketplace displays.
const UPLOAD_BATCH = 4
const MAX_EDGE = 1600

function shrink(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
    img.onload = () => {
      URL.revokeObjectURL(url)
      let { width: w, height: h } = img
      if (w > MAX_EDGE || h > MAX_EDGE) {
        const r = Math.min(MAX_EDGE / w, MAX_EDGE / h)
        w = Math.round(w * r); h = Math.round(h * r)
      }
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1])
    }
    img.src = url
  })
}

export async function uploadListingPhotos(vin, files, onProgress) {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Sign in again and retry')

  const list = [...files].filter((f) => /^image\//.test(f.type))
  if (!list.length) throw new Error('Those files are not images')

  const urls = []
  for (let i = 0; i < list.length; i += UPLOAD_BATCH) {
    const batch = list.slice(i, i + UPLOAD_BATCH)
    const photos = (await Promise.all(batch.map(shrink))).filter(Boolean)
    if (!photos.length) continue

    const res = await fetch(`${API_BASE_URL}/api/listing-upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ vin, photos, done: i + UPLOAD_BATCH >= list.length }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body?.error || `Upload failed (${res.status})`)
    urls.push(...(body.urls || []))
    onProgress?.(Math.min(i + batch.length, list.length), list.length)
  }
  return urls
}

// The house order for one car's photos — front three-quarter first, then the
// rest of the walkaround, interior, close-ups, paperwork.
//
// Every car gets this automatically within a quarter of an hour of its photos
// landing; this is the same sort on demand, for a car you want redone now. It
// ASKS rather than writes (dry): the ordering comes back, the editor shows it,
// and it only becomes the listing's order when you press Save — which stamps
// the edit as yours and takes the car off the automatic sweep for good.
//
// Runs on the server (api/photo-sort.js) because it looks at the pictures with
// Claude, and that key cannot ship inside the bundle.
export async function autoSortPhotos(vin) {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Sign in again and retry')

  const res = await fetch(`${API_BASE_URL}/api/photo-sort?vin=${encodeURIComponent(vin)}&dry=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: '{}',
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Auto-sort failed (${res.status})`)

  const car = body.results?.[0]
  if (!car) throw new Error('That car is not on the marketplace')
  if (car.error) throw new Error(car.error)
  return { ordering: car.labels.map((l) => l.url), labels: car.labels }
}
