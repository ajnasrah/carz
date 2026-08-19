// Put a listing's photos in the house order — automatically.
//
// The order itself lives where it always has: listing_photo_edits, the overlay
// that both the marketplace (applyPhotoEdits) and the SmartAuction upload
// (ready_to_sell_photos) already read. This endpoint is only a new WRITER of
// that overlay, so nothing about how a gallery renders changes, and an admin can
// still open Edit Photos and overrule it — after which this leaves the car
// alone, enforced in set_listing_photo_edits_auto rather than trusted here.
//
//   GET/POST /api/photo-sort               sweep cars that need sorting
//   GET/POST /api/photo-sort?vin=<VIN>     one car
//   ...&dry=1                              label and sort, write nothing
//   ...&model=<id>                         override the classifier (dry runs only)
//   ...&limit=<n>                          cars per sweep (default 10)
//
// Two ways in: the project's CRON_SECRET, the same shape as intake-sweep and
// sms-nudge, which is what the nightly cron sends; or a signed-in admin's token,
// which is what the Auto-sort button in Edit Photos sends. Neither is optional —
// an open endpoint here would let anyone on the internet spend our Anthropic
// balance a car at a time.
//
// Env (Vercel): SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, CRON_SECRET

import { classifyPhotos, sortPhotos, DEFAULT_MODEL } from './_lib/photoSort.js'

// A car takes ten to fifteen seconds — thirty photographs, three chunks, one
// verification pass, all deliberately sequential — so a sweep of six needs more
// than the default minute. Cars are committed one at a time regardless, so
// running out of time costs at most the car in flight; the next sweep, a quarter
// of an hour later, picks up whatever was left.
export const config = { maxDuration: 300 }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
}
function send(res, status, body) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v)
  res.setHeader('Content-Type', 'application/json')
  res.status(status).json(body)
}

function sb(path, init = {}) {
  return fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
}

// Same check as set_listing_photo_edits does in SQL, for the same reason: a
// token belonging to a buyer is a perfectly valid token, and buyers do not get
// to rearrange our galleries.
async function isAdmin(token) {
  if (!token) return false
  const u = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  })
  if (!u.ok) return false
  const user = await u.json().catch(() => null)
  if (!user?.id) return false
  const p = await sb(`profiles?id=eq.${user.id}&select=role`)
  const [profile] = p.ok ? await p.json().catch(() => []) : []
  return profile?.role === 'admin'
}

// Every photo the marketplace shows for a car, in the order it shows them now.
// Read from the same RPC the marketplace itself reads, so the sorter can never
// be working from a different set of pictures than the page.
async function listings() {
  const r = await sb('rpc/marketplace_listings', { method: 'POST', body: '{}' })
  if (!r.ok) throw new Error(`marketplace_listings ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const rows = await r.json()
  return rows
    .map((c) => ({
      vin: (c.full_vin || c.vin || '').toUpperCase(),
      stock: c.stock_number,
      car: [c.year, c.make, c.model].filter(Boolean).join(' '),
      photos: Object.values((c.checklist || {}).photos || {})
        .map((p) => p?.url)
        .filter(Boolean),
    }))
    .filter((c) => c.vin && c.photos.length)
}

async function cachedTags(urls) {
  const tags = new Map()
  // Chunked for the same reason as fetchPhotoEdits on the client: a few hundred
  // URLs in one ?in=(…) makes a request line long enough to be rejected before
  // it reaches Postgres.
  for (let i = 0; i < urls.length; i += 50) {
    const part = urls.slice(i, i + 50)
    const q = part.map((u) => `"${encodeURIComponent(u)}"`).join(',')
    const r = await sb(`listing_photo_tags?url=in.(${q})&select=url,label,quality`)
    if (!r.ok) continue
    for (const row of await r.json()) tags.set(row.url, { label: row.label, quality: row.quality })
  }
  return tags
}

async function saveTags(vin, tags, model) {
  const rows = [...tags].map(([url, t]) => ({ url, vin, label: t.label, quality: t.quality, model }))
  if (!rows.length) return
  await sb('listing_photo_tags?on_conflict=url', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(rows),
  })
}

// One car: label whatever hasn't been labelled yet, sort the whole set, write.
async function sortCar(car, { dry, model }) {
  // Ask before looking, not after. set_listing_photo_edits_auto refuses to
  // overwrite a person's arrangement anyway, but finding that out at the end
  // means having already paid to label thirty photographs for a car whose order
  // was never going to change. A dry run still labels — that is the Auto-sort
  // button asking what it WOULD do, which is a fair question about any car.
  if (!dry) {
    const r = await sb(`listing_photo_edits?vin=eq.${encodeURIComponent(car.vin)}&select=set_by`)
    const [row] = r.ok ? await r.json().catch(() => []) : []
    if (row && row.set_by !== 'ai') {
      return { vin: car.vin, stock: car.stock, car: car.car, photos: car.photos.length, result: 'curated' }
    }
  }

  const known = await cachedTags(car.photos)
  const fresh = car.photos.filter((u) => !known.has(u))

  let usage = { input_tokens: 0, output_tokens: 0 }
  if (fresh.length) {
    const out = await classifyPhotos(fresh, { apiKey: process.env.ANTHROPIC_API_KEY, model })
    usage = out.usage
    for (const [url, t] of out.tags) known.set(url, t)
    // Cache before writing the order: if the overlay write fails we still keep
    // what we paid to look at, and the retry costs nothing.
    if (!dry) await saveTags(car.vin, out.tags, model)
  }

  const { ordering, hidden, unusable } = sortPhotos(car.photos, known)

  let result = 'dry'
  if (!dry) {
    const r = await sb('rpc/set_listing_photo_edits_auto', {
      method: 'POST',
      body: JSON.stringify({ p_vin: car.vin, p_hidden: hidden, p_ordering: ordering }),
    })
    if (!r.ok) throw new Error(`write ${r.status}: ${(await r.text()).slice(0, 200)}`)
    result = await r.json()
  }

  return {
    vin: car.vin,
    stock: car.stock,
    car: car.car,
    photos: car.photos.length,
    classified: fresh.length,
    cached: car.photos.length - fresh.length,
    unusable: unusable.length,
    result,
    usage,
    labels: ordering.map((url) => ({
      url,
      label: known.get(url)?.label || null,
      unusable: unusable.includes(url) || undefined,
    })),
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 200, {})

  const q = { ...(req.query || {}), ...(typeof req.body === 'object' ? req.body : {}) }
  const auth = req.headers.authorization || ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const secret = process.env.CRON_SECRET

  const viaCron = !!secret && (bearer === secret || q.secret === secret)
  if (!viaCron && !(await isAdmin(bearer))) return send(res, 401, { error: 'unauthorized' })

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return send(res, 500, { error: 'server not configured' })
  }
  if (!process.env.ANTHROPIC_API_KEY) return send(res, 500, { error: 'ANTHROPIC_API_KEY missing' })

  const dry = q.dry === '1' || q.dry === true
  // A model override is a testing affordance, not a knob: letting an admin pick
  // the model on a write would leave the lot labelled by several different
  // models at once, and the cache makes that permanent.
  const model = dry && q.model ? String(q.model) : DEFAULT_MODEL
  const limit = Math.min(parseInt(q.limit || '6', 10) || 6, 40)

  try {
    const all = await listings()
    const vin = q.vin ? String(q.vin).toUpperCase() : null
    let cars = vin ? all.filter((c) => c.vin === vin || c.vin.endsWith(vin)) : all
    if (vin && !cars.length) return send(res, 404, { error: `no listing for ${vin}` })

    if (!vin) {
      // Sweep: only cars whose gallery would actually change — one this has
      // never sorted, or one that has grown photos since. Cars an admin
      // arranged by hand are dropped here as well as refused in SQL, so a
      // curated car never even gets looked at.
      const r = await sb('listing_photo_edits?select=vin,ordering,set_by')
      const edits = new Map((r.ok ? await r.json() : []).map((e) => [e.vin, e]))
      cars = cars
        .filter((c) => {
          const e = edits.get(c.vin)
          if (!e) return true
          if (e.set_by !== 'ai') return false
          const seen = new Set(e.ordering || [])
          return c.photos.some((u) => !seen.has(u))
        })
        .slice(0, limit)
    }

    const results = []
    for (const car of cars) {
      try {
        results.push(await sortCar(car, { dry, model }))
      } catch (e) {
        results.push({ vin: car.vin, stock: car.stock, error: String(e?.message || e) })
      }
    }

    const usage = results.reduce(
      (a, r) => ({
        input_tokens: a.input_tokens + (r.usage?.input_tokens || 0),
        output_tokens: a.output_tokens + (r.usage?.output_tokens || 0),
      }),
      { input_tokens: 0, output_tokens: 0 },
    )
    return send(res, 200, { model, dry, cars: results.length, usage, results })
  } catch (e) {
    console.error('photo-sort failed:', e?.message || e)
    return send(res, 500, { error: String(e?.message || e) })
  }
}
