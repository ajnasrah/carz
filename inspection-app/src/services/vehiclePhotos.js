// Car-level photo access — every photo we hold for a vehicle, whatever put it
// there: the crews' Telegram photos, shots taken in the app, and the inspection
// flow's checklist photos.
//
// This is deliberately NOT body-shop-specific. Photos belong to the car; the
// body shop, the car history screen, and anything else are all just callers.
// Nothing is ever copied between them, so a photo exists in exactly one place.

import { supabase } from './supabase'

const UPLOAD_BUCKET = 'car-history'
const SIGNED_URL_TTL = 60 * 60   // 1h — long enough for a shift, short enough to matter

// Where a photo came from, for the badge on each thumbnail.
export const PHOTO_SOURCE_LABELS = {
  body_shop:  'Body Shop',
  mechanic:   'Mechanic',
  transport:  'Transport',
  ready:      'Ready to Sell',
  seller:     'Intake',
  app:        'Added in App',
  inspection: 'Inspection',
}

export function photoSourceLabel(photo) {
  return PHOTO_SOURCE_LABELS[photo.station] || PHOTO_SOURCE_LABELS[photo.source] || 'Photo'
}

// EVERY photo we hold for a car — Telegram (any group), app uploads, inspection
// shots — newest first. This is car-level on purpose: the body shop is just one
// caller, and the car history screen calls the same thing. Nothing is copied
// between them.
//
// car-history is private, so its URLs are signed per read. Public buckets get a
// plain public URL. Signing is batched per bucket — one request, not one per photo.
export async function fetchVehiclePhotos({ vin6, stockNumber } = {}) {
  if (!vin6) return []

  const { data, error } = await supabase.rpc('vehicle_photos', {
    p_vin6: vin6, p_stock: stockNumber || null,
  })
  if (error) throw error

  const rows = (data || []).filter((r) => r.path)
  if (rows.length === 0) return []

  // Sign the private ones, one batch per bucket.
  const privateByBucket = new Map()
  for (const r of rows) {
    if (r.is_public) continue
    if (!privateByBucket.has(r.bucket)) privateByBucket.set(r.bucket, [])
    privateByBucket.get(r.bucket).push(r.path)
  }

  const signed = new Map()
  await Promise.all([...privateByBucket.entries()].map(async ([bucket, paths]) => {
    const { data: urls, error: signErr } = await supabase.storage
      .from(bucket).createSignedUrls(paths, SIGNED_URL_TTL)
    // One bad bucket shouldn't blank the whole gallery — the rest still render.
    if (signErr) { console.error('signing failed for', bucket, signErr.message); return }
    for (const u of urls || []) if (u.signedUrl) signed.set(`${bucket}/${u.path}`, u.signedUrl)
  }))

  return rows.map((r) => ({
    bucket: r.bucket,
    path: r.path,
    source: r.source,
    station: r.station,
    takenAt: r.taken_at,
    url: r.is_public
      ? supabase.storage.from(r.bucket).getPublicUrl(r.path).data.publicUrl
      : signed.get(`${r.bucket}/${r.path}`) || null,
  })).filter((p) => p.url)
}

// Shoot a photo in the app. Goes into the same `<vin6>/` folder the bot uses, so
// there's one place a car's photos live, and gets indexed at the car level.
export async function uploadVehiclePhoto({ vin6, stockNumber, vin }, file) {
  if (!vin6) throw new Error('No VIN on this car — photos need one to attach to')
  const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase()
  const uid = crypto.randomUUID().slice(0, 8)
  const path = `${vin6}/app-${uid}.${ext}`

  const { error: upErr } = await supabase.storage
    .from(UPLOAD_BUCKET).upload(path, file, { contentType: file.type || 'image/jpeg' })
  if (upErr) throw new Error(upErr.message || 'Upload failed')

  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase.from('vehicle_photos').insert({
    vin6, stock_number: stockNumber || null, vin: vin || null,
    bucket: UPLOAD_BUCKET, path, source: 'app', created_by: user?.id || null,
  })
  if (error) throw error
  return path
}

// Only ever removes app-added photos. A Telegram photo is the crew's record of
// what the car looked like — deleting it from here would silently rewrite the
// car's history, so the UI doesn't offer it.
export async function deleteVehiclePhoto(photo) {
  if (photo.source !== 'app') throw new Error('Only photos added in the app can be deleted')
  const { error } = await supabase.storage.from(photo.bucket).remove([photo.path])
  if (error) throw error
  await supabase.from('vehicle_photos').delete().eq('path', photo.path)
}
